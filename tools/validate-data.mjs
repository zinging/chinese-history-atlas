#!/usr/bin/env node
/**
 * 数据完整性校验（数据基座）。
 *
 * 背景：数据从"单体 index.json"演进为"清单 + 按需分片"后，很多错误不再是 JSON
 * 语法错误，而是"结构性不一致"——图片指向不存在的文件、两件器物复用同一张图、
 * artifact.from 与书籍名对不上（导致分组排到末尾）、分区分片计数与清单不一致等。
 * 这些正是过去靠人工反复才发现的问题。本脚本一次性把它们挡在提交前。
 *
 * 用法：node tools/validate-data.mjs
 * 退出码 0 = 全部通过；1 = 有错误（可直接接入 CI / pre-commit）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const errors = [];
const warns = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warns.push(msg);
const ok = (msg) => console.log(`  ✅ ${msg}`);

/** 读取并解析 JSON，文件不存在或解析失败记为错误。 */
function readJson(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    err(`缺少数据文件：${rel}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    err(`JSON 解析失败：${rel}（${e.message}）`);
    return null;
  }
}

/**
 * 器物图片路径形如 ../../data/portraits/artifacts/xxx.jpg（相对 web/guoxue 页面）。
 * 统一折算为仓库根相对路径，便于校验文件是否真实存在。
 */
function resolveImage(img) {
  if (!img || typeof img !== "string") return null;
  if (img.startsWith("../../")) return img.slice(6); // 去掉 ../../
  return img;
}

/** 校验七流派 index.json 至少可解析；其中格物致知为"清单+分片"，做重点校验。 */
function validateSectManifests() {
  const sects = ["rujia", "daojia", "foxue", "zhuzi", "lixue", "shiwen", "gewu"];
  for (const s of sects) {
    const m = readJson(`data/${s}/index.json`);
    if (!m) continue;
    if (!Array.isArray(m.books)) {
      err(`[${s}] index.json 缺少 books 数组`);
      continue;
    }
    // 书籍卡片必填字段（六流派内联、格物清单都应具备）
    for (const b of m.books) {
      for (const k of ["id", "name", "meta"]) {
        if (!b[k]) err(`[${s}] 书籍缺少字段 ${k}：${JSON.stringify(b.name || b.id)}`);
      }
    }
    // 通用：凡卡片带 src 指针（格物 + 已拆分的六流派），校验详情分片存在、可解析、id 一致
    for (const card of m.books) {
      if (!card.src) continue;
      const rel = `data/${s}/${card.src}`;
      const detail = readJson(rel);
      if (!detail) continue;
      if (detail.id !== card.id) {
        err(`[${s}] 分片 ${card.src} 的 id(${detail.id}) 与清单 id(${card.id}) 不一致`);
      }
    }
    if (s === "gewu") validateGewu(m);
  }
}

/** 格物致知：清单 + 分片 + 器物的完整一致性校验。 */
function validateGewu(m) {
  const bookNames = new Set(m.books.map((b) => b.name));
  const bookIds = new Set();

  // 1) 每本书的详情分片存在、可解析，且含 id
  for (const card of m.books) {
    if (bookIds.has(card.id)) err(`[gewu] 书籍 id 重复：${card.id}`);
    bookIds.add(card.id);
    if (!card.src) {
      err(`[gewu] 书《${card.name}》清单缺少 src 分片指针`);
      continue;
    }
    const rel = `data/gewu/${card.src}`;
    const detail = readJson(rel);
    if (!detail) continue;
    if (detail.id !== card.id) {
      err(`[gewu] 分片 ${card.src} 的 id(${detail.id}) 与清单 id(${card.id}) 不一致`);
    }
    // 章节介绍是格物致知的核心，要求每本书至少有大纲
    if (!Array.isArray(detail.outline) || detail.outline.length === 0) {
      warn(`[gewu] 《${card.name}》缺少章节介绍 outline`);
    }
  }

  // 2) 分区分片：文件存在、计数/分类角标与清单预聚合一致
  const sectionSpecs = [
    { key: "artifacts", rel: "data/gewu/artifacts.json", groupKey: "cat" },
    { key: "discourses", rel: "data/gewu/discourses.json", groupKey: "category" },
    { key: "cases", rel: "data/gewu/cases.json", groupKey: "category" },
  ];
  for (const spec of sectionSpecs) {
    const ptr = m[spec.key];
    if (!ptr || !ptr.src) {
      err(`[gewu] 清单缺少分区指针 ${spec.key}`);
      continue;
    }
    const arr = readJson(spec.rel);
    if (!arr) continue;
    if (ptr.count !== arr.length) {
      err(`[gewu] ${spec.key} 清单 count=${ptr.count} 与实际 ${arr.length} 不一致`);
    }
    const byGroup = {};
    for (const it of arr) {
      const g = it[spec.groupKey];
      if (g) byGroup[g] = (byGroup[g] || 0) + 1;
    }
    for (const [g, n] of Object.entries(byGroup)) {
      if ((ptr.byGroup || {})[g] !== n) {
        err(`[gewu] ${spec.key} 分类「${g}」清单计数 ${(ptr.byGroup || {})[g]} 与实际 ${n} 不一致`);
      }
    }
  }

  // 3) 器物图鉴（重点）
  const artifacts = readJson("data/gewu/artifacts.json");
  if (Array.isArray(artifacts)) {
    const imgOwners = new Map();   // 图片文件 -> 器物名（查重复图）
    const perBook = {};
    for (const a of artifacts) {
      if (!a.name) err(`[gewu] 器物缺少 name：${JSON.stringify(a).slice(0, 60)}`);
      if (!a.from) {
        err(`[gewu] 器物「${a.name}」缺少 from 出处`);
      } else if (!bookNames.has(a.from)) {
        err(`[gewu] 器物「${a.name}」from="${a.from}" 在 18 本书中不存在（会导致分组错位）`);
      }
      if (!a.cat) warn(`[gewu] 器物「${a.name}」缺少 cat 分类`);
      if (!a.note) warn(`[gewu] 器物「${a.name}」缺少 note 说明`);
      perBook[a.from] = (perBook[a.from] || 0) + 1;

      if (!a.image) {
        err(`[gewu] 器物「${a.name}」缺少图片 image`);
      } else {
        const rel = resolveImage(a.image);
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) {
          err(`[gewu] 器物「${a.name}」图片不存在：${rel}`);
        } else if (imgOwners.has(rel)) {
          err(`[gewu] 器物「${a.name}」与「${imgOwners.get(rel)}」复用了同一张图：${rel}`);
        } else {
          imgOwners.set(rel, a.name);
        }
      }
    }
    // 每本书至少 3 件器物
    for (const b of m.books) {
      const n = perBook[b.name] || 0;
      if (n < 3) err(`[gewu] 《${b.name}》器物仅 ${n} 件，要求至少 3 件`);
    }
  }

  // 4) 问典题目：必要字段
  const discourses = readJson("data/gewu/discourses.json");
  if (Array.isArray(discourses)) {
    for (const d of discourses) {
      if (!d.quest) err(`[gewu] 问典题目缺少 quest：${d.title || ""}`);
      if (!Array.isArray(d.clues) || d.clues.length === 0) {
        warn(`[gewu] 问典「${d.title || d.quest}」缺少线索 clues`);
      }
    }
  }

  // 5) 公案：必要字段
  const cases = readJson("data/gewu/cases.json");
  if (Array.isArray(cases)) {
    const validCats = new Set((m.categories || []).map((c) => c.id));
    for (const c of cases) {
      if (!c.name) err(`[gewu] 公案缺少 name`);
      if (c.category && !validCats.has(c.category)) {
        err(`[gewu] 公案「${c.name}」category=${c.category} 不在分类表中`);
      }
    }
  }
}

/**
 * 校验思想源流五派的「智慧舆图」数据：places / routes / events 与其配图。
 *
 * 为什么单独校验：这些字段此前完全没有校验覆盖，`validate-data` 只查书籍与格物，
 * 所以「38 件事件齐不齐、图有没有缺、途经点有没有写说明」全靠人肉看页面。
 * 新增一件事件、忘记配图或漏写 significance，这条校验会直接拦下。
 */
function validateSectEvents() {
  const SECTS = ["rujia", "daojia", "foxue", "zhuzi", "lixue"];
  const IMG_DIR = "data/portraits/sect-events";
  const allIds = [];
  let nEvents = 0, nRoutes = 0, nPoints = 0, nPlaces = 0;

  for (const s of SECTS) {
    const j = readJson(`data/${s}/index.json`);
    if (!j) continue;

    // ---- 地名 ----
    const places = Array.isArray(j.places) ? j.places : [];
    nPlaces += places.length;
    const seenKey = new Map();
    for (const p of places) {
      if (!p || !p.name) { err(`[${s}] 地名缺少 name`); continue; }
      if (typeof p.lat !== "number" || typeof p.lng !== "number") {
        err(`[${s}] 地名「${p.name}」缺少数字坐标 lat/lng`);
      } else if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) {
        err(`[${s}] 地名「${p.name}」坐标越界：${p.lat},${p.lng}`);
      }
      // 同站点名 + 同坐标视为同一地点，重复会在图上叠两枚标签
      const site = String(p.name).split(/[·・]/).pop().replace(/\s+/g, "");
      const key = `${site}@${Number(p.lat).toFixed(2)},${Number(p.lng).toFixed(2)}`;
      if (seenKey.has(key)) {
        err(`[${s}] 地名「${p.name}」与「${seenKey.get(key)}」是同一站点同一坐标，图上会叠两枚标签`);
      } else {
        seenKey.set(key, p.name);
      }
    }

    // ---- 路线 ----
    const routes = Array.isArray(j.routes) ? j.routes : [];
    nRoutes += routes.length;
    const routeNames = new Set();
    for (const r of routes) {
      if (!r || !r.name) { err(`[${s}] 路线缺少 name`); continue; }
      if (routeNames.has(r.name)) err(`[${s}] 路线名重复：${r.name}`);
      routeNames.add(r.name);
      const pts = Array.isArray(r.points) ? r.points : [];
      if (pts.length < 2) err(`[${s}] 路线「${r.name}」途经点少于 2 个`);
      for (const p of pts) {
        nPoints++;
        if (!p || !p.name) { err(`[${s}] 路线「${r.name}」有途经点缺少 name`); continue; }
        if (typeof p.lat !== "number" || typeof p.lng !== "number") {
          err(`[${s}] 路线「${r.name}」途经点「${p.name}」缺少数字坐标`);
        }
        if (!p.event || String(p.event).trim().length < 10) {
          err(`[${s}] 路线「${r.name}」途经点「${p.name}」缺少 event（该地发生了什么）`);
        }
      }
    }

    // ---- 思想大事 ----
    const events = Array.isArray(j.events) ? j.events : [];
    nEvents += events.length;
    for (const e of events) {
      if (!e || !e.id) { err(`[${s}] 事件缺少 id`); continue; }
      for (const k of ["name", "date", "summary", "narrative"]) {
        if (!e[k]) err(`[${s}] 事件「${e.id}」缺少 ${k}`);
      }
      if (!e.place || !e.place.name) err(`[${s}] 事件「${e.id}」缺少 place.name`);
      if (typeof e.lat !== "number" || typeof e.lng !== "number") {
        err(`[${s}] 事件「${e.id}」缺少数字坐标 lat/lng`);
      }
      if (!Array.isArray(e.people) || !e.people.length) warn(`[${s}] 事件「${e.id}」没有 people`);
      const quotes = Array.isArray(e.quotes) ? e.quotes : [];
      if (!quotes.length) err(`[${s}] 事件「${e.id}」缺少 quotes（原文与译文）`);
      for (const q of quotes) {
        if (!q || !q.original) err(`[${s}] 事件「${e.id}」有 quote 缺原文`);
        if (q && !q.translation) warn(`[${s}] 事件「${e.id}」有 quote 缺译文`);
      }
      const sig = Array.isArray(e.significance) ? e.significance : [];
      if (sig.length !== 4) err(`[${s}] 事件「${e.id}」significance 应为 4 条，实际 ${sig.length}`);
      allIds.push(e.id);
    }
  }

  // ---- 事件 id 唯一 ----
  const dupIds = allIds.filter((id, i) => allIds.indexOf(id) !== i);
  if (dupIds.length) err(`事件 id 重复：${[...new Set(dupIds)].join("、")}`);

  // ---- 配图：每个事件都要有图，且不能有多余的图 ----
  const abs = path.join(ROOT, IMG_DIR);
  const files = fs.existsSync(abs)
    ? fs.readdirSync(abs).filter((f) => /\.jpe?g$/i.test(f)).map((f) => f.replace(/\.jpe?g$/i, ""))
    : [];
  const fileSet = new Set(files);
  const idSet = new Set(allIds);
  for (const id of allIds) {
    if (!fileSet.has(id)) err(`事件「${id}」缺少配图：${IMG_DIR}/${id}.jpg`);
  }
  for (const f of files) {
    if (!idSet.has(f)) err(`${IMG_DIR}/${f}.jpg 没有对应的事件 id`);
  }

  if (!errors.length) {
    ok(`思想源流：${nEvents} 件事件（配图 ${files.length} 张一一对应）、${nRoutes} 条路线、${nPoints} 个途经点、${nPlaces} 处地名`);
  }
}

console.log("数据完整性校验开始…\n");
validateSectManifests();
validateSectEvents();

if (warns.length) {
  console.log(`\n⚠️  警告 ${warns.length} 项（建议修复，不阻断）：`);
  warns.forEach((w) => console.log(`  ⚠️  ${w}`));
}
if (errors.length) {
  console.log(`\n❌ 发现 ${errors.length} 个错误：`);
  errors.forEach((e) => console.log(`  ❌ ${e}`));
  process.exit(1);
}
console.log(`\n🎉 数据完整性校验通过（无错误，${warns.length} 项提示）。`);
