#!/usr/bin/env node
/**
 * 思想大事配图瘦身：把出图模型给的原始大图（data/portraits/.sect-raw/）缩到 800px 宽，
 * 输出到 data/portraits/sect-events/<事件 id>.jpg —— 站点只引这一份。
 *
 * 为什么需要它：出图给的是 2364×1773、单张约 800KB，38 张就近 30MB；
 * 事件卡内图片渲染宽约 342px，2x 屏需 684px，800 宽已覆盖，
 * 直接把原图丢进仓库既浪费体积也拖慢首屏。
 *
 * 源图先读进内存再解码（ReadAllBytes + MemoryStream），不用 Image.FromFile：
 * 后者会持有文件锁，之前在事件工笔图上踩过「Save 到同名文件必然失败」的坑。
 *
 * 用法：node web/tools/make-sect-thumbs.mjs [--dry-run] [--width=800] [--quality=82]
 * 依赖：Windows 自带 PowerShell + System.Drawing，无需 npm 安装。
 * 原图目录 .sect-raw/ 是临时暂存区，已 gitignore；处理完可自行删除。
 */
import { readdirSync, existsSync, statSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(HERE, '..', '..', 'data', 'portraits', '.sect-raw');
const OUT_DIR = join(HERE, '..', '..', 'data', 'portraits', 'sect-events');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const num = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const WIDTH = num('width', 800);
const QUALITY = num('quality', 82);

if (!existsSync(RAW_DIR)) {
  console.log('没有待处理的原图：', RAW_DIR);
  console.log('（把出图模型的原始大图放进这个目录，跑本脚本，产物进 sect-events/）');
  process.exit(0);
}
mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(RAW_DIR).filter((f) => /\.jpe?g$/i.test(f));
if (!files.length) { console.log('原图目录下没有 jpg。'); process.exit(0); }

const LIST = join(HERE, '.sect-raw-list.txt');
writeFileSync(LIST, files.map((name, i) => `${i}\t${join(RAW_DIR, name)}\t${name}`).join('\r\n'), 'utf8');

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const TMP_DIR = join(tmpdir(), 'dsh-sect-thumbs');
const PS = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$width=${WIDTH}; $q=${QUALITY}
$outDir=${q(TMP_DIR)}
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
    $bytes=[System.IO.File]::ReadAllBytes($src)
    $ms=New-Object System.IO.MemoryStream(,$bytes)
    $img=[System.Drawing.Image]::FromStream($ms)
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
    } finally { $img.Dispose(); $ms.Dispose() }
  } catch {
    Write-Output ("ERR|" + $idx + "|" + $_.Exception.Message)
  }
}
`;

rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

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
  const srcPath = join(RAW_DIR, name);
  const sz = statSync(srcPath).size;
  before += sz;
  const st = status.get(String(i));
  const dstPath = join(OUT_DIR, name);
  if (st === 'COPY') { if (!dryRun) copyFileSync(srcPath, dstPath); after += sz; copied++; }
  else if (st === 'OK') {
    const out = join(TMP_DIR, `${i}.jpg`);
    if (!existsSync(out)) { fail++; after += sz; return; }
    const s = statSync(out).size; after += s; made++;
    if (!dryRun) copyFileSync(out, dstPath);
  } else { fail++; after += sz; }
});

rmSync(TMP_DIR, { recursive: true, force: true });
rmSync(LIST, { force: true });
console.log(`思想大事配图：生成 ${made} 张 ${WIDTH}px（q${QUALITY}），原尺寸复制 ${copied} 张，失败 ${fail} 张`);
console.log(`  目录 ${OUT_DIR}`);
console.log(`  体积 ${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB`);
if (dryRun) console.log('（DRY RUN 未写盘，去掉 --dry-run 正式生成）');
