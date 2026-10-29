#!/usr/bin/env node
/**
 * 事件工笔彩绘图瘦身：把事件图缩到 680px 宽，落到 data/portraits/event-gongbi-thumb/。
 * 站点只用这一份——事件卡最宽 380px，图渲染宽 275~327px，680 宽在 2x 高分屏下仍有 0.81~0.96
 * 的余量（实测见 .sessions/gh-measure-fig.mjs），再大就是用不上的像素。
 * 事件图不做点击放大，因此不保留原图：event-gongbi/ 只是「新图进来时的暂存区」，用完可删。
 * 没有暂存区时本脚本原地重压 event-gongbi-thumb/，所以只有缩略图的常态下也能跑。
 * 已小于等于目标宽度的直接复制（保证目录齐全、零 404）。
 *
 * 用法：node web/tools/make-event-thumbs.mjs [--dry-run] [--width=680] [--quality=82]
 * 依赖：Windows 自带 PowerShell + System.Drawing，无需 npm 安装。
 */
import { readdirSync, existsSync, statSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FULL_DIR = join(HERE, '..', '..', 'data', 'portraits', 'event-gongbi');
const THUMB_DIR = join(HERE, '..', '..', 'data', 'portraits', 'event-gongbi-thumb');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const num = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const WIDTH = num('width', 680);
const QUALITY = num('quality', 82);

// 图片来源：优先用 event-gongbi/（新生成的高分辨率原图，用完即可删）；
// 没有该目录时直接在 event-gongbi-thumb/ 上原地重压——
// 站点只保留缩略图，所以「只有缩略图」是常态，流水线必须在这种常态下也能跑。
// 原地重压安全：读源图 → 编码到临时目录 → 再拷回，不会边读边写同一个文件。
const SRC_DIR = existsSync(FULL_DIR) ? FULL_DIR : THUMB_DIR;
const inPlace = SRC_DIR === THUMB_DIR;
mkdirSync(THUMB_DIR, { recursive: true });

const files = readdirSync(SRC_DIR).filter((f) => /\.jpe?g$/i.test(f));
if (!files.length) {
  console.error('没有可处理的事件图：event-gongbi/ 与 event-gongbi-thumb/ 里都没有 jpg。');
  process.exit(1);
}
if (inPlace && !dryRun) {
  // 原地重压：先把每张图备份为 .bak，全部成功后再删，避免中途失败丢图。
  // 只在真正写盘时备份——dry-run 必须零副作用。
  for (const n of files) {
    const b = join(THUMB_DIR, n + '.bak');
    if (existsSync(b)) continue;          // 已有备份说明上轮失败过，保留最初那份，别用重压结果覆盖它
    try { copyFileSync(join(THUMB_DIR, n), b); } catch {}
  }
}

const LIST = join(HERE, '.event-list.txt');
writeFileSync(LIST, files.map((name, i) => `${i}\t${join(SRC_DIR, name)}\t${name}`).join('\r\n'), 'utf8');

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const PS = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$width=${WIDTH}; $q=${QUALITY}
$outDir=${q(join(tmpdir(), 'dsh-event-thumbs'))}
$list=${q(LIST)}
$enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
function Save-Jpeg($bmp,$quality,$dst){
  $ep=New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),([long]$quality)
  $bmp.Save($dst,$enc,$ep)
}
foreach ($line in [System.IO.File]::ReadAllLines($list)) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $p=$line.Split([char]9)
  if ($p.Count -lt 3) { continue }
  $idx=$p[0]; $src=$p[1]
  try {
    $img=[System.Drawing.Image]::FromFile($src)
    try {
      if ($img.Width -le $width) { Write-Output ("COPY|" + $idx); continue }
      $h=[int][Math]::Round($img.Height * $width / $img.Width)
      $bmp=New-Object System.Drawing.Bitmap $width,$h
      $g=[System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.DrawImage($img,0,0,$bmp.Width,$bmp.Height)
      $g.Dispose()
      $dst=Join-Path $outDir ($idx + '.jpg')
      Save-Jpeg $bmp $q $dst
      $bmp.Dispose()
      Write-Output ("OK|" + $idx)
    } finally { $img.Dispose() }
  } catch {
    Write-Output ("ERR|" + $idx + "|" + $_.Exception.Message)
  }
}
`;

const OUT_DIR = join(tmpdir(), 'dsh-event-thumbs');
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const encCmd = Buffer.from(PS, 'utf16le').toString('base64');
let raw;
try {
  raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encCmd],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true });
} catch (e) {
  console.error('PowerShell 批处理失败：', String(e.stderr || e.message).split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

const status = new Map();
for (const line of String(raw).split(/\r?\n/)) {
  const m = line.match(/^(OK|ERR|COPY)\|(\d+)(?:\|(.+))?$/);
  if (!m) continue;
  status.set(m[2], m[1] === 'ERR' ? 'ERR' : m[1]);
  if (m[1] === 'ERR') console.log(`  失败 ${m[2]}: ${m[3]}`);
}

let before = 0, after = 0, made = 0, copied = 0, fail = 0;
files.forEach((name, i) => {
  const srcPath = join(SRC_DIR, name);
  const sz = statSync(srcPath).size;
  before += sz;
  const st = status.get(String(i));
  const dstPath = join(THUMB_DIR, name);
  if (st === 'COPY') { if (!dryRun) copyFileSync(srcPath, dstPath); after += sz; copied++; }
  else if (st === 'OK') {
    const out = join(OUT_DIR, `${i}.jpg`);
    if (!existsSync(out)) { fail++; after += sz; return; }
    const s = statSync(out).size; after += s; made++;
    if (!dryRun) copyFileSync(out, dstPath);
  } else { fail++; after += sz; }
});

if (inPlace && !dryRun) {
  // 全部成功后清掉刚才留的备份，半途失败的图靠备份恢复
  const okAll = fail === 0 && made + copied === files.length;
  if (okAll) { for (const n of files) { const b = join(THUMB_DIR, n + '.bak'); try { rmSync(b, { force: true }); } catch {} } }
  else { console.error('重压未全部成功，已保留 .bak 备份，请排查后重跑。'); process.exitCode = 1; }
}

rmSync(OUT_DIR, { recursive: true, force: true });
rmSync(LIST, { force: true });
console.log(`事件图：生成 ${made} 张 ${WIDTH}px 缩略图（q${QUALITY}），原尺寸复制 ${copied} 张，失败 ${fail} 张`);
console.log(`  目录 ${THUMB_DIR}`);
console.log(`  体积 ${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB`);
if (dryRun) console.log('（DRY RUN 未写盘，去掉 --dry-run 正式生成）');
