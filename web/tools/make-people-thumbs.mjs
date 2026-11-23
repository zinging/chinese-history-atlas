#!/usr/bin/env node
/**
 * 人物头像入库：把出图模型的原始大图（.sessions/people-raw/）处理成站内规范头像。
 *
 * 规范（与 data/portraits/people/ 现有 258 张一致）：
 *   - 320×320 正方形
 *   - JPEG q85
 *   - 文件名 = 人物 id 去掉「<朝代>-p-」前缀后的拼音，如 qin-p-lisi → lisi.jpg
 *
 * 原图是 1536×1536 方图，直接等比缩到 320 即可；若遇到非方图则居中裁剪。
 *
 * 用法：node web/tools/make-people-thumbs.mjs [--dry-run]
 */
import { readdirSync, existsSync, statSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RAW_DIR = join(ROOT, '.sessions', 'people-raw');
const OUT_DIR = join(ROOT, 'data', 'portraits', 'people');

const SIZE = 320;
const QUALITY = 85;
const DRY = process.argv.includes('--dry-run');

if (!existsSync(RAW_DIR)) { console.log('没有待处理的原始头像：', RAW_DIR); process.exit(0); }
mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(RAW_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
if (!files.length) { console.log('原图目录下没有图片。'); process.exit(0); }

// 文件名 → 目标名：<朝代>-<拼音>.<ext> → <拼音>.jpg
const plan = files.map((name) => {
  const base = name.replace(/\.(jpe?g|png|webp)$/i, '');
  const parts = base.split('-');
  const pin = parts.slice(1).join('-');
  return { src: name, dst: pin + '.jpg' };
});
const dupes = plan.map((p) => p.dst).filter((v, i, a) => a.indexOf(v) !== i);
if (dupes.length) { console.error('目标文件名重复：', [...new Set(dupes)].join(', ')); process.exit(1); }

if (DRY) {
  console.log(`待处理 ${plan.length} 张（--dry-run，不写文件）`);
  for (const p of plan) {
    const exists = existsSync(join(OUT_DIR, p.dst));
    console.log(`  ${p.src.padEnd(30)} → ${p.dst}${exists ? '（已存在，将覆盖）' : ''}`);
  }
  process.exit(0);
}

const TMP_DIR = join(tmpdir(), 'dsh-people-thumbs');
rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

const LIST = join(HERE, '.people-raw-list.txt');
writeFileSync(LIST, plan.map((p, i) => `${i}\t${join(RAW_DIR, p.src)}\t${p.dst}`).join('\r\n'), 'utf8');

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const PS = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$size=${SIZE}; $q=${QUALITY}
$outDir=${q(TMP_DIR)}
$list=${q(LIST)}
$enc=[System.Drawing.Imaging.ImageCodecInfo] | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
if (-not $enc) { $enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } }
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
    # 先读字节再建流，避免 Image.FromFile 锁定源文件
    $bytes=[System.IO.File]::ReadAllBytes($src)
    $ms=New-Object System.IO.MemoryStream(,$bytes)
    $img=[System.Drawing.Image]::FromStream($ms)
    try {
      # 居中裁成正方形，再等比缩到目标尺寸
      $side=[Math]::Min($img.Width,$img.Height)
      $sx=[int](($img.Width-$side)/2)
      $sy=[int](($img.Height-$side)/2)
      $bmp=New-Object System.Drawing.Bitmap $size,$size
      $g=[System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $dstRect=New-Object System.Drawing.Rectangle 0,0,$size,$size
      $srcRect=New-Object System.Drawing.Rectangle $sx,$sy,$side,$side
      $g.DrawImage($img,$dstRect,$srcRect,[System.Drawing.GraphicsUnit]::Pixel)
      $g.Dispose()
      Save-Jpeg $bmp $q (Join-Path $outDir ($idx + '.jpg'))
      $bmp.Dispose()
      Write-Output ("OK|" + $idx)
    } finally { $img.Dispose(); $ms.Dispose() }
  } catch {
    Write-Output ("ERR|" + $idx + "|" + $_.Exception.Message)
  }
}
`;

const encCmd = Buffer.from(PS, 'utf16le').toString('base64');
let raw;
try {
  raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encCmd],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true });
} catch (e) {
  console.error('PowerShell 处理失败：', String(e.stderr || e.message).split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

const status = new Map();
for (const line of String(raw).split(/\r?\n/)) {
  const m = line.match(/^(OK|ERR)\|(\d+)(?:\|(.+))?$/);
  if (!m) continue;
  status.set(m[2], m[1]);
  if (m[1] === 'ERR') console.log(`  失败 ${m[2]}: ${m[3]}`);
}

let made = 0, fail = 0, before = 0, after = 0;
for (const [i, p] of plan.entries()) {
  const st = status.get(String(i));
  before += statSync(join(RAW_DIR, p.src)).size;
  if (st !== 'OK') { fail++; continue; }
  const out = join(TMP_DIR, `${i}.jpg`);
  if (!existsSync(out)) { fail++; continue; }
  copyFileSync(out, join(OUT_DIR, p.dst));
  after += statSync(out).size;
  made++;
}

rmSync(TMP_DIR, { recursive: true, force: true });
rmSync(LIST, { force: true });

console.log(`人物头像：生成 ${made} 张 ${SIZE}×${SIZE}（q${QUALITY}），失败 ${fail} 张`);
console.log(`  体积 ${(before / 1048576).toFixed(1)} MB → ${(after / 1024).toFixed(0)} KB`);
console.log(`  目录 ${OUT_DIR}`);
