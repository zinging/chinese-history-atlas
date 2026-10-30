#!/usr/bin/env node
/**
 * 把 sect-enrichment.data.mjs 的 quotes / significance 合并进
 * data/<sect>/index.json 的 events（思想源流·智慧舆图）。
 * 只新增字段，不改动现有 summary / narrative 等。
 * 用法：node web/tools/enrich-sect-events.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENRICH } from './sect-enrichment.data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SECTS = ['rujia', 'daojia', 'foxue', 'zhuzi', 'lixue'];
const dryRun = process.argv.includes('--dry-run');

const covered = new Set();
let total = 0;
const problems = [];

for (const sect of SECTS) {
  const file = join(ROOT, 'data', sect, 'index.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(json.events)) { problems.push(`${sect} 无 events`); continue; }

  for (const ev of json.events) {
    total++;
    const add = ENRICH[ev.id];
    if (!add) { problems.push(`缺少扩展数据：${ev.id}`); continue; }
    if (!Array.isArray(add.quotes) || !add.quotes.length) problems.push(`quotes 为空：${ev.id}`);
    if (!Array.isArray(add.significance) || !add.significance.length) problems.push(`significance 为空：${ev.id}`);
    for (const q of add.quotes || []) {
      if (!q.original || !q.translation) problems.push(`quote 字段不完整：${ev.id}`);
    }
    ev.quotes = add.quotes;
    ev.significance = add.significance;
    covered.add(ev.id);
  }

  if (!dryRun) {
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  }
}

const extra = Object.keys(ENRICH).filter((id) => !covered.has(id));
console.log(`事件总数 ${total}，已扩展 ${covered.size}，数据文件 ${extra.length ? '有多余' : '无多余'}`);
if (extra.length) console.log('  多余数据：', extra.join(', '));
if (problems.length) {
  console.log('发现问题：');
  for (const p of problems) console.log('  -', p);
  process.exit(1);
}
console.log(dryRun ? '（DRY RUN 未写盘）' : '五个 index.json 已写入 quotes / significance。');
