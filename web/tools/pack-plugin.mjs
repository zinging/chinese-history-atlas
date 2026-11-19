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

// 0. 索引一致性闸门
//    为什么需要：plugin-atlas/data/ 是生成产物（已 gitignore），靠手动跑本脚本同步。
//    一旦改了数据却忘了重跑，插件会带着过期索引发布——用户搜到的正文与站点不符，
//    而这种不一致不会报错，只会表现为「插件讲的和你看到的对不上」。
//    用法：node web/tools/pack-plugin.mjs --check   （CI / 发布前校验，不写任何文件）
const CHECK_ONLY = process.argv.includes('--check');

function readIndexMeta(p) {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { sig: j.sig || '', docs: (j.docs || []).length, version: j.version || '' };
  } catch {
    return null;
  }
}

const IDX_SRC = path.join(ROOT, 'data', 'search-index.json');
const IDX_PKG = path.join(PKG, 'data', 'search-index.json');

function reportIndexMismatch(exitWhenDiffer) {
  const a = readIndexMeta(IDX_SRC);
  const b = readIndexMeta(IDX_PKG);
  if (!a || !b) {
    console.error('索引缺失，无法校验（源或插件内 search-index.json 读不到）');
    if (exitWhenDiffer) process.exit(1);
    return false;
  }
  const same = a.sig === b.sig && a.docs === b.docs;
  console.log(`  源索引   sig=${a.sig} docs=${a.docs} v${a.version}`);
  console.log(`  插件索引 sig=${b.sig} docs=${b.docs} v${b.version}`);
  if (!same) {
    console.error('\n不一致：plugin-atlas/data 已过期，请先运行 npm run pack:plugin 再发布。');
    if (exitWhenDiffer) process.exit(1);
    return false;
  }
  return true;
}

// 版本一致性闸门
//    同一个版本号原本出现在四个地方（根 package.json / 插件 package.json /
//    SERVER_VERSION / 索引 version），实际漂成了 1.3.0 / 1.1.0 / 1.6.0 / 1.6.0，
//    对外又有 README 写 1.6.0、docs 写 1.3.0。
//    口径定为：**这四处必须是同一个数字**，改一处就要四处一起改——版本号是用户
//    判断「我装的是不是最新」的唯一依据，一个数字对不上就会引发整轮排查。
function reportVersionConsistency(exitWhenDiffer) {
  const readVer = (p) => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')).version || ''; } catch { return ''; }
  };
  let srvVer = '';
  try {
    const src = fs.readFileSync(path.join(ROOT, 'web', 'tools', 'history-mcp-server.mjs'), 'utf8');
    const m = src.match(/SERVER_VERSION\s*=\s*'([^']+)'/);
    if (m) srvVer = m[1];
  } catch { /* 读不到就留空，交给下面报错 */ }
  const items = [
    ['根 package.json', readVer(path.join(ROOT, 'package.json'))],
    ['插件 package.json', readVer(path.join(PKG, 'package.json'))],
    ['SERVER_VERSION', srvVer],
    ['索引 version', readVer(IDX_SRC)],
  ];
  console.log('  版本口径：');
  for (const [k, v] of items) console.log(`    ${k.padEnd(20)} = ${v || '(空)'}`);
  const base = items[0][1];
  const bad = items.filter(([, v]) => v !== base);
  if (!base || bad.length) {
    console.error('\n版本不一致：应为同一个值，当前不一致的有 ' + (bad.map(([k, v]) => `${k}=${v || '(空)'}`).join('、')));
    if (exitWhenDiffer) process.exit(1);
    return false;
  }
  return true;
}

// 神话热点表一致性闸门
//    这张表原本由服务端现场解析 web/guoxue/app.js 得到，插件包里没有 web/ 目录，
//    所以改成了 data/myth/schematic.json（scripts/build-myth-schematic.mjs 生成）。
//    若源里重新生成了、插件包没跟上，`get_route(module=myth)` 会给旧坐标/旧图注，
//    而且不会报错——只有用户看到「地图热点对不上」时才发现。
function reportMythSchematic(exitWhenDiffer) {
  const read = (p) => {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { sig: j.sig || '', routes: (j.routes || []).length, hots: (j.routes || []).reduce((n, r) => n + (r.hots || []).length, 0) };
    } catch { return null; }
  };
  const a = read(path.join(ROOT, 'data', 'myth', 'schematic.json'));
  const b = read(path.join(PKG, 'data', 'myth', 'schematic.json'));
  if (!a || !b) {
    console.error('神话热点表缺失（data/myth/schematic.json 不存在）；请先运行 npm run build:myth');
    if (exitWhenDiffer) process.exit(1);
    return false;
  }
  console.log(`  源热点表   sig=${a.sig} routes=${a.routes} hots=${a.hots}`);
  console.log(`  插件热点表 sig=${b.sig} routes=${b.routes} hots=${b.hots}`);
  if (a.sig !== b.sig) {
    console.error('\n不一致：插件包里的神话热点表已过期，请先运行 npm run pack:plugin。');
    if (exitWhenDiffer) process.exit(1);
    return false;
  }
  return true;
}

if (CHECK_ONLY) {
  console.log('[--check] 仅校验，不写文件');
  reportIndexMismatch(true);
  reportVersionConsistency(true);
  reportMythSchematic(true);
  console.log('\n一致：插件数据与站点同源，版本号四处同值，神话热点表同步。');
  process.exit(0);
}

// 1. server.mjs
//    图片是否打进包：默认不带。
//    站点 clone 是后台进行的（server 返回 state:'cloning'），所以首次 1–2 分钟里没有站点，
//    那段窗口的图只能来自包内；但 552 张图占 25.5MB，而整包 36.6MB——上传时一次 ECONNRESET
//    就报废，发版稳定性和 1 分钟的配图能力不成比例。带 `--with-images` 时行为与旧版一致。
const WITH_IMAGES = process.argv.includes('--with-images');
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
  // data/search/ 是前端搜索分片（由 search-index.json 派生），MCP 不读它；
  // 拷进去只会白占 1.1MB 安装体积，而且它的内容随时会随索引重建变化。
  if (entry.name === 'search') continue;
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

// 3. 图片：MCP 的 image 内容块只读这 5 个目录（默认不带，见上面 WITH_IMAGES 的说明）
const imgBase = path.join(dataSrc, 'portraits');
const imgDst = path.join(dataDst, 'portraits');
const imgDirs = [
  { src: imgBase, dst: imgDst, filter: f => f.endsWith('.jpg') },           // 根：皇帝/诗人画像
  { src: path.join(imgBase, 'artifacts-thumb'), dst: path.join(imgDst, 'artifacts-thumb') },
  { src: path.join(imgBase, 'event-gongbi-thumb'), dst: path.join(imgDst, 'event-gongbi-thumb') },
  { src: path.join(imgBase, 'sect-events'), dst: path.join(imgDst, 'sect-events') },
  { src: path.join(imgBase, 'poet-events'), dst: path.join(imgDst, 'poet-events') },
];
let imgCount = 0, imgBytes = 0;
if (WITH_IMAGES) {
  fs.mkdirSync(imgDst, { recursive: true });
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
} else {
  console.log('data/portraits/: 未打包（默认精简；需要 clone 窗口内也带图请加 --with-images）');
}

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

// 5. 拷后自检：确认插件内索引与源同源（拷贝成功即应一致）
console.log('\n索引一致性：');
if (!reportIndexMismatch(false)) {
  console.error('打包后索引仍不一致，请检查 data/ 是否完整。');
  process.exit(1);
}
console.log('\n版本一致性：');
if (!reportVersionConsistency(false)) {
  console.error('版本号四处不一致，请对齐后再发布。');
  process.exit(1);
}
console.log('\n神话热点表一致性：');
if (!reportMythSchematic(false)) {
  console.error('神话热点表未同步，请检查 data/myth/schematic.json。');
  process.exit(1);
}

console.log('\n完成。npm publish 或本地调试时直接使用 plugin-atlas/ 目录。');
