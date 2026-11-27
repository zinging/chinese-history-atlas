#!/usr/bin/env node
/**
 * 每朝帝王合并成单文件：把 data/<朝>/emperors/ 下的「index.json + N 个帝王 JSON」
 * 合成一个 bundle.json，供前端一次性取回。
 *
 * 为什么要这么做（只解决请求数，不解决字节数）：
 *   首屏「全部」视图要 177 位帝王，原来是 161 个小文件 + 15 个 index = 176 个请求。
 *   浏览器对同一域名只开 6 个并发连接，弱网下 176 个请求 ≈ 30 轮往返，
 *   首屏等待被拖到数秒——瓶颈是「请求数 × RTT」，不是带宽。
 *   合并后每朝 1 个请求，共 15 个。
 *
 * 边界（很重要）：
 *   - 源文件一个字节都不改，bundle 只是派生副本；MCP Server、validate、
 *     插件打包继续读 index.json + 单帝文件，知识层目录口径不变。
 *   - 顺序严格等于 index.json 的顺序（时间线的段牌、年号条依赖这个次序）。
 *   - 帝王字段与单帝文件完全一致，不加不改（否则「全部」视图与单朝视图会出现
 *     两份不同的数据源，日后改一处忘另一处）。
 *
 * 用法：
 *   node scripts/build-emperors-bundle.mjs          生成 / 幂等更新
 *   node scripts/build-emperors-bundle.mjs --check  只校验 bundle 是否与源一致（CI 用，非零退出）
 * 依赖：零（只用 fs / path / crypto）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const CHECK_ONLY = process.argv.includes('--check');
const BUNDLE = 'bundle.json';

/** 找出所有带 emperors/index.json 的目录：明朝在 data/ 根下，其余在 data/<朝>/ 下。 */
function findEmpDirs() {
  const out = [];
  if (fs.existsSync(path.join(DATA, 'emperors', 'index.json'))) {
    out.push({ label: 'ming', rel: '', abs: path.join(DATA, 'emperors') });
  }
  for (const name of fs.readdirSync(DATA)) {
    const abs = path.join(DATA, name, 'emperors');
    if (fs.existsSync(path.join(abs, 'index.json'))) {
      out.push({ label: name, rel: name, abs });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** 生成单朝的 bundle 文本；任何结构性问题直接抛错（宁可构建失败，也不产出坏包）。 */
function buildOne({ label, abs }) {
  const idx = JSON.parse(fs.readFileSync(path.join(abs, 'index.json'), 'utf8'));
  const list = Array.isArray(idx.emperors) ? idx.emperors : [];
  if (!list.length) throw new Error(`${label}: index.emperors 为空`);

  const docs = [];
  const seen = new Set();
  for (const e of list) {
    if (!e || !e.file) throw new Error(`${label}: index 里有条目缺 file`);
    const fileAbs = path.join(abs, e.file);
    if (!fs.existsSync(fileAbs)) throw new Error(`${label}: 缺帝王文件 ${e.file}`);
    const doc = JSON.parse(fs.readFileSync(fileAbs, 'utf8'));
    if (doc.id !== e.id) throw new Error(`${label}/${e.file}: id 不一致（index=${e.id}，文件=${doc.id}）`);
    if (seen.has(doc.id)) throw new Error(`${label}: id 重复 ${doc.id}`);
    if (!doc.reign || doc.reign.start == null) throw new Error(`${label}/${e.file}: 缺 reign.start`);
    seen.add(doc.id);
    docs.push(doc);
  }

  // sig 只表「内容是否变过」，用于幂等写盘与 --check 比对
  const sig = crypto.createHash('sha1').update(JSON.stringify(docs)).digest('hex').slice(0, 12);

  // 每个帝王一行、不缩进：可读（能逐行 diff）且比逐个 pretty 拼接小 20% 左右
  const body = docs.map((d) => JSON.stringify(d)).join(',\n');
  const text = `{\n"meta": ${JSON.stringify(idx.meta || {})},\n"count": ${docs.length},\n"sig": "${sig}",\n"emperors": [\n${body}\n]\n}\n`;
  return { text, count: docs.length, sig, abs: path.join(abs, BUNDLE) };
}

function kb(n) { return `${(n / 1024).toFixed(1)} KB`; }

const dirs = findEmpDirs();
if (!dirs.length) {
  console.error('没找到任何 emperors/index.json');
  process.exit(1);
}

const stale = [];
const rows = [];
let srcTotal = 0;
let outTotal = 0;

for (const d of dirs) {
  const built = buildOne(d);
  const srcBytes = fs.readdirSync(d.abs)
    .filter((f) => f.endsWith('.json') && f !== BUNDLE)
    .reduce((s, f) => s + fs.statSync(path.join(d.abs, f)).size, 0);
  const outBytes = Buffer.byteLength(built.text);

  let old = null;
  try { old = fs.readFileSync(built.abs, 'utf8'); } catch { /* 还没有 bundle */ }

  rows.push({
    label: d.label,
    文件数: built.count + 1,
    源: kb(srcBytes),
    包: kb(outBytes),
    省: `${(((srcBytes - outBytes) / srcBytes) * 100).toFixed(1)}%`,
    状态: old === built.text ? '最新' : (old ? '待更新' : '新建'),
  });
  srcTotal += srcBytes;
  outTotal += outBytes;

  if (old !== built.text) {
    stale.push(d.label);
    if (!CHECK_ONLY) {
      fs.writeFileSync(built.abs, built.text);
    }
  }
}

console.table(rows);
console.log(`合计：${dirs.length} 个朝代 / 源 ${kb(srcTotal)} → 包 ${kb(outTotal)}（${(((srcTotal - outTotal) / srcTotal) * 100).toFixed(1)}% 更小，因去掉了每文件缩进与换行）`);
console.log(`请求数：${dirs.reduce((s, d) => s + rows.find((r) => r.label === d.label).文件数, 0)} 个 → ${dirs.length} 个`);

if (CHECK_ONLY) {
  if (stale.length) {
    console.error(`✗ bundle 与源不一致：${stale.join('、')}`);
    console.error('  请先跑 node scripts/build-emperors-bundle.mjs');
    process.exit(1);
  }
  console.log('✓ 全部 bundle 与源数据一致');
} else {
  console.log(stale.length ? `✓ 已写入 ${stale.length} 个 bundle：${stale.join('、')}` : '✓ 无变化，未写盘');
}
