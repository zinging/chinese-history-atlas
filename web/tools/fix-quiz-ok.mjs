/**
 * 修复 quiz.json 中丢失的 ok:true 标注。
 * 依据每题 why 解析确定唯一正确项，逐题显式指定索引，避免误标。
 */
import { readFileSync, writeFileSync } from 'node:fs';

// 文件 → 皇帝 → 题目关键词 → 正确项索引
const FIX = {
  'data/quiz/quiz.json': {
    'ming-emperor-taizu': {
      '废除丞相制度': 0,
      '明朝建立的过程': 0,
    },
    'ming-emperor-chengzu': {
      '迁都北京的主要战略考虑': 1,
      '郑和下西洋的历史作用': 0,
      '靖难之役的结束标志': 0,
    },
    'ming-emperor-yingzong': {
      '土木堡之变（1449）的直接原因': 0,
      '土木堡之变后的明朝局势': 0,
    },
    'ming-emperor-sizong': {
      '明朝灭亡的过程': 0,
      '明朝从强盛走向灭亡的关键转折点': 0,
    },
  },
};

for (const [file, byEmperor] of Object.entries(FIX)) {
  const g = JSON.parse(readFileSync(file, 'utf8'));
  let fixed = 0;
  for (const q of g.quiz) {
    const map = byEmperor[q.emperor];
    if (!map) continue;
    for (const it of q.items || []) {
      for (const [kw, idx] of Object.entries(map)) {
        if (!it.q.includes(kw)) continue;
        if (!it.options || !it.options[idx]) { console.log(`⚠ 索引越界: ${q.emperor} / ${it.q.slice(0, 20)}`); continue; }
        // 先清掉所有 ok，再给正确项打上
        for (const o of it.options) delete o.ok;
        it.options[idx].ok = true;
        fixed++;
        console.log(`✅ ${q.emperor} | ${kw} → [${idx}] ${it.options[idx].t.slice(0, 30)}`);
      }
    }
  }
  writeFileSync(file, JSON.stringify(g, null, 2) + '\n');
  console.log(`\n${file}: 修复 ${fixed} 题\n`);
}