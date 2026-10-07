#!/usr/bin/env node
/**
 * 内容层零依赖校验器（泛化版）
 * 检查：JSON 语法、必填字段、时间线升序、出处引用、索引一致性、BOM/制表符。
 * 覆盖：唐/宋/元/明/清 五朝。数据契约按各朝实际字段设计，前端只认统一的 bio/lifespan/sources。
 * 运行：node scripts/validate.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warns = [];

function readJson(rel) {
  const abs = join(root, rel);
  try {
    const raw = readFileSync(abs, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) warns.push(`${rel}: 含 BOM`);
    if (raw.includes('\t')) errors.push(`${rel}: 含制表符`);
    return JSON.parse(raw);
  } catch (e) {
    errors.push(`${rel}: JSON 解析失败 -> ${e.message}`);
    return null;
  }
}

function checkDate(rel, d, where) {
  // 支持 YYY/YYYY、YY-MM（三年以下月份）、YY-MM-DD、YY-YY（跨年区间，如"618-620"）
  // 年份 3-4 位（唐代 618 年、元代 1271 年均为三位/四位数），月份日各 2 位
  if (!/^\d{3,4}(-\d{2}){0,2}$/.test(String(d)) && !/^\d{3,4}-\d{3,4}$/.test(String(d))) {
    errors.push(`${rel}: ${where} 日期格式非法 "${d}"`);
  }
}

function checkTimeline(rel, timeline) {
  if (!Array.isArray(timeline)) return;
  let prev = null;
  for (const ev of timeline) {
    const d = ev.date;
    checkDate(rel, d, `时间线事件 "${ev.title}"`);
    // 按起始年份排序比较（兼容 YYYY、YYYY-MM、YYYY-YYYY 区间）
    const start = parseInt(String(d).slice(0, 4), 10);
    if (prev !== null && Number.isFinite(start) && start < prev) {
      errors.push(`${rel}: 时间线未按日期升序（${prev} -> ${start}，事件 "${ev.title}"）`);
    }
    if (Number.isFinite(start)) prev = start;
  }
}

function checkControversies(rel, list, where) {
  if (!Array.isArray(list)) return;
  for (const c of list) {
    if (!c.question || !c.context) errors.push(`${rel}: ${where} 争议话题缺 question/context`);
    if (!Array.isArray(c.viewpoints) || c.viewpoints.length < 2) {
      errors.push(`${rel}: ${where} 争议话题 "${c.question}" 视角少于 2 个`);
    }
  }
}

/** 朝代清单：目录、皇帝索引路径、各库相对路径、id 前缀、是否有地图数据 */
const DYNASTIES = [
  { key: 'ming', dir: '',     empDir: 'emperors', events: 'events/events.json', people: 'people/people.json', cases: 'cases/cases.json', map: true },
  { key: 'tang', dir: 'tang', empDir: 'emperors', events: 'events.json',       people: 'people.json',       cases: 'cases.json',       map: false },
  { key: 'song', dir: 'song', empDir: 'emperors', events: 'events.json',       people: 'people.json',       cases: 'cases.json',       map: true },
  { key: 'yuan', dir: 'yuan', empDir: 'emperors', events: 'events.json',       people: 'people.json',       cases: 'cases.json',       map: false },
  { key: 'qing', dir: 'qing', empDir: 'emperors', events: 'events.json',       people: 'people.json',       cases: 'cases.json',       map: false },
];

const d = (key) => (key === 'ming' ? '' : `${key}/`);
const base = (key, rel) => `data/${d(key)}${rel}`;

// 人名/事件名跨库交叉引用时，处理"合并写法"（顿号/括号/斜杠）
function isComposite(name) {
  return /[、（）()\/]/.test(name);
}

for (const dy of DYNASTIES) {
  const P = base(dy.key, '');
  const empDir = base(dy.key, dy.empDir);
  const idxRel = base(dy.key, `${dy.empDir}/index.json`);
  const eventsRel = base(dy.key, dy.events);
  const peopleRel = base(dy.key, dy.people);
  const casesRel = base(dy.key, dy.cases);
  const tag = `[${dy.key}]`;

  // ---- 皇帝库 ----
  const index = readJson(idxRel);
  const indexFiles = new Map();
  if (index) {
    for (const e of index.emperors) {
      indexFiles.set(e.file, e);
      const rel = `${empDir}/${e.file}`;
      const entry = readJson(rel);
      if (!entry) continue;
      if (entry.id !== e.id) errors.push(`${rel}: id "${entry.id}" 与索引 "${e.id}" 不一致`);
      if (entry.name !== e.name) errors.push(`${rel}: name 与索引不一致`);
      if (entry.templeName !== e.templeName) errors.push(`${rel}: templeName 与索引不一致`);
      // reign 两种格式：{start,end} 对象（宋/明）或 "618-626" 字符串（唐/元/清）
      const idxReign = e.reign;
      if (idxReign && typeof idxReign === 'object') {
        if (entry.reign?.start !== idxReign.start || entry.reign?.end !== idxReign.end) {
          errors.push(`${rel}: reign 与索引不一致`);
        }
      } else if (idxReign && typeof idxReign === 'string') {
        const m = String(idxReign).match(/^(\d{4})-(\d{4})$/);
        if (m && (entry.reign?.start !== m[1] || entry.reign?.end !== m[2])) {
          errors.push(`${rel}: reign 与索引不一致`);
        }
      }
      const required = ['id', 'name', 'templeName', 'eraName', 'reign', 'intro', 'timeline', 'majorEvents', 'people', 'controversies', 'funFacts'];
      for (const f of required) {
        if (!(f in entry)) errors.push(`${rel}: 缺少必填字段 ${f}`);
      }
      // id 格式：ming-emperor-* / <朝>-emp-*
      const idOk = dy.key === 'ming' ? /^ming-emperor-[a-z]+$/.test(entry.id) : new RegExp(`^${dy.key}-emp-[a-z0-9]+$`).test(entry.id);
      if (entry.id && !idOk) errors.push(`${rel}: id 格式非法 "${entry.id}"`);
      if (entry.portrait && !/^[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i.test(entry.portrait)) {
        errors.push(`${rel}: portrait 文件名非法 "${entry.portrait}"`);
      }
      if (entry.reign) { checkDate(rel, entry.reign.start, 'reign.start'); checkDate(rel, entry.reign.end, 'reign.end'); }
      checkTimeline(rel, entry.timeline);
      // majorEvents：明/宋为对象数组（含 summary/impact），唐/元/清为字符串数组（前端已兼容）
      const me = entry.majorEvents;
      if (Array.isArray(me)) {
        for (const ev of me) {
          if (ev && typeof ev === 'object') {
            if (!ev.name || !ev.summary || !ev.impact) errors.push(`${rel}: 重大事件缺 name/summary/impact`);
          } else if (typeof ev !== 'string') {
            errors.push(`${rel}: 重大事件元素应为对象或字符串`);
          }
        }
      }
      checkControversies(rel, entry.controversies, '整条目');
    }
  }

  // 未登记文件检查
  try {
    for (const f of readdirSync(join(root, empDir))) {
      if (f.endsWith('.json') && f !== 'index.json' && !indexFiles.has(f)) {
        errors.push(`${empDir}/${f}: 未在 index.json 中登记`);
      }
    }
  } catch (e) {
    errors.push(`无法读取 ${empDir}: ${e.message}`);
  }

  // ---- 事件库 ----
  const eventsDoc = readJson(eventsRel);
  const eventNames = new Set();
  if (eventsDoc) {
    for (const ev of eventsDoc.events) {
      eventNames.add(ev.name);
      const where = `事件 "${ev.name}"`;
      if (!ev.id) errors.push(`${eventsRel}: ${where} id 缺失`);
      if (ev.id && !/^[a-z]+-(event|ev)-[a-z0-9-]+$/.test(ev.id)) errors.push(`${eventsRel}: ${where} id 格式非法 "${ev.id}"`);
      for (const f of ['name', 'era', 'date', 'summary', 'narrative', 'impact', 'participants']) {
        if (!(f in ev)) errors.push(`${eventsRel}: ${where} 缺少必填字段 ${f}`);
      }
      checkDate(eventsRel, ev.date, where);
      checkControversies(eventsRel, ev.controversies, where);
    }
  }

  // ---- 人物库 ----
  const peopleDoc = readJson(peopleRel);
  const personNames = new Set();
  if (peopleDoc) {
    for (const p of peopleDoc.people) {
      personNames.add(p.name);
      const where = `人物 "${p.name}"`;
      if (!p.id) errors.push(`${peopleRel}: ${where} id 缺失`);
      if (p.id && !/^[a-z]+(-person|-p)-[a-z0-9-]+$/.test(p.id)) errors.push(`${peopleRel}: ${where} id 格式非法 "${p.id}"`);
      // 前端统一消费 bio；旧字段 note 视为未对齐
      if (!('bio' in p) && !('note' in p)) errors.push(`${peopleRel}: ${where} 缺 bio（或待迁移的 note）`);
      if (!p.name || !p.role) errors.push(`${peopleRel}: ${where} 缺 name/role`);
    }
  }

  // ---- 案件库 ----
  const casesDoc = readJson(casesRel);
  const catIds = new Set();
  if (casesDoc) {
    for (const cat of casesDoc.categories ?? []) {
      if (!cat.id) errors.push(`${casesRel}: 分类缺 id`);
      if (!cat.name) errors.push(`${casesRel}: 分类缺 name`);
      catIds.add(cat.id);
    }
    const caseIds = new Set();
    for (const c of casesDoc.cases ?? []) {
      const where = `案件 "${c.name}"`;
      if (!c.id) errors.push(`${casesRel}: ${where} id 缺失`);
      if (c.id && !/^[a-z]+-case-[a-z0-9-]+$/.test(c.id)) errors.push(`${casesRel}: ${where} id 格式非法 "${c.id}"`);
      if (caseIds.has(c.id)) errors.push(`${casesRel}: ${where} id 重复`);
      caseIds.add(c.id);
      for (const f of ['id', 'name', 'category', 'date', 'summary', 'nameOrigin', 'background', 'people', 'process', 'result', 'impact', 'sources']) {
        if (!(f in c)) errors.push(`${casesRel}: ${where} 缺少必填字段 ${f}`);
      }
      if (c.category && catIds.size && !catIds.has(c.category)) errors.push(`${casesRel}: ${where} category "${c.category}" 未在 categories 登记`);
      checkDate(casesRel, c.date, where);
      for (const p of c.people ?? []) {
        if (!p.name || !p.role || !p.note) errors.push(`${casesRel}: ${where} 人物缺 name/role/note`);
      }
      if (!c.openQuestions?.length) errors.push(`${casesRel}: ${where} 缺开放讨论题`);
      checkControversies(casesRel, c.openQuestions, where);
    }
  }

  // ---- 交叉引用（提示级）：皇帝条目的重大事件/人物建议在展开库登记 ----
  if (index && eventsDoc && peopleDoc) {
    for (const e of index.emperors) {
      const entry = readJson(`${empDir}/${e.file}`);
      if (!entry) continue;
      for (const ev of entry.majorEvents ?? []) {
        const evName = (ev && typeof ev === 'object') ? ev.name : ev;
        if (typeof evName === 'string' && !eventNames.has(evName) && !isComposite(evName)) {
          warns.push(`${tag} ${e.file}: 重大事件 "${evName}" 未在事件库登记`);
        }
      }
      for (const p of entry.people ?? []) {
        if (!personNames.has(p.name) && !isComposite(p.name)) {
          warns.push(`${tag} ${e.file}: 人物 "${p.name}" 未在人物库登记`);
        }
      }
    }
  }
}

// ---- 明朝独有：制度库 / 地名库 / 路线库 / 地图事件 ----
const instDoc = readJson('data/institutions/institutions.json');
if (instDoc) {
  const cats = ['政治', '军事', '经济', '文化', '社会', '宫廷'];
  for (const inst of instDoc.institutions) {
    const where = `制度 "${inst.name}"`;
    if (!inst.id || !/^ming-institution-[a-z0-9-]+$/.test(inst.id)) errors.push(`data/institutions/institutions.json: ${where} id 缺失或格式非法`);
    for (const f of ['name', 'category', 'era', 'intro', 'howItWorks', 'impact', 'childAngle']) {
      if (!(f in inst)) errors.push(`data/institutions/institutions.json: ${where} 缺少必填字段 ${f}`);
    }
    if (inst.category && !cats.includes(inst.category)) errors.push(`data/institutions/institutions.json: ${where} category 非法 "${inst.category}"`);
  }
}

const placesDoc = readJson('data/places/places.json');
if (placesDoc) {
  const placeTypes = ['capital', 'city', 'site', 'overseas'];
  for (const p of placesDoc.places) {
    if (!p.name || !p.modernName) errors.push('data/places/places.json: 地名缺 name/modernName');
    if (p.type && !placeTypes.includes(p.type)) errors.push(`data/places/places.json: 地名 "${p.name}" type 非法 "${p.type}"`);
    if (p.lat !== undefined && typeof p.lat !== 'number') errors.push(`data/places/places.json: 地名 "${p.name}" lat 非数字`);
    if (p.lng !== undefined && typeof p.lng !== 'number') errors.push(`data/places/places.json: 地名 "${p.name}" lng 非数字`);
  }
}

const routesDoc = readJson('data/routes/routes.json');
if (routesDoc) {
  for (const r of routesDoc.routes) {
    const where = `路线 "${r.name}"`;
    if (!r.id || !/^[a-z0-9-]+$/.test(r.id)) errors.push(`data/routes/routes.json: ${where} id 缺失或格式非法`);
    for (const f of ['id', 'name', 'color', 'desc', 'points']) {
      if (!(f in r)) errors.push(`data/routes/routes.json: ${where} 缺少必填字段 ${f}`);
    }
    if (r.color && !/^#[0-9a-fA-F]{6}$/.test(r.color)) errors.push(`data/routes/routes.json: ${where} color 格式非法`);
    if (Array.isArray(r.points) && r.points.length < 2) errors.push(`data/routes/routes.json: ${where} 途经点少于 2 个`);
    for (const pt of r.points ?? []) {
      if (!pt.name || typeof pt.lat !== 'number' || typeof pt.lng !== 'number') {
        errors.push(`data/routes/routes.json: ${where} 途经点 "${pt.name}" 缺 name/lat/lng`);
      }
    }
  }
}

const mapEventsDoc = readJson('data/events/map-events.json');
if (mapEventsDoc && Array.isArray(mapEventsDoc.events)) {
  for (const ev of mapEventsDoc.events) {
    if (!ev.name || !ev.date) errors.push('data/events/map-events.json: 地图事件缺 name/date');
  }
}

// 输出（警告超过 15 条时只列前 15 并汇总）
const MAX_WARNS = 15;
console.log(`\n校验完成：${errors.length} 个错误，${warns.length} 个警告。`);
for (const err of errors) console.log(`[error] ${err}`);
if (warns.length) {
  const shown = warns.slice(0, MAX_WARNS);
  for (const w of shown) console.log(`[warn] ${w}`);
  if (warns.length > MAX_WARNS) console.log(`[warn] …其余 ${warns.length - MAX_WARNS} 条略`);
}
process.exit(errors.length ? 1 : 0);
