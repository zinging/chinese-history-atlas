#!/usr/bin/env node
/**
 * 由 web/guoxue/index.html 生成 web/guoxue/shici.html（诗词鉴赏板块）。
 *
 * 做法：复用同一份 style.css 与 app.js，只做四处最小差异——
 *   1) <body data-sect="shiwen"> 锁定流派为诗文
 *   2) 标题与品牌名改为「诗词鉴赏」
 *   3) 顶部流派切换条换成朝代条（id="era-switch"，由 app.js 按数据填充，
 *      样式复用 .sect-switch/.sect-btn，即帝王谱系朝代条的同一套类）
 *   4) 页脚文案改为诗文集口径
 * 正文内的 #era-filter 已移除：朝代筛选上移到顶部朝代条，不重复出现。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUOXUE = join(HERE, '..', 'guoxue');   // 本脚本位于 web/tools/，页面在 web/guoxue/
const SRC = join(GUOXUE, 'index.html');
const OUT = join(GUOXUE, 'shici.html');

let html = readFileSync(SRC, 'utf8');

// 0) 页面声明锁定流派：诗词鉴赏固定为「诗文」，不显示流派切换条
html = html.replace('<body>', '<body data-sect="shiwen">');
html = html.replace('<title>国学图谱 · Chinese Classics Atlas</title>',
  '<title>诗词鉴赏 · Poetry Appreciation</title>');
html = html.replace('<div class="brand">📚 典籍长河</div>',
  '<div class="brand">🎋 诗词鉴赏</div>');

// 2) 顶部条：流派切换条换成朝代条。内容由 app.js 的 renderEraSwitch() 按数据填充，
//    这里只留一个「全部」占位；样式复用 .sect-switch/.sect-btn，与帝王谱系朝代条同一套类。
//    按行切分重写，避免正则转义与 CRLF 换行造成的偏移错位。
const lines = html.split(/\r?\n/);
const openIdx = lines.findIndex((l) => l.includes('<div class="sect-switch"'));
if (openIdx < 0) { console.error('未匹配到流派切换条，生成中止'); process.exit(1); }
let closeIdx = -1;
for (let i = openIdx + 1; i < lines.length; i++) {
  if (/^\s*<\/div>\s*$/.test(lines[i])) { closeIdx = i; break; }
}
if (closeIdx < 0) { console.error('未匹配到流派切换条的结束标签，生成中止'); process.exit(1); }
const eol = html.includes('\r\n') ? '\r\n' : '\n';
const newSwitch = [
  '  <!-- 诗词鉴赏按朝代分档：与帝王谱系顶部朝代条同一套类与样式（.sect-switch/.sect-btn 即朝代条），',
  '       点某朝代即筛选下方典籍卡片，副标题显示该朝诗人数量 -->',
  '  <div class="sect-switch" id="era-switch" role="tablist" aria-label="朝代切换">',
  '    <button class="sect-btn active" data-era="all"><span class="sect-main">全部</span><span class="sect-sub"></span></button>',
  '  </div>',
];
html = [...lines.slice(0, openIdx), ...newSwitch, ...lines.slice(closeIdx + 1)].join(eol);

// 3) 页脚文案
html = html.replace('内容以《史记》《汉书》《道德经》《庄子》等原典为依据 · 地图为示意 · 人物画像 AI 生成古风',
  '内容以《诗经》《楚辞》及唐宋元明清诗文集为依据 · 地图为示意 · 人物画像 AI 生成古风');

// 版本号独立，避免与典籍长河互相影响缓存
html = html.replace('style.css?v=v48', 'style.css?v=v48');
html = html.replace('app.js?v=v63', 'app.js?v=v63');

writeFileSync(OUT, html, 'utf8');
const b = readFileSync(OUT);
console.log('已生成 web/guoxue/shici.html');
console.log('BOM:', b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf);
console.log('标题:', /<title>(.*?)<\/title>/.exec(html)[1]);
console.log('流派按钮数:', (html.match(/class="sect-btn/g) || []).length);
console.log('引用同一份样式:', html.includes('style.css?v=v48'));
console.log('引用同一份脚本:', html.includes('app.js?v=v63'));