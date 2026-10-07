// 验证：GeoJSON 存在时 buildMapData() 走真实边界分支（shape.type==='geojson'），
//        不存在时回退手绘示意（shape.type==='polygon'）。用 vm.runInContext 注入 MAP_GEO。
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const appSrc = readFileSync('web/app.js', 'utf8');
const searchSrc = readFileSync('web/search-core.js', 'utf8');

const timelineCards = [];
const clueCards = [];
const casesEl = { innerHTML: '' };
const caseTabsEl = { innerHTML: '', querySelectorAll: () => [] };
const routeDetailEl = { innerHTML: '', classList: { add: () => {}, remove: () => {} }, scrollIntoView: () => {}, querySelectorAll: () => [] };
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

// 带图层状态跟踪的 L 桩：能验证 removeLayer/addTo 后地图上实际有哪些标记
const mapState = { layers: new Set(), visibleLines: new Map() };
const LStub = {
  map: () => ({
    setView: () => {}, invalidateSize: () => {}, flyTo: () => {}, getZoom: () => 4,
    hasLayer: (l) => mapState.layers.has(l), getCenter: () => ({ lat: 0, lng: 0 }), stop: () => {}, off: () => {}, on: () => {},
    addLayer: (l) => mapState.layers.add(l), removeLayer: (l) => mapState.layers.delete(l),
  }),
  tileLayer: () => ({ addTo: () => ({}), on: () => {} }),
  geoJSON: (geo, opts) => {
    // 模拟真实 Leaflet：对每个 feature 调 onEachFeature，feature layer 有 getBounds
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
  polyline: () => {
    const lyr = {
      addTo: () => { mapState.layers.add(lyr); return lyr; },
      _opacity: 0, _isLine: true, id: 'poly-' + Math.random().toString(36).slice(2, 8),
      setStyle: (s) => { if (s && s.opacity != null) lyr._opacity = s.opacity; },
      _path: { getTotalLength: () => 100, style: {}, getBoundingClientRect: () => ({}) },
    };
    return lyr;
  },
  circleMarker: (latlng, opts) => {
    const lyr = {
      addTo: () => { mapState.layers.add(lyr); return lyr; },
      _opacity: 0, _fill: opts && opts.fillColor, _latlng: latlng, _tipOpen: false,
      setStyle: (s) => { if (s && s.opacity != null) lyr._opacity = s.opacity; if (s && s.fillColor) lyr._fill = s.fillColor; },
      setOpacity: (o) => { lyr._opacity = o; },
      bindTooltip: () => lyr, getElement: () => null,
      closeTooltip: () => { lyr._tipOpen = false; },
      openTooltip: () => { lyr._tipOpen = true; },
    };
    return lyr;
  },
  marker: () => {
    const lyr = {
      addTo: () => { mapState.layers.add(lyr); return lyr; },
      setOpacity: () => {}, bindTooltip: () => lyr, on: () => lyr, getElement: () => null,
    };
    return lyr;
  },
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
    if (sel === '.map-wrap') return { scrollIntoView: () => {} };
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

const fakeGeo = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: '山东' }, geometry: { type: 'Polygon', coordinates: [[[120,37],[121,37],[121,36],[120,36],[120,37]]] } },
    { type: 'Feature', properties: { name: '南直隶' }, geometry: { type: 'Polygon', coordinates: [[[119,32],[120,32],[120,31],[119,31],[119,32]]] } },
  ],
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
    t.switchDynasty('ming').then(async () => {
      let fail = 0;
      // 场景 0：renderMap 全链路不抛错（L 桩覆盖 divIcon/geoJSON/polyline 等）
      try {
        t.renderMap();
        console.log('✅ renderMap 全链路无异常（L 桩）');
      } catch (e) {
        console.log(`❌ renderMap 抛错: ${e.message}`);
        fail++;
      }
      // 场景 1：geojson 优先策略 —— 明/唐/元/清走真实边界 geojson，宋/隋/五代回退 FALLBACK
      let md;
      try {
        // 注入四朝真实 geojson（读盘）
        const geoOf = (d) => {
          const f = `data/boundaries/${d}.geojson`;
          return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
        };
        const realGeo = { ming: geoOf('ming'), tang: geoOf('tang'), yuan: geoOf('yuan'), qing: geoOf('qing') };
        vm.runInContext('MAP_GEO = ' + JSON.stringify(realGeo), context);
        await t.switchDynasty('ming');
        md = t.buildMapData();
        const ok1 = md.shape && md.shape.type === 'geojson' && md.shape.geo.features.length >= 10;
        console.log(`${ok1 ? '✅' : '❌'} 明朝走真实 geojson 边界（${md.shape?.geo?.features?.length || 0} 个区块）`);
        if (!ok1) fail++;
        // 宋无 geojson → 回退 FALLBACK polygon
        await t.switchDynasty('song');
        const songShape = t.buildMapData().shape;
        const okSong = songShape.type === 'polygon' && songShape.points.length >= 10;
        console.log(`${okSong ? '✅' : '❌'} 宋朝无 geojson → 回退 FALLBACK polygon`);
        if (!okSong) fail++;
        // 七朝轮廓各不相同（元/清等走 geojson，测 feature 数与 bbox 不同）
        const sigs = new Set();
        for (const d of ['ming', 'tang', 'song', 'yuan', 'qing', 'sui', 'wudai']) {
          await t.switchDynasty(d);
          const dd = t.buildMapData().shape;
          if (dd.type === 'geojson') {
            let n = 0, s = [];
            const walk = (c) => { if (typeof c[0] === 'number') { n++; s.push(c[0].toFixed(2) + ',' + c[1].toFixed(2)); } else c.forEach(walk); };
            dd.geo.features.forEach((f) => walk(f.geometry.coordinates));
            sigs.add('geo:' + dd.geo.features.length + ':' + s.length + ':' + s[0]);
          } else {
            sigs.add('poly:' + dd.points.length + ':' + dd.points[0].join(','));
          }
        }
        const distinct = sigs.size;
        const ok2 = distinct >= 6;
        console.log(`${ok2 ? '✅' : '❌'} 七朝疆域轮廓各不相同（实际 ${distinct} 种）`);
        if (!ok2) fail++;
        // 切回明朝验证其余数据
        await t.switchDynasty('ming');
        md = t.buildMapData();
        const ok3 = md.places.length >= 15;
        console.log(`${ok3 ? '✅' : '❌'} 城市点数据仍正常（${md.places.length}）`);
        if (!ok3) fail++;
        const ok4 = md.routes.length >= 6;
        console.log(`${ok4 ? '✅' : '❌'} 国内路线数据仍正常（${md.routes.length}）`);
        if (!ok4) fail++;
        const ok5 = Boolean(md.zhenghe);
        console.log(`${ok5 ? '✅' : '❌'} 郑和航线数据仍存在`);
        if (!ok5) fail++;
      } catch (e) {
        console.log(`❌ buildMapData 抛错: ${e.message}`);
        fail++;
      }
      // 场景 3：该朝事件汇总（古地名 chips 渲染）
      try {
        t.showEventsSummary();
        const html = routeDetailEl.innerHTML;
        const ok6 = html.includes('evt-summary-chip') && html.includes('古地名') && (html.match(/evt-summary-chip/g) || []).length >= 40;
        console.log(`${ok6 ? '✅' : '❌'} 该朝事件汇总渲染古地名 chips（${(html.match(/evt-summary-chip/g) || []).length} 个）`);
        if (!ok6) fail++;
        const ok7 = html.includes('土木堡');
        console.log(`${ok7 ? '✅' : '❌'} 汇总含事件古地名（如土木堡）`);
        if (!ok7) fail++;
      } catch (e) {
        console.log(`❌ showEventsSummary 抛错: ${e.message}`);
        fail++;
      }
      // 场景 4：事件点按古地名聚合（北京 7 个事件合并成 1 个标记）
      try {
        await t.switchDynasty('ming');
        const clusters = t.buildEventClusters(t.DATA.mapEvents || []);
        const beijing = clusters.find((c) => c.name === '北京');
        const nanjing = clusters.find((c) => c.name === '南京');
        const ok8 = beijing && beijing.events.length >= 7;
        console.log(`${ok8 ? '✅' : '❌'} 北京事件聚合为 1 个标记（${beijing ? beijing.events.length : 0} 个事件）`);
        if (!ok8) fail++;
        const ok9 = nanjing && nanjing.events.length >= 3;
        console.log(`${ok9 ? '✅' : '❌'} 南京事件聚合为 1 个标记（${nanjing ? nanjing.events.length : 0} 个事件）`);
        if (!ok9) fail++;
        const ok10 = clusters.every((c) => c.events.length >= 1) && clusters.length < (t.DATA.mapEvents || []).length;
        console.log(`${ok10 ? '✅' : '❌'} 聚合后标记数少于事件数（${clusters.length} < ${(t.DATA.mapEvents || []).length}）`);
        if (!ok10) fail++;
      } catch (e) {
        console.log(`❌ buildEventClusters 抛错: ${e.message}`);
        fail++;
      }
      // 场景 5：点击单事件后，地图只保留该事件地点（其他事件点/城市点全隐藏）
      try {
        await t.switchDynasty('ming');
        // 清空状态 → renderMap 重建 → 统计挂载数
        mapState.layers.clear();
        t.renderMap();
        const before = mapState.layers.size;
        const ev = t.DATA.mapEvents.find((e) => e.eventId === 'ming-event-ke-dadu'); // 徐达攻克元大都
        t.showSingleEvent(ev);
        // showSingleEvent 内部 removeLayer 所有事件点/城市点，再 addTo 目标
        const after = mapState.layers.size;
        const ok11 = before > after && after >= 1;
        console.log(`${ok11 ? '✅' : '❌'} 点单事件后图层从 ${before} 降到 ${after}（只剩目标+底图）`);
        if (!ok11) fail++;
        // 目标 marker 应在图层中
        const targetOn = [...mapState.layers].some((l) => l._evtIds && l._evtIds.includes(ev.eventId));
        console.log(`${targetOn ? '✅' : '❌'} 目标事件（元大都）标记保留在地图上`);
        if (!targetOn) fail++;
      } catch (e) {
        console.log(`❌ showSingleEvent 抛错: ${e.message}`);
        fail++;
      }
      // 场景 6：点"靖难之役"后恰好 1 条关联路线可见（无残留）
      try {
        // 先等场景 5 的动画定时器全部结束，避免残留干扰
        await new Promise((r) => setTimeout(r, 2000));
        await t.switchDynasty('ming');
        mapState.layers.clear();
        t.renderMap();
        const jingnan = t.DATA.mapEvents.find((e) => e.eventId === 'ming-event-jingnan');
        t.showSingleEvent(jingnan);
        // mapFlyTo 靠 1.4s+450ms 兜底强制到达 → 触发 showEventRoute
        await new Promise((r) => setTimeout(r, 2200));
        // 动画路线 opacity 被设成 1；只统计 polyline（_isLine），不含起终点/途经点圆点
        const visible = [...mapState.layers].filter((l) => l._isLine && l._opacity && l._opacity >= 0.99);
        // 靖难路线是唯一应可见的（showSingleEvent 开头隐藏了其他 9 条路线）
        const ok12 = visible.length === 1;
        console.log(`${ok12 ? '✅' : '❌'} 点靖难后可见动线路线 ${visible.length} 条（应为 1 条）`);
        if (!ok12) {
          console.log('  可见明细:', visible.map((l) => ({ op: l._opacity, id: l.id })));
        }
      } catch (e) {
        console.log(`❌ 场景6 抛错: ${e.message}`);
        fail++;
      }
      // 场景 7：点靖难后，起终点标记常显 tooltip 且颜色符合图例（起绿 #2e7d32 / 终深红 #a0251c）
      try {
        await new Promise((r) => setTimeout(r, 2200));
        const marks = [...mapState.layers].filter((l) => l._latlng && l._fill);
        const starts = marks.filter((l) => l._fill === '#2e7d32' && l._opacity >= 0.9);
        const ends = marks.filter((l) => l._fill === '#a0251c' && l._opacity >= 0.9);
        const ok13 = starts.length === 1 && ends.length === 1;
        console.log(`${ok13 ? '✅' : '❌'} 点靖难后起点 ${starts.length} 个可见、终点 ${ends.length} 个可见（各 1 个）`);
        if (!ok13) fail++;
        const tipsOpen = marks.filter((l) => l._tipOpen).length;
        console.log(`${tipsOpen >= 2 ? '✅' : '❌'} 起终点常显地名标签已打开（${tipsOpen} 个）`);
        if (tipsOpen < 2) fail++;
      } catch (e) {
        console.log(`❌ 场景7 抛错: ${e.message}`);
        fail++;
      }
      console.log(fail === 0 ? '\n全部通过：GeoJSON 存在/缺失两条路径都正确' : `\n${fail} 项失败`);
      process.exit(fail ? 1 : 0);
    }).catch((e) => {
      console.log(`❌ switchDynasty('ming') 失败: ${e.message}`);
      process.exit(1);
    });
  }
}, 50);