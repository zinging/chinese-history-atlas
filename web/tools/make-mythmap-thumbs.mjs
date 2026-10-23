#!/usr/bin/env node
/**
 * 神话舆图图片瘦身（data/portraits/myth-map）：
 *
 * 1) 热点卡片配图：原图 2364×1773、平均约 950KB，而热点详情卡片只有 400px 宽
 *    （2x 屏最多需要 732px），且卡片没有二级放大——原图永远不会被按原始尺寸展示。
 *    故生成 800px 宽的缩略图到 data/portraits/myth-map-thumb/ 同名文件，
 *    卡片直接引用缩略图（已是最终显示尺寸，观感与原图一致）；
 *    原图保留在 myth-map/，作为日后做“点击放大”的素材与重新生成源。
 *    山海经 22 张已是 800×800，直接复制到缩略图目录（保证目录内文件齐全、零 404）。
 *
 * 2) 古舆图底图：底图 *-map.jpg 的显示宽度不超过约 1400px，统一规格为 1600×900。
 *    对超尺寸的底图（如聊斋/太平 2730×1536 各约 760KB）原位归一化（约 290KB，
 *    视觉无损）；已达标的底图跳过。
 *
 * 用法：node web/tools/make-mythmap-thumbs.mjs [--dry-run]
 *      [--width=800] [--quality=80] [--map-width=1600] [--map-quality=85]
 * 依赖：Windows 自带 PowerShell + System.Drawing，无需 npm 安装。
 */
import { readdirSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP_DIR = join(HERE, '..', '..', 'data', 'portraits', 'myth-map');
const THUMB_DIR = join(HERE, '..', '..', 'data', 'portraits', 'myth-map-thumb');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const num = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const WIDTH = num('width', 800);
const QUALITY = num('quality', 80);
const MAP_W = num('map-width', 1600);
const MAP_H = Math.round(MAP_W * 9 / 16);
const MAP_Q = num('map-quality', 85);

if (!existsSync(MAP_DIR)) { console.error('未找到原图目录：', MAP_DIR); process.exit(1); }
mkdirSync(THUMB_DIR, { recursive: true });

const all = readdirSync(MAP_DIR).filter((f) => /\.jpe?g$/i.test(f));
const cards = all.filter((f) => !/-map\.jpe?g$/i.test(f));
const maps = all.filter((f) => /-map\.jpe?g$/i.test(f));
if (!all.length) { console.error('myth-map 目录下没有 jpg'); process.exit(1); }

// 清单：类型(C=卡片 / M=底图) + 序号 + 原图路径 + 文件名
const rows = [
  ...cards.map((name, i) => ['C', i, join(MAP_DIR, name), name]),
  ...maps.map((name, i) => ['M', i, join(MAP_DIR, name), name]),
];
const LIST = join(HERE, '.mythmap-list.txt');
writeFileSync(LIST, rows.map((r) => `${r[0]}\t${r[1]}\t${r[2]}\t${r[3]}`).join('\r\n'), 'utf8');

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const PS = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$width=${WIDTH}; $q=${QUALITY}; $mw=${MAP_W}; $mh=${MAP_H}; $mq=${MAP_Q}
$outDir=${q(join(tmpdir(), 'dsh-mythmap-thumbs'))}
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
  if ($p.Count -lt 4) { continue }
  $type=$p[0]; $idx=$p[1]; $src=$p[2]; $name=$p[3]
  try {
    $img=[System.Drawing.Image]::FromFile($src)
    try {
      if ($type -eq 'C') {
        if ($img.Width -le $width) { Write-Output ("COPY|" + $type + "|" + $idx); continue }
        $h=[int][Math]::Round($img.Height * $width / $img.Width)
        $bmp=New-Object System.Drawing.Bitmap $width,$h
      } else {
        if ($img.Width -le $mw) { Write-Output ("SKIP|" + $type + "|" + $idx); continue }
        $bmp=New-Object System.Drawing.Bitmap $mw,$mh
        $h=$mh
      }
      $g=[System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.DrawImage($img,0,0,$bmp.Width,$bmp.Height)
      $g.Dispose()
      $useQ = if ($type -eq 'C') { $q } else { $mq }
      $dst=Join-Path $outDir ($type + '_' + $idx + '.jpg')
      Save-Jpeg $bmp $useQ $dst
      $bmp.Dispose()
      Write-Output ("OK|" + $type + "|" + $idx)
    } finally { $img.Dispose() }
  } catch {
    Write-Output ("ERR|" + $type + "|" + $idx + "|" + $_.Exception.Message)
  }
}
`;

const OUT_DIR = join(tmpdir(), 'dsh-mythmap-thumbs');
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
  const m = line.match(/^(OK|ERR|SKIP|COPY)\|(C|M)\|(\d+)(?:\|(.+))?$/);
  if (!m) continue;
  if (m[1] === 'ERR') { console.log(`  失败 ${m[2] === 'C' ? '卡片' : '底图'} ${m[3]}: ${m[4]}`); }
  status.set(`${m[2]}_${m[3]}`, m[1]);
}

let thumbBefore = 0, thumbAfter = 0, made = 0, copied = 0, fail = 0;
cards.forEach((name, i) => {
  const srcPath = join(MAP_DIR, name);
  const before = statSync(srcPath).size;
  thumbBefore += before;
  const st = status.get(`C_${i}`);
  const dstPath = join(THUMB_DIR, name);
  if (st === 'COPY') {
    if (!dryRun) copyFileSync(srcPath, dstPath);
    thumbAfter += before; copied++;
  } else if (st === 'OK') {
    const out = join(OUT_DIR, `C_${i}.jpg`);
    if (!existsSync(out)) { fail++; thumbAfter += before; return; }
    const s = statSync(out).size;
    thumbAfter += s; made++;
    if (!dryRun) copyFileSync(out, dstPath);
  } else {
    fail++; thumbAfter += before;
  }
});

let mapBefore = 0, mapAfter = 0, mapsNormalized = 0;
maps.forEach((name, i) => {
  const srcPath = join(MAP_DIR, name);
  const before = statSync(srcPath).size;
  mapBefore += before;
  const st = status.get(`M_${i}`);
  if (st === 'SKIP') { mapAfter += before; return; }
  if (st === 'OK') {
    const out = join(OUT_DIR, `M_${i}.jpg`);
    if (!existsSync(out)) { mapAfter += before; return; }
    mapAfter += statSync(out).size; mapsNormalized++;
    if (!dryRun) copyFileSync(out, srcPath);
  } else {
    mapAfter += before;
  }
});

rmSync(OUT_DIR, { recursive: true, force: true });
rmSync(LIST, { force: true });

console.log(`热点卡片图：生成 ${made} 张 ${WIDTH}px 缩略图（q${QUALITY}），原尺寸复制 ${copied} 张，失败 ${fail} 张`);
console.log(`  目录 ${THUMB_DIR}`);
console.log(`  体积 ${(thumbBefore / 1048576).toFixed(1)}MB → ${(thumbAfter / 1048576).toFixed(1)}MB（省 ${((1 - thumbAfter / thumbBefore) * 100).toFixed(0)}%）`);
console.log(`古舆图底图：${mapsNormalized ? '归一化 ' + mapsNormalized + ' 张到 ' + MAP_W + '×' + MAP_H + '（q' + MAP_Q + '）' : '全部达标，无需处理'}`);
console.log(`  体积 ${(mapBefore / 1048576).toFixed(2)}MB → ${(mapAfter / 1048576).toFixed(2)}MB（省 ${((1 - mapAfter / mapBefore) * 100).toFixed(0)}%）`);
if (dryRun) console.log('（DRY RUN 未写盘，去掉 --dry-run 正式生成）');
