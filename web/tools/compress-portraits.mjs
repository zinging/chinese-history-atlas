#!/usr/bin/env node
/* 画像批量压缩：2048x2048 JPG → 512x512 质量 75（约 40-90KB/张）
 * 用法：node web/tools/compress-portraits.mjs [--dry-run]
 * 备份：首次运行会把原图复制到 data/portraits-backup/
 * 依赖：web/.tools/node_modules/jpeg-js（纯 JS，无需系统工具）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// 依赖安装位置：web/.tools/node_modules/jpeg-js（脚本在 web/tools/ 下，需上两级）
const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.tools');
const require = createRequire(import.meta.url);
const jpeg = require(join(TOOLS_DIR, 'node_modules', 'jpeg-js'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'portraits');
const BACKUP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'portraits-backup');
const TARGET_SIZE = 512;      // 显示最大 120px，512 余量充足
const QUALITY = 75;           // 人像照 75 质量视觉接近无损

const dryRun = process.argv.includes('--dry-run');

/** 最近邻缩放：图像（RGBA Uint8Array）→ 目标尺寸。人像居中圆形展示，正方形缩放即可 */
function resize(rgba, w, h, tw, th) {
  const out = new Uint8Array(tw * th * 4);
  const xr = w / tw, yr = h / th;
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.floor(y * yr));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(x * xr));
      const si = (sy * w + sx) * 4, di = (y * tw + x) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = 255;
    }
  }
  return out;
}

function processFile(file) {
  const raw = readFileSync(file);
  const before = raw.length;
  let img;
  try { img = jpeg.decode(raw, { useTArray: true }); }
  catch (e) { console.log(`  ⚠ 解码失败 ${file}: ${e.message}`); return null; }
  const { width: w, height: h, data } = img;
  const scaled = resize(data, w, h, TARGET_SIZE, TARGET_SIZE);
  const out = jpeg.encode({ data: scaled, width: TARGET_SIZE, height: TARGET_SIZE }, QUALITY);
  return { before, after: out.data.length, buf: out.data };
}

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!/\.jpg$/i.test(f)) continue;
    out.push(join(dir, f));
  }
  return out;
}

(async () => {
  if (!existsSync(ROOT)) { console.error('portraits dir missing:', ROOT); process.exit(1); }
  const dirs = [ROOT, join(ROOT, 'people')].filter((d) => existsSync(d));
  const files = dirs.flatMap(walk);
  console.log(`共 ${files.length} 张 JPG（根目录+people/）`);
  if (!dryRun && !existsSync(BACKUP)) {
    mkdirSync(BACKUP, { recursive: true });
    mkdirSync(join(BACKUP, 'people'), { recursive: true });
    console.log('备份目录已建:', BACKUP);
  }
  let savedTotal = 0, fail = 0, ok = 0;
  for (const f of files) {
    const r = processFile(f);
    if (!r) { fail++; continue; }
    const saved = r.before - r.after;
    savedTotal += saved;
    if (!dryRun) {
      // 先备份（仅首次）
      const rel = f.slice(ROOT.length + 1);
      const bk = join(BACKUP, rel);
      if (!existsSync(bk)) { mkdirSync(dirname(bk), { recursive: true }); copyFileSync(f, bk); }
      writeFileSync(f, r.buf);
    }
    ok++;
    if (ok <= 5 || dryRun) {
      console.log(`  ${f.slice(ROOT.length + 1)}: ${(r.before / 1024).toFixed(0)}KB → ${(r.after / 1024).toFixed(0)}KB（省 ${(saved / 1024).toFixed(0)}KB）`);
    }
  }
  const totalMB = (files.reduce((s, f) => s + statSync(f).size, 0) / 1024 / 1024).toFixed(1);
  console.log(`\n完成：${ok} 成功，${fail} 失败${dryRun ? '（DRY RUN 未写盘）' : ''}`);
  console.log(`共节省约 ${(savedTotal / 1024 / 1024).toFixed(1)} MB，现画像目录总大小约 ${totalMB} MB（备份在 portraits-backup/）`);
  process.exit(fail ? 1 : 0);
})();