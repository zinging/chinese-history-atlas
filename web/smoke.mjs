// 前端 smoke test v5：加载 search-core + app.js，断言四页渲染与地图数据层
// 说明：地图改为 Leaflet 后，renderMap 依赖真实 DOM/网络瓦片，无法在 vm 里完整跑；
//        这里改为断言 buildMapData() 产出的地图数据层（疆域/城市/事件/路线/长城等）。
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const appSrc = readFileSync('web/app.js', 'utf8');
const searchSrc = readFileSync('web/search-core.js', 'utf8');

const timelineCards = [];
const clueCards = [];
const casesEl = { innerHTML: '' };
const caseTabsEl = { innerHTML: '', querySelectorAll: () => [] };
const routeDetailEl = { innerHTML: '', classList: { add: () => {}, remove: () => {} }, scrollIntoView: () => {} };
const mapLeaf = { innerHTML: '', setAttribute: () => {}, appendChild: () => {}, style: {} };
const detailEl = {
  innerHTML: '', classList: { remove: () => {}, add: () => {} },
  querySelector: (sel) => {
    if (sel === '.entry-grid') return { appendChild: () => {}, querySelectorAll: () => [] };
    if (sel === '.entry-panel') return null;
    if (sel === '.detail-panel') return { insertAdjacentElement: () => {} };
    return { style: {} };
  },
  querySelectorAll: () => [],
  appendChild: () => {}, scrollIntoView: () => {},
};

function container() {
  return { innerHTML: '', appendChild: (n) => { if (n.className === 'clue-card') clueCards.push(n); } };
}

// Leaflet 桩：renderMap 里 map 桩不绑定事件，只走通 setView/removeLayer。
const LStub = {
  map: () => ({ setView: () => {}, removeLayer: () => {}, hasLayer: () => false, getCenter: () => ({ lat: 0, lng: 0 }), getZoom: () => 4, flyTo: () => {}, stop: () => {}, off: () => {}, on: () => {} }),
  tileLayer: () => ({ addTo: () => ({}), on: () => {} }),
  geoJSON: () => { const lyr = { addTo: () => lyr, getBounds: () => ({ getCenter: () => ({ lng: 110, lat: 35 }) }) }; return lyr; },
  polygon: () => { const lyr = { addTo: () => lyr }; return lyr; },
  polyline: () => {
    const lyr = { addTo: () => lyr, setStyle: () => {}, _path: { getTotalLength: () => 100, style: {}, getBoundingClientRect: () => ({}) } };
    return lyr;
  },
  circleMarker: () => { const lyr = { addTo: () => lyr, setStyle: () => {}, setOpacity: () => {}, bindTooltip: () => lyr, getElement: () => null }; return lyr; },
  marker: () => { const lyr = { addTo: () => lyr, setOpacity: () => {}, bindTooltip: () => lyr, on: () => lyr, getElement: () => null }; return lyr; },
  divIcon: () => ({}),
};

const dom = {
  querySelector(sel) {
    if (sel === '#map-leaf') return mapLeaf;
    if (sel === '#map-route-btns') return { innerHTML: '', appendChild: () => {}, parentNode: { insertBefore: () => {} } };
    if (sel === '#timeline-scroll') return { innerHTML: '', appendChild: (n) => timelineCards.push(n), querySelector: () => null, addEventListener: () => {}, scrollLeft: 0, clientWidth: 1000, scrollWidth: 1000, scrollBy: () => {} };
    if (sel === '#era-strip') return { innerHTML: '', appendChild: () => {}, addEventListener: () => {}, scrollLeft: 0, clientWidth: 1000, scrollWidth: 1000, scrollBy: () => {} };
    if (sel === '#era-prev' || sel === '#era-next') return { disabled: false, onclick: null };
    if (sel === '#tl-prev' || sel === '#tl-next') return { disabled: false, onclick: null };
    if (sel === '#emperor-detail') return detailEl;
    if (sel === '#cases-list') return casesEl;
    if (sel === '#case-tabs') return caseTabsEl;
    if (sel === '#route-detail') return routeDetailEl;
    if (sel === '#detective-week') return container();
    if (sel === '#detective-clues') return container();
    if (sel === '#detective-create') return { innerHTML: '' };
    if (sel === '#ask-input') return { value: '' };
    if (sel === '#ask-btn') return { addEventListener: () => {} };
    if (sel === '#ask-result') return { innerHTML: '' };
    if (sel === '#create-input') return { value: '', classList: { add: () => {}, remove: () => {} } };
    if (sel === '#create-save') return { addEventListener: () => {} };
    if (sel === '#detective-next') return { addEventListener: () => {} };
    if (sel === '#create-msg') return { textContent: '', classList: { add: () => {}, remove: () => {} } };
    if (sel === '#map-popup') return { innerHTML: '', classList: { add: () => {}, remove: () => {} }, querySelector: () => ({ addEventListener: () => {} }), querySelectorAll: () => [] };
    if (sel === '#page-map') return { classList: { contains: () => true } };
    if (sel === '#page-cases') return { classList: { contains: () => true } };
    if (sel === '#shiguo-gantt') return { classList: { add: () => {}, remove: () => {} }, innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    if (sel === '#brand') return { textContent: '' };
    if (sel === '#legend-note') return { textContent: '' };
    if (sel === '#footer') return { textContent: '' };
    return null;
  },
  querySelectorAll(sel) { return []; },
  createElement: (tag) => ({
    className: '', dataset: {}, style: {}, textContent: '', innerHTML: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => true },
    addEventListener: () => {}, appendChild: () => {},
    querySelector: () => null, querySelectorAll: () => [],
  }),
  getElementById: () => null,
  body: { innerHTML: '' },
};

const context = {
  document: dom,
  window: { localStorage: { getItem: () => null, setItem: () => {} } },
  localStorage: { getItem: () => null, setItem: () => {} },
  L: LStub,
  fetch: async (path) => {
    // 单位映射：app.js 会给 URL 追加 ?_v= 缓存破坏参数，先剥离
    const cleanPath = path.split('?')[0];
    // 明朝在 data/ 根目录，其他朝在 data/<key>/ 下；按路径自动映射到磁盘文件
    const file = cleanPath.startsWith('../data/') ? cleanPath.replace('../data/', 'data/') : null;
    if (!file || !existsSync(file)) return { ok: false, status: 404 };
    const body = readFileSync(file, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  },
  console, URL, setTimeout, clearTimeout, Promise, requestAnimationFrame: (cb) => setTimeout(cb, 0), alert: (m) => console.log('alert:', m), module: { exports: {} }, exports: {},
};
vm.createContext(context);
vm.runInContext(searchSrc, context);
vm.runInContext(appSrc, context);

const deadline = Date.now() + 4000;
const waitLoop = setInterval(() => {
  const t = context.window.__mingTest;
  if ((t && t.DATA && t.DATA.emperors.length >= 5) || Date.now() > deadline) {
    clearInterval(waitLoop);
    if (!t || !t.DATA || !t.DATA.emperors.length) {
      console.log('❌ init 未完成');
      process.exit(1);
    }
    // 切到明朝（数据最全、地图功能主战场），再跑所有断言
    t.switchDynasty('ming').then(() => {
      const fail = runChecks(t);
      console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
      process.exit(fail ? 1 : 0);
    }).catch((e) => {
      console.log(`❌ switchDynasty('ming') 失败: ${e.message}`);
      process.exit(1);
    });
  }
}, 50);

function runChecks(t) {
  let fail = 0;
  const checks = [
    ['时间线卡片 ≥16', timelineCards.length >= 16, `实际 ${timelineCards.length}`],
    ['历史侦探线索动态生成（≥2 条检索线索）', clueCards.length >= 2, `实际 ${clueCards.length}`],
  ];
  for (const [name, ok, extra] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' ' + extra}`);
    if (!ok) fail++;
  }
  // —— 地图数据层（buildMapData）——
  try {
    const md = t.buildMapData();
    const c1 = ['疆域有形状', md.shape && (md.shape.type === 'geojson' || md.shape.type === 'polygon'), ''];
    const c2 = ['疆域说明含「疆域」', (md.shape && md.shape.label || '').replace(/\s/g, '').includes('疆域'), ''];
    const c3 = ['城市点 ≥15', md.places.length >= 15, `实际 ${md.places.length}`];
    const c4 = ['事件点数据正常（全朝 43 个地名）', md.events.length >= 40, `实际 ${md.events.length}`];
    const c5 = ['路线 ≥6（含郑和拆分）', md.routes.length >= 6, `实际 ${md.routes.length}`];
    const c6 = ['郑和航线数据存在', Boolean(md.zhenghe), ''];
    const c7 = ['有黄河/长江', md.rivers && md.rivers.huanghe.length > 0 && md.rivers.changjiang.length > 0, ''];
    const c8 = ['明朝有长城', md.wall && md.wall.length >= 8, ''];
    const c9 = ['明朝有省名标签', md.provinces.length >= 10, `实际 ${md.provinces.length}`];
    for (const [name, ok, extra] of [c1, c2, c3, c4, c5, c6, c7, c8, c9]) {
      console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' ' + extra}`);
      if (!ok) fail++;
    }
  } catch (e) {
    console.log(`❌ buildMapData 抛错: ${e.message}`);
    fail++;
  }
  // —— 皇帝详情页 ——
  try {
    t.showEmperor(t.DATA.emperors[2]);
    const html = detailEl.innerHTML;
    const timelineBeforeButtons = html.indexOf('生平时间线') >= 0 &&
      html.indexOf('生平时间线') < (html.indexOf('entry-chip') >= 0 ? html.indexOf('entry-chip') : Infinity);
    console.log(`${timelineBeforeButtons ? '✅' : '❌'} 生平时间线在三个按钮之前`);
    if (!timelineBeforeButtons) fail++;
  } catch (e) {
    console.log(`❌ 皇帝详情页渲染抛错: ${e.message}`);
    fail++;
  }
  // —— 案件卡 ——
  try {
    t.renderCases();
    const casesHtml = casesEl.innerHTML;
    const cases = t.DATA.cases || [];
    const cats = t.DATA.caseCategories || [];
    const checks2 = [
      ['案件库加载 ≥8 件', cases.length >= 8, `实际 ${cases.length}`],
      ['案件分类 ≥3 类', cats.length >= 3, `实际 ${cats.length}`],
      ['案件卡渲染含「名字的由来」', casesHtml.includes('名字的由来'), ''],
      ['案件卡渲染含「背景」', casesHtml.includes('背景'), ''],
      ['案件卡渲染含「关键人物」', casesHtml.includes('关键人物'), ''],
      ['案件卡渲染含「经过」', casesHtml.includes('经过'), ''],
      ['案件卡渲染含「结果」', casesHtml.includes('结果'), ''],
      ['案件卡渲染含「影响」', casesHtml.includes('影响'), ''],
      ['顶部分类 tab 已渲染', caseTabsEl.innerHTML.includes('case-tab'), ''],
      ['默认显示第一个分类的案件', cats[0] ? casesHtml.includes(cases.filter((c) => c.category === cats[0].id)[0]?.name || '@@none@@') : false, cats[0] ? '' : '无分类'],
      ['未平铺：其他分类案件不在当前视图', cats[1] ? !casesHtml.includes(cases.filter((c) => c.category === cats[1].id)[0]?.name || '@@none@@') : true, ''],
    ];
    for (const [name, ok, extra] of checks2) {
      console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' ' + extra}`);
      if (!ok) fail++;
    }
  } catch (e) {
    console.log(`❌ 案件卡渲染抛错: ${e.message}`);
    fail++;
  }
  // —— 检索 ——
  const hits = t.SEARCH ? t.SEARCH.search('郑和下西洋') : [];
  const searchOk = Array.isArray(hits) && hits.length > 0;
  console.log(`${searchOk ? '✅' : '❌'} SEARCH 检索"郑和下西洋"命中 ${searchOk ? hits.length : 0} 条`);
  if (!searchOk) fail++;
  const caseHits = t.SEARCH ? t.SEARCH.search('蓝玉案') : [];
  const caseSearchOk = Array.isArray(caseHits) && caseHits.length > 0;
  console.log(`${caseSearchOk ? '✅' : '❌'} SEARCH 检索"蓝玉案"命中案件 ${caseSearchOk ? caseHits.length : 0} 条`);
  if (!caseSearchOk) fail++;
  return fail;
}