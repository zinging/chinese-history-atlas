#!/usr/bin/env node
/**
 * 把神话舆图热点表从 `web/guoxue/app.js` 提到 `data/myth/schematic.json`。
 *
 * 为什么需要它：MCP 的 `get_route(module=myth)` 要读热点坐标、图注与原文译文，
 * 这些原本只存在于前端 app.js 的 `SCHEMATIC_HOTS` / `ROUTE_SCHEMATIC` 两个数组里，
 * 服务端靠 `fs.readFileSync(<站点>/web/guoxue/app.js)` 现场解析。
 * 但插件包（npm 安装形态）里没有 `web/`——只有 `data/`——于是站点还没 clone 的那一次
 * 调用会直接抛 `The "path" argument must be of type string. Received null`。
 * 把这张表落成数据文件后，两种安装形态读同一份 JSON，不再依赖前端源码在场。
 *
 * 用法：
 *   node scripts/build-myth-schematic.mjs          # 生成 data/myth/schematic.json
 *   node scripts/build-myth-schematic.mjs --check  # 只校验文件与 app.js 是否一致（发布前用）
 *
 * 依赖：零（fs + vm）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const APP_JS = path.join(ROOT, 'web', 'guoxue', 'app.js');
const OUT = path.join(ROOT, 'data', 'myth', 'schematic.json');
const CHECK_ONLY = process.argv.includes('--check');

/** 从 app.js 源码里摘出一个顶层数组常量（按括号配对，跳过字符串内的括号）。 */
function extractArray(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('未在 app.js 中找到 ' + marker);
  const arrStart = src.indexOf('[', start);
  let depth = 0, inStr = null, i = arrStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
    } else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) break; }
  }
  return src.slice(arrStart, i + 1);
}

function build() {
  const src = fs.readFileSync(APP_JS, 'utf8');
  const hotsSrc = extractArray(src, 'const SCHEMATIC_HOTS =');
  const routesSrc = extractArray(src, 'const ROUTE_SCHEMATIC =');
  const hots = vm.runInNewContext('(' + hotsSrc + ')', {});
  const routes = vm.runInNewContext('(function(SCHEMATIC_HOTS){return (' + routesSrc + ');})', {})(hots);
  return routes;
}

function sigOf(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex');
}

const routes = build();
const payload = {
  // 说明字段放在前面，方便人直接打开看这份文件是干什么的
  note: '神话舆图热点表：由 scripts/build-myth-schematic.mjs 从 web/guoxue/app.js 提取；MCP 与前端共用',
  sig: sigOf(routes).slice(0, 12),
  routes,
};

if (CHECK_ONLY) {
  if (!fs.existsSync(OUT)) {
    console.error(`[check] 缺少 ${path.relative(ROOT, OUT)}，请先运行 npm run build:myth`);
    process.exit(1);
  }
  const cur = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (cur.sig !== payload.sig || JSON.stringify(cur.routes) !== JSON.stringify(routes)) {
    console.error(`[check] 已过期：文件 sig=${cur.sig}，app.js 现为 sig=${payload.sig}；请重跑 npm run build:myth`);
    process.exit(1);
  }
  console.log(`[check] OK  sig=${payload.sig} routes=${routes.length} hots=${routes.reduce((n, r) => n + (r.hots || []).length, 0)}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log(`[build] 写出 ${path.relative(ROOT, OUT)}：routes=${routes.length} hots=${routes.reduce((n, r) => n + (r.hots || []).length, 0)} sig=${payload.sig}`);
