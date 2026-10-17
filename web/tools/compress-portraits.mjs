#!/usr/bin/env node
/**
 * 画像批量压缩：把 2048×2048 的 JPG 缩到显示所需的 320×320 并重编码。
 * 用法：node web/tools/compress-portraits.mjs [--dry-run] [--size=320] [--quality=78]
 *
 * 依赖：Windows 自带 PowerShell + System.Drawing，无需 npm 安装。
 * 旧版依赖的 web/.tools/node_modules/jpeg-js 未随仓库提供，脚本跑不起来，故重写。
 *
 * 流程：PowerShell 一次性处理全部图片，结果写到临时目录；Node 侧比较体积，
 * 只有确实变小才覆盖原图（--dry-run 只报告不写盘）。
 * 逐张起 powershell.exe 每张约 0.5s、274 张要几分钟，所以这里只冷启动一次进程。
 */
import { readdirSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'portraits');
const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const num = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const TARGET = num('size', 320);    // 显示最大 120px（详情头像），320 留足 2x 余量
const QUALITY = num('quality', 78); // 人像 78 质量肉眼几乎无损

/**
 * 遍历 portraits 根目录与 people/ 等子目录下全部 jpg。
 *
 * 跳过 artifacts/ 与 artifacts-thumb/：
 *   - artifacts/ 是器物图原图，点击放大（lightbox）要按 90vw 显示，必须保留高分辨率；
 *     它的卡片缩略图由 web/tools/make-artifact-thumbs.mjs 单独生成到 artifacts-thumb/。
 *   - artifacts-thumb/ 已是 480px 宽的成品，再压到 320 会白白损失清晰度。
 * 本脚本只面向「头像/书封」这类显示尺寸 ≤120px 的图（2x 屏留 320 足够）。
 */
const SKIP_DIRS = new Set(['artifacts', 'artifacts-thumb']);
function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (SKIP_DIRS.has(f)) continue;
      out.push(...walk(p));
    } else if (/\.jpg$/i.test(f)) out.push(p);
  }
  return out;
}

const files = existsSync(ROOT) ? walk(ROOT) : [];
if (!files.length) { console.error('未找到画像：', ROOT); process.exit(1); }
console.log(`共 ${files.length} 张 JPG → ${TARGET}×${TARGET} 质量 ${QUALITY}${dryRun ? '（DRY RUN 不写盘）' : ''}`);

const OUT_DIR = join(tmpdir(), 'dsh-portraits-out');
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// 路径清单与输出映射：清单按行传，输出目录用序号对应，避免中文/引号路径的转义问题
const LIST = join(HERE, '.portrait-list.txt');
writeFileSync(LIST, files.map((f, i) => `${i}\t${f}`).join('\r\n'), 'utf8');

/**
 * 批处理脚本：一次读入清单，逐张缩放重编码并写到临时目录。
 * 以 EncodedCommand(base16/utf16le) 传入——argv 直传多行脚本会被引号规则撕碎，
 * -File 又会被执行策略拦下，这是默认 Windows 上唯一能跑通的调用方式。
 * 路径写成脚本内字面量：powershell.exe 不允许 -EncodedCommand 之后跟位置参数。
 */
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const PS = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$size=${TARGET}; $q=${QUALITY}
$outDir=${q(OUT_DIR)}
$list=${q(LIST)}
$enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg'}
foreach ($line in [System.IO.File]::ReadAllLines($list)) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $tab=$line.IndexOf([char]9)
  if ($tab -lt 0) { continue }
  $idx=$line.Substring(0,$tab)
  $p=$line.Substring($tab+1)
  try {
    $img=[System.Drawing.Image]::FromFile($p)
    try {
      # 已达标的图直接跳过：否则每次运行都会把所有图重编码一遍，
      # 字节数虽几乎不变，却让 git 看到上百个无意义的二进制改动。
      if ($img.Width -le $size -and $img.Height -le $size) {
        Write-Output ("SKIP|" + $idx)
        continue
      }
      $bmp=New-Object System.Drawing.Bitmap $size,$size
      $g=[System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      # 居中方形缩放，与前端圆形裁剪（object-fit: cover）视觉一致
      $side=[Math]::Min($img.Width,$img.Height)
      $sx=[int](($img.Width-$side)/2); $sy=[int](($img.Height-$side)/2)
      $g.DrawImage($img,(New-Object System.Drawing.Rectangle 0,0,$size,$size),$sx,$sy,$side,$side,[System.Drawing.GraphicsUnit]::Pixel)
      $g.Dispose()
      $ep=New-Object System.Drawing.Imaging.EncoderParameters 1
      $ep.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),([long]$q)
      $dst=Join-Path $outDir ($idx + '.jpg')
      $bmp.Save($dst,$enc,$ep)
      $bmp.Dispose()
      Write-Output ("OK|" + $idx)
    } finally { $img.Dispose() }
  } catch {
    Write-Output ("ERR|" + $idx + "|" + $_.Exception.Message)
  }
}
`;

const encCmd = Buffer.from(PS, 'utf16le').toString('base64');
let raw;
try {
  raw = execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encCmd],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true });
} catch (e) {
  console.error('PowerShell 批处理失败：', String(e.stderr || e.message).split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

const done = new Set();
const skippedBySize = new Set();
for (const line of String(raw).split(/\r?\n/)) {
  const m = line.match(/^(OK|ERR|SKIP)\|(.+)$/);
  if (!m) continue;
  if (m[1] === 'ERR') console.log(`  ✗ ${m[2]} → ${files[Number(m[2])]?.slice(ROOT.length + 1)}: ${m.slice(2).join('|')}`);
  else if (m[1] === 'SKIP') skippedBySize.add(Number(m[2]));
  else done.add(Number(m[2]));
}

let before = 0, after = 0, saved = 0, skipped = 0, fail = 0;
files.forEach((f, i) => {
  const b = statSync(f).size;
  before += b;
  if (skippedBySize.has(i)) { skipped++; after += b; return; }   // 尺寸已达标，未重编码
  const out = join(OUT_DIR, `${i}.jpg`);
  if (!done.has(i) || !existsSync(out)) { fail++; after += b; return; }
  const s = statSync(out).size;
  if (s >= b) { skipped++; after += b; return; }  // 没变小就不覆盖，避免把小图换劣化
  after += s; saved++;
  if (!dryRun) copyFileSync(out, f);
});

rmSync(OUT_DIR, { recursive: true, force: true });
rmSync(LIST, { force: true });

console.log(`\n完成：${saved} 张已压缩，${skipped} 张已足够小，${fail} 张失败${dryRun ? '（DRY RUN 未写盘）' : ''}`);
console.log(`体积 ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB（省 ${((1 - after / before) * 100).toFixed(1)}%）`);
if (dryRun) console.log('去掉 --dry-run 即原地覆盖。');