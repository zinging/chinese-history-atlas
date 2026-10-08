/**
 * 为宋朝 quiz.json 补齐每题唯一正确项的 ok:true 标注。
 * 正确项索引依据题目语义与 why 解析逐题确定（不依赖固定位置）。
 * 键为题目文本中的关键片段，便于人工核对。
 */
import { readFileSync, writeFileSync } from 'node:fs';

// 题目关键片段 → 正确项索引
const CORRECT = {
  // 宋太祖：多为「正确陈述在 [0]」
  '宋太祖赵匡胤最核心的历史贡献': 0,
  '「杯酒释兵权」反映宋太祖': 0,
  '北宋「重文抑武」政策带来的主要影响': 0,
  '北宋建立后逐步统一全国的顺序': 0,
  '澶渊之盟（1005）对北宋的影响': 0,
  '宋太祖重文抑武，虽然稳定了政权': 1, // 辩证项：「部分同意」在 [1]
  // 宋神宗
  '王安石变法的核心目标': 0,
  '青苗法的主要内容和目的': 0,
  '王安石变法最终失败的根本原因': 0,
  '王安石变法的时间顺序': 0,
  '方向正确、方法激进': 2, // 辩证项：「需要辩证看待」在 [2]
  // 宋徽宗
  '宋徽宗赵佶在历史上的主要形象': 0,
  '「花石纲」是什么': 0,
  '靖康之变（1127）的直接原因': 0,
  '北宋灭亡的过程': 0,
  '宋徽宗是艺术家': 2, // 辩证项
  // 宋高宗
  '宋高宗赵构最核心的历史争议': 0,
  '岳飞被杀的根本原因': 0,
  '绍兴和议（1141）的主要内容': 0,
  '南宋建立的过程': 0,
  '宋高宗对金求和是明智之举': 2, // 辩证项
  // 宋恭帝
  '南宋灭亡的标志性事件': 0,
  '文天祥的历史地位': 0,
  '「崖山之后无中国」这句话的含义': 1, // [1] 才是「传统延续」的准确表述
  '南宋灭亡的过程': 0,
  '南宋灭亡是历史的必然': 2, // 辩证项
};

const file = 'data/song/quiz.json';
const g = JSON.parse(readFileSync(file, 'utf8'));

let fixed = 0;
const missed = [];

for (const q of g.quiz) {
  for (const it of q.items || []) {
    const opts = it.options || [];
    if (opts.filter((o) => o.ok).length === 1) continue; // 已标注
    if (opts.length !== 4) { missed.push(`选项数异常(${opts.length}): ${it.q.slice(0, 24)}`); continue; }
    // 按题目文本片段匹配
    let idx = null;
    let hitKw = '';
    for (const [kw, i] of Object.entries(CORRECT)) {
      if (it.q.includes(kw)) { idx = i; hitKw = kw; break; }
    }
    if (idx == null) { missed.push(`未匹配: ${q.emperor} | ${it.q.slice(0, 30)}`); continue; }
    for (const o of opts) delete o.ok;
    opts[idx].ok = true;
    fixed++;
    console.log(`✅ [${hitKw.slice(0, 18)}] → [${idx}] ${opts[idx].t.slice(0, 34)}`);
  }
}

writeFileSync(file, JSON.stringify(g, null, 2) + '\n');
console.log(`\n标注 ${fixed} 题`);
if (missed.length) {
  console.log(`\n未处理 ${missed.length} 题：`);
  missed.forEach((m) => console.log('  ⚠ ' + m));
}