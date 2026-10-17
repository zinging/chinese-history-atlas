#!/usr/bin/env node
/**
 * 器物图缩略图：为 data/portraits/artifacts 下的原图生成 480px 宽的缩略图，
 * 放到 data/portraits/artifacts-thumb/ 同名文件。
 *
 * 为什么需要：器物图原图是 1600–2364px、平均 531KB，但卡片只显示 220×160
 * （2x 屏需 440×320）。一屏 27 张就要 7.2MB，其中 95% 是浪费。
 * 卡片改用缩略图后，点击放大（lightbox）仍加载原图，显示效果不变。
 *
 * 用法：node web/tools/make-artifact-thumbs.mjs [--dry-run] [--width=480] [--quality=72]
 * 依赖：Windows 自带 PowerShell + System.Drawing，无需 npm 安装。
 */
import { readdirSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', 'data', 'portraits');
const SRC = join(ROOT, 'artifacts');
const DST = join(ROOT, 'artifacts-thumb');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const num = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const WIDTH = num('width', 480);
const QUALITY = num('quality', 72);

if (!existsSync(SRC)) { console.error('未找到原图目录：', SRC); process.exit(1); }
mkdirSync(DST, { recursive: true });

const files = readdirSync(SRC).filter((f) => /\.jpe?g$/i.test(f));
if (!files.length) { console.error('原图目录下没有 jpg'); process.exit(1); }
console.log(`共 ${files.length} 张 → 宽 ${WIDTH}px、质量 ${QUALITY}${dryRun ? '（DRY RUN 不写盘）' : ''}`);

const OUT_DIR = join(tmpdir(), 'dsh-artifact-thumbs');
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// 清单用「序号\t原图路径\t输出名」，避免中文与空格路径的转义问题
const LIST = join(HERE, '.artifact-thumb-list.txt');
writeFileSync(LIST, files.map((f, i) => `${i}\t${join(SRC, f)}\t${f}`).join('\r\n'), 'utf8');

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const PS = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$width=${WIDTH}; $q=${QUALITY}
$outDir=${q(OUT_DIR)}
$list=${q(LIST)}
$enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
foreach ($line in [System.IO.File]::ReadAllLines($list)) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $parts=$line.Split([char]9)
  if ($parts.Count -lt 3) { continue }
  $idx=$parts[0]; $p=$parts[1]; $name=$parts[2]
  try {
    $img=[System.Drawing.Image]::FromFile($p)
    try {
      if ($img.Width -le $width) { Write-Output ("SKIP|" + $idx); continue }
      $h=[int][Math]::Round($img.Height * $width / $img.Width)
      $bmp=New-Object System.Drawing.Bitmap $width,$h
      $g=[System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.DrawImage($img,0,0,$width,$h)
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
  raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encCmd],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true });
} catch (e) {
  console.error('PowerShell 批处理失败：', String(e.stderr || e.message).split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

const done = new Set(), skipped = new Set();
for (const line of String(raw).split(/\r?\n/)) {
  const m = line.match(/^(OK|ERR|SKIP)\|(.+)$/);
  if (!m) continue;
  if (m[1] === 'ERR') console.log(`  失败 ${files[Number(m[2])]}: ${m.slice(2).join('|')}`);
  else if (m[1] === 'SKIP') skipped.add(Number(m[2]));
  else done.add(Number(m[2]));
}

let before = 0, after = 0, made = 0, fail = 0;
files.forEach((f, i) => {
  const srcPath = join(SRC, f);
  const b = statSync(srcPath).size;
  before += b;
  if (skipped.has(i)) { after += b; return; }
  const out = join(OUT_DIR, `${i}.jpg`);
  if (!done.has(i) || !existsSync(out)) { fail++; after += b; return; }
  const s = statSync(out).size;
  after += s; made++;
  if (!dryRun) copyFileSync(out, join(DST, f));
});

rmSync(OUT_DIR, { recursive: true, force: true });
rmSync(LIST, { force: true });

if (dryRun) {
  // 预估：dry run 下仍生成了缩略图，这里报告预估体积
  console.log(`\n预估：${made} 张缩略图，约 ${(after / 1048576).toFixed(1)}MB（原图 ${(before / 1048576).toFixed(1)}MB，省 ${((1 - after / before) * 100).toFixed(0)}%）`);
  console.log('去掉 --dry-run 即写入 ' + DST);
} else {
  console.log(`\n完成：生成 ${made} 张缩略图，跳过 ${skipped.size} 张，失败 ${fail} 张`);
  console.log(`输出目录 ${DST}`);
}