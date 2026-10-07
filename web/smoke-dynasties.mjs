// 验证：五朝地图数据层各自正确（buildMapData 不抛错、疆域形状合理、事件/路线/城市按数据存在）
// ming/tang/yuan/qing 有 geojson → shape.type==='geojson'；song 无 → polygon 回退。
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
  querySelectorAll: () => [], appendChild: () => {}, scrollIntoView: () => {},
};
const container = () => ({ innerHTML: '', appendChild: (n) => { if (n.className === 'clue-card') clueCards.push(n); } });
const LStub = {
  map: () => ({ setView: () => {}, removeLayer: () => {}, invalidateSize: () => {}, hasLayer: () => false, getCenter: () => ({ lat: 0, lng: 0 }), getZoom: () => 4, flyTo: () => {}, stop: () => {}, off: () => {}, on: () => {} }),
  tileLayer: () => ({ addTo: () => ({}), on: () => {} }),
  geoJSON: (geo, opts) => {
    if (opts && opts.onEachFeature && geo && geo.features) {
      geo.features.forEach((f) => {
        const fl = { getBounds: () => ({ getCenter: () => ({ lng: 110, lat: 35 }) }), on: () => fl };
        opts.onEachFeature(f, fl);
      });
    }
    const lyr = { addTo: () => lyr, getBounds: () => ({ getCenter: () => ({ lng: 110, lat: 35 }) }) };
    return lyr;
  },
  polygon: () => { const lyr = { addTo: () => lyr, getBounds: () => ({ getCenter: () => ({ lng: 110, lat: 35 }) }) }; return lyr; },
  polyline: () => { const lyr = { addTo: () => lyr, setStyle: () => {}, _path: { getTotalLength: () => 100, style: {}, getBoundingClientRect: () => ({}) } }; return lyr; },
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
  alert: (m) => console.log('alert:', m),
  fetch: async (path) => {
    // 剥离 app.js 追加的 ?_v= 缓存破坏参数
    const cleanPath = path.split('?')[0];
    const file = cleanPath.startsWith('../data/') ? cleanPath.replace('../data/', 'data/') : null;
    if (!file || !existsSync(file)) return { ok: false, status: 404 };
    const body = readFileSync(file, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  },
  console, URL, setTimeout, clearTimeout, Promise, requestAnimationFrame: (cb) => setTimeout(cb, 0), module: { exports: {} }, exports: {},
};
vm.createContext(context);
vm.runInContext(searchSrc, context);
vm.runInContext(appSrc, context);

// 各朝真实 geojson 注入 MAP_GEO（读盘文件）
const geoFor = (d) => {
  const f = `data/boundaries/${d}.geojson`;
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

const deadline = Date.now() + 4000;
const waitLoop = setInterval(() => {
  const t = context.window.__mingTest;
  if ((t && t.DATA && t.DATA.emperors.length >= 5) || Date.now() > deadline) {
    clearInterval(waitLoop);
    if (!t || !t.DATA || !t.DATA.emperors.length) {
      console.log('❌ init 未完成');
      process.exit(1);
    }
    (async () => {
      let fail = 0;
      const expectGeo = { ming: true, tang: true, song: false, yuan: true, qing: true, sui: false, wudai: false };
      // 各朝 polygon 轮廓坐标应不同（隋/五代应有自己的形状，而非明朝回退）
      const shapeSig = {};
      for (const d of ['ming', 'tang', 'song', 'sui', 'wudai']) {
        try {
          await t.switchDynasty(d);
          vm.runInContext(`MAP_GEO = { '${d}': ${JSON.stringify(geoFor(d))} }`, context);
          const md = t.buildMapData();
          if (md.shape.type === 'polygon') shapeSig[d] = md.shape.points.length + ':' + md.shape.points.join(',');
        } catch (e) {
          console.log(`❌ [${d}] 取轮廓签名失败: ${e.message}`);
          process.exit(1);
        }
      }
      const distinctShapes = new Set(Object.values(shapeSig)).size;
      const okShapes1 = distinctShapes >= 3;
      console.log(`${okShapes1 ? '✅' : '❌'} 明朝/宋/隋/五代轮廓各不相同（实际 ${distinctShapes} 种）`);
      if (!okShapes1) fail++;
      for (const d of ['ming', 'tang', 'song', 'yuan', 'qing', 'sui', 'wudai']) {
        try {
          await t.switchDynasty(d);
          const g = geoFor(d);
          vm.runInContext('MAP_GEO = ' + JSON.stringify({ [d]: g }), context);
          const md = t.buildMapData();
          const type = md.shape.type;
          const okShape = expectGeo[d] ? type === 'geojson' : type === 'polygon';
          console.log(`${okShape ? '✅' : '❌'} [${d}] 疆域类型 ${type}（期望 ${expectGeo[d] ? 'geojson' : 'polygon 回退'}）`);
          if (!okShape) fail++;
          const okEv = Array.isArray(md.events);
          console.log(`${okEv ? '✅' : '❌'} [${d}] events 数组（${md.events.length}）`);
          if (!okEv) fail++;
          const okRt = Array.isArray(md.routes);
          console.log(`${okRt ? '✅' : '❌'} [${d}] routes 数组（${md.routes.length}）`);
          if (!okRt) fail++;
          const okPl = Array.isArray(md.places);
          console.log(`${okPl ? '✅' : '❌'} [${d}] places 数组（${md.places.length}）`);
          if (!okPl) fail++;
          try { t.renderMap(); } catch (e) { console.log(`❌ [${d}] renderMap 抛错: ${e.message}`); fail++; }
        } catch (e) {
          console.log(`❌ [${d}] 切换失败: ${e.message}`);
          fail++;
        }
      }
      console.log(fail === 0 ? '\n七朝地图数据层全部通过' : `\n${fail} 项失败`);
      process.exit(fail ? 1 : 0);
    })();
  }
}, 50);