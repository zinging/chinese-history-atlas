#!/usr/bin/env node
/**
 * 事件工笔彩绘图瘦身（data/portraits/event-gongbi）：
 * 事件详情卡配图最大约 300px 宽（2x 屏 600px），原图统一缩到 800px 宽生成缩略图，
 * 输出到 data/portraits/event-gongbi-thumb/ 同名文件，卡片直接引缩略图；
 * 原图保留在 event-gongbi/，供点击放大与日后再生成。
 * 已小于等于目标宽度的直接复制（保证目录齐全、零 404）。
 *
 * 用法：node web/tools/make-event-thumbs.mjs [--dry-run] [--width=800] [--quality=82]
 * 依赖：Windows 自带 PowerShell + System.Drawing，无需 npm 安装。
 */
import { readdirSync, existsSync, statSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', '..', 'data', 'portraits', 'event-gongbi');
const THUMB_DIR = join(HERE, '..', '..', 'data', 'portraits', 'event-gongbi-thumb');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const num = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const WIDTH = num('width', 800);
const QUALITY = num('quality', 82);

if (!existsSync(SRC_DIR)) { console.error('未找到原图目录：', SRC_DIR); process.exit(1); }
mkdirSync(THUMB_DIR, { recursive: true });

const files = readdirSync(SRC_DIR).filter((f) => /\.jpe?g$/i.test(f));
if (!files.length) { console.log('event-gongbi 目录下暂无 jpg（图片生成后再跑本脚本）。'); process.exit(0); }

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

rmSync(OUT_DIR, { recursive: true, force: true });
rmSync(LIST, { force: true });
console.log(`事件图：生成 ${made} 张 ${WIDTH}px 缩略图（q${QUALITY}），原尺寸复制 ${copied} 张，失败 ${fail} 张`);
console.log(`  目录 ${THUMB_DIR}`);
console.log(`  体积 ${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB`);
if (dryRun) console.log('（DRY RUN 未写盘，去掉 --dry-run 正式生成）');
