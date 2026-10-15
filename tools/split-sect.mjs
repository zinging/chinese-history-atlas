#!/usr/bin/env node
/**
 * 通用流派拆分：把 index.json 里每本书的"详情字段"抽成 books/{id}.json 按需分片。
 *
 * 与 gewu 的区别：这六个流派（儒/道/佛/诸子/理学心学/诗文）的顶层 cases / quiz /
 * discourses / places / routes 数据量小、且页面一进来就要用，保留内联；只把体积大头
 * ——每本书的 quote/intro/core/chapters/golden/funFacts/timeline ——拆出去，点开才加载。
 *
 * 用法：node tools/split-sect.mjs rujia daojia foxue zhuzi lixue shiwen
 * 重复运行安全：已存在的 books/{id}.json 不覆盖；原单体备份到 .index.full.bak.json（仅首次）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 卡片列表渲染需要的字段（留在清单里，切到该流派即显示）
const CARD_KEEP = new Set([
  "id", "icon", "name", "meta", "portrait", "person",
  "cardMeta", "era", "collectionName", "category",
]);

function splitSect(sect) {
  const dir = path.join(ROOT, "data", sect);
  const indexPath = path.join(dir, "index.json");
  const manifest = JSON.parse(fs.readFileSync(indexPath, "utf8"));

  // 备份原单体（仅首次）
  const bak = path.join(dir, ".index.full.bak.json");
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(indexPath, bak);
  }

  const booksDir = path.join(dir, "books");
  fs.mkdirSync(booksDir, { recursive: true });

  let beforeSize = fs.statSync(indexPath).size;
  let shardSize = 0;

  manifest.books = manifest.books.map((book) => {
    const id = book.id;
    // 卡片：只留列表字段 + 分片指针
    const card = {};
    for (const k of Object.keys(book)) {
      if (CARD_KEEP.has(k)) card[k] = book[k];
    }
    card.src = `books/${id}.json`;
    // 详情：其余全部字段，带 id 便于校验
    const detail = { id };
    for (const k of Object.keys(book)) {
      if (!CARD_KEEP.has(k)) detail[k] = book[k];
    }
    // 详情分片已存在则不覆盖（保护手工编辑）
    const shardPath = path.join(booksDir, `${id}.json`);
    if (!fs.existsSync(shardPath)) {
      fs.writeFileSync(shardPath, JSON.stringify(detail, null, 2) + "\n", "utf8");
    }
    shardSize += fs.statSync(shardPath).size;
    return card;
  });

  fs.writeFileSync(indexPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const afterSize = fs.statSync(indexPath).size;

  console.log(
    `  ${sect}: 清单 ${(beforeSize / 1024).toFixed(1)}KB → ${(afterSize / 1024).toFixed(1)}KB ` +
    `（${manifest.books.length} 本书详情共 ${(shardSize / 1024).toFixed(1)}KB 已分片）`
  );
}

const sects = process.argv.slice(2);
if (!sects.length) {
  console.error("用法：node tools/split-sect.mjs <sect1> [sect2 ...]");
  process.exit(1);
}
console.log("开始拆分：");
for (const s of sects) splitSect(s);
console.log("完成。");
