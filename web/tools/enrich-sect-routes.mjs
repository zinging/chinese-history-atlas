#!/usr/bin/env node
/**
 * 把 sect-routes-enrich.data.mjs 的 desc / quote / meaning 合并进
 * data/<sect>/index.json 的 routes（智慧舆图·圣贤行迹）。
 *
 * 只新增字段，不改动现有 name / points（坐标与 event 原文保留）。
 * 用法：node web/tools/enrich-sect-routes.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_ENRICH } from './sect-routes-enrich.data.mjs';
import { MEANING_REWRITE } from './sect-routes-meaning-fix.data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SECTS = ['rujia', 'daojia', 'foxue', 'zhuzi', 'lixue'];
const dryRun = process.argv.includes('--dry-run');

/** 取某个途经点的意义：改写表优先，否则用主数据。
 *  分两层的原因：主数据里有 43 处的 meaning 以 event 原文开头，页面上会让
 *  同一件事显示两遍（经过一遍、意义又一遍）。改写表只收这些，主数据保持原貌。 */
function meaningFor(sect, routeName, pointName, fallback) {
  const perRoute = MEANING_REWRITE[sect] && MEANING_REWRITE[sect][routeName];
  return (perRoute && perRoute[pointName]) || fallback;
}

let nRoutes = 0, nQuotes = 0, nMeanings = 0, nDescs = 0, nRewritten = 0;
const problems = [];

for (const sect of SECTS) {
  const file = join(ROOT, 'data', sect, 'index.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const routes = Array.isArray(json.routes) ? json.routes : [];
  const plan = ROUTE_ENRICH[sect] || [];

  if (plan.length !== routes.length) {
    problems.push(`[${sect}] 路线数不符：数据 ${routes.length} 条，扩展 ${plan.length} 条`);
  }

  for (const r of routes) {
    const add = plan.find((x) => x.name === r.name);
    if (!add) { problems.push(`[${sect}] 路线「${r.name}」缺少扩展数据`); continue; }
    nRoutes++;
    if (!add.desc || add.desc.length < 40) problems.push(`[${sect}]「${r.name}」desc 过短`);
    r.desc = add.desc;
    nDescs++;

    for (const p of r.points || []) {
      const pa = (add.points || []).find((x) => x.name === p.name);
      if (!pa) { problems.push(`[${sect}]「${r.name}」途经点「${p.name}」缺少扩展数据`); continue; }
      if (pa.quote) {
        if (!pa.quote.original || !pa.quote.translation || !pa.quote.source) {
          problems.push(`[${sect}]「${p.name}」quote 字段不完整`);
        }
        p.quote = pa.quote;
        nQuotes++;
      }
      const meaning = meaningFor(sect, r.name, p.name, pa.meaning);
      if (meaning && meaning.length >= 20) {
        p.meaning = meaning;
        if (meaning !== pa.meaning) nRewritten++;
        nMeanings++;
      } else {
        problems.push(`[${sect}]「${p.name}」meaning 缺失或过短`);
      }
      // 重复体检：意义的开头不得复述 event 的开头，否则页面上同一件事显示两遍
      const ev = String(p.event || "");
      const me = String(p.meaning || "");
      let k = 0;
      while (k < ev.length && k < me.length && ev[k] === me[k]) k++;
      if (k >= 10) {
        problems.push(`[${sect}]「${p.name}」meaning 开头与 event 重复 ${k} 字（页面会重复呈现）`);
      }
    }
    // 反向检查：扩展数据里有、路线里没有的站点名，多半是改名后忘了同步
    for (const pa of add.points || []) {
      if (!(r.points || []).some((p) => p.name === pa.name)) {
        problems.push(`[${sect}]「${r.name}」扩展数据多出站点「${pa.name}」`);
      }
    }
  }

  if (!dryRun) writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
}

console.log(`路线 ${nRoutes} 条（导语 ${nDescs}）、原句 ${nQuotes} 处、意义 ${nMeanings} 条（其中改写去重 ${nRewritten} 条）`);
if (problems.length) {
  console.log('发现问题：');
  for (const p of problems) console.log('  -', p);
  process.exit(1);
}
console.log(dryRun ? '（DRY RUN 未写盘）' : '五个 index.json 已写入 desc / quote / meaning。');
