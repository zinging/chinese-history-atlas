#!/usr/bin/env node
/**
 * 诗词生平事件配图瘦身：把出图模型的原始大图（data/portraits/.poet-raw/）
 * 缩到 800px 宽，输出到 data/portraits/poet-events/<事件 id>.jpg —— 站点只引这一份。
 * 与 make-sect-thumbs.mjs 同一套 System.Drawing 流程，无需 npm 安装。
 *
 * 用法：node web/tools/make-poet-thumbs.mjs [--width=800] [--quality=82]
 */
import { readdirSync, existsSync, statSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(HERE, '..', '..', 'data', 'portraits', '.poet-raw');
const OUT_DIR = join(HERE, '..', '..', 'data', 'portraits', 'poet-events');

const args = process.argv.slice(2);
const num = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const WIDTH = num('width', 800);
const QUALITY = num('quality', 82);

if (!existsSync(RAW_DIR)) { console.log('没有待处理的原图：', RAW_DIR); process.exit(0); }
mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(RAW_DIR).filter((f) => /\.jpe?g$/i.test(f));
if (!files.length) { console.log('原图目录下没有 jpg。'); process.exit(0); }

const LIST = join(HERE, '.poet-raw-list.txt');
writeFileSync(LIST, files.map((name, i) => `${i}\t${join(RAW_DIR, name)}\t${name}`).join('\r\n'), 'utf8');

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const TMP_DIR = join(tmpdir(), 'dsh-poet-thumbs');
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
  if (st === 'COPY') { copyFileSync(srcPath, dstPath); after += sz; copied++; }
  else if (st === 'OK') {
    const out = join(TMP_DIR, `${i}.jpg`);
    if (!existsSync(out)) { fail++; after += sz; return; }
    const s = statSync(out).size; after += s; made++;
    copyFileSync(out, dstPath);
  } else { fail++; after += sz; }
});

rmSync(TMP_DIR, { recursive: true, force: true });
rmSync(LIST, { force: true });
console.log(`诗词事件配图：生成 ${made} 张 ${WIDTH}px（q${QUALITY}），原尺寸复制 ${copied} 张，失败 ${fail} 张`);
console.log(`  目录 ${OUT_DIR}`);
console.log(`  体积 ${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB`);
