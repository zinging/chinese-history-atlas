#!/usr/bin/env node
/* 智慧舆图冒烟测试（对齐 web/smoke-geo.mjs 的做法）
 * 真实浏览器 + CDP：逐个流派切到「智慧舆图」页，校验
 *   1) 地名图层数量 = 数据里的 places 数
 *   2) 路线图层与起终点标记数量正确
 *   3) 路线按钮文案含站数，点击后详情列出全部途经点，再点收起
 *   4) 切换流派后旧图层被清干净，不叠加
 * 用法：node web/guoxue/smoke-map.mjs [port]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = Number(process.argv[2] || 5199);
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SECTS = ['rujia', 'daojia', 'foxue', 'zhuzi', 'lixue', 'shiwen'];

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 起一个只服务 data/ 的静态服务器（复用主 serve.mjs 的 API 面最小集）
const server = spawn(process.execPath, [join(ROOT, 'web', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
process.on('exit', () => server.kill());

// 等服务器就绪
for (let i = 0; i < 40; i++) {
  try { await fetch(`http://127.0.0.1:${PORT}/web/guoxue/index.html`); break; } catch { await sleep(150); }
}
await sleep(300);

const profile = mkdtempSync(join(tmpdir(), 'cdp-map-'));
const cport = 9600 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cport}`, `--user-data-dir=${profile}`,
  '--window-size=1400,900', '--hide-scrollbars', '--no-first-run', '--disable-gpu',
  '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

let page;
for (let i = 0; i < 60 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${cport}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {}
  if (!page) await sleep(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } };
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
  const v = r.result?.result?.value;
  // 页面里返回的是 JSON 字符串，这里解析成对象；非 JSON 则原样返回
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
};

await send('Page.enable');
await send('Runtime.enable');
// 捕获一切未处理异常与 console.error：地图空白这类问题必须由测试自己发现。
// 必须在导航前注册（addScriptToEvaluateOnNewDocument），否则页面加载会清掉钩子。
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__mapErrors = [];
    window.addEventListener('error', (e) => window.__mapErrors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__mapErrors.push('rejection: ' + String(e.reason)));
    const _ce = console.error; console.error = (...a) => { window.__mapErrors.push(a.map(String).join(' ')); _ce.apply(console, a); };`,
});
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/web/guoxue/index.html` });
await sleep(2600);

// 进入地图页
await evalJs(`document.querySelector('[data-page=map]').click()`);
await sleep(900);

console.log('=== 智慧舆图 · 各流派图层 ===');
const expected = {};
for (const s of SECTS) {
  const j = JSON.parse(readFileSync(join(ROOT, 'data', s, 'index.json'), 'utf8'));
  expected[s] = { places: (j.places || []).length, routes: (j.routes || []).length };
}

const perSect = {};
for (const s of SECTS) {
  const r = await evalJs(`(async () => {
    const btn = document.querySelector('.sect-btn[data-s=${s}]');
    // 诗文已独立成「诗词鉴赏」板块，故本页流派条里可能没有该按钮——
    // 此时该流派的地图不在本模块的验证范围内，跳过而不是让测试崩掉。
    if (!btn) return JSON.stringify({ skipped: true });
    btn.click();
    await new Promise(r => setTimeout(r, 700));
    const T = window.__guoxueMapTest;
    const map = T.map;
    let places = 0, routes = 0, startEnd = 0;
    T.mapLayers.places.forEach(l => { if (l instanceof L.CircleMarker) places++; });
    T.mapLayers.routes.forEach(l => {
      if (l instanceof L.Polyline) routes++;
      else if (l instanceof L.CircleMarker) startEnd++;
    });
    return {
      placeLayers: T.mapLayers.places.length,
      routePolylines: routes,
      routeEndMarkers: startEnd,
      btnTexts: [...document.querySelectorAll('#map-route-btns .route-btn')].map(b => b.textContent),
      routePanelHidden: document.getElementById('map-route-btns').classList.contains('hidden'),
      detailHidden: document.getElementById('route-detail').classList.contains('hidden'),
      // 图层是否真在图上（total 覆盖面积大于 0 说明已渲染）
      svgPresent: !!document.querySelector('.leaflet-overlay-pane svg, .leaflet-overlay-pane canvas'),
      dataPlaces: (T.bookData.places||[]).length,
      dataRoutes: (T.bookData.routes||[]).length,
      dataPoints: (T.bookData.routes||[]).reduce((n,x)=>n+(x.points||[]).length,0),
    };
  })()`);
  perSect[s] = r;
  const exp = expected[s];
  // 该流派已不在本页（诗文独立成板块）→ 跳过断言，并记录，供后面的用例挑选
  if (r.skipped) {
    console.log(`— ${s}: 本页无此流派（已独立成其他板块），跳过`);
    continue;
  }
  ok(r.placeLayers === exp.places, `${s}: 地名图层 ${r.placeLayers} = places ${exp.places}`);
  ok(r.routePolylines === exp.routes, `${s}: 路线折线 ${r.routePolylines} = routes ${exp.routes}`);
  ok(r.routeEndMarkers === exp.routes * 2, `${s}: 起终点标记 ${r.routeEndMarkers} = ${exp.routes}×2`);
  ok(r.routePanelHidden === (exp.routes === 0), `${s}: 路线按钮区显隐正确（routes=${exp.routes}）`);
  ok(r.btnTexts.length === exp.routes, `${s}: 路线按钮 ${r.btnTexts.length} 个`);
  if (exp.routes) ok(r.btnTexts[0].includes('站'), `${s}: 路线按钮含站数「${r.btnTexts[0]}」`);
}

console.log('\n=== 路线展开/收起 ===');
// 挑一个「本页存在且有路线」的流派验证交互
const testedSects = SECTS.filter((s) => !perSect[s].skipped);
const withRoute = testedSects.find((s) => expected[s].routes > 0);
const routeInfo = await evalJs(`(async () => {
  document.querySelector('.sect-btn[data-s=${withRoute}]').click();
  await new Promise(r => setTimeout(r, 700));
  const T = window.__guoxueMapTest;
  const r0 = T.bookData.routes[0];
  const btn = document.querySelector('#map-route-btns .route-btn');
  btn.click();
  await new Promise(r => setTimeout(r, 250));
  const stops = [...document.querySelectorAll('#route-detail .route-detail-stops li')].map(li => li.textContent.trim());
  // 编号是 <ol> 的 list-style 生成的，不在 textContent 里；改为核对 DOM 顺序 == 数据顺序
  const stopNames = [...document.querySelectorAll('#route-detail .route-detail-stops li')].map(li => {
    const b = li.querySelector('.stop-head b') || li.querySelector('b');
    return b ? b.textContent.trim() : '';
  });
  const dataNames = (r0.points || []).map(p => String(p.name || '').trim());
  const orderedNames = stopNames.length === dataNames.length && stopNames.every((n, i) => n === dataNames[i]);
  const activeOn = btn.classList.contains('on');
  const styled = T.mapLayers.routes.filter(l => l instanceof L.Polyline && l.options.weight === 5).length;
  // 再点一次收起
  btn.click();
  await new Promise(r => setTimeout(r, 250));
  return {
    name: r0.name, points: (r0.points||[]).length,
    stopCount: stops.length, stops, activeOn, highlightedLines: styled,
    orderedNames, stopNames, dataNames,
    afterToggleHidden: document.getElementById('route-detail').classList.contains('hidden'),
    afterToggleOn: btn.classList.contains('on'),
    weightBack: T.mapLayers.routes.filter(l => l instanceof L.Polyline).every(l => l.options.weight === 3),
  };
})()`);
ok(routeInfo.stopCount === routeInfo.points, `路线「${routeInfo.name}」详情列出 ${routeInfo.points} 个途经点`);
// 编号由 <ol> 的 list-style 自动生成，textContent 里没有「1.」字面量。
// 因此校验 DOM 顺序与数据站点名逐一对应——序号由浏览器按 DOM 顺序渲染，顺序对即编号对。
ok(routeInfo.orderedNames === true,
  `途经点按数据顺序编号（${routeInfo.stops.length} 项逐一对应 routes[0].points）`);
ok(routeInfo.activeOn === true, '展开时按钮呈选中态');
ok(routeInfo.highlightedLines === 1, '当前路线折线高亮（weight=5）');
ok(routeInfo.afterToggleHidden === true, '再点一次收起详情');
ok(routeInfo.afterToggleOn === false, '收起后按钮取消选中');
ok(routeInfo.weightBack === true, '收起后所有折线恢复默认样式');

console.log('\n=== 切换流派不叠加图层 ===');
const noLeak = await evalJs(`(async () => {
  const T = window.__guoxueMapTest;
  document.querySelector('.sect-btn[data-s=rujia]').click();
  await new Promise(r => setTimeout(r, 600));
  const a = T.mapLayers.places.length;
  document.querySelector('.sect-btn[data-s=lixue]').click();
  await new Promise(r => setTimeout(r, 600));
  const b = T.mapLayers.places.length;
  return { a, b, lixueExpect: T.bookData.places.length };
})()`);
ok(noLeak.b === noLeak.lixueExpect, `切到 lixue 后地名图层 ${noLeak.b} = 数据 ${noLeak.lixueExpect}（未叠加 rujia 的 ${noLeak.a}）`);

console.log('\n=== 无脚本异常 + 图层真的渲染出来了 ===');
// 关键回归：曾经 mapLayers.routes 里混入 tooltip，对 tooltip 调 setStyle 会抛异常，
// 导致 initMap 中断、整张地图空白——而只数图层对象的断言察觉不到。这里改为查真实 DOM 与错误。
const errors = [];
const renderReport = await evalJs(`(() => {
  const errs = window.__mapErrors || [];
  return JSON.stringify({
    errs,
    overlayPaths: document.querySelectorAll('.leaflet-overlay-pane path').length,
    markers: document.querySelectorAll('.leaflet-marker-pane *').length,
    tooltips: document.querySelectorAll('.leaflet-tooltip').length,
    tileImgs: document.querySelectorAll('.leaflet-tile-pane img').length,
  });
})()`);
const p = renderReport;   // evalJs 已把 JSON 字符串解析成对象
ok(p.errs.length === 0, `地图渲染过程无异常（${p.errs.length ? p.errs.join(' | ') : '0 条'}）`);
ok(p.overlayPaths > 0, `SVG 图层已渲染（${p.overlayPaths} 个 path，含折线与圆点）`);
ok(p.tooltips > 0, `常显标签已渲染（${p.tooltips} 个 tooltip）`);
// 瓦片来自在线 OSM，离线时允许为 0，但不应报错
if (p.tileImgs === 0) console.log('ℹ 未加载到 OSM 瓦片（离线或网络受限），图层功能不受影响');

console.log('\n=== 图例与容器 ===');
const dom = await evalJs(`(() => {
  const lg = document.querySelector('.map-legend-float');
  const wrap = document.querySelector('.map-wrap');
  const ml = document.getElementById('map-leaf');
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  const ov = (a, b) => !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
  const rail = document.querySelector('.tabs-v');
  const rb = rail.getBoundingClientRect();
  return {
    legendItems: lg ? [...lg.querySelectorAll('.legend-item')].map(x => x.textContent.trim()) : [],
    mapH: r(ml).h, wrapW: r(wrap).w,
    legendInsideMap: lg ? ov(lg.getBoundingClientRect(), r(wrap) && ml.getBoundingClientRect()) : false,
    contentRight: Math.round(document.querySelector('#app').getBoundingClientRect().right - parseFloat(getComputedStyle(document.querySelector('#app')).paddingRight)),
    railLeft: Math.round(rb.left),
  };
})()`);
ok(dom.legendItems.length === 4, `图例 4 项：${dom.legendItems.join(' / ')}`);
ok(dom.mapH >= 500, `地图高度 ${dom.mapH}px（≥500）`);
ok(dom.legendInsideMap === true, '图例浮在地图内部右上角');
ok(dom.railLeft >= dom.contentRight - 1, `右侧胶囊不占正文（正文右缘 ${dom.contentRight}，胶囊左缘 ${dom.railLeft}）`);

ws.close(); chrome.kill(); server.kill();
console.log(`\n${fail === 0 ? '全部通过' : '存在失败'}：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);