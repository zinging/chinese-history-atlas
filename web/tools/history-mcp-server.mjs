#!/usr/bin/env node
/**
 * chinese-history-atlas · 本地 MCP Server（零依赖，Node ESM）
 *
 * 把站点的五大板块只读数据（帝王谱系 / 思想源流 / 诗词鉴赏 / 格物致知 / 神话异志）
 * 以 MCP 工具的形式暴露给豆包工作、Claude、Cursor 等支持 STDIO MCP 的 AI 客户端。
 *
 * 数据全部来自项目 data/ 目录，实时读取、不缓存到外部；返回结果中：
 *   - 图片优先给缩略图 URL（artifacts-thumb / myth-map-thumb），另附原图 URL；
 *   - 每个实体都带 url（本地 127.0.0.1 完整地址）与 online_url（GitHub Pages），
 *     AI 回答后可直接把用户引回网页对应卡片/热点（前端需支持 query 深链）。
 *
 * 用法：
 *   node web/tools/history-mcp-server.mjs              # STDIO MCP 模式（客户端拉起）
 *   node web/tools/history-mcp-server.mjs --selftest   # 协议自测，不读 stdin
 *
 * 环境变量：
 *   CHAT_BASE_URL  本地网页基址，默认 http://127.0.0.1:5173/web/
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..', '..');
const DATA = path.join(ROOT, 'data');

const LOCAL_BASE = (process.env.CHAT_BASE_URL || 'http://127.0.0.1:5173/web/').replace(/\/?$/, '/');
const ONLINE_BASE = 'https://zinging.github.io/chinese-history-atlas/web/';

// 连接诊断日志：客户端每拉起一次 STDIO 进程都会记录，用于排查连接器是否真正启动
const LOG_FILE = path.join(ROOT, '.sessions', 'mcp-connector.log');
function dlog(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, 'utf8'); } catch { /* 忽略 */ }
}

// ---------- 本地站点探活与自动拉起（全部由 MCP 进程完成，AI 不需要执行任何命令） ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 探活。返回 { up, own }：own=true 表示响应头带本站标记，说明端口是本站服务。 */
async function probeSite(timeoutMs = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(LOCAL_BASE, { signal: ctrl.signal });
    if (res.status < 200 || res.status >= 500) return { up: false, own: false };
    return { up: true, own: res.headers.get('x-dsh-atlas') === '1' };
  } catch { return { up: false, own: false }; }
  finally { clearTimeout(timer); }
}

// 同一 STDIO 进程内只尝试拉起一次，避免重复 spawn
let mcpSpawnedServer = false;

/**
 * 确保本地服务可用。返回结构化结论，模型只读结论、不跑命令：
 *   running        已在运行且确认为本站
 *   started_by_mcp 原本未运行，已由本工具后台拉起并探活通过
 *   port_taken     端口被其它程序占用（会给出占用方线索与换端口办法）
 *   start_failed   拉起后仍不通，附最后一段错误输出
 */
async function ensureLocalServer() {
  const first = await probeSite();
  if (first.up && first.own) return { state: 'running' };
  if (first.up && !first.own) {
    return {
      state: 'port_taken',
      detail: '端口有服务在响应，但响应头没有本站标记，很可能不是本项目的服务。',
      fix: `换一个端口后重新连接：设置环境变量 CHAT_BASE_URL=http://127.0.0.1:<端口>/web/ 再拉起本 MCP Server；或先停掉占用该端口的程序。`,
    };
  }

  const servePath = path.join(ROOT, 'web', 'serve.mjs');
  let port = '';
  try { const u = new URL(LOCAL_BASE); if (u.port && u.port !== '5173') port = u.port; } catch { /* 默认端口 */ }
  const args = port ? [servePath, port] : [servePath];

  if (!mcpSpawnedServer) {
    mcpSpawnedServer = true;
    try {
      // 用 pipe 捕获 stderr：端口占用时 serve.mjs 会以 exit code 2 退出并打印原因，
      // 这样 MCP 能把「端口被占」这个确定性结论直接告诉模型，而不是让它自己排查。
      const child = spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (c) => { err += String(c); if (err.length > 2000) err = err.slice(-2000); });
      child.on('error', (e) => dlog('自启动站点失败: ' + e.message));
      child.on('exit', (code) => dlog('自启动的站点退出 code=' + code + ' ' + err.slice(0, 300)));
      child.unref();
      dlog('已由 MCP 自动拉起本地站点: ' + process.execPath + ' ' + args.join(' '));
    } catch (e) {
      dlog('spawn 异常: ' + e.message);
      return { state: 'start_failed', detail: '无法启动本地服务进程：' + e.message };
    }
  }

  for (let i = 0; i < 10; i++) {
    await sleep(700);
    const r = await probeSite();
    if (r.up && r.own) return { state: 'started_by_mcp' };
    if (r.up && !r.own) {
      return {
        state: 'port_taken',
        detail: '启动过程中端口被其它程序占用。',
        fix: '换端口后重新拉起本 MCP Server：CHAT_BASE_URL=http://127.0.0.1:<端口>/web/',
      };
    }
  }
  return {
    state: 'start_failed',
    detail: '已尝试拉起本地服务，但连续探活仍失败。',
    fix: '手动执行一条命令确认：node ' + args.join(' '),
  };
}

// ---------- 基础工具 ----------
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s·・《》「」『』]/g, '');
const pick = (obj, keys) => {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
};

/** 深链：同时返回本地（本地服务）与在线（GitHub Pages）两个完整 URL */
function deepLink(relQuery) {
  return { url: LOCAL_BASE + relQuery, online_url: ONLINE_BASE + relQuery };
}
const enc = encodeURIComponent;

/** data/portraits 下的图片地址；thumb=true 时返回 {thumb, full} */
function portraitHref(rel, { thumb = false, thumbDir = null } = {}) {
  // rel 形如 ../../data/portraits/artifacts/xxx.jpg 或 data/portraits/xxx.jpg
  const m = String(rel).match(/(?:\.\.\/\.\.\/)?data\/portraits\/(.+)$/);
  const sub = m ? m[1] : String(rel).replace(/^\/+/, '');
  const full = 'data/portraits/' + sub;
  const pair = (f) => ({
    url: LOCAL_BASE + '../' + f,
    online_url: ONLINE_BASE + '../' + f,
  });
  if (!thumb) return pair(full);
  const thumbFull = thumbDir
    ? 'data/portraits/' + thumbDir + '/' + path.basename(sub)
    : full.replace('/artifacts/', '/artifacts-thumb/');
  return { thumb: pair(thumbFull), full: pair(full) };
}

// ---------- 帝王谱系数据 ----------
const DYNASTIES = ['sui', 'tang', 'wudai', 'song', 'yuan', 'ming', 'qing'];
const DYNASTY_LABEL = {
  sui: '隋朝', tang: '唐朝', wudai: '五代', song: '宋朝',
  yuan: '元朝', ming: '明朝', qing: '清朝', all: '全部朝代',
};
const DYNASTY_DIR = { ming: '', tang: 'tang/', song: 'song/', yuan: 'yuan/', qing: 'qing/', sui: 'sui/', wudai: 'wudai/' };

const dynCache = {};
function loadDynasty(d) {
  if (dynCache[d]) return dynCache[d];
  const dir = DYNASTY_DIR[d] || '';
  const empIdx = readJson(path.join(DATA, dir, 'emperors', 'index.json'));
  const emperors = empIdx.emperors.map((e) => {
    const full = readJson(path.join(DATA, dir, 'emperors', e.file));
    full._dynasty = d;
    return full;
  });
  const maybe = (rel) => {
    const p = path.join(DATA, dir, rel);
    return exists(p) ? readJson(p) : null;
  };
  // 明朝分库在 data/ 根目录；其余朝代在朝代目录内
  const casesDoc = d === 'ming' ? maybe('cases/cases.json') : maybe('cases.json');
  const quizDoc = d === 'ming' ? maybe('quiz/quiz.json') : maybe('quiz.json');
  const eventsDoc = d === 'ming' ? maybe('events/events.json') : maybe('events.json');
  const mapEventsDoc = d === 'ming' ? maybe('events/map-events.json') : maybe('map-events.json');
  const peopleDoc = d === 'ming' ? maybe('people/people.json') : maybe('people.json');
  const routesDoc = d === 'ming' ? maybe('routes/routes.json') : maybe('routes.json');
  const placesDoc = d === 'ming' ? maybe('places/places.json') : maybe('places.json');
  const bundle = {
    emperors,
    cases: (casesDoc && casesDoc.cases) || [],
    caseCategories: (casesDoc && casesDoc.categories) || (casesDoc && casesDoc.caseCategories) || [],
    quiz: (quizDoc && quizDoc.quiz) || [],
    events: (eventsDoc && eventsDoc.events) || [],
    mapEvents: (mapEventsDoc && mapEventsDoc.events) || [],
    people: (peopleDoc && peopleDoc.people) || [],
    routes: (routesDoc && routesDoc.routes) || [],
    places: (placesDoc && placesDoc.places) || [],
  };
  dynCache[d] = bundle;
  return bundle;
}

function emperorSummary(e) {
  return {
    id: e.id,
    name: e.name,
    templeName: e.templeName,
    eraName: e.eraName,
    dynasty: DYNASTY_LABEL[e._dynasty],
    dynastyKey: e._dynasty,
    reign: e.reign,
    intro: e.intro,
    portrait: portraitHref('data/portraits/' + e.portrait),
    ...deepLink(`index.html?page=timeline&dynasty=${e._dynasty}&emperor=${enc(e.id)}`),
  };
}
function findEmperor(keyword, dynasty) {
  const dyns = dynasty ? [dynasty] : DYNASTIES;
  const k = norm(keyword);
  for (const d of dyns) {
    const b = loadDynasty(d);
    const hit = b.emperors.find((e) =>
      norm(e.id) === k || norm(e.name) === k || (e.eraName || []).some((x) => norm(x) === k));
    if (hit) return hit;
  }
  for (const d of dyns) {
    const b = loadDynasty(d);
    const hit = b.emperors.find((e) =>
      norm(e.id).includes(k) || norm(e.name).includes(k));
    if (hit) return hit;
  }
  return null;
}

// ---------- 国学四板块数据 ----------
/** 思想五宗：目录名 → 页面 sect 参数与中文名 */
const THOUGHT_SECTS = {
  rujia: '儒家', daojia: '道家', foxue: '佛学', zhuzi: '诸子', lixue: '理学心学',
};
const GUOXUE_PAGE = {
  thought: 'guoxue/index.html',
  shiwen: 'guoxue/shici.html',
  gewu: 'guoxue/gewu.html',
  myth: 'guoxue/myth.html',
};
const GUOXUE_DIR = { thought: null, shiwen: 'shiwen', gewu: 'gewu', myth: 'myth' };
const MODULE_LABEL = {
  emperors: '帝王谱系', thought: '思想源流', shiwen: '诗词鉴赏',
  gewu: '格物致知', myth: '神话异志',
};

const gxCache = {};
/** 加载一个国学板块（思想按 sect 分别加载）的完整数据 */
function loadGuoxue(module, sect) {
  const dir = module === 'thought' ? sect : GUOXUE_DIR[module];
  const cacheKey = module + ':' + (dir || '');
  if (gxCache[cacheKey]) return gxCache[cacheKey];
  const base = path.join(DATA, dir);
  const index = readJson(path.join(base, 'index.json'));
  const section = (key) => {
    const v = index[key];
    if (Array.isArray(v)) return v;
    if (v && v.src) {
      const doc = readJson(path.join(base, v.src));
      const val = Array.isArray(doc) ? doc : doc[key];
      return Array.isArray(val) ? val : [];
    }
    return [];
  };
  const books = (index.books || []).map((b) => {
    if (!b.src) return b;
    const full = readJson(path.join(base, b.src));
    return { ...b, ...full };
  });
  const bundle = {
    dir,
    categories: index.categories || [],
    books,
    cases: section('cases'),
    places: section('places'),
    routes: section('routes'),
    discourses: section('discourses'),
    quiz: section('quiz'),
    artifacts: section('artifacts'),
  };
  gxCache[cacheKey] = bundle;
  return bundle;
}

function gxDeepLink(module, sect, query) {
  const page = GUOXUE_PAGE[module];
  const q = module === 'thought' ? `sect=${sect}&` : '';
  return deepLink(page + '?' + q + query);
}

function bookSummary(module, sect, b) {
  return {
    id: b.id,
    name: b.name,
    person: b.person || null,
    era: b.era || b.category || null,
    meta: b.meta,
    category: b.category || null,
    portrait: b.portrait ? portraitHref('data/portraits/' + b.portrait) : null,
    ...gxDeepLink(module, sect, `tab=books&book=${enc(b.id)}`),
  };
}

// ---------- 神话舆图热点（源在 web/guoxue/app.js 的 ROUTE_SCHEMATIC） ----------
let mythSchematic = null;
function loadMythSchematic() {
  if (mythSchematic) return mythSchematic;
  const appJs = fs.readFileSync(path.join(ROOT, 'web', 'guoxue', 'app.js'), 'utf8');
  const extract = (marker) => {
    const start = appJs.indexOf(marker);
    if (start < 0) throw new Error('未在 app.js 中找到 ' + marker);
    const arrStart = appJs.indexOf('[', start);
    let depth = 0, inStr = null, i = arrStart;
    for (; i < appJs.length; i++) {
      const ch = appJs[i];
      if (inStr) {
        if (ch === '\\') { i++; continue; }
        if (ch === inStr) inStr = null;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        inStr = ch;
      } else if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) break; }
    }
    return appJs.slice(arrStart, i + 1);
  };
  const hotsSrc = extract('const SCHEMATIC_HOTS =');
  const routesSrc = extract('const ROUTE_SCHEMATIC =');
  const hots = vm.runInNewContext('(' + hotsSrc + ')', {});
  const routes = vm.runInNewContext('(function(SCHEMATIC_HOTS){return (' + routesSrc + ');})', {})(hots);
  mythSchematic = routes;
  return routes;
}

// ---------- 工具实现 ----------
function tListModules() {
  const counts = {};
  // 帝王
  let empCount = 0;
  for (const d of DYNASTIES) empCount += loadDynasty(d).emperors.length;
  counts.emperors = { emperors: empCount };
  for (const [m, sects] of [
    ['thought', Object.keys(THOUGHT_SECTS)],
    ['shiwen', ['shiwen']], ['gewu', ['gewu']], ['myth', ['myth']],
  ]) {
    const c = { books: 0, cases: 0, discourses: 0, artifacts: 0, routes: 0 };
    for (const s of sects) {
      const b = loadGuoxue(m, s);
      c.books += b.books.length; c.cases += b.cases.length;
      c.discourses += b.discourses.length; c.artifacts += b.artifacts.length;
      c.routes += b.routes.length;
    }
    counts[m] = c;
  }
  return {
    modules: [
      { id: 'emperors', name: MODULE_LABEL.emperors, desc: '隋至清七朝 77 位皇帝生平时间线、重大事件、悬案疑案、史论选择题、舆图疆域',
        ...deepLink('index.html'), counts: counts.emperors },
      { id: 'thought', name: MODULE_LABEL.thought, desc: '儒释道/诸子/理学心学五宗经典、公案、问典与圣贤行迹路线',
        sects: THOUGHT_SECTS, ...deepLink('guoxue/index.html'), counts: counts.thought },
      { id: 'shiwen', name: MODULE_LABEL.shiwen, desc: '22 位诗人、71 篇名篇精读、95 条金句、13 条诗路与品诗问典',
        ...deepLink('guoxue/shici.html'), counts: counts.shiwen },
      { id: 'gewu', name: MODULE_LABEL.gewu, desc: '17 部科技典籍、59 件器物图谱、工艺公案与格物问典',
        ...deepLink('guoxue/gewu.html'), counts: counts.gewu },
      { id: 'myth', name: MODULE_LABEL.myth, desc: '9 部志怪典籍、113 只神兽、五条古舆图路线（山海经/西游/封神/聊斋/太平广记）',
        ...deepLink('guoxue/myth.html'), counts: counts.myth },
    ],
    note: '所有结果均为站点内数据；涉及《三国演义》《西游记》等演义文本时内容会注明出处。图片字段为缩略图+原图，url 可直接打开对应网页。',
  };
}

function tListEmperors({ dynasty }) {
  const dyns = dynasty ? [dynasty] : DYNASTIES;
  const items = [];
  for (const d of dyns) items.push(...loadDynasty(d).emperors.map(emperorSummary));
  return { dynasty: dynasty ? DYNASTY_LABEL[dynasty] : '全部', count: items.length, items };
}

function tGetEmperor({ id, name }) {
  const key = id || name;
  if (!key) throw new Error('需要提供 id 或 name（皇帝名/年号）');
  const e = findEmperor(key);
  if (!e) throw new Error('未找到皇帝：' + key);
  return {
    ...pick(e, ['id', 'name', 'templeName', 'eraName', 'reign', 'intro', 'timeline',
      'majorEvents', 'people', 'controversies', 'funFacts', 'places', 'sources']),
    dynasty: DYNASTY_LABEL[e._dynasty],
    dynastyKey: e._dynasty,
    portrait: portraitHref('data/portraits/' + e.portrait),
    ...deepLink(`index.html?page=timeline&dynasty=${e._dynasty}&emperor=${enc(e.id)}`),
  };
}

function caseSummary(module, sect, c, dynasty) {
  const link = module === 'emperors'
    ? deepLink(`index.html?page=cases&dynasty=${dynasty}&case=${enc(c.id)}`)
    : gxDeepLink(module, sect, `tab=cases&case=${enc(c.id)}`);
  return {
    id: c.id, name: c.name, date: c.date || null,
    category: c.category || null, summary: c.summary,
    ...link,
  };
}

function tListCases({ module, dynasty, sect, category }) {
  const items = [];
  if (!module || module === 'emperors') {
    const dyns = dynasty ? [dynasty] : DYNASTIES;
    for (const d of dyns) {
      for (const c of loadDynasty(d).cases) items.push(caseSummary('emperors', null, c, d));
    }
  }
  if (module === 'thought') {
    const sects = sect ? [sect] : Object.keys(THOUGHT_SECTS);
    for (const s of sects) for (const c of loadGuoxue('thought', s).cases) items.push(caseSummary('thought', s, c));
  }
  if (module === 'shiwen' || module === 'gewu' || module === 'myth') {
    const b = loadGuoxue(module, module);
    for (const c of b.cases) items.push(caseSummary(module, module, c));
  }
  const filtered = category ? items.filter((c) => c.category === category) : items;
  return { count: filtered.length, items: filtered };
}

function tGetCase({ module, sect, id, name }) {
  const target = norm(id || name);
  const pools = [];
  if (!module || module === 'emperors') {
    for (const d of DYNASTIES) pools.push({ list: loadDynasty(d).cases, type: 'emperors', dynasty: d });
  }
  if (module === 'thought') {
    for (const s of (sect ? [sect] : Object.keys(THOUGHT_SECTS))) {
      pools.push({ list: loadGuoxue('thought', s).cases, type: 'thought', sect: s });
    }
  }
  if (module === 'shiwen' || module === 'gewu' || module === 'myth') {
    pools.push({ list: loadGuoxue(module, module).cases, type: module });
  }
  for (const p of pools) {
    const c = p.list.find((x) => norm(x.id) === target || norm(x.name) === target)
      || p.list.find((x) => norm(x.name).includes(target));
    if (c) {
      return { ...c, url: caseSummary(p.type, p.sect, c, p.dynasty).url };
    }
  }
  throw new Error('未找到案件：' + (id || name));
}

function tListBooks({ module, sect }) {
  const items = [];
  if (module === 'thought') {
    for (const s of (sect ? [sect] : Object.keys(THOUGHT_SECTS))) {
      for (const b of loadGuoxue('thought', s).books) items.push(bookSummary('thought', s, b));
    }
  } else {
    const b = loadGuoxue(module, module);
    for (const x of b.books) items.push(bookSummary(module, module, x));
  }
  return { count: items.length, items };
}

function tGetBook({ module, sect, id, name }) {
  const target = norm(id || name);
  const pools = [];
  if (module === 'thought') {
    for (const s of (sect ? [sect] : Object.keys(THOUGHT_SECTS))) {
      pools.push({ books: loadGuoxue('thought', s).books, sect: s });
    }
  } else {
    pools.push({ books: loadGuoxue(module, module).books, sect: module });
  }
  for (const p of pools) {
    const b = p.books.find((x) => norm(x.id) === target || norm(x.name) === target)
      || p.books.find((x) => norm(x.name).includes(target));
    if (b) {
      const { src: _src, ...rest } = b;
      return { ...rest, ...gxDeepLink(module, p.sect, `tab=books&book=${enc(b.id)}`) };
    }
  }
  throw new Error('未找到典籍：' + (id || name));
}

function artifactLike(module, a) {
  const base = {
    name: a.name, era: a.era || null, cat: a.cat || null,
    from: a.from || null, book: a.book || null, note: a.note,
  };
  if (module === 'myth') {
    return { ...base, image: portraitHref(a.image, { thumb: true, thumbDir: 'artifacts-thumb' }),
      ...gxDeepLink('myth', 'myth', `tab=artifacts&name=${enc(a.name)}`) };
  }
  return { ...base, image: portraitHref(a.image, { thumb: true, thumbDir: 'artifacts-thumb' }),
    ...gxDeepLink('gewu', 'gewu', `tab=artifacts&name=${enc(a.name)}`) };
}

function tListCreatures({ category, book }) {
  const list = loadGuoxue('myth', 'myth').artifacts;
  let items = list;
  if (category) items = items.filter((a) => a.cat === category);
  if (book) items = items.filter((a) => a.book === book);
  return { count: items.length, items: items.map((a) => artifactLike('myth', a)) };
}

function tListArtifacts({ module, category, book }) {
  const m = module === 'myth' ? 'myth' : 'gewu';
  const list = loadGuoxue(m, m).artifacts;
  let items = list;
  if (category) items = items.filter((a) => a.cat === category);
  if (book) items = items.filter((a) => a.book === book);
  return { module: m, count: items.length, items: items.map((a) => artifactLike(m, a)) };
}

function findArtifactLike(module, name) {
  const m = module === 'myth' ? 'myth' : 'gewu';
  const k = norm(name);
  const list = loadGuoxue(m, m).artifacts;
  return list.find((a) => norm(a.name) === k) || list.find((a) => norm(a.name).includes(k));
}
function tGetArtifact({ module, name }) {
  const a = findArtifactLike(module, name);
  if (!a) throw new Error('未找到：' + name);
  return artifactLike(module, a);
}

function tGetRoute({ module, sect, route }) {
  if (module === 'emperors') {
    // 帝王舆图：返回指定朝代（默认全部）的路线与事件
    const dyns = sect ? [sect] : DYNASTIES;
    // 单条路线：按 id 或名称命中（与 myth 分支同一套语义）
    if (route !== undefined && route !== null) {
      const key = norm(route);
      for (const d of dyns) {
        const b = loadDynasty(d);
        const hit = (b.routes || []).find((r) =>
          norm(r.id) === key
          || norm(r.name).includes(key)
          || (r.keywords || []).some((k) => norm(k) === key || norm(k).includes(key))
          || (r.points || []).some((p) => norm(p.name) === key || norm(p.title || '') === key));
        if (hit) {
          return {
            dynasty: d,
            dynasty_label: DYNASTY_LABEL[d],
            route: {
              ...hit,
              points: (hit.points || []).map((p) => ({
                ...p,
                ...deepLink(`index.html?page=map&dynasty=${d}&route=${enc(hit.id)}`),
              })),
            },
            ...deepLink(`index.html?page=map&dynasty=${d}&route=${enc(hit.id)}`),
          };
        }
      }
      // 未命中：回退到清单，并明确说明（避免模型以为没有数据）
      const avail = [];
      for (const d of dyns) {
        (loadDynasty(d).routes || []).forEach((r) => avail.push(`${d}/${r.id}`));
      }
      return {
        matched: false,
        query: route,
        hint: `没有id或名称为「${route}」的路线。可用路线 id：${avail.join(', ')}`,
      };
    }
    const out = {};
    for (const d of dyns) {
      const b = loadDynasty(d);
      const mapEvents = (b.mapEvents || []).map((ev) => ({
        ...ev,
        ...deepLink(`index.html?page=map&dynasty=${d}&event=${enc(ev.eventId || ev.id)}`),
      }));
      out[d] = {
        dynasty: DYNASTY_LABEL[d],
        routes: b.routes, mapEvents, places: b.places,
        ...deepLink(`index.html?page=map&dynasty=${d}`),
      };
    }
    return out;
  }
  // 神话舆图：合并 app.js 中的热点（x/y/图）与 index.json 中的事件文字
  if (module === 'myth') {
    const b = loadGuoxue('myth', 'myth');
    const schematic = loadMythSchematic();
    const routes = b.routes.map((r, i) => {
      const cfg = schematic[i] || {};
      const hots = cfg.hots || [];
      const points = (r.points || []).map((p) => {
        const h = hots.find((x) => x.name === p.name) || {};
        return {
          name: p.name,
          year: p.year || h.tag || null,
          event: p.event,
          x: h.x, y: h.y,
          src: h.src || null,
          image: h.img ? {
            thumb: {
              url: LOCAL_BASE + '../data/portraits/myth-map-thumb/' + h.img,
              online_url: ONLINE_BASE + '../data/portraits/myth-map-thumb/' + h.img,
            },
            full: {
              url: LOCAL_BASE + '../data/portraits/myth-map/' + h.img,
              online_url: ONLINE_BASE + '../data/portraits/myth-map/' + h.img,
            },
          } : null,
          ...gxDeepLink('myth', 'myth', `tab=map&route=${i}&hotspot=${enc(p.name)}`),
        };
      });
      return {
        index: i, name: r.name, unit: r.unit || '站',
        schematic: !!r.schematic, background: cfg.bg || null,
        point_count: points.length, points,
        ...gxDeepLink('myth', 'myth', `tab=map&route=${i}`),
      };
    });
    if (route !== undefined && route !== null) {
      const idx = Number(route);
      const one = routes.find((r) => r.index === idx || norm(r.name).includes(norm(route)));
      if (one) return one;
    }
    return { count: routes.length, routes: routes.map((r) => ({ ...r, points: undefined, point_count: r.point_count })) };
  }
  // 思想/诗词：真实 Leaflet 路线
  if (module === 'thought') {
    const sects = sect ? [sect] : Object.keys(THOUGHT_SECTS);
    const out = [];
    for (const s of sects) {
      const b = loadGuoxue('thought', s);
      b.routes.forEach((r, i) => out.push({ sect: s, sectName: THOUGHT_SECTS[s], index: i, ...r,
        ...gxDeepLink('thought', s, `tab=map&route=${i}`) }));
    }
    return { count: out.length, routes: out };
  }
  const b = loadGuoxue('shiwen', 'shiwen');
  const routes = b.routes.map((r, i) => ({ index: i, ...r,
    ...gxDeepLink('shiwen', 'shiwen', `tab=map&route=${i}`) }));
  return { count: routes.length, routes };
}

function tGetDiscourses({ module, sect }) {
  const out = [];
  if (module === 'thought') {
    for (const s of (sect ? [sect] : Object.keys(THOUGHT_SECTS))) {
      for (const d of loadGuoxue('thought', s).discourses) {
        out.push({ ...d, sect: s, ...gxDeepLink('thought', s, 'tab=quiz') });
      }
    }
  } else if (module === 'shiwen' || module === 'gewu' || module === 'myth') {
    for (const d of loadGuoxue(module, module).discourses) {
      out.push({ ...d, ...gxDeepLink(module, module, 'tab=quiz') });
    }
  } else {
    throw new Error('问典（discourses）只存在于思想/诗词/格物/神话板块；帝王板块请用 get_quiz');
  }
  return { count: out.length, items: out };
}

function tGetQuiz({ dynasty }) {
  const dyns = dynasty ? [dynasty] : DYNASTIES;
  const out = [];
  for (const d of dyns) {
    const b = loadDynasty(d);
    for (const q of b.quiz) {
      out.push({ dynasty: DYNASTY_LABEL[d], dynastyKey: d, ...q,
        ...deepLink(`index.html?page=detective&dynasty=${d}`) });
    }
  }
  return { count: out.length, items: out };
}

// ---------- 全文检索（进程内预构建文档表 + 单字/双字倒排索引，只建一次） ----------
const TYPE_BOOST = {
  '地图事件': 6, '皇帝': 5, '悬案': 4, '典籍': 4, '公案': 4, '热点': 4,
  '神兽': 3, '器物': 3, '问典': 3, '路线': 2,
};

let searchDocs = null;
function buildSearchDocs() {
  const docs = [];
  const add = (m, type, title, raw, summary, url) => {
    docs.push({
      module: m, moduleName: MODULE_LABEL[m] || m, type,
      title: String(title || ''), tnorm: norm(title),
      body: norm(raw), raw: String(raw || ''), summary: String(summary || ''), url,
    });
  };
  // 帝王板块：皇帝 / 悬案 / 地图事件
  for (const d of DYNASTIES) {
    const b = loadDynasty(d);
    for (const e of b.emperors) {
      add('emperors', '皇帝', e.name, JSON.stringify(e), e.intro, emperorSummary(e).url);
    }
    for (const c of b.cases) {
      add('emperors', '悬案', c.name, JSON.stringify(c), c.summary, caseSummary('emperors', null, c, d).url);
    }
    for (const ev of b.mapEvents || []) {
      add('emperors', '地图事件', ev.name, JSON.stringify(ev), ev.summary || ev.note,
        deepLink(`index.html?page=map&dynasty=${d}&event=${enc(ev.eventId || ev.id)}`).url);
    }
    // 帝王路线（靖难/郑和/土木堡……）：整条导览 + 逐站都建索引，
    // 命中后直接打开讲解员导览（step 精确到某一站）
    for (const r of b.routes || []) {
      const tourBase = `index.html?page=map&dynasty=${d}&route=${enc(r.id)}`;
      const routeText = [r.name, r.year, r.desc, r.intro,
        (r.keywords || []).join(' '),
        (r.points || []).map((p) => `${p.name} ${p.title || ''} ${p.narrate || p.note || ''}`).join(' ')]
        .filter(Boolean).join(' ');
      add('emperors', '路线导览', r.name, routeText,
        r.intro || r.desc, deepLink(`${tourBase}&step=0&autoplay=0&muted=1`).url);
      (r.points || []).forEach((p, i) => {
        const txt = [r.name, p.name, p.modern, p.title, p.date, p.narrate, p.note, (r.keywords || []).join(' ')].filter(Boolean).join(' ');
        add('emperors', '导览站点', `${p.title || p.name}（${r.name}）`, txt,
          p.narrate || p.note || '', deepLink(`${tourBase}&step=${i}&autoplay=0&muted=1`).url);
      });
    }
  }
  // 国学板块：典籍 / 公案 / 神兽器物 / 路线 / 问典
  const gxGroups = [
    ['thought', Object.keys(THOUGHT_SECTS)],
    ['shiwen', ['shiwen']],
    ['gewu', ['gewu']],
    ['myth', ['myth']],
  ];
  for (const [m, sects] of gxGroups) {
    for (const s of sects) {
      const b = loadGuoxue(m, s);
      for (const x of b.books) {
        add(m, '典籍', x.name, JSON.stringify(x), x.intro || x.meta, bookSummary(m, s, x).url);
      }
      for (const c of b.cases) {
        add(m, '公案', c.name, JSON.stringify(c), c.summary, caseSummary(m, s, c).url);
      }
      for (const a of b.artifacts) {
        add(m, m === 'myth' ? '神兽' : '器物', a.name, JSON.stringify(a), a.note, artifactLike(m, a).url);
      }
      (b.routes || []).forEach((r, idx) => {
        const u = m === 'myth'
          ? gxDeepLink('myth', 'myth', `tab=map&route=${idx}`).url
          : gxDeepLink(m, s, `tab=map&route=${idx}`).url;
        add(m, '路线', r.name, JSON.stringify(r.points || []),
          (r.points || []).map((p) => p.name).join(' → '), u);
        // 每个舆图热点/行迹地点也单独建索引，搜"兰若寺"可直达热点卡片
        for (const p of r.points || []) {
          const pu = m === 'myth'
            ? gxDeepLink('myth', 'myth', `tab=map&route=${idx}&hotspot=${enc(p.name)}`).url
            : u;
          add(m, '热点', p.name, JSON.stringify(p), p.note || p.text || p.story || '', pu);
        }
      });
      for (const dd of b.discourses || []) {
        add(m, '问典', dd.title, JSON.stringify(dd), dd.quest, gxDeepLink(m, s, 'tab=quiz').url);
      }
    }
  }
  return docs;
}

function bigrams(str) {
  const out = [];
  for (let i = 0; i < str.length - 1; i++) out.push(str.slice(i, i + 2));
  return out;
}

let searchIndex = null;
function getSearchIndex() {
  if (searchDocs && searchIndex) return searchIndex;
  searchDocs = buildSearchDocs();
  const post = new Map();
  const bump = (token, idx, weight) => {
    let m = post.get(token);
    if (!m) { m = new Map(); post.set(token, m); }
    m.set(idx, (m.get(idx) || 0) + weight);
  };
  searchDocs.forEach((doc, idx) => {
    for (const ch of doc.tnorm) bump('u:' + ch, idx, 3);
    for (const bg of bigrams(doc.tnorm)) bump('t:' + bg, idx, 1);
    for (const bg of bigrams(doc.body)) bump('b:' + bg, idx, 1);
  });
  searchIndex = post;
  return searchIndex;
}

function makeSnippet(doc, chunks) {
  const base = (doc.summary || doc.raw).replace(/<[^>]+>/g, '');
  const hay = norm(base);
  for (const c of chunks) {
    const i = hay.indexOf(c);
    if (i >= 0) return base.slice(Math.max(0, i - 30), i + 70);
  }
  return base.slice(0, 80);
}

function tSearch({ q, module, limit }) {
  const max = Math.min(Number(limit) || 20, 50);
  const raw = String(q || '').trim();
  const chunks = raw.toLowerCase()
    .replace(/[·・《》「」『』，,。、？?！!：:；;()（）]/g, ' ')
    .split(/\s+/).map((c) => norm(c)).filter(Boolean);
  if (!chunks.length) throw new Error('需要提供 q（检索词）');
  const post = getSearchIndex();
  const allowed = new Set();
  searchDocs.forEach((d, i) => { if (!module || d.module === module) allowed.add(i); });
  const scores = new Map();
  // 收集某个 token 的命中文档集合，同时累计分值
  const tokenSet = (token, w, out) => {
    const m = post.get(token);
    if (!m) return;
    for (const [idx, cnt] of m) {
      if (!allowed.has(idx)) continue;
      scores.set(idx, (scores.get(idx) || 0) + w * cnt);
      out.add(idx);
    }
  };
  const intersect = (a, b) => new Set([...a].filter((x) => b.has(x)));
  const perChunk = [];
  for (const chunk of chunks) {
    let cands = null;
    if (chunk.length === 1) {
      const s = new Set();
      tokenSet('u:' + chunk, 2, s);
      cands = s;
    } else {
      // 同一 chunk 的全部双字都必须命中（AND），防止常用字误命中
      for (const bg of bigrams(chunk)) {
        const s = new Set();
        tokenSet('t:' + bg, 10, s);
        tokenSet('b:' + bg, 1, s);
        cands = cands ? intersect(cands, s) : s;
      }
    }
    perChunk.push(cands || new Set());
  }
  // 所有切词都必须命中同一文档（AND）
  let candidates = perChunk[0] || new Set();
  for (let i = 1; i < perChunk.length; i++) {
    candidates = new Set([...candidates].filter((x) => perChunk[i].has(x)));
  }
  const items = [];
  for (const idx of candidates) {
    const doc = searchDocs[idx];
    let score = scores.get(idx) || 0;
    for (const chunk of chunks) {
      if (doc.tnorm === chunk) score += 100;
      else if (doc.tnorm.includes(chunk)) score += 55;
    }
    score += TYPE_BOOST[doc.type] || 0;
    items.push({
      module: doc.module, moduleName: doc.moduleName, type: doc.type,
      title: doc.title, snippet: makeSnippet(doc, chunks), url: doc.url, score,
    });
  }
  items.sort((a, b) => (b.score - a.score) || a.title.length - b.title.length);
  return { q: raw, count: items.length, items: items.slice(0, max) };
}

// ---------- 工具清单 ----------
/**
 * 开场：把「服务是否可用」这个确定性问题在本进程内解决完，只把结论交给模型。
 * 这里刻意不返回任何命令行——模型不需要、也不应该执行命令。
 */
async function tSessionStart() {
  const status = await ensureLocalServer();
  const base = {
    site_name: '中华历史图谱',
    project_root: ROOT,
    server_script: path.join(ROOT, 'web', 'serve.mjs'),
    local_base_url: LOCAL_BASE,
  };

  if (status.state === 'running' || status.state === 'started_by_mcp') {
    return {
      ...base,
      ready: true,
      status: status.state,
      status_note: status.state === 'started_by_mcp'
        ? '本地服务原本未运行，已由本工具在后台自动启动，探活通过。'
        : '本地服务已在运行，探活通过。',
      home_url: LOCAL_BASE,
      next_action: [
        '站点已就绪。请把下面这个地址作为可点击链接回复用户（用户点击即可在右侧浏览器打开）：',
        LOCAL_BASE,
        '然后说一句「站点已就绪，可以开始提问」，静默等待提问。不要执行任何命令。',
      ].join('\n'),
      rules: [
        '本工具已完成探活与启动，你不需要执行任何命令行。',
        '不要搜索硬盘、查找项目目录、查 hosts / DNS、查端口占用、查进程——路径与网址都在本返回里。',
        '禁止运行 服务管理.bat：它以前台窗口方式启动服务，并会另开系统浏览器，破坏右侧浏览器内的统一体验。',
        '你只需把 home_url 作为可点击链接发给用户，不要自己尝试打开浏览器。',
      ],
    };
  }

  if (status.state === 'port_taken') {
    return {
      ...base,
      ready: false,
      status: 'port_taken',
      status_note: status.detail,
      home_url: LOCAL_BASE,
      fix: status.fix,
      next_action: [
        '把结论如实告诉用户：端口被其它程序占用，站点未能启动。',
        '给出上面 fix 字段里的换端口办法，等用户处理后再调用一次 session_start 复检。',
        '不要自己尝试查端口、查进程或改系统配置。',
      ].join('\n'),
    };
  }

  return {
    ...base,
    ready: false,
    status: 'start_failed',
    status_note: status.detail,
    home_url: LOCAL_BASE,
    fix: status.fix,
    next_action: [
      '把结论如实告诉用户：本地服务未能自动启动。',
      '给出上面 fix 字段里的一条命令，让用户自行执行；执行完再调用一次 session_start 复检。',
      '不要自己反复尝试启动或排查环境。',
    ].join('\n'),
  };
}

const TOOLS = [
  { name: 'session_start', description: '【每次会话开场必须第一个调用】本工具会自动探活本地站点，未运行时由本工具直接在后台拉起（无需你执行任何命令），并返回可直接打开或分享的首页地址。调用后按 next_action 把链接给用户并待命；你永远不需要自己搜索或拼接项目路径。',
    inputSchema: { type: 'object', properties: {} },
    run: () => tSessionStart() },
  { name: 'list_modules', description: '列出站点全部五个学习板块（帝王谱系/思想源流/诗词鉴赏/格物致知/神话异志）及其数据规模与入口。不确定内容归属时先调用本工具。',
    inputSchema: { type: 'object', properties: {} },
    run: () => tListModules() },
  { name: 'search', description: '站内权威数据源：在全部或指定板块中做全文检索（人名、书名、案件、神兽、器物、路线、问典均可），按相关度返回带深链的结果。回答历史问题时优先使用本工具，无需联网搜索。',
    inputSchema: { type: 'object', required: ['q'],
      properties: {
        q: { type: 'string', description: '检索词，如“空印案”“九尾狐”“李白”“牧野之战”' },
        module: { type: 'string', enum: ['emperors', 'thought', 'shiwen', 'gewu', 'myth'] },
        limit: { type: 'number', description: '返回条数上限，默认 20，最大 50' },
      } },
    run: (a) => tSearch(a) },
  { name: 'list_emperors', description: '列出皇帝（可按朝代），含在位年代、简介、画像与深链。',
    inputSchema: { type: 'object', properties: {
      dynasty: { type: 'string', enum: DYNASTIES },
    } },
    run: (a) => tListEmperors(a) },
  { name: 'get_emperor', description: '按 id、皇帝名或年号获取皇帝完整档案：生平时间线、重大事件、人物关系、争议、趣闻、史料出处与画像。',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: '如 ming-emperor-taizu' },
      name: { type: 'string', description: '皇帝名或年号，如“朱元璋”“康熙”' },
    } },
    run: (a) => tGetEmperor(a) },
  { name: 'list_cases', description: '列出悬案/公案（帝王八段式档案或各板块公案），可按模块、朝代、分类筛选。',
    inputSchema: { type: 'object', properties: {
      module: { type: 'string', enum: ['emperors', 'thought', 'shiwen', 'gewu', 'myth'] },
      dynasty: { type: 'string', enum: DYNASTIES },
      sect: { type: 'string', enum: Object.keys(THOUGHT_SECTS), description: '思想板块的宗派，如 rujia' },
      category: { type: 'string' },
    } },
    run: (a) => tListCases(a) },
  { name: 'get_case', description: '按 id 或名称获取一桩悬案/公案的完整八段式内容（得名由来、背景、人物、经过、结果、影响、开放问题）。',
    inputSchema: { type: 'object', properties: {
      module: { type: 'string', enum: ['emperors', 'thought', 'shiwen', 'gewu', 'myth'] },
      sect: { type: 'string', enum: Object.keys(THOUGHT_SECTS) },
      id: { type: 'string' }, name: { type: 'string' },
    } },
    run: (a) => tGetCase(a) },
  { name: 'list_books', description: '列出典籍/诗人（思想板块需指定 sect，或返回五宗全部）。',
    inputSchema: { type: 'object', required: ['module'], properties: {
      module: { type: 'string', enum: ['thought', 'shiwen', 'gewu', 'myth'] },
      sect: { type: 'string', enum: Object.keys(THOUGHT_SECTS) },
    } },
    run: (a) => tListBooks(a) },
  { name: 'get_book', description: '按 id 或书名获取一部典籍/一位诗人的完整内容：原文金句、名篇精读、章节导读、冷知识、时间线等。',
    inputSchema: { type: 'object', required: ['module'], properties: {
      module: { type: 'string', enum: ['thought', 'shiwen', 'gewu', 'myth'] },
      sect: { type: 'string', enum: Object.keys(THOUGHT_SECTS) },
      id: { type: 'string', description: '如 libai、shanhaijing、kaogongji' },
      name: { type: 'string', description: '书名或人名，如“李白”“山海经”' },
    } },
    run: (a) => tGetBook(a) },
  { name: 'list_creatures', description: '列出神话异志神兽图鉴（113 只），可按分类（上古神话/神魔长篇/鬼狐笔记/小说总集）或出处书筛选，带缩略图。',
    inputSchema: { type: 'object', properties: {
      category: { type: 'string' }, book: { type: 'string' },
    } },
    run: (a) => tListCreatures(a) },
  { name: 'list_artifacts', description: '列出器物图谱（默认格物致知 59 件；module=myth 时等同神兽），可按分类/典籍筛选，带缩略图。',
    inputSchema: { type: 'object', properties: {
      module: { type: 'string', enum: ['gewu', 'myth'], description: '默认 gewu' },
      category: { type: 'string' }, book: { type: 'string' },
    } },
    run: (a) => tListArtifacts(a) },
  { name: 'get_artifact', description: '按名称获取一件器物或神兽的详情（出处、原文与解读、缩略图与原图）。',
    inputSchema: { type: 'object', required: ['name'], properties: {
      module: { type: 'string', enum: ['gewu', 'myth'], description: '默认 gewu' },
      name: { type: 'string', description: '如“九尾狐”“商代后母戊鼎”' },
    } },
    run: (a) => tGetArtifact(a) },
  { name: 'get_route', description: '获取路线舆图：神话板块返回五条古舆图路线（山海经22/西游17/封神14/聊斋8/太平8，含每个热点的坐标、原著原文+译文、配图与深链）；诗词/思想返回真实地理路线；帝王返回各朝舆图事件。',
    inputSchema: { type: 'object', properties: {
      module: { type: 'string', enum: ['emperors', 'thought', 'shiwen', 'myth'] },
      sect: { type: 'string', enum: Object.keys(THOUGHT_SECTS) },
      route: { description: '路线序号（0 起）或名称；不传则只返回路线清单',
        oneOf: [{ type: 'number' }, { type: 'string' }] },
    } },
    run: (a) => tGetRoute(a) },
  { name: 'get_discourses', description: '获取“问典”侦探式思辨题（思想/诗词/格物/神话），含议题、线索、开放观点与创作题。',
    inputSchema: { type: 'object', properties: {
      module: { type: 'string', enum: ['thought', 'shiwen', 'gewu', 'myth'] },
      sect: { type: 'string', enum: Object.keys(THOUGHT_SECTS) },
    } },
    run: (a) => tGetDiscourses(a) },
  { name: 'get_quiz', description: '获取帝王板块的史论选择题（可按朝代），含选项、正确答案与解析。',
    inputSchema: { type: 'object', properties: {
      dynasty: { type: 'string', enum: DYNASTIES },
    } },
    run: (a) => tGetQuiz(a) },
];

// 开场提示词模板（MCP prompts）：客户端 UI 中可点击，强制锁定正确开场
const OPENING_PROMPT = [
  '你已连接「中华历史图谱」连接器，请严格按以下顺序执行，不要跳过：',
  '1. 立即调用 session_start 工具。它会自己探活、必要时自己在后台拉起本地站点，并把结论返回给你。你不需要、也不允许为此执行任何命令行。',
  '2. 若返回 ready=true：把返回的 home_url 作为可点击链接发给用户（用户点击即可在右侧浏览器打开），并说一句「站点已就绪，可以开始提问」，然后静默等待。',
  '3. 若返回 ready=false：把 status_note 与 fix 如实告诉用户，等用户处理后再调用一次 session_start。',
  '之后我的所有问题，只能用连接器的只读工具检索站内数据回答，禁止联网搜索或浏览外部网页；把返回的 url 作为可点击深链发给用户，再对照数据讲解。',
].join('\n');

const PROMPTS = [
  {
    name: '开场：打开中华历史图谱',
    description: '新会话点此开场：自动启动本地站点并给出首页链接（无需任何命令行与路径）',
    arguments: [],
  },
  {
    name: '按站内内容讲解',
    description: '输入一个历史/国学话题（如「土木堡之变」「山海经」），仅用连接器数据检索、深链定位并讲解',
    arguments: [{ name: '话题', description: '想了解的人物、事件、典籍或神兽', required: true }],
  },
];

// 服务端指令：握手时通过 instructions 字段下发给客户端模型，约束其行为
const SERVER_INSTRUCTIONS = [
  '你是「中华历史图谱」站点的 AI 讲解员。该站点是一个纯静态中国历史与国学可视化网站，包含帝王谱系、思想源流、诗词鉴赏、格物致知、神话异志五大板块。',
  '【开场 SOP——进入会话后的第一个动作，无需用户要求，只做一次】',
  '1. 立即调用 session_start。它会在服务端完成探活与按需启动，只把结论返回给你。你不需要执行任何命令行。',
  '2. ready=true：把返回的 home_url 作为可点击链接发给用户（用户点击即可在右侧浏览器打开），并说一句「站点已就绪，可以开始提问」，随后静默等待。',
  '3. ready=false：把 status_note 与 fix 原样告诉用户，等用户处理后再调用一次 session_start。',
  '【其他问题 SOP】',
  '检索类问题先 search；单个人物用 get_emperor；案件悬案用 get_case；书籍/诗人用 get_book；神兽器物用 get_artifact；地图与舆图概览用 get_route。把结果里的 url 作为可点击深链发给用户，然后对照 JSON 讲解。',
  '【禁止事项】',
  'A. 禁止搜索本地文件、硬盘、项目目录、hosts/DNS、端口、进程；站点已经在运行，网址都在工具返回里，找不到内容就再调工具，不要翻文件系统。',
  'B. 禁止联网搜索或浏览外部网页来检索、补充本站相关事实；禁止引用维基百科、百科、新闻网页。工具没返回的内容，直接说「站点暂未收录」。',
  'C. 禁止自行编写 HTML、地图或任何替代站点页面的产物。',
  'D. 只打开工具返回的 127.0.0.1 地址，不要打开外部网站。图片字段 thumb 用于对话内展示，full 是原图链接；不要输出 base64。',
  'E. 只有用户明确要把链接分享给别人时，才用 online_url（GitHub Pages 在线地址）。',
  '【其他】涉及演义小说（《三国演义》《西游记》《封神演义》《聊斋志异》等）保留数据中的出处标注，不与正史混淆；默认使用简体中文。',
].join('\n');

// 每条工具结果开头的强制提醒（模型对刚读到的工具内容关注度最高，写在这里比握手 instructions 更有效）
const RESULT_REMINDER = [
  '【下一步操作指引】',
  '1. 以上 JSON 是「中华历史图谱」站内人工整理的权威内容，是回答本题的唯一事实来源。禁止联网搜索、浏览网页、搜索本地文件或执行命令行排查。',
  '2. 把结果中的 url 字段作为可点击深链发给用户，打开后页面会定位到对应条目。',
  '3. 讲解必须落在返回的字段上；返回里没有的内容，说「站点暂未收录」。',
].join('\n');

// 模型跳过开场流程时的附加提醒
const NOT_STARTED_REMINDER = '【提醒：你还没有执行开场流程】请先调用 session_start（它会自己探活并在需要时启动本地服务，你不需要执行任何命令），把返回的 home_url 作为可点击链接发给用户，再处理本问题。';

// ---------- JSON-RPC over STDIO ----------
function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// 本进程是否已执行开场流程（每个 STDIO 进程独立，新会话会重新拉起进程）
let sessionStarted = false;

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
      serverInfo: { name: 'chinese-history-atlas', version: '1.3.0' },
      instructions: SERVER_INSTRUCTIONS,
    });
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return rpcResult(id, {});
  // 豆包客户端（rmcp）的前置探测：只记录参数，必须返回 method-not-found。
  // 实测该探测收到非标准结果会判定连接失败并反复重试（不进入 initialize）；
  // 返回标准错误后客户端才会继续走 initialize 正式握手。
  if (method === 'server/discover') {
    dlog('server/discover 参数: ' + JSON.stringify(params || {}).slice(0, 2000));
    return rpcError(id, -32601, '未知方法：server/discover');
  }
  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === 'prompts/list') {
    return rpcResult(id, { prompts: PROMPTS });
  }
  if (method === 'prompts/get') {
    const pname = params && params.name;
    if (pname === '开场：打开中华历史图谱') {
      return rpcResult(id, {
        description: '自动启动并打开中华历史图谱，然后待命',
        messages: [{ role: 'user', content: { type: 'text', text: OPENING_PROMPT } }],
      });
    }
    if (pname === '按站内内容讲解') {
      const topic = (params && params.arguments && params.arguments['话题']) || '（请在此填入话题）';
      const text = OPENING_PROMPT + `\n\n现在请讲解：${topic}\n要求：先用 search 等工具检索；把返回的 url 作为可点击深链发给用户（打开即定位到对应条目）；再对照返回的 JSON 数据讲解。工具未收录的内容直接说「站点暂未收录」，禁止联网补充。`;
      return rpcResult(id, {
        description: '仅用连接器数据讲解：' + topic,
        messages: [{ role: 'user', content: { type: 'text', text } }],
      });
    }
    return rpcError(id, -32601, '未知提示词：' + pname);
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return rpcError(id, -32601, '未知工具：' + name);
    try {
      const data = await tool.run((params && params.arguments) || {});
      if (name === 'session_start') sessionStarted = true;
      const blocks = [];
      if (!sessionStarted) blocks.push({ type: 'text', text: NOT_STARTED_REMINDER });
      blocks.push({ type: 'text', text: RESULT_REMINDER });
      blocks.push({ type: 'text', text: JSON.stringify(data, null, 2) });
      return rpcResult(id, { content: blocks });
    } catch (e) {
      return rpcResult(id, -32000, String(e && e.message || e));
    }
  }
  if (id === undefined) {
    if (method !== 'notifications/initialized') dlog('未知通知 ' + method + ' 参数: ' + JSON.stringify(params || {}).slice(0, 1000));
    return null;
  }
  dlog('未知方法 ' + method + ' 参数: ' + JSON.stringify(params || {}).slice(0, 1000));
  return rpcError(id, -32601, '未知方法：' + method);
}

function runStdio() {
  dlog(`进程启动 cwd=${process.cwd()} node=${process.version} argv=${JSON.stringify(process.argv)}`);
  process.on('uncaughtException', (e) => dlog('uncaughtException: ' + (e && e.stack || e)));
  process.on('exit', (code) => dlog('进程退出 code=' + code));
  const rl = readline.createInterface({ input: process.stdin });
  let buf = '';
  let chain = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { dlog('JSON解析失败: ' + line.slice(0, 200) + ' | ' + e.message); continue; }
      dlog('收到 ' + msg.method + (msg.id != null ? ' (id=' + msg.id + ')' : ''));
      // 串行处理，保证异步工具（session_start 会探活/拉起服务）按请求顺序回复
      chain = chain.then(async () => {
        let res;
        try {
          res = await handle(msg);
        } catch (e) {
          dlog('handle异常: ' + (e && e.stack || e));
          res = msg.id != null ? rpcError(msg.id, -32000, String(e && e.message || e)) : null;
        }
        if (res) {
          const out = JSON.stringify(res);
          dlog('回复 ' + msg.method + ' ' + out.length + ' 字节');
          process.stdout.write(out + '\n');
        }
      }).catch((e) => dlog('chain异常: ' + (e && e.stack || e)));
    }
  });
}

// ---------- 协议自测 ----------
async function selftest() {
  const call = (msg) => handle(msg);
  const assert = (cond, label) => {
    if (!cond) { console.error('❌ 自测失败：' + label); process.exit(1); }
    console.log('✅ ' + label);
  };
  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert(init.result.protocolVersion === '2024-11-05', 'initialize 握手');
  const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert(list.result.tools.length === TOOLS.length, 'tools/list 返回 ' + TOOLS.length + ' 个工具');
  const mods = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_modules', arguments: {} } });
  const modData = JSON.parse(mods.result.content.at(-1).text);
  assert(modData.modules.length === 5, 'list_modules 返回 5 个板块');
  const emp = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_emperor', arguments: { name: '朱元璋' } } });
  const empData = JSON.parse(emp.result.content.at(-1).text);
  assert(empData.name === '朱元璋' && empData.portrait.url.includes('taizu.jpg'), 'get_emperor 朱元璋');
  const route = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_route', arguments: { module: 'myth', route: 1 } } });
  const routeData = JSON.parse(route.result.content.at(-1).text);
  assert(routeData.point_count === 17 && routeData.points[0].image && routeData.points[0].url,
    '神话西游路线 17 热点，含图片与深链');
  const creature = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_artifact', arguments: { module: 'myth', name: '九尾狐' } } });
  const cData = JSON.parse(creature.result.content.at(-1).text);
  assert(cData.image.thumb && cData.image.full, '九尾狐缩略图+原图');
  const book = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_book', arguments: { module: 'shiwen', name: '李白' } } });
  const bData = JSON.parse(book.result.content.at(-1).text);
  assert(Array.isArray(bData.chapters), 'get_book 李白含名篇精读');
  const sch = await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'search', arguments: { q: '空印案', limit: 5 } } });
  const sData = JSON.parse(sch.result.content.at(-1).text);
  assert(sData.items.some((x) => x.title === '空印案'), 'search 空印案命中');
  console.log('\n全部自测通过。');
}

if (process.argv.includes('--selftest')) {
  await selftest();
} else {
  runStdio();
}
