// 把滞留在 .module-inner 内的右幅装饰搬进 .deco-slot-right
//
// 背景：上一轮的结构修复脚本用行范围切片，删多/漏搬，导致右幅留在
// .module-inner 里（浏览器容错渲染为它的子元素，正文列宽度因此算错）。
// 这次改为按「内容锚点」定位并当场校验，不再依赖行号。
import { readFileSync, writeFileSync } from 'node:fs';

const P = 'web/index.html';
let html = readFileSync(P, 'utf8');

const innerOpen = html.indexOf('class="module-inner"');
const innerClose = html.search(/\/\s*module-inner/);
if (innerOpen < 0 || innerClose < 0) { console.error('未找到 module-inner 区间'); process.exit(1); }

const rAt = html.indexOf('ink-deco ink-deco-right');
console.log('右幅位置:', rAt, ' module-inner 区间: [' + innerOpen + ',' + innerClose + ']');

if (rAt < innerOpen || rAt > innerClose) {
  console.log('右幅已在 module-inner 之外，无需搬迁');
  process.exit(0);
}

// 右幅整块：从它所在行的 <div 开始，到「</svg> 后的 </div>」结束
const lineStart = html.lastIndexOf('<div', rAt);
let svgEnd = html.indexOf('</svg>', rAt);
while (svgEnd !== -1 && !/^\s*<\/div>/.test(html.slice(svgEnd + 6, svgEnd + 40))) {
  svgEnd = html.indexOf('</svg>', svgEnd + 6);
}
if (svgEnd === -1) { console.error('未找到右幅的 </svg> 收尾'); process.exit(1); }
const divEnd = html.indexOf('</div>', svgEnd) + '</div>'.length;
const block = html.slice(lineStart, divEnd);
console.log('右幅块长度:', block.length, ' 含 ink-deco-right:', block.includes('ink-deco-right'));

// 从原位置删除
html = html.slice(0, lineStart) + html.slice(divEnd);

// 插入到 .deco-slot-right 内（该槽位当前应为空）
const slotOpen = html.indexOf('deco-slot-right');
if (slotOpen < 0) { console.error('未找到 .deco-slot-right'); process.exit(1); }
const slotTagEnd = html.indexOf('>', slotOpen) + 1;
html = html.slice(0, slotTagEnd) + '\n' + block + '\n    ' + html.slice(slotTagEnd);

writeFileSync(P, html, 'utf8');

// 复核
const after = readFileSync(P, 'utf8');
const io2 = after.indexOf('class="module-inner"');
const ic2 = after.search(/\/\s*module-inner/);
const l2 = after.indexOf('ink-deco ink-deco-left');
const r2 = after.indexOf('ink-deco ink-deco-right');
const cf = (v) => (v ? '✓' : '✗');
console.log(cf((after.match(/ink-deco ink-deco-left/g) || []).length === 1) + ' 左幅恰好一份');
console.log(cf((after.match(/ink-deco ink-deco-right/g) || []).length === 1) + ' 右幅恰好一份');
console.log(cf(l2 < io2) + ' 左幅在 module-inner 之前');
console.log(cf(r2 > ic2) + ' 右幅在 module-inner 之后');
console.log(cf((after.match(/<div\b/g) || []).length === (after.match(/<\/div>/g) || []).length) + ' div 配平');
console.log(cf(after.indexOf('deco-slot-right') < r2) + ' 右幅位于 deco-slot-right 内');