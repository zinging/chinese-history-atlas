/*
 * 中华历史图谱 · 全站搜索索引分片（前端用）
 *
 * 一句话：**不另建一套文档清单**，直接从 MCP 已经产出的 data/search-index.json 派生，
 * 把 6.67MB 的索引拆成「首屏零加载、按需拉取」的小分片，并把 URL 相对化。
 *
 *   data/search-index.json（MCP 产物：941 docs + 倒排，绝对 BASE_URL）
 *        │
 *        └─→ data/search/title.json        词条级：标题/类型/摘要/相对深链/落点类型（~110KB）
 *            data/search/body-<module>.json 正文级：每篇切句（与 web/split.js 同一份规则）
 *            data/search/manifest.json      分片清单 + 数据签名（前端据此判新鲜度）
 *
 * 为什么从索引派生而不是重新读 data/**：
 *   1) 文档清单只可能有一份（MCP 的 buildSearchDocs），不会出现「前端搜到、MCP 搜不到」；
 *   2) 不用把 deepLink / caseSummary / gxDeepLink 那套 URL 逻辑再复制一遍；
 *   3) 数据一改，MCP 重算索引 → 本脚本重跑分片，两边的 sig 天然对齐。
 *
 * 用法：
 *   node scripts/build-search.mjs            # 重建分片
 *   node scripts/build-search.mjs --check    # 只校验（sig 是否与 data/search-index.json 一致）
 *   node scripts/build-search.mjs --verbose  # 打印体积明细
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'search');
const INDEX_FILE = path.join(DATA, 'search-index.json');

const require = createRequire(import.meta.url);
// web/split.js 是给浏览器写的经典脚本（挂 window.__split）。这里用 vm 跑一遍取出同一份实现，
// 而不是再复制一套切句规则——「索引分的句」与「页面包的句」必须字字相同。
const split = (function loadSplit() {
  const code = fs.readFileSync(path.join(ROOT, 'web', 'split.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: 'web/split.js' });
  return sandbox.window.__split.split;
})();

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const VERBOSE = args.has('--verbose');

/** 类型 → 落点类型（决定跳转后去哪个容器找目标行） */
const ANCHOR = {
  '皇帝': 'emperor',
  '悬案': 'case',
  '公案': 'case',
  '地图事件': 'popup',
  '生平事件': 'popup',
  '百家纪事': 'popup',
  '路线': 'route',
  '热点': 'stop',
  '典籍': 'chapter',
  '神兽': 'lightbox',
  '器物': 'lightbox',
  '问典': 'quiz',
};

/** 不参与正文提取的字段名（id/颜色/图片等，进正文只会污染检索） */
const SKIP_KEY = /^(id|url|img|image|src|href|color|lat|lng|file|portrait|icon|slug|key|links|type|category|era|dynasty|sect)$/i;
const MAX_SENT = 26;      // 单篇最多保留句数（控制体积，长文后面还有词条级兜底）
const MAX_CHARS = 1800;   // 单篇正文上限

/** 递归收集 raw JSON 里的中文字串，拼成「可读正文」 */
function proseOf(raw) {
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return String(raw || ''); }
  const out = [];
  const walk = (node, key) => {
    if (typeof node === 'string') {
      const s = node.trim();
      if (s.length < 8) return;
      if (!/[\u4e00-\u9fff]/.test(s)) return;
      if (/^https?:\/\//.test(s)) return;
      if (SKIP_KEY.test(key)) return;
      out.push(s);
      return;
    }
    if (Array.isArray(node)) { node.forEach((n) => walk(n, key)); return; }
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k], k);
    }
  };
  walk(parsed, '');
  return out.join('\n');
}

/** 绝对深链 → 相对深链；顺带补「落点参数」 */
function relativeUrl(url, type, title) {
  const rel = String(url || '').replace(/^https?:\/\/[^/]+\/web\//, '');
  const u = new URLSearchParams(rel.includes('?') ? rel.split('?')[1] : '');
  // 热点：深链只到「哪条路线」，必须再告诉页面要落到哪一站
  if (type === '热点' && !u.has('hotspot') && !u.has('stop')) {
    return rel + (rel.includes('?') ? '&' : '?') + 'stop=' + encodeURIComponent(title);
  }
  // 问典：一次只渲染一道题，必须指名是哪一道（guoxue applyDeepLink 认这个参数）
  if (type === '问典' && !u.has('disc')) {
    return rel + (rel.includes('?') ? '&' : '?') + 'disc=' + encodeURIComponent(title);
  }
  return rel;
}

function sentencesOf(text) {
  const arr = split(String(text || ''));
  const keep = [];
  let chars = 0;
  for (const s of arr) {
    if (s.length < 6) continue;
    if (chars + s.length > MAX_CHARS) break;
    keep.push(s);
    chars += s.length;
    if (keep.length >= MAX_SENT) break;
  }
  return keep;
}

function listJsonFiles() {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      // emperors/bundle.json 是前端专用的帝王合并包（scripts/build-emperors-bundle.mjs 生成），
      // 它只是源文件的派生副本，不是知识层内容：计入签名会让「重建一次包 → 索引过期 →
      // 分片重算」无端空转，所以这里与查到同一份源文件的原则一致，一律排除。
      else if (name.endsWith('.json') && name !== 'bundle.json' && path.resolve(p) !== INDEX_FILE) out.push(p);
    }
  })(DATA);
  return out.sort();
}

function dataSignature() {
  // 与 history-mcp-server.mjs 的 dataSignature 同一算法；但必须排除 data/search/ 自身产物，
  // 否则「签名 → 分片 → 签名」形成循环依赖，每次构建签名都会变一次。
  const crypto = require('node:crypto');
  const h = crypto.createHash('sha1');
  const SKIP_DIR = path.join(path.sep + 'search' + path.sep);
  for (const f of listJsonFiles()) {
    if (f.includes(SKIP_DIR)) continue;
    h.update(path.relative(DATA, f).replace(/\\/g, '/'));
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex');
}

function main() {
  const t0 = Date.now();
  if (!fs.existsSync(INDEX_FILE)) {
    console.error('缺少 data/search-index.json：先跑 npm run -s mcp:selftest 或任意 MCP 查询生成索引');
    process.exit(1);
  }
  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const docs = Array.isArray(idx.docs) ? idx.docs : [];
  const sig = dataSignature();
  const sigMatch = idx.sig === sig;

  if (CHECK) {
    if (!fs.existsSync(path.join(OUT, 'manifest.json'))) {
      console.error('[check] 分片不存在，先跑 node scripts/build-search.mjs');
      process.exit(1);
    }
    const man = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
    let bad = 0;
    if (man.sig !== sig) { console.error(`[check] 分片 sig 过期：manifest=${man.sig} data=${sig}`); bad++; }
    if (man.docs !== docs.length) { console.error(`[check] 词条数不一致：manifest=${man.docs} index=${docs.length}`); bad++; }
    for (const sh of man.shards || []) {
      const f = path.join(OUT, sh.f);
      if (!fs.existsSync(f)) { console.error(`[check] 缺分片 ${sh.f}`); bad++; continue; }
      const body = JSON.parse(fs.readFileSync(f, 'utf8'));
      if ((body.docs || []).length !== sh.n) { console.error(`[check] ${sh.f} 条数不一致：${(body.docs || []).length} != ${sh.n}`); bad++; }
      for (const d of body.docs || []) {
        if (/^https?:\/\//.test(d.u)) { console.error(`[check] ${sh.f} 里 ${d.t} 的 url 不是相对路径`); bad++; break; }
      }
    }
    if (idx.sig && !sigMatch) { console.error('[check] 索引本身已过期（data 改过），请重建索引再跑本脚本'); bad++; }
    if (bad) process.exit(1);
    console.log(`[check] OK  sig=${sig.slice(0, 10)}  docs=${docs.length}  shards=${(man.shards || []).length}`);
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });

  const titleDocs = [];
  const shards = new Map();   // module → docs
  docs.forEach((d, i) => {
    const type = d.type || '';
    const k = ANCHOR[type] || '';
    const rel = relativeUrl(d.url, type, d.title);
    titleDocs.push({
      i, t: d.title,
      ty: type, m: d.module || '', s: String(d.summary || '').slice(0, 36),
      u: rel.replace(/^index\.html\?/, ''),   // 统一去掉入口前缀，前端拼回，省 ~34KB
      k,
    });
    const m = d.module || 'misc';
    if (!shards.has(m)) shards.set(m, []);
    shards.get(m).push({ i, t: d.title, u: rel, k, sn: sentencesOf(proseOf(d.raw)) });
  });

  const titlePayload = { sig, v: idx.version || '', docs: titleDocs };
  fs.writeFileSync(path.join(OUT, 'title.json'), JSON.stringify(titlePayload), 'utf8');

  const manShards = [];
  for (const [m, list] of shards) {
    const file = `body-${m}.json`;
    const payload = JSON.stringify({ sig, m, docs: list });
    fs.writeFileSync(path.join(OUT, file), payload, 'utf8');
    const bytes = Buffer.byteLength(payload, 'utf8');
    manShards.push({ m, f: file, n: list.length, bytes });
    if (VERBOSE) console.log(`  ${file.padEnd(22)} ${String(list.length).padStart(4)} 篇  ${(bytes / 1024).toFixed(0)}KB`);
  }

  const manifest = {
    v: idx.version || '', sig, builtAt: new Date().toISOString(),
    docs: docs.length, title: Buffer.byteLength(JSON.stringify(titlePayload), 'utf8'),
    shards: manShards.sort((a, b) => b.n - a.n),
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');

  const totalBody = manShards.reduce((s, x) => s + x.bytes, 0);
  console.log(`[build-search] ${docs.length} 篇 / ${manShards.length} 片 / 标题 ${(manifest.title / 1024).toFixed(0)}KB / 正文 ${(totalBody / 1024).toFixed(0)}KB / sig ${sig.slice(0, 10)} / ${Date.now() - t0}ms`);
  if (!sigMatch) console.warn('[build-search] 注意：索引 sig 与当前 data 不一致（索引本身过期），建议重跑索引后再构建');
}

main();
