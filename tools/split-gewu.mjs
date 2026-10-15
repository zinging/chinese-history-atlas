#!/usr/bin/env node
/**
 * 一次性数据迁移：把单体 data/gewu/index.json 拆为"清单 + 按需加载分片"。
 *
 * 拆分后：
 *   data/gewu/index.json            清单（分类 + 每本书卡片字段 + 各分区指针/计数）
 *   data/gewu/books/<id>.json       每本书详情（intro/core/chapters/golden/funFacts/timeline/outline）
 *   data/gewu/artifacts.json        百工图鉴器物（62 件）
 *   data/gewu/discourses.json       格物问典（14 题）
 *   data/gewu/cases.json            工艺公案（12 则）
 *
 * 拆分后这些文件即为"唯一数据源"，前端按需 fetch；本脚本只用于从旧的单体文件
 * 做一次性迁移，重复运行前请先保留备份（脚本会先写 .index.full.bak.json）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "data", "gewu");
const SRC = path.join(DIR, "index.json");
const BAK = path.join(DIR, ".index.full.bak.json");
const BOOKS_DIR = path.join(DIR, "books");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function countBy(items, key) {
  const m = {};
  for (const it of items) {
    const k = it[key];
    if (k) m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function main() {
  const full = readJson(SRC);

  // 备份单体文件（已存在则不覆盖，避免反复运行时把最早的备份顶掉）
  if (!fs.existsSync(BAK)) {
    fs.copyFileSync(SRC, BAK);
    console.log("已备份原文件 -> .index.full.bak.json");
  }

  if (!fs.existsSync(BOOKS_DIR)) fs.mkdirSync(BOOKS_DIR, { recursive: true });

  // 卡片字段（书籍横向卡片条、分组排序所需），其余重量内容进分片
  const CARD_FIELDS = ["id", "icon", "name", "meta", "person", "portrait", "category", "era"];
  const DETAIL_FIELDS = ["id", "quote", "intro", "core", "chapters", "golden", "funFacts", "timeline", "outline"];

  const cards = [];
  for (const b of full.books) {
    // 详情分片
    const detail = {};
    for (const k of DETAIL_FIELDS) {
      if (b[k] !== undefined) detail[k] = b[k];
    }
    writeJson(path.join(BOOKS_DIR, `${b.id}.json`), detail);

    // 清单卡片
    const card = {};
    for (const k of CARD_FIELDS) {
      if (b[k] !== undefined) card[k] = b[k];
    }
    card.src = `books/${b.id}.json`;
    cards.push(card);
  }

  // 分区分片
  writeJson(path.join(DIR, "artifacts.json"), full.artifacts || []);
  writeJson(path.join(DIR, "discourses.json"), full.discourses || []);
  writeJson(path.join(DIR, "cases.json"), full.cases || []);

  // 分区指针：带预聚合计数，前端未加载分片时朝代条/分类条仍可显示角标
  const sectionPtr = (arr, src, groupKey) => ({
    src,
    count: arr.length,
    byGroup: countBy(arr, groupKey),
  });

  const manifest = {
    categories: full.categories || [],
    books: cards,
    artifacts: sectionPtr(full.artifacts || [], "artifacts.json", "cat"),
    discourses: sectionPtr(full.discourses || [], "discourses.json", "category"),
    cases: sectionPtr(full.cases || [], "cases.json", "category"),
    places: full.places || [],
    routes: full.routes || [],
  };
  writeJson(SRC, manifest);

  // 简单体积报告
  const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
  console.log(`清单 index.json = ${kb(Buffer.byteLength(fs.readFileSync(SRC)))}（原单体 ${kb(Buffer.byteLength(fs.readFileSync(BAK)))}）`);
  console.log(`books/ = ${cards.length} 个分片`);
  console.log("完成。");
}

main();
