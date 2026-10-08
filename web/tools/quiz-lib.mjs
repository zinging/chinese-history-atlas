/** 史论工坊题目写入工具：合并进各朝 quiz.json，并做结构校验 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = {
  sui: 'data/sui/quiz.json',
  tang: 'data/tang/quiz.json',
  song: 'data/song/quiz.json',
  yuan: 'data/yuan/quiz.json',
  ming: 'data/quiz/quiz.json',
  qing: 'data/qing/quiz.json',
};

/** 构造一道题：正确项固定在第 0 项（由 q() 打乱成随机位置） */
export function item(mode, question, correct, wrong1, wrong2, wrong3, why, open = false) {
  const options = [{ t: correct, ok: true }, { t: wrong1 }, { t: wrong2 }, { t: wrong3 }];
  // 简单确定性打散：用标题字符和降级，避免每次生成不同答案位置
  const seed = question.length + mode.length;
  const shift = seed % 4;
  for (let i = 0; i < shift; i++) options.push(options.shift());
  return { mode, q: question, options, ...(open ? { open: true } : {}), why };
}

/** 写入并校验 */
export function write(dyn, entries) {
  const file = FILE[dyn];
  const g = JSON.parse(readFileSync(file, 'utf8'));
  let added = 0;
  for (const e of entries) {
    const idx = g.quiz.findIndex((q) => q.emperor === e.emperor);
    if (idx >= 0) {
      // 已存在：补足到 5 题（每朝至少 arg×2 + chain×2 + open×1）
      const have = g.quiz[idx].items;
      const need = 5 - have.length;
      if (need > 0) { have.push(...e.items.slice(0, need)); added += Math.min(need, e.items.length); }
    } else {
      g.quiz.push({ emperor: e.emperor, items: e.items });
      added += e.items.length;
    }
  }
  g.meta.updated = '2026-10-08';
  writeFileSync(file, JSON.stringify(g, null, 2) + '\n');

  // 校验本次写入
  let problems = 0;
  for (const q of g.quiz) {
    for (const it of q.items) {
      const oks = (it.options || []).filter((o) => o.ok).length;
      if (oks !== 1) { console.log(`  ❌ ok≠1: ${q.emperor} | ${it.q.slice(0, 30)}`); problems++; }
      if (!it.why) { console.log(`  ⚠ 缺解析: ${q.emperor} | ${it.q.slice(0, 24)}`); problems++; }
    }
  }
  const total = g.quiz.reduce((s, q) => s + q.items.length, 0);
  const opens = g.quiz.reduce((s, q) => s + q.items.filter((i) => i.open).length, 0);
  console.log(`${dyn}: 写入 ${added} 题 → 现有 ${g.quiz.length} 位皇帝 / ${total} 题（开放题 ${opens}）${problems ? '  ❌' : '  ✅'}`);
}