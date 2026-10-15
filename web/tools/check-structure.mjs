// 结构守卫：HTML 标签配平 + 关键容器父子关系
//
// 为什么需要它：这次「水墨装饰反复压住正文」的根因，是 index.html 里有一个
// 多余的 </div>，使 .module-inner 提前闭合。源码行号看起来正常、正则数 div 也对得上，
// 只有让浏览器解析后看真实父子关系才能发现——而这个错误静默存在了很久，
// 让我连续几轮都在错误的假设上调 CSS。
//
// 所以这个守卫检查两件事：
//   1. 去掉注释后标签是否配平（能抓到多数多余/缺失闭合）
//   2. .module-inner 是否真的包住了正文（topbar / 四个 main / footer 的父级）
//
// 用法：node web/tools/check-structure.mjs [--file web/index.html]
// 退出码 0 = 通过，1 = 有问题（可直接用于 CI / 提交前检查）。

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : 'web/index.html';
const file = resolve(fileArg);
const html = readFileSync(file, 'utf8');

const problems = [];
const ok = (label) => console.log(`✅ ${label}`);
const bad = (label, detail) => { problems.push(label); console.log(`❌ ${label}${detail ? ' — ' + detail : ''}`); };

// ---------- 1. 标签配平（忽略注释与自闭合） ----------
const stripped = html
  .replace(/<!--[\s\S]*?-->/g, '')       // 注释里可能有尖括号
  .replace(/<(meta|link|img|br|hr|input|source|path|circle|rect|line|ellipse|use|stop|text)\b[^>]*>/gi, (m) => (m.endsWith('/>') ? '' : m)); // 保留成对标签

const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source', 'path', 'circle', 'rect', 'line', 'ellipse', 'use', 'stop', 'text']);

const stack = [];
const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
let m;
while ((m = re.exec(stripped)) !== null) {
  const [, closing, name, attrs, selfClose] = m;
  const tag = name.toLowerCase();
  if (VOID.has(tag) || selfClose) continue;
  if (closing) {
    const top = stack.pop();
    if (!top) bad(`多余的 </${tag}>`, `位置字符 ${m.index}`);
    else if (top !== tag) bad(`标签不匹配`, `期望 </${top}>，实际 </${tag}>（字符 ${m.index}）`);
  } else {
    stack.push(tag);
  }
}
if (stack.length === 0) ok('标签配平');
else bad(`有 ${stack.length} 个标签未闭合`, stack.slice(-5).join(', '));

// ---------- 2. 关键容器是否包住正文（仅主站页面检查） ----------
if (fileArg.includes('index.html') && !fileArg.includes('guoxue')) {
  const hasModuleInner = /class="module-inner"/.test(html);
  if (hasModuleInner) {
    // 源码层面：.module-inner 开标签应在 topbar 之前、闭合应在 footer 之后
    const openAt = html.indexOf('class="module-inner"');
    const closeAt = html.search(/\/\s*module-inner/);
    const topbarAt = html.indexOf('<header class="topbar">');
    const footerAt = html.indexOf('class="footer"');
    if (openAt > -1 && topbarAt > -1) {
      if (openAt < topbarAt) ok('module-inner 开标签在 topbar 之前');
      else bad('module-inner 开标签在 topbar 之后', '正文会掉到它外面');
    }
    if (closeAt > -1 && footerAt > -1) {
      if (closeAt > footerAt) ok('module-inner 闭合标签在 footer 之后');
      else bad('module-inner 闭合标签在 footer 之前', '正文会掉到它外面');
    } else if (closeAt === -1) {
      bad('找不到 module-inner 的闭合注释');
    }
  } else {
    ok('本文件无 .module-inner，跳过容器检查');
  }
}

// ---------- 3. 装饰不得挂在 module-inner 内 ----------
// 用「装饰的字符位置是否落在 module-inner 的开闭区间内」判断，而不是正则匹配整段——
// 正则跨大段匹配容易被注释与嵌套干扰，给出假阳性。
const innerOpen = html.indexOf('class="module-inner"');
const innerClose = html.search(/\/\s*module-inner/);
if (innerOpen > -1 && innerClose > -1) {
  const inRange = (needle) => {
    const at = html.indexOf(needle);
    return at > innerOpen && at < innerClose;
  };
  const inside = inRange('ink-deco ink-deco-left') || inRange('ink-deco ink-deco-right');
  if (inside) bad('水墨装饰仍在 .module-inner 内', '应放进 .deco-slot 列位，否则宽度计算全错');
  else if (/deco-slot/.test(html)) ok('装饰已移入 deco-slot 列位（在 module-inner 之外）');
}

// ---------- 汇总 ----------
console.log('');
if (problems.length) {
  console.log(`发现 ${problems.length} 个结构问题：`);
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  process.exit(1);
}
console.log('结构检查通过');
process.exit(0);