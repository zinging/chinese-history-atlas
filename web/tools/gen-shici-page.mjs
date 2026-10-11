#!/usr/bin/env node
/**
 * 由 web/guoxue/index.html 生成 web/guoxue/shici.html（诗词鉴赏板块）。
 *
 * 做法：复用同一份 style.css 与 app.js，只做三处最小差异——
 *   1) 标题改为「诗词鉴赏」
 *   2) 流派切换条只保留「诗文」一项（锁定该流派，不做多流派切换）
 *   3) 底部说明文案去掉典籍类目
 * 生成后再把 app.js 里的初始流派设为 shiwen（由页面上的 data-s 决定，无需改 JS）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUOXUE = join(HERE, '..', 'guoxue');   // 本脚本位于 web/tools/，页面在 web/guoxue/
const SRC = join(GUOXUE, 'index.html');
const OUT = join(GUOXUE, 'shici.html');

let html = readFileSync(SRC, 'utf8');

// 1) 标题与品牌名
html = html.replace('<title>国学图谱 · Chinese Classics Atlas</title>',
  '<title>诗词鉴赏 · Poetry Appreciation</title>');
html = html.replace('<div class="brand">📚 典籍长河</div>',
  '<div class="brand">🎋 诗词鉴赏</div>');

// 2) 流派切换条：只留「诗文」，并让它成为唯一（不可点）的那一项。
//    按行切分重写，避免正则里的转义与 CRLF 换行带来的偏移错位。
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
  '  <!-- 诗词鉴赏锁定为「诗文」一类：与典籍长河同一套数据和样式，只是收敛到单一品类 -->',
  '  <div class="sect-switch" id="sect-switch" role="tablist" aria-label="品类">',
  '    <button class="sect-btn active" data-s="shiwen" aria-current="true"><span class="sect-main">诗文</span><span class="sect-sub">22 位文人</span></button>',
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