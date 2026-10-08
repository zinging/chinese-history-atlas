import { readFileSync, existsSync } from 'node:fs';

const DYNS = [
  ['sui', 'data/sui/quiz.json', 'data/sui/emperors'],
  ['tang', 'data/tang/quiz.json', 'data/tang/emperors'],
  ['song', 'data/song/quiz.json', 'data/song/emperors'],
  ['yuan', 'data/yuan/quiz.json', 'data/yuan/emperors'],
  ['ming', 'data/quiz/quiz.json', 'data/emperors'],
  ['qing', 'data/qing/quiz.json', 'data/qing/emperors'],
];

let tAll = 0, tHas = 0, tItems = 0, tOpen = 0;
for (const [d, qf, ed] of DYNS) {
  const g = JSON.parse(readFileSync(qf, 'utf8'));
  const idx = JSON.parse(readFileSync(`${ed}/index.json`, 'utf8')).emperors;
  const cov = new Map(g.quiz.map((q) => [q.emperor, q]));
  const missing = idx.filter((e) => !cov.has(e.id));
  const items = g.quiz.reduce((s, q) => s + q.items.length, 0);
  const opens = g.quiz.reduce((s, q) => s + q.items.filter((i) => i.open).length, 0);
  tAll += idx.length; tHas += cov.size; tItems += items; tOpen += opens;
  console.log(`\n=== ${d}：${cov.size}/${idx.length} 位有题，共 ${items} 题（开放题 ${opens}）===`);
  if (missing.length) {
    console.log('  缺题（' + missing.length + '位）：');
    for (const e of missing) console.log(`    ${e.name.padEnd(5)} ${e.id}`);
  }
}
console.log(`\n合计：${tHas}/${tAll} 位有题，${tItems} 道题（其中开放题 ${tOpen}）`);
console.log(`待补：${tAll - tHas} 位皇帝`);