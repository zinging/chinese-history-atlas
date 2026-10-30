#!/usr/bin/env node
/**
 * chinese-history-atlas · 本地 MCP Server（零依赖，Node ESM）
 *
 * 把站点的五大板块只读数据（帝王谱系 / 思想源流 / 诗词鉴赏 / 格物致知 / 神话异志）
 * 以 MCP 工具的形式暴露给豆包工作、Claude、Cursor 等支持 STDIO MCP 的 AI 客户端。
 *
 * 数据全部来自项目 data/ 目录，实时读取、不缓存到外部；返回结果中：
 *   - 图片优先给缩略图 URL（artifacts-thumb / myth-map-thumb），另附原图 URL；
 *   - 每个实体都带 url（本地 127.0.0.1 完整地址），
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
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..', '..');
const DATA = path.join(ROOT, 'data');

const LOCAL_BASE = (process.env.CHAT_BASE_URL || 'http://127.0.0.1:5173/web/').replace(/\/?$/, '/');

const SERVER_VERSION = '1.5.0';

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

/** 深链：只返回本地（127.0.0.1）完整 URL。
 *  全部讲解能力基于本地版本，不与 GitHub Pages 线上镜像做任何关联——
 *  线上镜像可能与本地不一致，给出线上地址会让读者看到旧内容、掩盖本地改动。 */
function deepLink(relQuery) {
  return { url: LOCAL_BASE + relQuery };
}
const enc = encodeURIComponent;

// ---------- 讲解员「歌词跟随」：前后端共享切句规则 ----------
// 必须与 web/guide-highlight.js 的 splitSentences 完全一致（按 。！？…；;!? 切分并保留句末标点），
// 保证服务端 steps[i] 与页面 <span class="gh-line" data-s="i"> 一一对齐。
function splitSentences(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  let buf = '';
  for (const ch of s) {
    buf += ch;
    if ('。！？；;!?'.includes(ch)) {
      const t = buf.trim();
      if (t) out.push(t);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  // 残句合并：仅由引号/括号收尾符组成的孤立残句（如『…』切出的「』」）并回上一句，必须与前端 guide-highlight.js 一致
  const merged = [];
  for (const t of out) {
    if (merged.length && /^[\s』」”）》〉、，]+$/.test(t)) {
      merged[merged.length - 1] += t;
    } else {
      merged.push(t);
    }
  }
  return merged;
}

// 神话热点 desc 形如：原文……<span class='tr'>译文：……</span>原文……<span class='tr'>译文：……</span>；
// 按出现顺序拆成若干 {type:'main'|'tr', text} 段（一张卡片可能有多组原文/译文）；
// 同时返回 main/tr（首组，供扁平字段使用）。该顺序必须与前端 guide-highlight.js 的 hotSeq 完全一致。
function stripMythTr(desc) {
  const html = String(desc || '');
  const re = /<span class='tr'>([\s\S]*?)<\/span>/g;
  const segments = [];
  let last = 0, m;
  const plain = (s) => s.replace(/<[^>]+>/g, '').trim();
  const pushMain = (s) => { const t = plain(s); if (t) segments.push({ type: 'main', text: t }); };
  const pushTr = (s) => { const t = plain(s); if (t) segments.push({ type: 'tr', text: t }); };
  while ((m = re.exec(html))) {
    pushMain(html.slice(last, m.index));
    pushTr(m[1]);
    last = re.lastIndex;
  }
  pushMain(html.slice(last));
  if (!segments.length) {
    const t = plain(html);
    return { main: t, tr: '', segments: t ? [{ type: 'main', text: t }] : [] };
  }
  return {
    main: (segments.find((s) => s.type === 'main') || {}).text || '',
    tr: (segments.find((s) => s.type === 'tr') || {}).text || '',
    segments,
  };
}

/**
 * 构造一个讲解对象的「锚点表」（anchors）——AI 写导读时的布景清单，不是台词本。
 *
 * 语义：每个 anchor 表示「页面上第 i 个可定位位置讲的是什么」，供 AI 判断该讲哪个、按什么顺序讲。
 * AI 的讲解稿由它自己组织，讲到某处时挂 anchor.url（含 #s=i）让页面跳到该位置高亮；
 * 页面只负责定位与呈现（原文、配图、地图、路线动画），不承担朗读。
 *
 * blocks: [{label, text, sources?, role?}]，顺序必须与前端渲染顺序一致。
 * 返回 { anchor_count, guide_url, anchors:[{i, scene, role, gist, chars, sources, url}] }
 */
/**
 * 讲解视角：按对象类型给出「该往哪想」，只给思考方向，不规定篇幅、不规定写法。
 * 这是导览员的关注点清单，不是填空模板——模型据此判断重点，具体措辞由它自己组织。
 */
const GUIDE_LENS = {
  event: '这件事为什么会发生、关键人物是谁、他（他们）发动或卷入此事的动机是什么、转折点在哪、代价与后果是什么、历史意义在哪',
  person: '他面对的时代困局是什么、做过哪些关键抉择、付出了什么代价、取得了什么成就、后世如何评价他',
  book: '这部书的核心思想或主要内容是什么、作者当时的处境如何、它回应了那个时代的什么问题、在此后的时代产生了怎样的意义与影响',
  craft: '古人在解决什么实际难题、具体怎么做、巧在哪里、局限又在哪里、这套方法后来如何演变',
  myth: '这个想象回应了人对什么的困惑或恐惧、原著是怎么写的、后世如何变形与流传',
  route: '这条路线的走向与地理逻辑、沿途每一站的关键事件、整条线串起的因果推进关系',
  hotspot: '这处地点在原著中为什么重要、在故事里起什么叙事作用、它对应的地貌与文本依据',
};

function guidePack(relQuery, blocks, kind) {
  const base = deepLink(relQuery);
  const guideUrl = base.url + '&guide=1';
  const anchors = [];
  for (const blk of blocks) {
    // 一条 block 按其句数展开成多个可定位位置。
    // 只给 gist（约 30 字摘要）而不是整句原文：原文给太全，模型会直接搬运，
    // 讲解退化成复述网页；摘要足够判断这处讲什么，具体措辞由模型自己组织。
    const sents = splitSentences(blk.text);
    for (const text of sents) {
      const i = anchors.length;
      anchors.push({
        i,
        scene: blk.label,                              // 这一处讲的是什么（语义单位）
        role: blk.role || null,                        // 背景 / 转折 / 结局等，供 AI 组织顺序
        gist: gistOf(text),                            // 摘要，供 AI 判断内容，不是台词
        chars: text.replace(/\s/g, "").length,         // 原文长度，供 AI 估算篇幅
        sources: blk.sources || null,                  // 出处随锚点自动带出
        url: `${guideUrl}#s=${i}`,                     // 直接可跳转的定位链接
      });
    }
  }
  return {
    anchor_count: anchors.length,
    guide_url: guideUrl,
    // 打开即自动按句推进（页面播放器支持 ?autoplay=1）：用户点一个链接，页面就逐句金色高亮，
    // 讲解员再对照锚点顺序口述；无需模型手动发多个 #s=i 链接。
    autoplay_url: guideUrl + '&autoplay=1',
    kind: kind || null,
    lens: (kind && GUIDE_LENS[kind]) || null,
    anchors,
  };
}

/** 取一句话的摘要：前 30 个非空字符 + 省略号；短句原样返回。 */
function gistOf(text) {
  const s = String(text || "").replace(/\s+/g, "");
  return s.length <= 30 ? s : s.slice(0, 30) + "…";
}

/** data/portraits 下的图片地址；thumb=true 时返回 {thumb, full} */
function portraitHref(rel, { thumb = false, thumbDir = null } = {}) {
  // rel 形如 ../../data/portraits/artifacts/xxx.jpg 或 data/portraits/xxx.jpg
  const m = String(rel).match(/(?:\.\.\/\.\.\/)?data\/portraits\/(.+)$/);
  const sub = m ? m[1] : String(rel).replace(/^\/+/, '');
  const full = 'data/portraits/' + sub;
  const pair = (f) => ({
    url: LOCAL_BASE + '../' + f,
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

/** 事件 → 关联路线映射（必须与 web/app.js 的 EVENT_ROUTE_MAP 保持一致）。
 *  讲解员逐句讲解某事件时，命中此处会把路线概述与逐站解说一并纳入 guide。 */
const EVENT_ROUTE_MAP = {
  // 明朝
  'ming-event-jingnan': 'jingnan-south',
  'ming-event-zhenghe-qihang': 'zhenghe-west',
  'ming-event-tumu': 'yexian-nanxia',
  'ming-event-shanhaiguan': 'qing-ruguan',
  'ming-event-zhangxianzhong': 'zhangxianzhong-sichuan',
  'ming-event-yangzhou': 'nanmin-liuwang',
  'ming-event-ke-dadu': 'qing-ruguan',
  'ming-event-chongzhen-ziyi': 'lizicheng-north',
  // 宋朝
  'song-event-chenqiao': 'song-chenqiao',
  'song-event-nandu': 'song-nandu',
  'song-event-yuefei': 'song-yuefei',
  'song-event-yashan': 'song-yashan',
  // 唐朝
  'tang-event-jinyang': 'tang-jinyang-changan',
  'tang-event-mie-dongtujue': 'tang-mie-dongtujue',
  'tang-event-zheng-gaogouli': 'tang-zheng-gaogouli',
  'tang-event-anshi-baofa': 'tang-anshi',
  'tang-event-caizhou': 'tang-caizhou',
  'tang-event-huangchao': 'tang-huangchao',
  // 元朝
  'yuan-event-miejin': 'yuan-miejin',
  'yuan-ev-1279': 'yuan-miesong',
  'yuan-ev-1351': 'yuan-hongjin',
  'yuan-ev-1368': 'yuan-beiyuan',
  'yuan-event-zhenghe': 'yuan-makeluo',
  // 清朝
  'qing-ev-1644': 'qing-ruguan-beijing',
  'qing-event-sanshun': 'qing-pingding-sanfan',
  'qing-ev-1683': 'qing-taiwan',
  'qing-event-gaerdan': 'qing-san-zheng-gaerdan',
  'qing-ev-1851': 'qing-taiping',
  'qing-ev-1900': 'qing-baguo',
  // 隋朝
  'sui-ev-589': 'sui-pingchen',
  'sui-ev-goguryeo': 'sui-zheng-gaogouli',
  'sui-ev-jiangdu': 'sui-jiangdu',
  // 五代
  'wudai-event-houtang': 'wudai-houtang-mie-liang',
  'wudai-event-chairong': 'wudai-chairong-beifa',
};

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
/**
 * MCP 的模块名 → 主壳（web/index.html）侧栏的模块 id。
 * 两者不是一套命名：主壳按 iframe 入口取名（guoxue/shici/gewu/myth），
 * MCP 按内容取名（thought/shiwen/gewu/myth）。深链必须用主壳的 id，
 * 否则 applyDeepLink 找不到 .mega-btn[data-mega=...]，iframe 不会被装载，
 * 链接会停在一个空白页——此前思想源流的所有深链都踩了这个坑。
 */
const SHELL_MODULE = { thought: 'guoxue', shiwen: 'shici', gewu: 'gewu', myth: 'myth' };
const shellModule = (m) => SHELL_MODULE[m] || m;

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
    // 思想源流的「思想大事」：思想传播与学派形成的关键事件（含原文译文与意义）。
    // 只有五宗有，其他板块 section 返回空数组，不影响既有结构。
    events: section('events'),
    discourses: section('discourses'),
    quiz: section('quiz'),
    artifacts: section('artifacts'),
  };
  gxCache[cacheKey] = bundle;
  return bundle;
}

/**
 * 国学子站深链：统一指向主壳 index.html?module=<板块>&...，
 * 而不是裸 guoxue/xxx.html。裸页面没有左侧栏，用户无法自行切换板块；
 * 主壳的 applyDeepLink 读到 module 后会切到对应面板并把参数转发给 iframe。
 */
function gxDeepLink(module, sect, query) {
  const q = module === 'thought' ? `sect=${sect}&` : '';
  return deepLink('index.html?module=' + shellModule(module) + '&' + q + query);
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
    const c = { books: 0, cases: 0, discourses: 0, artifacts: 0, routes: 0, events: 0, places: 0, routePoints: 0 };
    for (const s of sects) {
      const b = loadGuoxue(m, s);
      c.books += b.books.length; c.cases += b.cases.length;
      c.discourses += b.discourses.length; c.artifacts += b.artifacts.length;
      c.routes += b.routes.length;
      c.events += (b.events || []).length;
      c.places += (b.places || []).length;
      for (const r of b.routes || []) c.routePoints += (r.points || []).length;
    }
    counts[m] = c;
  }
  return {
    modules: [
      { id: 'emperors', name: MODULE_LABEL.emperors, desc: '隋至清七朝 77 位皇帝生平时间线、重大事件、悬案疑案、史论选择题、舆图疆域',
        ...deepLink('index.html'), counts: counts.emperors },
      { id: 'thought', name: MODULE_LABEL.thought, desc: `儒释道/诸子/理学心学五宗：${counts.thought.books} 部典籍、${counts.thought.cases} 件公案、${counts.thought.discourses} 道问典、${counts.thought.routes} 条圣贤行迹路线（${counts.thought.routePoints} 个途经点）、${counts.thought.events} 件思想大事与 ${counts.thought.places} 处古今地名`,
        sects: THOUGHT_SECTS, ...deepLink('index.html?module=' + shellModule('thought')), counts: counts.thought },
      { id: 'shiwen', name: MODULE_LABEL.shiwen, desc: '22 位诗人、71 篇名篇精读、95 条金句、13 条诗路与品诗问典',
        ...deepLink('index.html?module=' + shellModule('shiwen')), counts: counts.shiwen },
      { id: 'gewu', name: MODULE_LABEL.gewu, desc: '17 部科技典籍、59 件器物图谱、工艺公案与格物问典',
        ...deepLink('index.html?module=' + shellModule('gewu')), counts: counts.gewu },
      { id: 'myth', name: MODULE_LABEL.myth, desc: '9 部志怪典籍、113 只神兽、五条古舆图路线（山海经/西游/封神/聊斋/太平广记）',
        ...deepLink('index.html?module=' + shellModule('myth')), counts: counts.myth },
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
  // 锚点表：生平简介 → 时间线每条 description（顺序与前端 .intro + .tl-note 一致）
  // sources 随锚点带出（简介用皇帝顶层 sources，时间线用该条自身的 sources），AI 无需自行标注出处
  const guideBlocks = [];
  if (e.intro) guideBlocks.push({ label: '生平简介', text: e.intro, role: '背景', sources: e.sources || null });
  (e.timeline || []).forEach((t, idx) => {
    if (t && t.description) {
      guideBlocks.push({
        label: '时间线·' + (t.date || t.title || ('第' + idx + '条')),
        text: t.description,
        sources: t.sources || null,
      });
    }
  });
  return {
    ...pick(e, ['id', 'name', 'templeName', 'eraName', 'reign', 'intro', 'timeline',
      'majorEvents', 'people', 'controversies', 'funFacts', 'places', 'sources']),
    dynasty: DYNASTY_LABEL[e._dynasty],
    dynastyKey: e._dynasty,
    portrait: portraitHref('data/portraits/' + e.portrait),
    ...deepLink(`index.html?page=timeline&dynasty=${e._dynasty}&emperor=${enc(e.id)}`),
    guide: guidePack(`index.html?page=timeline&dynasty=${e._dynasty}&emperor=${enc(e.id)}`, guideBlocks, 'person'),
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
      // 锚点表：按章节顺序，每章 背景→原文→译文→点评（顺序与前端 .chapter 内一致）
      const guideBlocks = [];
      (b.chapters || []).forEach((c, ci) => {
        const cname = c.title ? String(c.title).replace(/^《|》$/g, '') : ('第' + (ci + 1) + '篇');
        if (c.context) guideBlocks.push({ label: cname + '·背景', text: c.context, role: '背景' });
        if (c.original) guideBlocks.push({ label: cname + '·原文', text: c.original, role: '原文' });
        if (c.gloss) guideBlocks.push({ label: cname + '·译文', text: c.gloss, role: '译文' });
        if (c.afterword) guideBlocks.push({ label: cname + '·点评', text: c.afterword, role: '点评' });
      });
      const sectQ = module === 'thought' ? `sect=${p.sect}&` : '';
      // 相对主壳的查询串（带 module），与 gxDeepLink 一致，保证打开后保留左侧栏。
      // module 必须换成主壳的 id（thought→guoxue 等），否则 iframe 不会被装载。
      const rel = `index.html?module=${shellModule(module)}&` + sectQ + `tab=books&book=${enc(b.id)}`;
      return {
        ...rest,
        ...gxDeepLink(module, p.sect, `tab=books&book=${enc(b.id)}`),
        ...(guideBlocks.length ? { guide: guidePack(rel, guideBlocks, 'book') } : {}),
      };
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

function tGetRoute({ module, sect, route, event }) {
  if (module === 'emperors') {
    // 帝王舆图：返回指定朝代（默认全部）的路线与事件
    const dyns = sect ? [sect] : DYNASTIES;
    // 单个地图事件详情（讲解员逐句高亮）：正文取 events.json 的完整 narrative，与页面单事件弹窗一致
    if (event) {
      const key = norm(event);
      for (const d of dyns) {
        const b = loadDynasty(d);
        const ev = (b.mapEvents || []).find((x) =>
          norm(x.eventId || x.id) === key || norm(x.name).includes(key));
        if (ev) {
          const eid = ev.eventId || ev.id;
          const full = (b.events || []).find((x) => (x.eventId || x.id) === eid);
          const story = (full && full.narrative) ? full.narrative : (ev.narrative || ev.summary || ev.note || '');
          const link = deepLink(`index.html?page=map&dynasty=${d}&event=${enc(eid)}`);
          // 若该事件关联路线：锚点顺序 = 事件正文 → 路线概述 → 逐站解说，
          // 前端按同一顺序包裹 #map-popup 与 #route-detail，保证 anchors[i] 与页面 data-s 对齐。
          const routeId = EVENT_ROUTE_MAP[eid] || null;
          // 与前端对齐：郑和航线（zhenghe-west）是特殊海外图层，前端只做动画、不渲染路线详情，
          // 故讲解不追加路线概述/逐站（否则服务端步数多于页面 #s 行数，逐句高亮会错位）。
          const route = (routeId && routeId !== 'zhenghe-west')
            ? (b.routes || []).find((r) => r.id === routeId)
            : null;
          const guideBlocks = [{
            label: '事件叙述', text: story, role: '正文',
            sources: (full && full.sources) || null,
          }];
          let routeBrief = null;
          if (route && (route.points || []).length) {
            guideBlocks.push({ label: '路线概述', text: route.desc || '', role: '路线' });
            routeBrief = {
              id: route.id, name: route.name, year: route.year || '',
              station_count: route.points.length,
              path: route.points.map((p) => p.name + (p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : '')).join(' → '),
            };
            route.points.forEach((p, i) => {
              guideBlocks.push({ label: `路线第${i + 1}站·${p.name}`, text: p.note || '', role: '路线站' });
            });
          }
          // 事件工笔彩绘图（只有缩略图，存在才返回，未生成的事件不带该字段，避免破图）
          const imgThumbPath = path.join(DATA, 'portraits', 'event-gongbi-thumb', `${eid}.jpg`);
          const eventImage = exists(imgThumbPath)
            ? portraitHref(`data/portraits/event-gongbi-thumb/${eid}.jpg`)
            : null;
          return {
            dynasty: d,
            dynasty_label: DYNASTY_LABEL[d],
            ...pick(ev, ['eventId', 'name', 'date', 'kind', 'place', 'summary', 'note']),
            participants: (full && full.participants) || null,
            narrative: story,
            route: routeBrief,
            image: eventImage,
            ...link,
            guide: guidePack(`index.html?page=map&dynasty=${d}&event=${enc(eid)}`, guideBlocks, 'event'),
          };
        }
      }
      return { matched: false, query: event, hint: '未找到该地图事件；可先调用 get_route(module=emperors) 查看各朝事件清单。' };
    }
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
      const mapEvents = (b.mapEvents || []).map((ev) => {
        const link = deepLink(`index.html?page=map&dynasty=${d}&event=${enc(ev.eventId || ev.id)}`);
        const eid = ev.eventId || ev.id;
        const full = (b.events || []).find((x) => (x.eventId || x.id) === eid);
        const story = (full && full.narrative) ? full.narrative : (ev.narrative || ev.summary || ev.note || '');
        return {
          ...ev,
          ...link,
          // 讲解员逐句高亮：列表只给计数与直达；逐句正文调 get_route(module=emperors, event=事件id)
          guide_count: splitSentences(story).length,
          guide_url: link.url + '&guide=1',
        };
      });
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
        const { segments } = stripMythTr(h.desc);
        const rel = `index.html?module=myth&tab=map&route=${i}&hotspot=${enc(p.name)}`;
        const guideBlocks = [];
        if (h.src) guideBlocks.push({ label: '出处', text: h.src, role: '出处' });
        segments.forEach((seg) => guideBlocks.push({
          label: seg.type === 'tr' ? '译文' : '原文',
          text: seg.text,
          role: seg.type === 'tr' ? '译文' : '原文',
        }));
        const mainAll = segments.filter((s) => s.type === 'main').map((s) => s.text).join('');
        const trAll = segments.filter((s) => s.type === 'tr').map((s) => s.text).join('');
        return {
          name: p.name,
          year: p.year || h.tag || null,
          event: p.event,
          x: h.x, y: h.y,
          src: h.src || null,
          main_text: mainAll || null,
          tr_text: trAll || null,
          image: h.img ? {
            thumb: {
              url: LOCAL_BASE + '../data/portraits/myth-map-thumb/' + h.img,
            },
            full: {
              url: LOCAL_BASE + '../data/portraits/myth-map/' + h.img,
            },
          } : null,
          ...gxDeepLink('myth', 'myth', `tab=map&route=${i}&hotspot=${enc(p.name)}`),
          guide: guideBlocks.length ? guidePack(rel, guideBlocks, 'hotspot') : null,
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
    // 单件思想大事：正文 + 原文译文 + 意义与影响，深链直接在地图上打开该事件卡片
    if (event) {
      const key = norm(event);
      for (const s of sects) {
        const b = loadGuoxue('thought', s);
        const evs = b.events || [];
        const ev = evs.find((x) => norm(x.id) === key || norm(x.name) === key)
          || evs.find((x) => norm(x.name).includes(key));
        if (ev) {
          return {
            sect: s, sectName: THOUGHT_SECTS[s],
            ...pick(ev, ['id', 'name', 'date', 'place', 'lat', 'lng', 'people', 'summary', 'narrative']),
            quotes: ev.quotes || [],
            significance: ev.significance || [],
            ...gxDeepLink('thought', s, `tab=map&evt=${enc(ev.id)}`),
          };
        }
      }
      return { matched: false, query: event, hint: '未找到该思想大事；可先调用 get_route(module=thought) 查看各宗路线，或先 search 该事件名。' };
    }
    const out = [];
    for (const s of sects) {
      const b = loadGuoxue('thought', s);
      b.routes.forEach((r, i) => out.push({ sect: s, sectName: THOUGHT_SECTS[s], index: i, ...r,
        ...gxDeepLink('thought', s, `tab=map&route=${i}`) }));
    }
    // 单条路线：按序号或名称命中，只返回那一条。
    // 此前该分支完全忽略 route 参数，问「王阳明的行迹」会把理学四条路线全给出去。
    if (route !== undefined && route !== null) {
      const idx = Number(route);
      const one = out.find((r) => r.index === idx || norm(r.name).includes(norm(route)));
      if (one) return one;
      return { matched: false, query: route, hint: '未找到该行迹路线；可先调用 get_route(module=thought) 查看清单。' };
    }
    return { count: out.length, routes: out };
  }
  const b = loadGuoxue('shiwen', 'shiwen');
  const routes = b.routes.map((r, i) => ({ index: i, ...r,
    ...gxDeepLink('shiwen', 'shiwen', `tab=map&route=${i}`) }));
  if (route !== undefined && route !== null) {
    const idx = Number(route);
    const one = routes.find((r) => r.index === idx || norm(r.name).includes(norm(route)));
    if (one) return one;
    return { matched: false, query: route, hint: '未找到该诗路；可先调用 get_route(module=shiwen) 查看清单。' };
  }
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

// 预构建检索索引落盘位置（data/ 下，随包发布，让新用户开箱即快查）
const SEARCH_INDEX_FILE = path.join(DATA, 'search-index.json');

// 常见别称 / 简称 → 标准词（高价值、且可能不在正文字段里的称呼；已在正文里的别称命中也无害）
const SEARCH_ALIASES = {
  '朱重八': '朱元璋', '洪武帝': '朱元璋', '朱洪武': '朱元璋',
  '三宝太监': '郑和', '三保太监': '郑和',
  '诸葛孔明': '诸葛亮', '孔明': '诸葛亮', '关云长': '关羽', '云长': '关羽',
  '李太白': '李白', '太白': '李白', '李青莲': '李白',
  '杜工部': '杜甫', '杜子美': '杜甫', '子美': '杜甫',
  '苏东坡': '苏轼', '苏子瞻': '苏轼', '坡仙': '苏轼',
  '永乐帝': '朱棣', '永乐大帝': '朱棣',
  '玄烨': '康熙', '爱新觉罗玄烨': '康熙',
  '弘历': '乾隆', '胤禛': '雍正',
};

let searchDocs = null;
let searchIndex = null;

/** 列出 data/ 下全部 JSON（排除预构建索引自身），按相对路径排序，供计算数据签名 */
function listJsonFiles() {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.json') && path.resolve(p) !== SEARCH_INDEX_FILE) out.push(p);
    }
  })(DATA);
  return out.sort();
}
/** 数据签名：对全部 JSON 的「路径 + 原始字节」做哈希。读 3MB 原始字节很快（约几十毫秒），
 * 且 git clone 后字节一致 → 签名一致 → 可直接复用随包发布的索引；内容一改签名即变。 */
function dataSignature() {
  const h = crypto.createHash('sha1');
  for (const f of listJsonFiles()) {
    h.update(path.relative(DATA, f).replace(/\\/g, '/'));
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex');
}
function buildPostings(docs) {
  const post = new Map();
  const bump = (token, idx, weight) => {
    let m = post.get(token);
    if (!m) { m = new Map(); post.set(token, m); }
    m.set(idx, (m.get(idx) || 0) + weight);
  };
  docs.forEach((doc, idx) => {
    for (const ch of doc.tnorm) bump('u:' + ch, idx, 3);
    for (const bg of bigrams(doc.tnorm)) bump('t:' + bg, idx, 1);
    for (const bg of bigrams(doc.body)) bump('b:' + bg, idx, 1);
  });
  return post;
}
const serializePost = (post) => {
  const o = {};
  for (const [tk, m] of post) o[tk] = Object.fromEntries(m);
  return o;
};
const inflatePost = (o) => {
  const post = new Map();
  for (const tk of Object.keys(o)) {
    post.set(tk, new Map(Object.entries(o[tk]).map(([k, v]) => [Number(k), v])));
  }
  return post;
};
function writeSearchIndex(docs, post, sig) {
  const payload = {
    version: SERVER_VERSION, sig,
    // body 不持久化（其双字已编码进 post），只留展示/做摘要所需字段
    docs: docs.map((d) => ({
      module: d.module, moduleName: d.moduleName, type: d.type,
      title: d.title, tnorm: d.tnorm, summary: d.summary, raw: d.raw, url: d.url,
    })),
    post: serializePost(post),
  };
  fs.writeFileSync(SEARCH_INDEX_FILE, JSON.stringify(payload), 'utf8');
}
function getSearchIndex() {
  if (searchDocs && searchIndex) return { searchDocs, post: searchIndex };
  let sig = null;
  try { sig = dataSignature(); } catch (e) { dlog('计算数据签名失败: ' + e.message); }
  let pre = null;
  try { pre = readJson(SEARCH_INDEX_FILE); } catch { /* 无预构建 */ }
  if (pre && pre.sig === sig && Array.isArray(pre.docs) && pre.post && pre.version === SERVER_VERSION) {
    // 命中预构建索引：只做一次 JSON.parse，省去 parse + stringify + 建双字（约 2.6s → 数百毫秒）
    searchDocs = pre.docs.map((d) => ({ ...d, body: '' }));
    searchIndex = inflatePost(pre.post);
  } else {
    searchDocs = buildSearchDocs();
    searchIndex = buildPostings(searchDocs);
    try { writeSearchIndex(searchDocs, searchIndex, sig || dataSignature()); }
    catch (e) { dlog('写检索索引失败: ' + e.message); }
  }
  return { searchDocs, post: searchIndex };
}

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
        // 每个舆图热点/行迹地点也单独建索引，搜"兰若寺"可直达热点卡片。
        // 思想/诗词的途经点把「该地发生了什么」写在 event 里（不是 note），
        // 这里一并取，否则摘要为空、结果里看不出这条为什么命中。
        for (const p of r.points || []) {
          const pu = m === 'myth'
            ? gxDeepLink('myth', 'myth', `tab=map&route=${idx}&hotspot=${enc(p.name)}`).url
            : u;
          add(m, '热点', p.name, JSON.stringify(p), p.note || p.event || p.text || p.story || '', pu);
        }
      });
      // 思想大事：思想传播与学派形成的关键事件（正文 + 原文译文 + 意义与影响），
      // 深链把地图切到该事件并弹出卡片。
      for (const e of b.events || []) {
        add(m, '思想大事', e.name, JSON.stringify(e), e.summary,
          gxDeepLink(m, s, `tab=map&evt=${enc(e.id)}`).url);
      }
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
  const aliasOf = (s) => SEARCH_ALIASES[s] || s;
  const chunks = raw.toLowerCase()
    .replace(/[·・《》「」『』，,。、？?！!：:；;()（）]/g, ' ')
    .split(/\s+/).map((c) => aliasOf(norm(c))).filter(Boolean);
  if (!chunks.length) throw new Error('需要提供 q（检索词）');
  const { post } = getSearchIndex();
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
  // 宽松回退：严格 AND 为空（别称、非相邻字、口语化问法）时，改为「任一 token 命中即计分」
  // 的 OR 召回 + 标题包含，保证简称也能找到；权重低于严格匹配，排序自然靠后。
  const loose = new Map();
  if (!candidates.size) {
    for (const chunk of chunks) {
      const toks = chunk.length === 1
        ? ['u:' + chunk]
        : bigrams(chunk).flatMap((bg) => ['t:' + bg, 'b:' + bg]);
      for (const tk of toks) {
        const m = post.get(tk);
        if (!m) continue;
        for (const [idx, cnt] of m) {
          if (!allowed.has(idx)) continue;
          loose.set(idx, (loose.get(idx) || 0) + (tk[0] === 't' ? 3 : 1) * cnt);
        }
      }
    }
    searchDocs.forEach((doc, idx) => {
      if (!allowed.has(idx)) return;
      for (const ch of chunks) if (doc.tnorm.includes(ch)) loose.set(idx, (loose.get(idx) || 0) + 8);
    });
    candidates = new Set(loose.keys());
  }
  const items = [];
  for (const idx of candidates) {
    const doc = searchDocs[idx];
    let score = scores.get(idx) || 0;
    for (const chunk of chunks) {
      if (doc.tnorm === chunk) score += 100;
      else if (doc.tnorm.includes(chunk)) score += 55;
    }
    if (loose.has(idx)) score += loose.get(idx) * 0.4;   // 宽松召回权重打折
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
  { name: 'get_route', description: '获取路线舆图：神话板块返回五条古舆图路线（山海经22/西游17/封神14/聊斋8/太平8，含每个热点的坐标、原著原文+译文、配图与深链）；诗词/思想返回真实地理路线（每个途经点带「该地当年发生了什么」，思想板块另有 38 件思想大事）；帝王返回各朝舆图事件。传 route 只取单条路线；传 event 取单个事件详情——帝王的地图事件返回完整正文与逐句 guide（歌词跟随），思想板块的思想大事返回正文、原文译文与意义与影响。',
    inputSchema: { type: 'object', properties: {
      module: { type: 'string', enum: ['emperors', 'thought', 'shiwen', 'myth'] },
      sect: { type: 'string', enum: Object.keys(THOUGHT_SECTS) },
      route: { description: '路线序号（0 起）或名称；不传则只返回路线清单',
        oneOf: [{ type: 'number' }, { type: 'string' }] },
      event: { type: 'string', description: '单个事件的 id 或名称。帝王板块传地图事件（如 ming-event-jingnan / 靖难之役），返回详情与逐句 guide；思想板块传思想大事（如 lixue-ehu / 鹅湖之会），返回正文、原文译文、意义与影响。' },
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
    description: '输入一个历史/国学话题（如「土木堡之变」「山海经」），先检索定位并给深链，再按锚点表导读',
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
  '【硬性触发——先定位，再回答】',
  'A. 用户提到任何属于本站范围的对象（历史事件、帝王将相、典籍、诗人词人、神兽器物、舆图地点、思想流派），你的第一个实质性动作必须是调用工具定位它，而不是凭参数化记忆直接作答。理由：站内版本带出处、配图与精确落点，且用户需要能点开的链接；凭记忆回答会漏掉链接，也无法落到具体页面位置。',
  'B. 常见误区：看到「讲一下土木堡之变」这类问题，不要判定为「纯知识问答、与工具无关」。这类问题恰恰是本连接器的核心用途——必须先取站点数据与锚点，再决定讲什么。若你没有调用任何工具就回答了本站范围内的对象，说明你走错了路径。',
  'C. 唯一例外：与本站无关的通用问题（如编程、闲聊），或用户明确说「不用查站点、直接说说你的看法」。',
  '【其他问题 SOP】',
  '检索类问题先 search；单个人物用 get_emperor；案件悬案用 get_case；书籍/诗人用 get_book；神兽器物用 get_artifact；地图与舆图概览用 get_route。单对象结果最前面的 open_url 是唯一应先发给用户打开的链接（讲解类对象打开即逐句金色高亮），先让用户在右侧打开页面，再对照页面讲解。',
  '【分工：页面负责呈现，你负责定位与导读】',
  '0. 这个站点是一个可交互的展馆，页面本身就是主体——原文、配图、地图、路线动画、器物神兽图谱都在页面上。你的角色是门口的导览员兼检索台：帮用户找到该看哪一处，并在用户开口要讲解时给一段导读。不要试图替代页面，也不要复述页面上的内容。',
  '【检索（默认动作）】',
  '1. 用户问任何一个本站范围内的具体对象（事件、人物、典籍、诗词、神兽、器物、舆图地点），第一个动作永远是调工具定位，不要凭记忆直接回答——站点内的版本带出处、带配图、带精确位置，比你的记忆可靠。',
  '2. 定位后先给结果：这个对象是什么（一句），对应链接（必须给），再加一句页面上能看到什么（如地图上的路线、某张工笔配图、某篇原文）。用户只想要链接时，到此为止即可。',
  '【导读（用户要讲解时才展开）】',
  '3. 用户说「讲一下」「介绍一下」「详细说说」时，才进入导读。导读的作用是帮助用户看懂页面，不是替代阅读：讲清为什么值得看、最反直觉之处、几处关键的前后关系、争议在哪，然后指向页面上对应的位置。用户点链接就能看到全部细节。',
  '4. 篇幅跟着内容走，不设下限也不设上限。两三百字能讲清就两三百字；内容确实丰富就分几小节。判断标准只有一个：有没有帮用户更顺地看这个页面。不要为了显得充实而填充，也不要为了简洁砍掉真正关键的判断。',
  '5. guide 字段是一张「锚点表」：guide.kind 是对象类型（event/person/book/craft/myth/route/hotspot），guide.lens 是该类型的关注点清单——它告诉你这类对象该往哪想（例如 event 该想「为什么发生、关键人物与动机、转折、代价与意义」；book 该想「核心思想或主要内容、作者处境、时代意义」）。lens 只是思考方向，不是填空模板，也不规定篇幅与写法。',
  '   guide.autoplay_url 是「打开即自动逐句推进」的链接（页面会逐句金色高亮，桌面歌词风），用户要讲解时优先发它；guide_url 是不自动播放的版本。',
  '   anchors[i] = { scene 这处讲什么、role 角色（背景/转折/路线站/原文/点评等）、gist 摘要（约 30 字，仅供你判断）、sources 出处、url 直达链接 }。用 scene 与 role 决定该指向哪一处，用 url 给链接；gist 是供你判断的摘要，不是要你复述的原文。',
  '6. 挂链接由你判断：哪一处真的值得让用户离开对话、去页面上看一眼，就在那里给 anchors[i].url。可能三处、可能一处、也可能用户只想要答案时一处不给。唯一硬要求是指向不同位置——不要开头结尾各给一个却指向同一处，也不要每句话都塞一个链接。',
  '6a. 允许并鼓励补充页面没有的内容：背景常识、因果分析、学界另一种说法、后世的回响，这些是页面做不到而你能做到的。但要与站内记载分层说清哪些是延伸，且不要在延伸里编造可查证的具体事实。',
  '7. 事实边界：你讲的具体史实（人名、年份、地名、细节）必须有返回字段作依据，不得自造。解释、因果、评价、类比都是你的判断空间，不算越界。',
  '8. 地图事件（靖难之役、土木堡之变等）：先 get_route(module=emperors,event=事件id或名称)。若关联路线，anchors 里有「路线概述」与逐站解说（role=路线站），顺着地理走向把站点串成一条线，别逐条复述每站 note。',
  '9. 一律使用返回的本地 127.0.0.1 地址；本站全部能力基于本地版本。',
  '【禁止事项】',
  'A. 禁止搜索本地文件、硬盘、项目目录、hosts/DNS、端口、进程；站点已经在运行，网址都在工具返回里，找不到内容就再调工具，不要翻文件系统。',
  'B. 禁止联网搜索或浏览外部网页来检索、补充本站相关事实；禁止引用维基百科、百科、新闻网页。站内确实没有的具体条目，如实说明收录范围即可。',
  'C. 禁止自行编写 HTML、地图或任何替代站点页面的产物。',
  'D. 只打开工具返回的 127.0.0.1 地址，不要打开外部网站。图片字段 thumb 用于对话内展示，full 是原图链接；不要输出 base64。',
  'E. 只打开工具返回的 127.0.0.1 本地地址。',
  '【其他】涉及演义小说（《三国演义》《西游记》《封神演义》《聊斋志异》等）保留数据中的出处标注，不与正史混淆；默认使用简体中文。',
].join('\n');

// 每条工具结果开头的强制提醒（模型对刚读到的工具内容关注度最高，写在这里比握手 instructions 更有效）
const RESULT_REMINDER = [
  '【下一步操作指引】',
  '1. 以上 JSON 是「中华历史图谱」站内人工整理的权威内容，是本题的事实来源。禁止联网搜索、浏览网页、搜索本地文件或执行命令行排查。',
  '2. 若结果最前面带 open_url（单对象）：它是唯一应先发给用户的链接，先让用户在右侧打开页面、定位到对应条目，再对照页面讲解；讲解类对象的 open_url 打开即逐句金色高亮。列表类结果则把其中 url 作为可点击深链。页面负责呈现，你负责指路。',
  '3. 不许编造具体史实（人名、年份、地名、事件细节）——这些必须来自返回字段。但解释、因果分析、评价、类比是你的判断空间，不算越界。',
  '4. 若结果含 guide 字段：先看 guide.kind 与 guide.lens——lens 告诉你这类对象该想什么（事件想动机与转折，典籍想思想与时代意义，等等）。链接挂在真正值得去页面看一眼的地方，由你判断几处，但不要重复同一处。用户要「讲一下」时再展开导读；只想知道在哪时，给链接加一句说明即可。讲地图事件先用 get_route(module=emperors,event=...) 取完整 guide。',
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
      serverInfo: { name: 'chinese-history-atlas', version: SERVER_VERSION },
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
      const text = OPENING_PROMPT + `\n\n现在请讲解：${topic}\n要求：先用 search 等工具检索定位（站内版本带出处、配图与精确落点，优先于记忆）；把返回结果里的 url 作为可点击深链发给用户（打开即定位到对应条目）。若结果含 guide 字段，先读 guide.kind 与 guide.lens 确定该讲哪几处、往哪想，再用 anchors[i].url 把链接挂在真正值得去页面看一眼的位置。若站内确实没有该具体条目，如实说「站点暂未收录」；允许补充页面没有的背景常识与分析，但延伸内容须与站内记载分层说清，不得编造可查证的具体事实，禁止联网补充。`;
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
      let data = await tool.run((params && params.arguments) || {});
      if (name === 'session_start') sessionStarted = true;
      // 单对象结果（皇帝/事件/典籍/器物）：把「唯一应先打开的链接」置顶。
      // 讲解类对象用 autoplay 链接（打开即逐句高亮），让模型的第一个动作就是让用户在右侧打开页面，
      // 而不是凭记忆作答或去翻文件；列表类结果（items/数组）不置顶。
      if (data && typeof data === 'object' && !Array.isArray(data) && !data.open_url) {
        const first = (data.guide && data.guide.autoplay_url) || data.url || null;
        if (first) data = { open_url: first, ...data };
      }
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
  assert(!!empData.open_url && /&autoplay=1$/.test(empData.open_url), '单对象结果置顶 open_url（讲解类=autoplay）');
  assert(!!empData.guide && empData.guide.anchor_count === empData.guide.anchors.length
    && /&guide=1$/.test(empData.guide.guide_url)
    && /&autoplay=1$/.test(empData.guide.autoplay_url)
    && empData.guide.anchors.every((a, i) => a.i === i && a.gist && a.scene
      && new RegExp('#s=' + i + '$').test(a.url))
    && empData.guide.anchors.some((a) => a.sources && a.sources.length && a.role === '背景'),
    '皇帝 guide 为锚点表（count=anchors，带 guide_url/autoplay_url，每项带 scene/gist/url#s=i，简介锚点带 sources）');
  // 摘要必须是摘要而非原文全文：否则模型会直接搬运，讲解退化成复述
  assert(empData.guide.anchors.some((a) => a.gist.length < (a.chars || 0) || a.chars <= 30),
    '锚点 gist 为摘要而非完整原文（防止模型照搬）');
  // 类型视角：人物 guide 应带 kind=person 与对应 lens，供模型判断该往哪想
  assert(empData.guide.kind === 'person' && /时代困局|关键抉择/.test(empData.guide.lens || ''),
    '人物 guide 带 kind=person 与类型视角 lens');
  const route = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_route', arguments: { module: 'myth', route: 1 } } });
  const routeData = JSON.parse(route.result.content.at(-1).text);
  assert(routeData.point_count === 17 && routeData.points[0].image && routeData.points[0].url,
    '神话西游路线 17 热点，含图片与深链');
  const shj = await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_route', arguments: { module: 'myth', route: 0 } } });
  const shjData = JSON.parse(shj.result.content.at(-1).text);
  const guidedPts = shjData.points.filter((p) => p.guide);
  assert(shjData.point_count === 22 && guidedPts.length >= 1
    && guidedPts.every((p) => p.guide.anchor_count === p.guide.anchors.length && /&guide=1$/.test(p.guide.guide_url)
      && p.main_text && p.guide.anchors.some((a) => a.role === '原文') && p.guide.anchors.some((a) => a.role === '译文')),
    '山海经 22 热点且含原文/译文锚点');
  const empRoute = await call({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_route', arguments: { module: 'emperors' } } });
  const mingMap = JSON.parse(empRoute.result.content.at(-1).text).ming.mapEvents;
  assert(mingMap.length > 0 && mingMap.every((e) => e.guide_url && /&guide=1$/.test(e.guide_url) && Number.isInteger(e.guide_count)),
    '明地图事件全部带 guide_url/guide_count');
  const ev1 = await call({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'get_route', arguments: { module: 'emperors', event: 'ming-event-jingnan' } } });
  const ev1Data = JSON.parse(ev1.result.content.at(-1).text);
  assert(ev1Data.narrative && ev1Data.guide && ev1Data.guide.anchor_count === ev1Data.guide.anchors.length
    && /&guide=1$/.test(ev1Data.guide.guide_url) && ev1Data.guide.anchor_count > 2,
    '单事件详情含完整 narrative 锚点表（靖难之役）');
  // 事件类型视角必须包含「关键人物」与「动机」，以及转折与意义
  assert(ev1Data.guide.kind === 'event'
    && /关键人物/.test(ev1Data.guide.lens || '')
    && /动机/.test(ev1Data.guide.lens || '')
    && /转折|代价/.test(ev1Data.guide.lens || ''),
    '事件 guide 带 kind=event 与「关键人物 + 动机 + 转折」视角');
  // 路线逐站：靖难应关联 5 站南下路线；锚点数=正文+路线概述+逐站解说，且路线站锚点可直接跳转
  {
    const g = ev1Data.guide;
    const ming = loadDynasty('ming');
    const r = (ming.routes || []).find((x) => x.id === 'jingnan-south');
    const expected = splitSentences(ev1Data.narrative).length
      + splitSentences(r.desc || '').length
      + r.points.reduce((n, p) => n + splitSentences(p.note || '').length, 0);
    assert(r && r.points.length === 5 && ev1Data.route && ev1Data.route.station_count === 5
      && g.anchor_count === expected
      && g.anchors.some((a) => a.scene === '路线概述' && a.role === '路线')
      && g.anchors.some((a) => /^路线第5站/.test(a.scene) && a.role === '路线站')
      && g.anchors.every((a) => /#s=\d+$/.test(a.url)),
      '靖难事件锚点表含路线概述+5 站逐站解说，锚点数与前端一致，每项可跳转');
  }
  // 郑和起锚关联的是特殊海外图层 zhenghe-west：前端只做动画、不渲染路线详情，
  // 服务端 guide 必须只含事件正文，与前端包裹的 #s 行数一致，不能追加路线块。
  const zh = await call({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'get_route', arguments: { module: 'emperors', event: 'ming-event-zhenghe-qihang' } } });
  const zhData = JSON.parse(zh.result.content.at(-1).text);
  assert(zhData.route === null
    && zhData.guide.anchor_count === splitSentences(zhData.narrative).length
    && !zhData.guide.anchors.some((a) => /路线/.test(a.scene)),
    '郑和起锚事件不追加特殊航线块，锚点数与前端一致');
  const creature = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_artifact', arguments: { module: 'myth', name: '九尾狐' } } });
  const cData = JSON.parse(creature.result.content.at(-1).text);
  assert(cData.image.thumb && cData.image.full, '九尾狐缩略图+原图');
  const book = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_book', arguments: { module: 'shiwen', name: '李白' } } });
  const bData = JSON.parse(book.result.content.at(-1).text);
  assert(Array.isArray(bData.chapters), 'get_book 李白含名篇精读');
  assert(!!bData.guide && bData.guide.anchor_count === bData.guide.anchors.length
    && /&guide=1$/.test(bData.guide.guide_url) && bData.guide.anchors.length > 0
    && bData.guide.anchors.some((a) => a.role === '原文') && bData.guide.anchors.some((a) => a.role === '点评'),
    '典籍 guide 为锚点表（章节 背景→原文→译文→点评 各带 role）');
  // 典籍类型视角应包含「核心思想/主要内容」与「时代意义」
  assert(bData.guide.kind === 'book'
    && /核心思想|主要内容/.test(bData.guide.lens || '')
    && /时代/.test(bData.guide.lens || ''),
    '典籍 guide 带 kind=book 与「核心思想/主要内容 + 时代意义」视角');
  const sch = await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'search', arguments: { q: '空印案', limit: 5 } } });
  const sData = JSON.parse(sch.result.content.at(-1).text);
  assert(sData.items.some((x) => x.title === '空印案'), 'search 空印案命中');
  // 别称别名：搜「李太白」应命中李白（别名映射）
  const alias = await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search', arguments: { q: '李太白', limit: 5 } } });
  const aData = JSON.parse(alias.result.content.at(-1).text);
  assert(aData.items.some((x) => x.title === '李白'), 'search 别称「李太白」命中李白');
  // 宽松回退：非相邻字 / 口语化问法（严格 AND 为空）也能召回，如「苏东坡」应命中苏轼
  const loose = await call({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'search', arguments: { q: '苏东坡', limit: 5 } } });
  const lData = JSON.parse(loose.result.content.at(-1).text);
  assert(lData.items.some((x) => x.title === '苏轼'), 'search 宽松回退「苏东坡」命中苏轼');
  // ---- 思想源流的「思想大事」（这批内容晚于 MCP，最容易漏） ----
  const evtSearch = await call({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'search', arguments: { q: '鹅湖之会', limit: 8 } } });
  const esData = JSON.parse(evtSearch.result.content.at(-1).text);
  assert(esData.items.some((x) => x.type === '思想大事'), 'search 命中「思想大事」条目');
  const oneEvt = await call({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'get_route', arguments: { module: 'thought', event: '鹅湖之会' } } });
  const oeData = JSON.parse(oneEvt.result.content.at(-1).text);
  assert(oeData.name === '鹅湖之会' && oeData.place && oeData.place.name === '鹅湖寺'
    && (oeData.quotes || []).length >= 1 && (oeData.significance || []).length === 4
    && /evt=lixue-ehu/.test(oeData.url || ''),
    'get_route(thought, event) 返回思想大事的正文/原文译文/四条意义与 evt 深链');
  const oneRt = await call({ jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'get_route', arguments: { module: 'thought', sect: 'lixue', route: '王阳明' } } });
  const orData = JSON.parse(oneRt.result.content.at(-1).text);
  assert(/王阳明/.test(orData.name || '') && (orData.points || []).length === 5 && !!orData.url,
    'get_route(thought, route=<名称>) 只返回命中的那一条路线');
  // 主壳模块 id 与 MCP 模块名不是同一套：深链必须用主壳的 id，否则 iframe 不装载
  const modList = JSON.parse((await call({ jsonrpc: '2.0', id: 23, method: 'tools/call', params: { name: 'list_modules', arguments: {} } })).result.content.at(-1).text);
  const allLinks = modList.modules.flatMap((m) => [m.url, m.online_url]).filter(Boolean);
  assert(allLinks.length > 0 && allLinks.every((u) => !/module=(thought|shiwen)\b/.test(u)),
    '所有板块深链都用主壳模块 id（thought→guoxue、shiwen→shici），不会落到空 iframe');
  assert(/module=guoxue/.test(modList.modules.find((m) => m.id === 'thought').url || ''),
    '思想源流入口链接指向 module=guoxue');
  console.log('\n全部自测通过。');
}

if (process.argv.includes('--build-index')) {
  // 数据改动后强制重建检索索引并落盘（发布前跑一次，随包发布让新用户开箱即快查）
  const t0 = process.hrtime.bigint();
  const docs = buildSearchDocs();
  const post = buildPostings(docs);
  writeSearchIndex(docs, post, dataSignature());
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const sizeMB = fs.statSync(SEARCH_INDEX_FILE).size / 1048576;
  console.log(`检索索引已重建：${docs.length} 条文档，用时 ${ms.toFixed(0)}ms，文件 ${sizeMB.toFixed(1)}MB`);
} else if (process.argv.includes('--selftest')) {
  await selftest();
} else {
  runStdio();
}
