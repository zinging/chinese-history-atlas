#!/usr/bin/env node
/**
 * 打包插件：把仓库内的 server.mjs、数据 JSON 与 MCP 需要的图片拷进 plugin-atlas/。
 *
 * 为什么需要它：plugin-atlas/ 作为 npm 包发布时必须自包含——server.mjs 和 data/
 * 不能靠相对路径指回仓库（新用户的机器上没有仓库）。但把它们直接提交进 git
 * 会造成两份重复内容、每次改源都要同步两处。所以 gitignore 掉生成产物，
 * 发布前（或本地调试插件时）跑一次本脚本即可同步。
 *
 * 用法：node web/tools/pack-plugin.mjs
 * 依赖：零（只用 fs）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PKG = path.join(ROOT, 'plugin-atlas');

function copyRecursive(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}

function rmRecursive(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// 1. server.mjs
const serverSrc = path.join(ROOT, 'web', 'tools', 'history-mcp-server.mjs');
const serverDst = path.join(PKG, 'server.mjs');
fs.copyFileSync(serverSrc, serverDst);
console.log(`server.mjs: ${Math.round(fs.statSync(serverDst).size / 1024)} KB`);

// 2. 数据 JSON（排除 portraits/ 下的图片与 .sect-raw）
const dataSrc = path.join(ROOT, 'data');
const dataDst = path.join(PKG, 'data');
rmRecursive(dataDst);
fs.mkdirSync(dataDst, { recursive: true });
for (const entry of fs.readdirSync(dataSrc, { withFileTypes: true })) {
  if (entry.name === 'portraits') continue; // 图片单独处理
  const src = path.join(dataSrc, entry.name);
  const dst = path.join(dataDst, entry.name);
  if (entry.isDirectory()) {
    copyRecursive(src, dst);
  } else if (entry.isFile() && entry.name.endsWith('.json')) {
    fs.copyFileSync(src, dst);
  }
}
// 统一统计（readdirSync 递归只对目录可用，这里改为先收集再统计）
const jsonFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json')) jsonFiles.push(p);
  }
})(dataDst);
const jsonCount = jsonFiles.length;
const jsonBytes = jsonFiles.reduce((s, p) => s + fs.statSync(p).size, 0);
console.log(`data/ JSON: ${jsonCount} 个，${(jsonBytes / 1048576).toFixed(1)} MB`);

// 3. 图片：MCP 的 image 内容块只读这 4 个目录
const imgBase = path.join(dataSrc, 'portraits');
const imgDst = path.join(dataDst, 'portraits');
fs.mkdirSync(imgDst, { recursive: true });
const imgDirs = [
  { src: imgBase, dst: imgDst, filter: f => f.endsWith('.jpg') },           // 根：皇帝/诗人画像
  { src: path.join(imgBase, 'artifacts-thumb'), dst: path.join(imgDst, 'artifacts-thumb') },
  { src: path.join(imgBase, 'event-gongbi-thumb'), dst: path.join(imgDst, 'event-gongbi-thumb') },
  { src: path.join(imgBase, 'sect-events'), dst: path.join(imgDst, 'sect-events') },
];
let imgCount = 0, imgBytes = 0;
for (const { src, dst, filter } of imgDirs) {
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (filter ? filter(name) : name.endsWith('.jpg')) {
      fs.copyFileSync(path.join(src, name), path.join(dst, name));
      imgCount++; imgBytes += fs.statSync(path.join(src, name)).size;
    }
  }
}
console.log(`data/portraits/: ${imgCount} 张图片，${(imgBytes / 1048576).toFixed(1)} MB`);

// 4. 总体积
const allFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else allFiles.push(p);
  }
})(PKG);
let total = 0;
for (const p of allFiles) total += fs.statSync(p).size;
console.log(`plugin-atlas/ 总计: ${(total / 1048576).toFixed(1)} MB`);
console.log('\n完成。npm publish 或本地调试时直接使用 plugin-atlas/ 目录。');
