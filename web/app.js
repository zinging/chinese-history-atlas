/* 中国历史图谱 · 交互层逻辑
   消费知识层 data/ 数据：emperors / people / events / places / routes
   纯原生 JS，零依赖。示意地图非精确边界。 */

'use strict';

// 数据文件构建号：追加到 fetch URL 末尾，避免浏览器缓存旧的 JSON（尤其是新增文件前的 404）
const APP_BUILD = '20261006b';

// ---------- 工具 ----------
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** 转义 HTML 特殊字符（渲染外部/AI 文本时用，防注入） */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 渲染 AI 回复：先转义防注入，再把换行转成 <br>，保证段落可读 */
function formatReply(s) {
  return escapeHtml(s).replace(/\r?\n/g, '<br>');
}

async function loadJSON(path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${path}${sep}_v=${APP_BUILD}`);
  if (!r.ok) throw new Error(`加载失败 ${path}: ${r.status}`);
  return r.json();
}

let DATA = null; // { emperors:[], people:[], events:[], places:[], routes:[] }
let activeEraId = null; // null = 全部朝代；否则为 emperor id
let currentDynasty = 'sui'; // 'ming' | 'song' | 'tang' | 'yuan' | 'qing' | 'sui' | 'wudai'
// 各朝数据缓存：切换朝代不重发请求（数据只读）
const DATA_CACHE = {};

// 把事件年份归到对应朝代
function eraForYear(yearStr) {
  const y = parseInt(String(yearStr).replace(/[^0-9]/g, ''), 10);
  if (!y || !DATA) return null;
  for (const e of DATA.emperors) {
    const s = parseInt(e.reign.start, 10);
    const en = parseInt(e.reign.end, 10);
    if (y >= s && y <= en) return e.id;
  }
  // 年份超出所有皇帝在位范围：归到边界皇帝
  // 建立前（如 1363 鄱阳湖之战）→ 第一帝（太祖）；灭亡后（如 1645 南明）→ 末帝（思宗）
  const first = DATA.emperors[0];
  const last = DATA.emperors[DATA.emperors.length - 1];
  if (first) {
    const fs = parseInt(first.reign.start, 10);
    if (y < fs) return first.id;
  }
  if (last) {
    const le = parseInt(last.reign.end, 10);
    if (y > le) return last.id;
  }
  return null;
}

function renderEraStrip() {
  const strip = $('#era-strip');
  if (!strip) return;
  strip.innerHTML = '';
  const centerTo = (btn) => {
    // 被点击的年号自动滚到视口中央
    const target = btn.offsetLeft - (strip.clientWidth - btn.offsetWidth) / 2;
    const max = strip.scrollWidth - strip.clientWidth;
    strip.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: 'smooth' });
  };
  const allBtn = el('button', 'era-btn' + (activeEraId ? '' : ' active'));
  const range = DYNASTY_RANGE[currentDynasty] || '1368-1644';
  allBtn.innerHTML = `<span class="era-name">全部</span><span class="era-years">${range}</span>`;
  allBtn.addEventListener('click', () => {
    activeEraId = null; renderEraStrip(); renderMap(); renderEraInfo();
    showEventsSummary(); // 保持「该朝事件」汇总展开（默认视图）
    centerTo(document.querySelector('#era-strip .era-btn'));
  });
  strip.appendChild(allBtn);
  DATA.emperors.forEach((e) => {
    const btn = el('button', 'era-btn' + (activeEraId === e.id ? ' active' : ''));
    btn.innerHTML = `<span class="era-name">${e.eraName[0]}</span><span class="era-years">${e.reign.start}-${e.reign.end}</span>`;
    btn.addEventListener('click', () => {
      activeEraId = (activeEraId === e.id ? null : e.id);
      renderEraStrip(); renderMap(); renderEraInfo();
      showEventsSummary(); // 保持「该朝事件」汇总展开（默认视图）
      centerTo(document.querySelector(`#era-strip .era-btn${activeEraId ? '.active' : ''}`));
    });
    strip.appendChild(btn);
  });
  // 年号条左右箭头
  const prev = $('#era-prev'), next = $('#era-next');
  if (prev && next) {
    const step = 120;
    prev.onclick = () => strip.scrollBy({ left: -step, behavior: 'smooth' });
    next.onclick = () => strip.scrollBy({ left: step, behavior: 'smooth' });
    const update = () => {
      prev.disabled = strip.scrollLeft <= 2;
      next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
    };
    strip.addEventListener('scroll', update);
    update();
    enableDragScroll(strip);
  }
}

function currentEraEmperor() {
  if (!activeEraId) return null;
  return DATA.emperors.find((e) => e.id === activeEraId) || null;
}

function eventsForEra(eraId) {
  if (!eraId) return DATA.mapEvents || [];
  return (DATA.mapEvents || []).filter((ev) => eraForYear(ev.date) === eraId);
}

function renderEraInfo() {
  const box = $('#era-info');
  if (!box) return;
  const emp = currentEraEmperor();
  if (!emp) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const evs = eventsForEra(emp.id);
  const people = (emp.people || []).map((p) => p.name).join('、') || '—';
  box.classList.remove('hidden');
  box.innerHTML = `
    <h4>${emp.eraName[0]}年间 · ${emp.name}（${emp.templeName}） ${emp.reign.start}-${emp.reign.end}</h4>
    <div class="era-row"><b>核心人物：</b>${people}</div>
    <div class="era-row"><b>地图上的事件：</b>${evs.length ? evs.map((ev) => `<span class="era-event-chip" data-ev="${ev.eventId}">${ev.date} ${ev.name}</span>`).join('') : '（这个时代没有标记在地图上的事件）'}</div>
  `;
  box.querySelectorAll('.era-event-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      box.querySelectorAll('.era-event-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const ev = (DATA.mapEvents || []).find((e) => e.eventId === chip.dataset.ev);
      if (ev) {
        // 胶囊点击：清场只留该事件地点 + 关联路线 + 定位（不放大）
        showSingleEvent(ev, { zoom: false });
        document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
}

// ---------- 网络请求数据 ----------
// 各朝数据目录配置：目录路径、是否有地图数据（places/routes/mapEvents）、年代范围
const DYNASTY_DIRS = {
  ming: '',
  tang: 'tang/',
  song: 'song/',
  yuan: 'yuan/',
  qing: 'qing/',
  sui: 'sui/',
  wudai: 'wudai/',
};
const DYNASTY_HAS_MAP = { ming: true, tang: true, song: true, yuan: true, qing: true, sui: true, wudai: true };
const DYNASTY_RANGE = { ming: '1368-1644', tang: '618-907', song: '960-1279', yuan: '1271-1368', qing: '1616-1912', sui: '581-618', wudai: '907-960' };
// 各朝文件布局：明朝各库在 data/ 根目录下分目录，其他朝在朝代目录内
const DYNASTY_LAYOUT = {
  ming: { people: 'people/people.json', cases: 'cases/cases.json', events: 'events/events.json', mapEvents: 'events/map-events.json', places: 'places/places.json', routes: 'routes/routes.json' },
  tang: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  song: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  yuan: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  qing: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  sui: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  wudai: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
};
// 各朝文案：品牌名、时间线标题、地图标题、地图 aria、图例注、页脚
const DYNASTY_TEXT = {
  ming: {
    brand: '🏮 明朝', timelineTitle: '从 1368 到 1644 · 十六位明朝皇帝', mapAria: '明朝示意地图',
    legendNote: '省界据《中国历史地图集·明时期》手绘简化示意',
    footer: '疆域轮廓据《明史·地理志》示意，非精确边界 · 皇帝画像为 AI 生成工笔风格，仅供示意 · 内容以《明史》《明实录》为主要依据',
  },
  tang: {
    brand: '🏮 大唐风华', timelineTitle: '从 618 到 907 · 大唐二十一帝', mapAria: '唐朝示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·唐时期》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》唐时期示意，非精确边界 · 内容以《旧唐书》《新唐书》《资治通鉴》为主要依据',
  },
  song: {
    brand: '🏮 大宋风云', timelineTitle: '从 960 到 1279 · 两宋十八帝', mapAria: '宋朝示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·北宋/南宋》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》两宋部分示意，非精确边界 · 人物头像为示意占位 · 内容以《宋史》《续资治通鉴长编》为主要依据',
  },
  yuan: {
    brand: '🏮 大元兴起', timelineTitle: '从 1271 到 1368 · 大元十一帝', mapAria: '明朝示意地图',
    legendNote: '省界据《中国历史地图集·元时期》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》元时期示意，非精确边界 · 内容以《元史》《新元史》为主要依据',
  },
  qing: {
    brand: '🏮 大清三百年', timelineTitle: '从 1616 到 1912 · 大清十二帝', mapAria: '清朝示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·清时期》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》清时期示意，非精确边界 · 内容以《清史稿》《清实录》为主要依据',
  },
  sui: {
    brand: '🏮 大隋一统', timelineTitle: '从 581 到 618 · 隋朝三帝', mapAria: '隋朝示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·隋时期》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》隋时期示意，非精确边界 · 内容以《隋书》《资治通鉴》为主要依据',
  },
  wudai: {
    brand: '🏮 五代十国', timelineTitle: '从 907 到 960 · 五代中原王朝横条', mapAria: '五代十国示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·五代十国时期》手绘简化示意',
    footer: '五代十国是唐末到宋初的大分裂时期 · 内容以《新五代史》《资治通鉴》为主要依据',
  },
};

async function loadAll() {
  const dir = DYNASTY_DIRS[currentDynasty] || '';
  const hasMap = DYNASTY_HAS_MAP[currentDynasty] || false;
  const lay = DYNASTY_LAYOUT[currentDynasty] || DYNASTY_LAYOUT.ming;
  const p = (rel) => `../data/${dir}${rel}`;

  // 可选文件（地图相关、制度、出处）缺失时容错为空，不阻断整个朝代加载
  const maybe = (path) => loadJSON(path).catch(() => null);

  // 已加载过的朝代缓存：切回不再重发请求（数据只读，切换朝代不修改）
  if (DATA_CACHE[currentDynasty]) {
    DATA = DATA_CACHE[currentDynasty];
    if (typeof SEARCH !== 'undefined') SEARCH.setData(DATA);
    return;
  }

  const urls = [
    loadJSON(p('emperors/index.json')),
    loadJSON(p(lay.events)),
    loadJSON(p(lay.people)),
    loadJSON(p(lay.cases)),
  ];
  if (hasMap) urls.push(maybe(p(lay.places)), maybe(p(lay.routes)), maybe(p(lay.mapEvents)));
  if (currentDynasty === 'ming') urls.push(maybe(p('institutions/institutions.json')), maybe(p('sources/sources.json')));
  const quizPath = currentDynasty === 'ming' ? 'quiz/quiz.json' : 'quiz.json';
  const quizDoc = await maybe(p(quizPath));

  const [empIdx, events, people, casesDoc, places, routes, mapEventsDoc, institutions, sourcesDoc] = await Promise.all(urls);

  // 逐皇帝读条目（并发，替代原串行）
  const emperors = await Promise.all(empIdx.emperors.map((e) => loadJSON(p(`emperors/${e.file}`))));
  DATA = {
    emperors,
    people: people.people || [],
    events: events.events || [],
    places: (places && places.places) || [],
    routes: (routes && routes.routes) || [],
    institutions: (institutions && institutions.institutions) || [],
    sourcesDoc: sourcesDoc || { sources: [] },
    mapEvents: (mapEventsDoc && mapEventsDoc.events) || [],
    cases: casesDoc.cases || [],
    caseCategories: casesDoc.categories || [],
    quiz: (quizDoc && quizDoc.quiz) || [],
  };
  DATA_CACHE[currentDynasty] = DATA;
  // 喂给检索模块（历史侦探/追问框用）
  if (typeof SEARCH !== 'undefined') SEARCH.setData(DATA);
}

// ---------- 界面切换 ----------
function switchPage(name) {
  for (const p of ['timeline', 'cases', 'map', 'detective']) {
    const page = document.getElementById(`page-${p}`);
    const tab = document.querySelector(`.tab[data-page="${p}"]`);
    if (!page) continue;
    const on = p === name;
    page.classList.toggle('hidden', !on);
    if (tab) tab.classList.toggle('active', on);
  }
  if (name === 'map') {
    renderEraStrip(); renderEraInfo(); renderMap();
    // 首次进入地图页：默认点开「该朝事件」（展开事件古地名汇总面板）
    showEventsSummary();
    // 地图容器从隐藏变为可见，让 Leaflet 重新计算尺寸
    if (leafletMap) setTimeout(() => leafletMap.invalidateSize(), 60);
  }
  if (name === 'cases') renderCases();
  if (name !== 'map') hideRouteDetail();
}

// ---------- 界面二：案件卡（按分类 tab 切换） ----------
let activeCaseCat = null;

function renderCases() {
  const wrap = $('#cases-list');
  const tabsEl = $('#case-tabs');
  if (!wrap) return;
  const cases = DATA.cases || [];
  if (!cases.length) { wrap.innerHTML = '<p>案件库还没建好，先看别处吧。</p>'; return; }
  const cats = DATA.caseCategories || [];
  if (!activeCaseCat || !cats.some((c) => c.id === activeCaseCat)) activeCaseCat = cats[0]?.id || null;

  // 顶部分类 tab
  if (tabsEl) {
    tabsEl.innerHTML = cats.map((cat) => {
      const n = cases.filter((c) => c.category === cat.id).length;
      return `<button class="case-tab${cat.id === activeCaseCat ? ' active' : ''}" data-cat="${cat.id}">${cat.name}<span class="case-tab-n">${n}</span></button>`;
    }).join('');
    tabsEl.querySelectorAll('.case-tab').forEach((b) => {
      b.addEventListener('click', () => {
        activeCaseCat = b.dataset.cat;
        renderCases();
      });
    });
  }

  const cat = cats.find((c) => c.id === activeCaseCat);
  if (!cat) { wrap.innerHTML = '<p>没有可显示的分类。</p>'; return; }
  const list = cases.filter((c) => c.category === cat.id).sort((a, b) => a.date.localeCompare(b.date));
  wrap.innerHTML = `
    <section class="case-category">
      <p class="case-cat-note">${cat.note || ''}</p>
      ${list.map(caseCard).join('')}
    </section>`;
}

function caseCard(c) {
  const people = (c.people || []).map((p) =>
    `<div class="case-person"><b>${p.name}</b><span class="case-person-role">${p.role}</span><div class="case-person-note">${p.note}</div></div>`).join('');
  const questions = (c.openQuestions || []).map((q) => `
    <div class="case-question">
      <div class="q">❓ ${q.question}</div>
      <div class="ctx">${q.context || ''}</div>
      <div class="viewpoints">${(q.viewpoints || []).map((v) => `<p>• ${v}</p>`).join('')}</div>
    </div>`).join('');
  return `
    <article class="case-card">
      <div class="case-head">
        <div class="case-title">${c.name}</div>
        <div class="case-date">${c.date}年</div>
      </div>
      <div class="case-summary">${c.summary}</div>
      <div class="case-section">
        <b>名字的由来</b>
        <p>${c.nameOrigin}</p>
      </div>
      <div class="case-section">
        <b>背景</b>
        <p>${c.background}</p>
      </div>
      <div class="case-section">
        <b>关键人物</b>
        <div class="case-people">${people}</div>
      </div>
      <div class="case-section">
        <b>经过</b>
        <p>${c.process}</p>
      </div>
      <div class="case-section">
        <b>结果</b>
        <p>${c.result}</p>
      </div>
      <div class="case-section">
        <b>影响</b>
        <p>${c.impact}</p>
      </div>
      <div class="case-section">
        <b>想一想</b>
        ${questions || '<p>（暂无开放讨论题）</p>'}
      </div>
      <div class="case-src">出处：${(c.sources || []).map(sourceTitle).join('、')}</div>
    </article>`;
}

function sourceTitle(id) {
  const s = (DATA.sourcesDoc?.sources || []).find((x) => x.id === id);
  return s ? s.title : id;
}

// ---------- 界面一：时间线 ----------
function renderTimeline() {
  const wrap = $('#timeline-scroll');
  wrap.innerHTML = '';
  const emojis = ['👑','🧧','🏯','📜','⚔️','🐉','🛡️','🎨','🪷','🐎','🔮','🕊️','🏛️','🏮','🔨','🌙'];
  DATA.emperors.forEach((e, i) => {
    const card = el('div', 'emp-card');
    // 横向卡片条头像数量少、体积小，直接加载（懒加载在横向滚动容器里对最右侧卡片不触发）
    const lazy = ' decoding="async"';
    const portrait = e.portrait
      ? `<img class="emp-portrait" src="../data/portraits/${e.portrait}" alt="${e.name}" ${lazy}/>`
      : `<div class="emp-portrait">${emojis[i % emojis.length]}</div>`;
    card.innerHTML = `
      ${portrait}
      <div class="name">${e.name}</div>
      <div class="era">${e.templeName} · ${e.eraName[0]}${e.eraName.length > 1 ? '等' + e.eraName.length + '个年号' : ''}</div>
      <div class="reign">${e.reign.start} - ${e.reign.end}</div>`;
    card.addEventListener('click', () => {
      document.querySelectorAll('.emp-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      // 被点击的卡片自动滚到视口中央，详情在正下方展开
      const target = card.offsetLeft - (wrap.clientWidth - card.offsetWidth) / 2;
      const max = wrap.scrollWidth - wrap.clientWidth;
      wrap.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: 'smooth' });
      showEmperor(e);
    });
    wrap.appendChild(card);
  });
  // 箭头翻页：一次滚一张卡宽度
  const prev = $('#tl-prev'), next = $('#tl-next');
  const step = () => {
    const card = wrap.querySelector('.emp-card');
    return card ? card.offsetWidth + 14 : 200;
  };
  const updateArrows = () => {
    prev.disabled = wrap.scrollLeft <= 2;
    next.disabled = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2;
  };
  prev.onclick = () => { wrap.scrollBy({ left: -step(), behavior: 'smooth' }); };
  next.onclick = () => { wrap.scrollBy({ left: step(), behavior: 'smooth' }); };
  wrap.addEventListener('scroll', updateArrows);
  updateArrows();
  // 拖拽滚动：按住左右拖动
  enableDragScroll(wrap);
  // 五代十国：渲染十国甘特图
  renderShiguoGantt();
}

// 十国数据（史实：存续年、都城、历任君主序列）
const SHIGUO = [
  { name: '前蜀', start: 907, end: 925, capital: '成都', founder: '王建', fall: '后唐庄宗李存勖所灭', color: 'tang-internal',
    kings: [['王建', 907, 918], ['王衍', 918, 925]] },
  { name: '后蜀', start: 934, end: 965, capital: '成都', founder: '孟知祥', fall: '北宋太祖赵匡胤所灭', color: 'song',
    kings: [['孟知祥', 934, 934], ['孟昶', 934, 965]] },
  { name: '吴', start: 902, end: 937, capital: '广陵（今扬州）', founder: '杨行密', fall: '被南唐禅代', color: 'tang-internal',
    kings: [['杨行密', 902, 905], ['杨渥', 905, 908], ['杨隆演', 908, 920], ['杨溥', 920, 937]] },
  { name: '南唐', start: 937, end: 975, capital: '金陵（今南京）', founder: '李昪', fall: '北宋太祖赵匡胤所灭', color: 'song',
    kings: [['李昪', 937, 943], ['李璟', 943, 961], ['李煜', 961, 975]] },
  { name: '吴越', start: 907, end: 978, capital: '杭州', founder: '钱镠', fall: '钱俶纳土归宋', color: 'song',
    kings: [['钱镠', 907, 932], ['钱元瓘', 932, 941], ['钱弘佐', 941, 947], ['钱弘倧', 947, 948], ['钱俶', 948, 978]] },
  { name: '闽', start: 909, end: 945, capital: '长乐（今福州）', founder: '王审知', fall: '南唐所灭', color: 'tang-internal',
    kings: [['王审知', 909, 925], ['王延翰', 925, 926], ['王延钧', 926, 935], ['王继鹏', 935, 939], ['王延羲', 939, 944]] },
  { name: '南汉', start: 917, end: 971, capital: '番禺（今广州）', founder: '刘岩', fall: '北宋太祖赵匡胤所灭', color: 'song',
    kings: [['刘岩', 917, 942], ['刘玢', 942, 943], ['刘晟', 943, 958], ['刘鋹', 958, 971]] },
  { name: '南平（荆南）', start: 924, end: 963, capital: '江陵（今荆州）', founder: '高季兴', fall: '北宋太祖赵匡胤所灭', color: 'song',
    kings: [['高季兴', 924, 929], ['高从诲', 929, 948], ['高保融', 948, 960], ['高保勖', 960, 962], ['高继冲', 962, 963]] },
  { name: '楚', start: 907, end: 951, capital: '长沙', founder: '马殷', fall: '南唐所灭', color: 'tang-internal',
    kings: [['马殷', 907, 930], ['马希声', 930, 932], ['马希范', 932, 947], ['马希广', 947, 950], ['马希萼', 950, 951]] },
  { name: '北汉', start: 951, end: 979, capital: '太原', founder: '刘崇', fall: '北宋太宗赵光义所灭', color: 'song',
    kings: [['刘崇', 951, 954], ['刘承钧', 954, 968], ['刘继恩', 968, 968], ['刘继元', 968, 979]] },
];

function renderShiguoGantt() {
  const box = $('#shiguo-gantt');
  if (!box) return;
  if (currentDynasty !== 'wudai') { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const T0 = 902, T1 = 979;
  const span = T1 - T0;
  const ticks = [907, 923, 936, 947, 951, 960, 979];
  const pct = (y) => ((y - T0) / span) * 100;
  // 每个国家一行，行内按历任君主切块；同年即位（如孟知祥934/孟昶934）共用一根柱子
  const bars = SHIGUO.map((g) => {
    const kings = g.kings || [];
    // 先按"起始年"合并同年君主为一根柱子（名字用 · 连写，跨度取较长者）
    const cols = [];
    for (const k of kings) {
      const last = cols[cols.length - 1];
      if (last && last.start === k[1]) {
        last.names.push(k[0]);
        last.end = Math.max(last.end, k[2]);
        last.notes.push(`${k[0]}（${k[1]}-${k[2]}）`);
      } else {
        cols.push({ start: k[1], end: k[2], names: [k[0]], notes: [`${k[0]}（${k[1]}-${k[2]}）`] });
      }
    }
    const segs = cols.map((c, ci) => {
      // 宽度保持真实年份比例（与横坐标对齐），不人为拉宽
      const left = pct(c.start);
      const width = Math.max(0, pct(c.end) - pct(c.start));
      const label = c.names.join('·');
      const tip = `${c.notes.join(' · ')} · ${g.name}`;
      return `<div class="gantt-king ${g.color} ${ci % 2 ? 'alt' : ''}" data-king="${label}" style="left:${left}%;width:${width}%" title="${tip}">
        <span class="gantt-king-name">${label}</span>
      </div>`;
    }).join('');
    const label = `<div class="gantt-label">
      <b>${g.name}</b>
      <span class="gantt-label-years">${g.start}-${g.end}</span>
    </div>`;
    return `<div class="gantt-row">
      ${label}
      <div class="gantt-track">${segs}</div>
    </div>`;
  }).join('');
  const axisTicks = ticks.map((t) => `<div class="tick" style="left:${pct(t)}%">${t}</div>`).join('');
  box.innerHTML = `
    <h3>🏯 十国并立图 · 历代君主时间线（与五代同时存在）</h3>
    <div class="gantt-axis">${axisTicks}</div>
    ${bars}
    <div class="gantt-legend">
      <span><i class="sw" style="background:#6b8e6b"></i>被五代内部吞并</span>
      <span><i class="sw" style="background:#c8553d"></i>被北宋所灭</span>
      <span><i class="sw" style="background:#fff;border:1px solid #c9a96a"></i>点按块看君主在位年</span>
    </div>
    <div class="gantt-note">💡 吴越最长（钱镠祖孙三代，978年纳土归宋）；北汉唯一在北方（太原）；前蜀被后唐庄宗李存勖所灭。</div>
  `;
  // hover 已用 title 提示，无需额外绑定
  box.classList.remove('hidden');
}

function enableDragScroll(el) {
  let isDown = false, startX = 0, startScroll = 0, moved = false;
  el.addEventListener('mousedown', (e) => {
    isDown = true; moved = false;
    startX = e.pageX; startScroll = el.scrollLeft;
    el.style.cursor = 'grabbing';
  });
  el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = ''; });
  el.addEventListener('mouseup', () => { isDown = false; el.style.cursor = ''; });
  el.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const dx = e.pageX - startX;
    if (Math.abs(dx) > 4) moved = true;
    el.scrollLeft = startScroll - dx;
  });
  // 阻止拖拽时误触卡片点击
  el.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
}

const PERSON_PORTRAITS = {
  // 皇帝互相关联（直接用帝后像）
  '英宗（朱祁镇）': 'yingzong.jpg',
  '朱瞻基': 'xuanzong.jpg',
  '李世民': 'tang-taizong.jpg',
  '武曌': 'tang-wu.jpg',
  // 人物像
  '马皇后': 'mahuang.jpg',
  '徐达': 'xuda.jpg',
  '刘基': 'liuji.jpg',
  '姚广孝': 'yaoguangxiao.jpg',
  '郑和': 'zhenghe.jpg',
  '于谦': 'yuqian.jpg',
  '戚继光': 'qijiguang.jpg',
  '张居正': 'zhangjuzheng.jpg',
  '徐阶': 'xujie.jpg',
  '王守仁（王阳明）': 'wangyangming.jpg',
  '魏忠贤': 'weizhongxian.jpg',
  '袁崇焕': 'yuanchengchong.jpg',
  '李自成': 'lizicheng.jpg',
  '皇太极': 'huangtaiji.jpg',
  // 第二批
  '朱标': 'zhubiao.jpg',
  '王振': 'wangzhen.jpg',
  '也先': 'yexian.jpg',
  '方孝孺': 'fangxiaoru.jpg',
  '严嵩': 'yansong.jpg',
  '海瑞': 'hairui.jpg',
  '刘瑾': 'liujin.jpg',
  '万贵妃': 'wanguifei.jpg',
  '张皇后': 'zhanghuanghou.jpg',
  '郑贵妃': 'zhengguifei.jpg',
  '朱高煦': 'zhugaoxu.jpg',
  '客氏': 'kashi.jpg',
  '汪直': 'wangzhi.jpg',
  '高拱': 'gaogong.jpg',
  '解缙': 'xiejin.jpg',
  '李选侍': 'lixuanshi.jpg',
  // 宋朝人物像
  '赵普': 'zhaopu.jpg', '杨业': 'yangye.jpg', '寇准': 'kouzhun.jpg',
  '石守信': 'shishouxin.jpg',
  '范仲淹': 'fanzhongyan.jpg', '包拯': 'baozheng.jpg', '王安石': 'wanganshi.jpg',
  '司马光': 'simaguang.jpg', '苏轼': 'sushi.jpg', '欧阳修': 'ou-yangxiu.jpg',
  '蔡京': 'caijing.jpg', '秦桧': 'qinhui.jpg', '岳飞': 'yuefei.jpg',
  '韩世忠': 'hanshizhong.jpg', '朱熹': 'zhuxi.jpg', '文天祥': 'wentianxiang.jpg',
  '陆秀夫': 'luxufu.jpg', '张世杰': 'zhangshijie.jpg', '贾似道': 'jiasidao.jpg',
  '李纲': 'ligang.jpg', '辛弃疾': 'xinqiji.jpg',
  // 唐朝人物像
  '魏征': 'weizheng.jpg', '房玄龄': 'fangxuanling.jpg', '杜如晦': 'duruhui.jpg',
  '狄仁杰': 'direnjie.jpg', '姚崇': 'yaochong.jpg', '宋璟': 'songjing.jpg',
  '杨玉环': 'yangguifei.jpg', '杨贵妃': 'yangguifei.jpg',
  '安禄山': 'anshan.jpg', '郭子仪': 'guoziyi.jpg', '李光弼': 'liguangbi.jpg',
  '李愬': 'likuo.jpg', '黄巢': 'huangchao.jpg',
  '玄奘': 'xuanzhuang.jpg', '杜甫': 'dufu.jpg', '李白': 'libai.jpg',
  // 唐朝次要人物像
  '裴寂': 'peiji.jpg', '长孙无忌': 'changsunwuji.jpg',
  '太平公主': 'taipinggongzhu.jpg', '来俊臣': 'laijunchen.jpg',
  '杨炎': 'yangyan.jpg', '李德裕': 'lideyu.jpg', '裴度': 'peidu.jpg',
  '杨国忠': 'yangguozhong.jpg', '田令孜': 'tianlingzi.jpg',
  '令狐绹': 'linghuta.jpg', '韦后': 'weihou.jpg', '韦皇后': 'weihou.jpg',
  '长孙皇后': 'zhangsunhuanghou.jpg',
  '李靖': 'lijing.jpg', '李勣': 'liji.jpg', '李林甫': 'lilinfu.jpg',
  '扩廓帖木儿': 'kuokuotiemuer.jpg', '王保保': 'kuokuotiemuer.jpg',
  // 元朝人物像
  '刘秉忠': 'liubingzhong.jpg', '伯颜': 'boyan.jpg', '脱脱': 'tuotuo.jpg', '马可·波罗': 'makeluo.jpg', '马可波罗': 'makeluo.jpg',
  '真金': 'zhenjin.jpg', '阔阔真': 'kuokuozhen.jpg', '完泽': 'wanze.jpg',
  '李孟': 'limeng.jpg', '拜住': 'baizhu.jpg', '铁失': 'tieshi.jpg',
  '脱虎脱': 'tuohtuo.jpg', '倒剌沙': 'daolasha.jpg',
  '燕帖木儿': 'yantiemuer.jpg', '和世㻋': 'yuan-mingzong.jpg', '虞集': 'yuji.jpg',
  '哈麻': 'hama.jpg', '奇皇后': 'qihuanghou.jpg', '爱猷识理答腊': 'ayushidilala.jpg',
  // 清朝人物像
  '多尔衮': 'duoergun.jpg', '孝庄太后': 'xiaozhuang.jpg', '鳌拜': 'aobai.jpg', '代善': 'daishan.jpg',
  '阿巴亥': 'abahai.jpg', '洪承畴': 'hongchengchou.jpg', '济尔哈朗': 'jihaolang.jpg', '索额图': 'suoetu.jpg',
  '施琅': 'shilang.jpg', '吴三桂': 'wusangui.jpg', '年羹尧': 'niangengyao.jpg', '隆科多': 'longkeduo.jpg',
  '张廷玉': 'zhangtingyu.jpg', '田文镜': 'tianwenjing.jpg', '和珅': 'hezhen.jpg', '刘统勋': 'liutongxun.jpg',
  '纪昀': 'jiyun.jpg', '阿桂': 'agui.jpg', '傅恒': 'fuheng.jpg', '孝贤纯皇后': 'xiaoxian.jpg',
  '王杰': 'wangjie.jpg', '林则徐': 'linzexu.jpg', '琦善': 'qishan.jpg', '肃顺': 'sushun.jpg',
  '恭亲王奕䜣': 'yixin.jpg', '奕䜣': 'yixin.jpg', '慈安太后': 'cian.jpg', '慈禧太后': 'cixi.jpg',
  '曾国藩': 'zengguofan.jpg', '李鸿章': 'lihongzhang.jpg', '翁同龢': 'wengtonghe.jpg',
  '康有为': 'kangyouwei.jpg', '袁世凯': 'yuanshikai.jpg', '载沣': 'zaifeng.jpg', '隆裕太后': 'longyu.jpg',
  '庄妃': 'xiaozhuang.jpg',
  // 隋朝人物像
  '独孤皇后': 'sui-dugu.jpg', '高颎': 'sui-gaojiong.jpg', '杨素': 'sui-yangsu.jpg',
  '苏威': 'sui-suwei.jpg', '宇文化及': 'sui-yuhuaji.jpg', '李密': 'sui-limi.jpg',
  '萧皇后': 'sui-xiao.jpg', '韩擒虎': 'sui-hanqinhu.jpg', '贺若弼': 'sui-heruobi.jpg',
  '宇文恺': 'sui-yuwenkai.jpg', '杨玄感': 'sui-yangxuangan.jpg', '窦建德': 'sui-doujiande.jpg',
  // 五代人物像
  '李煜': 'wudai-liyu.jpg', '钱镠': 'wudai-qianliu.jpg', '孟昶': 'wudai-mengchang.jpg',
  '赵普': 'wudai-zhaopu.jpg',
  '李克用': 'wudai-licunxu.jpg', '刘知远': 'wudai-liuzhiyuan.jpg',
  '石敬瑭': 'wudai-shijingtang.jpg', '柴荣': 'wudai-chairong.jpg',
  '郭威': 'wudai-guowei.jpg', '赵匡胤': 'song-taizu.jpg',
  '李渊': 'tang-gaozu.jpg', '爱育黎拔力八达': 'yuan-renzong.jpg',
  '桑维翰': 'wudai-sangweihan.jpg', '郭崇韬': 'wudai-guochongtao.jpg', '王朴': 'wudai-wangpu.jpg',
  '张惠': 'wudai-zhanghui.jpg', '李振': 'wudai-lizhen.jpg', '朱友珪': 'wudai-zhuyougui.jpg',
  '刘皇后': 'wudai-liuhuanghou.jpg', '耶律德光': 'wudai-yelvdeguang.jpg',
  '景延广': 'wudai-jingyanguang.jpg', '苏逢吉': 'wudai-sufengji.jpg',
  '史弘肇': 'wudai-shihongzhao.jpg', '柴皇后': 'wudai-chaihuanghou.jpg',
  '符皇后': 'wudai-fuhuanghou.jpg', '柴宗训': 'wudai-chaizongxun.jpg',
};

const PERSON_TITLES = {
  '徐达': '中山王·大将军', '刘基': '诚意伯·御史中丞', '马皇后': '孝慈高皇后', '朱标': '懿文太子',
  '姚广孝': '太子少师', '郑和': '三宝太监·航海家', '解缙': '内阁首辅·永乐大典总裁',
  '齐泰': '兵部尚书', '黄子澄': '太常寺卿', '方孝孺': '文学博士·大儒',
  '朱高煦': '汉王', '杨士奇、杨荣、杨溥（三杨）': '内阁三杨',
  '于谦': '兵部尚书', '王振': '司礼监太监', '也先': '瓦剌太师',
  '万贵妃': '皇贵妃', '汪直': '西厂提督太监',
  '商辂': '内阁首辅', '李东阳、谢迁': '内阁大学士',
  '王守仁（王阳明）': '新建伯·哲学家', '刘瑾': '司礼监掌印太监',
  '张皇后': '孝康敬皇后',
  '严嵩': '内阁首辅·大学士', '徐阶': '内阁首辅', '高拱': '内阁首辅',
  '戚继光': '蓟州总兵·抗倭名将', '海瑞': '南京右都御史',
  '张居正': '内阁首辅·改革家', '郑贵妃': '皇贵妃',
  '魏忠贤': '司礼监秉笔太监·九千岁', '客氏': '奉圣夫人',
  '李选侍': '李康妃', '袁崇焕': '蓟辽督师',
  '李自成': '闯王·大顺皇帝', '张献忠': '大西皇帝',
  '努尔哈赤': '后金天命汗', '皇太极': '清太宗',
  '吴三桂': '平西王',
  // 宋朝人物官位
  '赵普': '宰相·半部论语治天下', '杨业': '云州观察使·杨令公', '寇准': '宰相',
  '石守信': '侍卫亲军都指挥使·杯酒释兵权',
  '范仲淹': '参知政事·先天下之忧而忧', '包拯': '开封府尹·包青天',
  '王安石': '同平章事·熙宁变法', '司马光': '宰相·资治通鉴主编',
  '苏轼': '翰林学士·苏东坡', '欧阳修': '翰林学士·北宋文坛领袖',
  '蔡京': '宰相·六贼之首', '秦桧': '宰相·主和派',
  '岳飞': '枢密副使·岳王爷', '韩世忠': '宣抚使·抗金名将',
  '朱熹': '理学家·紫阳先生', '文天祥': '右丞相·正气歌作者',
  '陆秀夫': '丞相·负帝投海', '张世杰': '枢密副使·抗元统帅',
  '贾似道': '平章军国事·蟋蟀宰相', '李纲': '尚书右丞·东京保卫战',
  '辛弃疾': '安抚使·爱国词人',
  // 唐朝人物官位
  '李世民': '秦王·唐太宗', '武曌': '则天大圣皇帝',
  '魏征': '侍中·谏议大夫', '房玄龄': '尚书左仆射·梁国公', '杜如晦': '尚书右仆射·莱国公',
  '狄仁杰': '同凤阁鸾台平章事·梁国公', '姚崇': '兵部尚书·梁国公',
  '宋璟': '吏部尚书·刑部尚书',
  '杨玉环': '贵妃', '杨贵妃': '贵妃',
  '安禄山': '范阳节度使·东平郡王', '郭子仪': '太尉·汾阳郡王',
  '李光弼': '河东节度使·临淮郡王', '李愬': '唐邓节度使·凉国公',
  '黄巢': '冲天大将军·大齐皇帝',
  '玄奘': '三藏法师·大慈恩寺上座', '杜甫': '检校工部员外郎·诗圣',
  '李白': '翰林待诏·诗仙',
  // 唐朝次要人物官位
  '裴寂': '尚书左仆射·魏国公', '长孙无忌': '太尉·赵国公',
  '太平公主': '镇国太平公主', '来俊臣': '御史中丞·酷吏',
  '杨炎': '门下侍郎·同平章事·两税法推行者',
  '李德裕': '太尉·卫国公·会昌中兴主相',
  '裴度': '中书令·晋国公·平淮西主师',
  '杨国忠': '右相·文部尚书',
  '田令孜': '神策军中尉·左十军',
  '令狐绹': '尚书左仆射·凉国公',
  '韦后': '皇后·想学武则天', '韦皇后': '皇后·想学武则天',
  // 元朝人物官位
  '刘秉忠': '太保·参领中书省事·大都城规划者',
  '伯颜': '中书右丞相·灭宋统帅',
  '脱脱': '中书右丞相·修宋辽金三史',
  '马可·波罗': '威尼斯旅行家·在元十七年',
  '马可波罗': '威尼斯旅行家·在元十七年',
  '真金': '皇太子·忽必烈嫡子',
  '阔阔真': '裕圣皇后·铁穆耳生母',
  '完泽': '中书右丞相·成宗朝贤相',
  '李孟': '平章政事·仁宗潜邸旧臣',
  '拜住': '中书左丞相·英宗锐革助手',
  '铁失': '御史大夫·南坡弑主者',
  '脱虎脱': '尚书省左丞相·武宗朝滥发钞币',
  '倒剌沙': '中书左丞相·泰定帝幸臣',
  '燕帖木儿': '中书右丞相·文宗朝权臣',
  '和世㻋': '明宗·武宗长子',
  '虞集': '奎章阁侍书学士·元诗文大家',
  '哈麻': '中书右丞相·谗杀脱脱者',
  '奇皇后': '肃良合皇后·高丽人·顺帝后',
  '爱猷识理答腊': '皇太子·北元昭宗',
  // 清朝人物官位
  '多尔衮': '摄政王·和硕睿亲王',
  '孝庄太后': '孝庄文皇后·太皇太后',
  '鳌拜': '辅政大臣·一等公',
  '代善': '礼亲王·大贝勒',
  '阿巴亥': '大妃·努尔哈赤第四任大福晋',
  '洪承畴': '秘书院大学士·经略西南',
  '济尔哈朗': '郑亲王·辅政叔王',
  '索额图': '保和殿大学士·签订尼布楚条约',
  '施琅': '福建水师提督·靖海侯',
  '吴三桂': '平西王',
  '年羹尧': '抚远大将军·一等公',
  '隆科多': '步军统领·一等公',
  '张廷玉': '保和殿大学士·配享太庙',
  '田文镜': '河南山东总督·雍正三大模范督抚之一',
  '和珅': '领班军机大臣·一等忠襄公',
  '刘统勋': '东阁大学士·首席军机大臣',
  '纪昀': '礼部尚书·四库全书总纂官',
  '阿桂': '武英殿大学士·一等诚谋英勇公',
  '傅恒': '保和殿大学士·一等忠勇公',
  '孝贤纯皇后': '乾隆帝元后·富察氏',
  '王杰': '东阁大学士·嘉庆帝师',
  '林则徐': '钦差大臣·两广总督',
  '琦善': '文渊阁大学士·直隶总督',
  '肃顺': '协办大学士·户部尚书',
  '恭亲王奕䜣': '议政王·领班军机大臣',
  '奕䜣': '议政王·领班军机大臣',
  '慈安太后': '孝贞显皇后·东太后',
  '慈禧太后': '孝钦显皇后·西太后',
  '曾国藩': '两江总督·一等毅勇侯',
  '李鸿章': '直隶总督·北洋大臣·一等肃毅伯',
  '翁同龢': '户部尚书·光绪帝师',
  '康有为': '工部主事·戊戌变法主将',
  '袁世凯': '北洋大臣·内阁总理大臣',
  '载沣': '监国摄政王',
  '隆裕太后': '隆裕皇太后·下退位诏书者',
  '庄妃': '永福宫庄妃·即孝庄太后',
  // 隋朝人物官位
  '独孤皇后': '文献皇后·二圣之一',
  '高颎': '尚书左仆射·渤海郡公·开皇第一名相',
  '杨素': '尚书右仆射·越国公·楚公',
  '苏威': '纳言·宰相·隋律修订者',
  '韩擒虎': '庐州总管·上柱国·灭陈先锋',
  '贺若弼': '吴州总管·上柱国·灭陈东路统帅',
  '宇文恺': '将作大匠·工部尚书·大兴城/洛阳规划者',
  '宇文化及': '右屯卫将军·许帝·弑炀帝者',
  '杨玄感': '礼部尚书·楚公·黎阳起兵',
  '李密': '魏公·瓦岗军首领',
  '窦建德': '夏王·河北义军首领',
  '萧皇后': '愍皇后·后梁明帝之女',
  // 五代人物官位
  '李煜': '南唐后主·词中之帝',
  '钱镠': '吴越王·钱氏海塘修筑者',
  '孟昶': '后蜀后主·春联发明者之一',
  '赵普': '枢密使·半部论语治天下',
  '李克用': '晋王·五代前导者',
  '刘知远': '后汉高祖',
  '石敬瑭': '后晋高祖·儿皇帝',
  '柴荣': '后周世宗·五代第一明君',
  '桑维翰': '后晋枢密使·草割燕云降表者',
  '郭崇韬': '后唐侍中·灭前蜀统帅',
  '王朴': '后周枢密副使·《平边策》作者',
  '张惠': '后梁元贞皇后·朱温贤内助',
  '李振': '后梁崇政院使·白马驿之祸主谋',
  '朱友珪': '后梁郢王·弑父篡位者',
  '刘皇后': '后唐神闵敬皇后·吝啬亡国者',
  '耶律德光': '辽太宗·获燕云十六州者',
  '景延广': '后晋侍卫亲军都指挥使·对辽强硬派',
  '苏逢吉': '后梁宰相·酷法执政',
  '史弘肇': '后汉侍卫亲军都指挥使·酷将',
  '柴皇后': '后周圣穆皇后·郭威发妻·柴荣姑母',
};

function personPortrait(name) {
  const f = PERSON_PORTRAITS[name];
  if (!f) return null;
  // 皇帝互相关联的像在 portraits/ 根目录，其他人在 portraits/people/
  if (['英宗（朱祁镇）','朱瞻基','李世民','武曌','郭威','柴荣','李渊','爱育黎拔力八达','赵匡胤','和世㻋'].includes(name)) {
    return `../data/portraits/${f}`;
  }
  return `../data/portraits/people/${f}`;
}

function renderRelGraph(e) {
  const people = e.people || [];
  if (!people.length) return '';
  // 左右布局：皇帝在左，人物在右竖排，描述文字给足宽度
  const W = 960;
  const rowH = 110;
  const H = Math.max(320, people.length * rowH + 60);
  const cx = 110, cy = H / 2;
  const px = 440;
  const nodes = people.map((p, i) => {
    const y = 60 + i * rowH + rowH / 2;
    return { p, y, x: px };
  });
  const lines = nodes.map((nd) => `
    <line x1="${cx+60}" y1="${cy}" x2="${nd.x-42}" y2="${nd.y}" stroke="#c9a96a" stroke-width="2" stroke-dasharray="5 4" opacity="0.7" />
  `).join('');
  const relLabels = nodes.map((nd) => {
    const mx = (cx + 60 + nd.x - 42) / 2, my = (cy + nd.y) / 2;
    const rel = nd.p.relation || nd.p.role || '';
    return `<rect x="${mx-42}" y="${my-13}" width="84" height="24" rx="12" fill="#fff7e0" stroke="#c9a96a" />
      <text x="${mx}" y="${my+5}" text-anchor="middle" font-size="13" fill="#8a6d3b" font-weight="700">${rel}</text>`;
  }).join('');
  // 描述文字按宽度自动换行（SVG text 不会自动折行，手动拆 tspan）
  const wrapNote = (text) => {
    if (!text) return '';
    const maxPerLine = 38; // 12px 字号下 SVG 宽度 960，节点 x=440，可用宽度约 470px
    const lines = [];
    let s = text;
    while (s.length > maxPerLine) {
      // 优先在标点处断
      let cut = maxPerLine;
      for (let i = maxPerLine; i >= maxPerLine - 8; i--) {
        if (/[，。；、]/.test(s[i])) { cut = i + 1; break; }
      }
      lines.push(s.slice(0, cut));
      s = s.slice(cut);
    }
    if (s) lines.push(s);
    return lines.map((ln, i) =>
      `<text x="50" y="${14 + i * 14}" font-size="12" fill="#8a7a5c">${ln}</text>`
    ).join('');
  };
  const dots = nodes.map((nd) => {
    const portrait = personPortrait(nd.p.name);
    const img = portrait
      ? `<image x="-36" y="-36" width="72" height="72" href="${portrait}" clip-path="circle(36px)" preserveAspectRatio="xMidYMid slice" loading="lazy" />`
      : `<text x="0" y="12" text-anchor="middle" font-size="26">👤</text>`;
    const title = PERSON_TITLES[nd.p.name] ? ` · ${PERSON_TITLES[nd.p.name]}` : '';
    return `<g transform="translate(${nd.x},${nd.y})">
      <circle r="38" fill="#fff" stroke="#c9a96a" stroke-width="2.5" />
      ${img}
      <text x="50" y="-6" text-anchor="start" font-size="15" font-weight="700" fill="#3a2e1f">${nd.p.name}<tspan font-size="12" font-weight="400" fill="#888">${title}</tspan></text>
      ${wrapNote(nd.p.note || '')}
    </g>`;
  }).join('');
  const centerImg = e.portrait
    ? `<image x="-60" y="-60" width="120" height="120" href="../data/portraits/${e.portrait}" clip-path="circle(60px)" preserveAspectRatio="xMidYMid slice" />`
    : `<text x="0" y="20" text-anchor="middle" font-size="36">👑</text>`;
  const center = `
    <g transform="translate(${cx},${cy})">
      <circle r="70" fill="#fff7e0" stroke="#c9a96a" stroke-width="4" />
      ${centerImg}
      <text x="0" y="92" text-anchor="middle" font-size="17" font-weight="800" fill="#8a4b1f">${e.name}</text>
    </g>`;
  return `<div class="detail-panel">
    <h4 style="font-size:18px">🕸️ ${e.name}的人物关系</h4>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:960px" role="img" aria-label="${e.name}人物关系图">
      ${lines}${relLabels}${center}${dots}
    </svg>
  </div>`;
}

function showEmperor(e) {
  const d = $('#emperor-detail');
  d.classList.remove('hidden');
  currentEmperorKey = e.id || e.name;
  // 关键人物只列人名（官位在下方人物关系图中展示）
  const people = (e.people || []).map((p) => p.name).join('、');
  const intro = e.intro || e.summary || '';
  const timeline = e.timeline || (e.majorEvents ? e.majorEvents.map((m) => ({ date: '', title: m, description: '' })) : []);
  const chips = [
    { cls: 'chip-facts', label: '趣味冷知识', panel: renderFacts(e.funFacts) },
    { cls: 'chip-open', label: '争议话题', panel: renderOpen(e.controversies) },
    { cls: 'chip-make', label: '史论工坊', panel: renderWorkshop(e) },
  ];
  d.innerHTML = `
    <div class="detail-head">
      ${e.portrait
        ? `<img class="detail-portrait" src="../data/portraits/${e.portrait}" alt="${e.name}" />`
        : `<div class="detail-portrait">👑</div>`}
      <div class="meta">
        <h3 style="color:#c0392b;font-size:26px">${e.name} <small style="color:#8a7a5c;font-size:16px;font-weight:normal">${e.templeName}</small></h3>
        <div class="intro">${intro}</div>
        <div class="tags"><b style="color:#333">年号</b> <span class="tag-val" title="${e.eraName.join('、')}">${e.eraName.join('、')}</span> · <b style="color:#333">在位</b> <span class="tag-val">${e.reign.start}-${e.reign.end}</span> · <b style="color:#333">关键人物</b>：<span class="tag-val">${people || '—'}</span></div>
      </div>
    </div>
    ${renderRelGraph(e)}
    <div class="detail-panel entry-block">
      <h4>📜 生平时间线</h4>
      <ul class="timeline-list">${timeline.map((t) => `
        <li><span class="t-date">${t.date || ''}</span> <span class="t-title">${t.title}</span>
        <div class="t-desc">${t.description || ''}</div></li>`).join('')}
      </ul>
    </div>`;
  // 三个入口与其内容面板作为一个整体，挂在时间线之后
  const block = el('div', 'entry-block');
  block.innerHTML = `
    <div class="entry-grid">
      ${chips.map((c, i) => `<button class="entry-chip ${c.cls}${i === 0 ? ' active' : ' dim'}" data-i="${i}">${c.label}</button>`).join('')}
    </div>
    <div class="detail-panel entry-panel">${chips[0].panel}</div>`;
  d.appendChild(block);
  block.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.entry-chip');
    if (!btn) return;
    const c = chips[Number(btn.dataset.i)];
    if (!c) return;
    block.querySelectorAll('.entry-chip').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.classList.toggle('dim', b !== btn);
    });
    const oldPanel = block.querySelector('.entry-panel');
    if (oldPanel) oldPanel.innerHTML = c.panel;
    hydrateEntryPanels(block);
  });

  wireWorkshop(block, e);
  hydrateEntryPanels(block);
  // 不再自动滚动到详情区，由用户自己看
}

function renderFacts(facts) {
  if (!facts || !facts.length) return '<p>（暂无）</p>';
  return `<ul class="fact-list">${facts.map((f) => `<li>💡 ${f.fact || f}</li>`).join('')}</ul>`;
}

function renderOpen(cs) {
  if (!cs || !cs.length) return '<p>想想看：如果你是这位皇帝，你会怎么做？</p>';
  return `<ul class="open-list">${cs.map((c, i) => {
    const vp = (c.viewpoints || []).join(' / ');
    const key = `deb-${currentDynasty}-${currentEmperorKey}-${i}`;
    return `
    <li class="debate-item" data-di="${i}" data-q="${escapeHtml(c.question || '')}" data-vp="${escapeHtml(vp)}">
      <div class="q">❓ ${c.question}</div>
      <div class="ctx">${c.context || ''}</div>
      <div class="viewpoints">${(c.viewpoints || []).map((v) => `<p>• ${v}</p>`).join('')}</div>
      <textarea class="deb-input" data-key="${key}" placeholder="你怎么看？写下你的理由（可以引用上面的视角或史实）…"></textarea>
      <button type="button" class="create-save llm-btn deb-ai" data-di="${i}">🤖 请 AI 老师点评我的理由</button>
      <div class="deb-result" data-di="${i}"></div>
    </li>`;
  }).join('')}</ul>`;
}

// ---------- 史论工坊：内置辩证选择题，点卡片作答，AI 只做点评 ----------
const QUIZ_LETTERS = ['A', 'B', 'C', 'D', 'E'];
// 两种模式的名称与说明（题目为项目内置，不交给 AI 现出）
const QUIZ_SPEC = {
  arg: {
    label: '论证判断',
    hint: '点卡片作答：考你哪个判断最有史实依据、哪条才是真证据、怎样有力回应反驳。答完可请 AI 老师点评。',
  },
  chain: {
    label: '因果链',
    hint: '点卡片作答：帮你分清深层起因、导火索、关键节点、直接结果和长远影响。答完可请 AI 老师点评。',
  },
};
function renderWorkshop(e) {
  const key = e.id || e.name;
  return `
  <div class="ws" data-emperor="${key}">
    <div class="ws-tabs">
      <button type="button" class="ws-tab active" data-mode="arg">${QUIZ_SPEC.arg.label}</button>
      <button type="button" class="ws-tab" data-mode="chain">${QUIZ_SPEC.chain.label}</button>
    </div>
    <div class="ws-pane" data-pane="arg"><p class="ws-hint">${QUIZ_SPEC.arg.hint}</p><div class="quiz-slot"></div></div>
    <div class="ws-pane hidden" data-pane="chain"><p class="ws-hint">${QUIZ_SPEC.chain.hint}</p><div class="quiz-slot"></div></div>
  </div>`;
}

// 从内置 DATA.quiz 取某皇帝、某模式的题目
function quizEntry(emperorKey) {
  return (DATA.quiz || []).find((x) => x.emperor === emperorKey) || null;
}
function quizItems(emperorKey, mode) {
  const entry = quizEntry(emperorKey);
  if (!entry) return [];
  return (entry.items || []).filter((it) => (it.mode || 'arg') === mode);
}
// 作答状态（只存选择与批改结果，题目本身在数据里）
function quizStateKey(emperorKey, mode) { return `quiz-${currentDynasty}-${emperorKey}-${mode}`; }
function loadQuizState(emperorKey, mode) {
  try { return JSON.parse(localStorage.getItem(quizStateKey(emperorKey, mode)) || 'null'); } catch { return null; }
}
function saveQuizState(emperorKey, mode, s) { localStorage.setItem(quizStateKey(emperorKey, mode), JSON.stringify(s)); }

function quizQuestionsHTML(items, st) {
  return items.map((item, qi) => {
    const picked = st.selected[qi];
    const opts = item.options.map((o, oi) => {
      let cls = 'qq-opt';
      if (st.graded) {
        if (o.ok) cls += ' correct';
        else if (oi === picked) cls += ' wrong';
      } else if (oi === picked) cls += ' picked';
      return `<button type="button" class="${cls}" data-qi="${qi}" data-oi="${oi}"${st.graded ? ' disabled' : ''}>
        <span class="qq-letter">${QUIZ_LETTERS[oi]}</span><span class="qq-text">${o.t || o}</span></button>`;
    }).join('');
    const pickedOk = picked != null && item.options[picked] && item.options[picked].ok;
    const goodLetters = item.options.map((o, i) => (o.ok ? QUIZ_LETTERS[i] : null)).filter(Boolean).join('、');
    const explain = st.graded
      ? `<div class="qq-explain ${pickedOk ? 'ok' : 'bad'}">${pickedOk ? '✔ 选得有依据' : '✘ 更有依据的是 ' + goodLetters} · ${item.why || ''}</div>`
      : (item.open ? '<div class="qq-open">此题偏开放，选项没有绝对对错，但有史实支撑强弱之分；提交后 AI 会具体点评。</div>' : '');
    return `<div class="qq">
      <div class="qq-q">${qi + 1}. ${item.q}</div>
      <div class="qq-opts">${opts}</div>
      ${explain}
    </div>`;
  }).join('');
}
// 渲染某模式槽位
function renderQuizSlot(ws, mode, emperorKey) {
  const slot = ws.querySelector(`.ws-pane[data-pane="${mode}"] .quiz-slot`);
  const items = quizItems(emperorKey, mode);
  if (!items.length) {
    slot.innerHTML = '<div class="ask-hint">这一部分的题目还在整理中，先看看其他标签或争议话题。</div>';
    return;
  }
  const st = loadQuizState(emperorKey, mode) || { selected: {}, graded: false };
  const answered = Object.keys(st.selected).length;
  const correct = st.graded
    ? items.filter((it, i) => { const p = st.selected[i]; return p != null && it.options[p] && it.options[p].ok; }).length
    : 0;
  const footer = st.graded
    ? `<div class="quiz-score">选对 ${correct} / ${items.length}</div>
       <button type="button" class="create-save llm-btn quiz-review" data-mode="${mode}">🤖 请 AI 老师点评</button>
       <button type="button" class="create-save llm-btn quiz-reset" data-mode="${mode}" style="background:#8a7a5c">🔄 重做</button>
       <div class="ws-result quiz-review-result"></div>`
    : `<div class="quiz-progress">已选 ${answered} / ${items.length}</div>
       <button type="button" class="create-save llm-btn quiz-submit" data-mode="${mode}">✅ 提交看答案</button>`;
  slot.innerHTML = quizQuestionsHTML(items, st) + footer;
}

// 面板重新注入后，恢复争议话题草稿并渲染选择题槽位
function hydrateEntryPanels(block) {
  block.querySelectorAll('.deb-input').forEach((ta) => {
    const v = localStorage.getItem(ta.dataset.key);
    if (v) ta.value = v;
  });
  const ws = block.querySelector('.ws');
  if (!ws) return;
  const emperorKey = ws.dataset.emperor;
  ['arg', 'chain'].forEach((mode) => renderQuizSlot(ws, mode, emperorKey));
}

let currentEmperorKey = '';
// 史论工坊（内置选择题）+ 争议话题的交互（事件委托，面板重注入后仍有效）
function wireWorkshop(block, e) {
  const label = DYNASTY_LABEL[currentDynasty] || '';
  const emperorKey = e.id || e.name;
  // 争议话题草稿自动保存
  block.addEventListener('input', (ev) => {
    const debInput = ev.target.closest('.deb-input');
    if (debInput) localStorage.setItem(debInput.dataset.key, debInput.value);
  });

  block.addEventListener('click', async (ev) => {
    // 工坊子标签切换
    const tab = ev.target.closest('.ws-tab');
    if (tab) {
      const ws = tab.closest('.ws');
      ws.querySelectorAll('.ws-tab').forEach((t) => t.classList.toggle('active', t === tab));
      ws.querySelectorAll('.ws-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab.dataset.mode));
      return;
    }
    const ws = block.querySelector('.ws');
    if (!ws) return;
    // 点选某个选项（未提交前可改）
    const opt = ev.target.closest('.qq-opt');
    if (opt && !opt.disabled) {
      const mode = opt.closest('.ws-pane').dataset.pane;
      const items = quizItems(emperorKey, mode);
      const st = loadQuizState(emperorKey, mode) || { selected: {}, graded: false };
      st.selected[Number(opt.dataset.qi)] = Number(opt.dataset.oi);
      saveQuizState(emperorKey, mode, st);
      renderQuizSlot(ws, mode, emperorKey);
      return;
    }
    // 提交批改
    const submit = ev.target.closest('.quiz-submit');
    if (submit) {
      const mode = submit.dataset.mode;
      const items = quizItems(emperorKey, mode);
      const st = loadQuizState(emperorKey, mode) || { selected: {}, graded: false };
      if (Object.keys(st.selected).length < items.length) {
        renderQuizSlot(ws, mode, emperorKey);
        const slot = ws.querySelector(`.ws-pane[data-pane="${mode}"] .quiz-slot`);
        slot.insertAdjacentHTML('beforeend', '<div class="ask-hint">还有题没选，全部选完再提交。</div>');
        return;
      }
      st.graded = true;
      saveQuizState(emperorKey, mode, st);
      renderQuizSlot(ws, mode, emperorKey);
      return;
    }
    // 重做
    const reset = ev.target.closest('.quiz-reset');
    if (reset) {
      const mode = reset.dataset.mode;
      saveQuizState(emperorKey, mode, { selected: {}, graded: false });
      renderQuizSlot(ws, mode, emperorKey);
      return;
    }
    // AI 点评（题目内置，AI 只点评选择是否成立）
    const review = ev.target.closest('.quiz-review');
    if (review) {
      const mode = review.dataset.mode;
      const items = quizItems(emperorKey, mode);
      const st = loadQuizState(emperorKey, mode);
      const out = ws.querySelector(`.ws-pane[data-pane="${mode}"] .quiz-review-result`);
      const digest = items.map((it, i) => {
        const p = st.selected[i];
        const chosen = p != null ? (it.options[p].t || it.options[p]) : '（未选）';
        const good = it.options.map((o, k) => (o.ok ? (o.t || o) : null)).filter(Boolean).join(' / ');
        return `第${i + 1}题：${it.q}\n  我选：${chosen}\n  更有依据：${good}\n  史实解析：${it.why || ''}`;
      }).join('\n');
      out.innerHTML = '<div class="ask-hint">🤖 AI 老师正在结合史实点评…</div>';
      const prompt = `下面是关于${label}${e.name}的选择题作答（题目为本项目内置）：
${digest}

请点评：我选错的题，错在哪个理解误区，用史实讲清楚；选对但题目偏开放的，补充一点我没想到的角度；最后用一句话总结我最该记住的认识。通俗简练，分点说。`;
      const d = await askHistoryTeacher(prompt);
      out.innerHTML = d.ok
        ? `<div class="ask-hit llm-answer"><b>🤖 AI 老师点评</b>：${formatReply(d.reply)}</div>`
        : `<div class="ask-hint">${escapeHtml(d.error || 'AI 点评失败')}</div>`;
      return;
    }
    // 争议话题 AI 点评
    const debAi = ev.target.closest('.deb-ai');
    if (debAi) {
      const item = debAi.closest('.debate-item');
      const ta = item.querySelector('.deb-input');
      const result = item.querySelector('.deb-result');
      const v = ta.value.trim();
      if (!v) { result.innerHTML = '<div class="ask-hint">先写下你的理由，AI 才能点评。</div>'; return; }
      result.innerHTML = '<div class="ask-hint">🤖 AI 老师正在结合史实点评…</div>';
      const prompt = `【争议问题】${item.dataset.q}
【常见的两种视角】${item.dataset.vp || '（无）'}
【我的理由】${v}
请中立地点评：我的理由是否站得住、用了哪些史实（指出与史实不符处）、有没有忽略对方视角中有力的一点；最后提一个能让我继续思考的问题。通俗简练。`;
      const d = await askHistoryTeacher(prompt);
      result.innerHTML = d.ok
        ? `<div class="ask-hit llm-answer"><b>🤖 AI 老师点评</b>：${formatReply(d.reply)}</div>`
        : `<div class="ask-hint">${escapeHtml(d.error || 'AI 点评失败')}</div>`;
    }
  });
}

// ---------- 界面三：地图（Leaflet 重绘） ----------
// 用 Leaflet + OpenStreetMap 瓦片做底图：真实海岸线/河流/城市名，可滚轮缩放、拖动平移。
// 疆域、长城、事件、路线等历史图层叠加其上；现代底图只作参照，历史边界仍为手绘简化示意。
// 数据准备与渲染分离：buildMapData() 只算数据（可脱离 Leaflet 测试），renderMap() 只管画。

const LEAFLET_TILES = {
  // 国内可访问的浅色底图（高德矢量路网），历史图层叠上去更醒目
  url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  subdomains: ['1','2','3','4'],
  attribution: '底图 © <a href="https://www.amap.com/" target="_blank" rel="noopener">高德地图</a>',
};

// 各朝历史数据缺失时回退的简化示意（与旧版一致的儿童示意多边形，经纬度坐标）
const FALLBACK_SHAPES = {
  // 明朝核心实控区：北以长城为界（九边），据《明史·地理志》+ 谭其骧《中国历史地图集》示意
  ming: [
    [98.2,39.8],[99.5,38.5],[101.0,37.5],[103.0,36.5],[104.5,36.0],
    [103.5,34.0],[102.0,32.0],[100.5,30.5],[99.0,28.5],[98.5,26.0],
    [98.0,24.0],[99.5,22.8],[101.5,21.8],[104.0,22.5],[106.5,22.0],
    [108.5,21.5],[109.5,20.0],[109.2,18.2],[110.5,18.5],[110.8,20.0],
    [112.0,21.8],[113.5,22.3],[115.0,22.8],[116.5,23.3],[118.2,24.5],
    [119.3,26.1],[120.5,28.0],[121.0,30.3],[121.9,31.4],[120.5,33.0],
    [119.5,35.0],[120.5,36.5],[122.5,37.5],[121.0,38.5],[118.0,39.0],
    [117.5,40.2],[119.8,40.0],[121.5,40.5],[123.2,41.3],[124.2,40.5],
    [122.0,40.0],[119.0,40.3],[115.5,40.7],[113.3,40.1],[111.5,39.6],
    [109.7,38.8],[107.0,38.5],[105.0,38.8],[102.0,38.5],[100.0,39.0],
    [98.2,39.8],
  ],
  // 北宋最大范围：北界白沟河-雁门，据谭其骧《中国历史地图集·北宋》
  song: [
    [103.8,36.1],[104.5,37.5],[106.5,38.5],[108.0,39.5],[110.0,39.8],
    [112.0,39.5],[114.0,39.2],[116.0,39.2],[117.5,39.0],[118.5,38.0],
    [119.5,37.5],[120.5,37.8],[122.0,37.5],[122.5,36.5],[120.5,36.0],
    [119.5,35.0],[120.0,34.5],[120.5,33.0],[121.0,31.5],[121.5,30.5],
    [121.0,28.5],[120.0,27.0],[119.0,25.5],[118.0,24.5],[116.5,23.5],
    [115.0,22.8],[113.5,22.3],[112.0,21.8],[110.8,20.0],[110.5,18.5],
    [109.2,18.2],[109.5,20.0],[108.5,21.5],[106.5,22.0],[104.0,22.5],
    [101.5,21.8],[99.5,22.8],[98.5,24.0],[99.5,26.0],[100.5,28.5],
    [102.0,31.0],[103.0,33.0],[104.0,34.0],[105.5,34.5],[107.0,34.5],
    [106.0,35.5],[103.8,36.1],
  ],
  // 隋朝全盛疆域（大业年间，据谭其骧《中国历史地图集·隋时期》示意）：
  // 北接突厥（阴山-燕山一线，约41°N），西到河西走廊敦煌（约94°E，未长期占西域），
  // 东到辽西走廊（约121°E，不深入辽东半岛），南含海南与交趾（约18°N）
  sui: [
    [94.0,39.5],[96.5,39.0],[99.0,38.5],[101.5,38.5],[104.0,38.8],
    [106.5,38.5],[109.0,38.8],[111.5,39.6],[113.3,40.1],[115.5,40.7],
    [117.5,40.5],[119.5,40.5],[120.8,40.8],[121.5,40.0],[120.0,39.5],
    [119.5,38.5],[120.5,36.5],[121.5,35.5],[120.5,33.5],[121.9,31.4],
    [121.0,30.3],[120.5,28.0],[119.3,26.1],[118.2,24.5],[116.5,23.3],
    [115.0,22.8],[113.5,22.3],[112.0,21.8],[110.8,20.0],[110.5,18.5],
    [109.2,18.2],[109.5,20.0],[108.5,21.5],[106.5,22.0],[104.0,22.5],
    [101.5,21.8],[99.5,22.8],[98.5,24.0],[98.5,26.0],[99.0,28.5],
    [100.5,30.5],[102.0,32.0],[103.5,34.0],[104.5,36.0],[103.0,36.5],
    [101.0,37.5],[97.0,38.0],[94.0,39.5],
  ],
  // 五代：中原五代疆域（后周最大范围，据谭其骧《中国历史地图集·五代十国时期》示意）：
  // 北至燕云十六州（石敬瑭割让后到契丹手中，后周实际北界在雁门—白沟一线），
  // 南到淮河-长江（南方十国并立，含后蜀四川），西到陇右（约104°E，河西走廊属回鹘等）
  wudai: [
    [104.5,36.0],[106.5,38.0],[109.7,38.8],[111.5,39.6],[113.3,40.1],
    [115.5,40.7],[117.5,40.2],[119.8,40.0],[121.5,40.5],[123.2,41.3],
    [122.0,40.0],[121.0,38.5],[120.5,36.5],[122.5,37.5],[119.5,35.0],
    [120.0,34.5],[119.0,33.5],[117.0,33.2],[114.5,33.0],[112.0,33.2],
    [109.0,33.5],[107.0,34.5],[106.0,35.5],[104.5,36.0],
  ],
  // 唐（贞观-开元全盛）：据谭其骧《中国历史地图集·唐时期》——
  // 西到碎叶（今吉尔吉斯），北到贝加尔湖，东北到外兴安岭，南到交趾
  tang: [
    [73.0,39.5],[75.0,40.5],[78.0,41.0],[80.0,42.0],[82.0,43.0],
    [85.0,44.0],[88.0,45.0],[91.0,46.0],[95.0,46.5],[98.0,47.0],
    [100.0,48.0],[103.0,49.0],[106.0,50.0],[110.0,51.0],[115.0,52.0],
    [120.0,53.0],[125.0,53.5],[130.0,53.0],[135.0,51.5],[138.0,49.0],
    [135.0,47.0],[132.0,45.0],[130.0,43.0],[128.0,41.0],[125.0,40.0],
    [122.0,39.5],[121.0,38.0],[122.0,36.5],[121.0,35.0],[120.0,33.5],
    [121.0,31.5],[120.5,29.0],[118.0,26.0],[115.0,23.5],[112.0,22.0],
    [109.0,21.0],[106.0,22.0],[103.0,22.5],[100.0,23.0],[97.0,24.0],
    [95.0,26.0],[93.0,28.0],[90.0,29.5],[88.0,31.0],[85.0,32.0],
    [82.0,33.0],[80.0,34.5],[77.0,36.0],[75.0,37.5],[73.0,39.5],
  ],
  // 元（1271-1368）：据谭其骧《中国历史地图集·元时期》——
  // 北逾阴山、岭北行省直抵北冰洋沿岸（约 55°N）；西尽阿姆河以东、新疆东部（约 85°E，不含西域绿洲）；
  // 东含库页岛（约 142°E）；西南含吐蕃宣慰司；南到南海
  yuan: [
    [85.0,47.0],[90.0,49.0],[95.0,51.0],[100.0,53.0],[105.0,54.5],
    [110.0,55.0],[115.0,55.5],[120.0,55.5],[125.0,55.0],[130.0,54.0],
    [135.0,52.5],[140.0,51.0],[142.0,49.0],[140.0,47.0],[137.0,45.5],
    [134.0,43.5],[131.0,41.5],[128.0,40.0],[125.0,39.0],[122.0,38.0],
    [121.0,36.5],[122.0,35.0],[121.0,33.5],[120.0,31.5],[120.5,29.0],
    [118.0,26.0],[115.0,23.5],[112.0,22.0],[109.0,21.0],[106.0,21.5],
    [103.0,22.0],[100.0,21.5],[97.0,22.0],[94.0,23.0],[92.0,25.0],
    [90.0,27.5],[88.0,30.0],[86.0,33.0],[85.0,36.0],[85.0,40.0],
    [85.0,43.0],[85.0,47.0],
  ],
  // 清（乾隆-嘉庆极盛，1759 平定大小和卓后）：据谭其骧《中国历史地图集·清时期》——
  // 西到巴尔喀什湖与伊犁河谷（约 74°E，含今新疆全境）；北到外兴安岭—唐努乌梁海/萨彦岭（约 53°N）；
  // 东北含库页岛（约 142°E）；东南含台湾；西南含西藏；南到南海
  qing: [
    [74.0,40.0],[76.0,42.5],[79.0,45.0],[82.0,46.5],[85.0,47.5],
    [88.0,48.5],[92.0,49.5],[96.0,51.0],[100.0,52.0],[105.0,53.0],
    [110.0,53.5],[115.0,54.0],[120.0,54.0],[125.0,53.5],[130.0,52.5],
    [135.0,51.0],[140.0,49.5],[142.0,47.5],[140.0,45.5],[137.0,43.5],
    [134.0,42.0],[131.0,40.5],[128.0,39.5],[125.0,38.5],[122.0,37.5],
    [121.0,36.0],[122.0,34.5],[121.0,33.0],[120.0,31.0],[121.0,29.0],
    [120.0,27.0],[118.0,25.0],[115.0,23.0],[112.0,21.8],[109.0,21.0],
    [106.0,21.5],[103.0,22.0],[100.0,21.5],[97.0,22.0],[94.0,24.0],
    [91.0,26.5],[88.0,28.5],[85.0,30.5],[82.0,32.5],[80.0,34.5],
    [77.0,36.5],[75.0,38.5],[74.0,40.0],
  ],
};

// 明长城（九边重镇连线：嘉峪关→山海关→辽东）示意走向
const GREAT_WALL = [
  [98.2,39.8],[100.5,39.0],[105.8,38.6],[109.7,38.5],[113.3,40.1],
  [115.0,40.7],[117.5,40.4],[119.8,40.0],[121.5,40.5],[123.2,41.3],
];
// 南宋·宋金分界线（绍兴和议后）：大散关→淮河→楚州入海
const SONG_JIN_BORDER = [
  [107.0,34.5],[109.0,33.5],[112.0,33.2],[114.5,33.0],[117.0,33.2],[119.5,33.5],
];
// 黄河（几字形示意）
const HUANGHE = [
  [104.5,36.0],[106.5,37.5],[108.5,39.5],[110.5,40.2],[111.5,40.0],
  [110.5,38.5],[110.0,37.0],[110.5,35.5],[112.0,34.8],[114.0,35.0],
  [116.0,36.5],[118.0,37.5],[119.0,37.8],
];
// 长江（示意）
const CHANGJIANG = [
  [104.6,28.8],[106.5,29.5],[108.5,30.5],[110.5,30.8],[112.5,30.3],
  [114.3,30.6],[116.0,29.8],[117.5,30.5],[118.8,32.0],[120.5,31.5],
];
// 主要山脉（淡棕示意，地形自古不变）
const MOUNTAINS = [
  { name: '大兴安岭', pts: [[120.0,51.5],[121.5,49.0],[122.5,46.5],[123.0,44.5]] },
  { name: '长白山', pts: [[127.5,42.5],[128.5,41.5],[129.5,41.0]] },
  { name: '太行山', pts: [[114.0,40.5],[113.5,38.5],[113.8,36.5],[113.2,35.0]] },
  { name: '燕山', pts: [[115.5,41.0],[117.0,40.8],[118.5,40.5]] },
  { name: '祁连山', pts: [[96.0,39.5],[99.0,38.5],[101.5,37.5]] },
  { name: '秦岭', pts: [[106.5,34.0],[108.5,34.2],[110.5,33.8],[112.5,33.5]] },
  { name: '昆仑山', pts: [[78.0,36.0],[85.0,36.0],[92.0,36.0],[96.0,36.5]] },
  { name: '横断山', pts: [[98.0,30.0],[99.0,28.0],[100.0,26.5],[101.0,25.5]] },
  { name: '南岭', pts: [[111.0,25.0],[113.0,24.8],[115.0,24.5]] },
  { name: '武夷山', pts: [[117.0,27.5],[118.0,26.5],[118.5,25.5]] },
  { name: '大别山', pts: [[114.5,31.8],[115.8,31.5],[116.8,31.2]] },
];
// 两京十三布政使司 + 辽东都司 首府位置标签（仅明朝）
const MING_PROVINCES = [
  { name: "北直隶", lng: 116.6, lat: 39.6 }, { name: "南直隶", lng: 118.7, lat: 32.6 },
  { name: "山东", lng: 118.5, lat: 36.3 }, { name: "山西", lng: 112.5, lat: 37.3 },
  { name: "河南", lng: 113.5, lat: 33.8 }, { name: "陕西", lng: 107.0, lat: 35.8 },
  { name: "四川", lng: 104.5, lat: 30.5 }, { name: "湖广", lng: 112.5, lat: 29.5 },
  { name: "浙江", lng: 120.0, lat: 29.0 }, { name: "江西", lng: 115.8, lat: 27.5 },
  { name: "福建", lng: 118.2, lat: 25.8 }, { name: "广东", lng: 113.3, lat: 23.3 },
  { name: "广西", lng: 108.3, lat: 23.5 }, { name: "云南", lng: 101.5, lat: 25.0 },
  { name: "贵州", lng: 106.7, lat: 26.7 }, { name: "辽东", lng: 123.0, lat: 40.8 },
];
// 明朝境外周边政权/地理标签（给孩子建立空间感）
const NEIGHBORS = [
  { name: "蒙古高原（鞑靼·瓦剌）", lng: 110, lat: 46.5, sub: "长城之外" },
  { name: "女真诸部", lng: 127, lat: 44.5, sub: "东北" },
  { name: "日本", lng: 130, lat: 34.5, sub: "隔海" },
  { name: "东海", lng: 128, lat: 27, sub: "" },
  { name: "南海", lng: 115, lat: 16.5, sub: "" },
  { name: "乌思藏", lng: 91, lat: 30.5, sub: "青藏" },
];
// 宋朝境外周边政权标签
const SONG_NEIGHBORS = [
  { name: "辽（契丹）", lng: 118, lat: 44.0, sub: "北宋北邻" },
  { name: "西夏", lng: 104, lat: 39.0, sub: "西北" },
  { name: "吐蕃诸部", lng: 91, lat: 31.0, sub: "青藏" },
  { name: "大理", lng: 101, lat: 25.0, sub: "云南" },
  { name: "日本", lng: 133, lat: 35.0, sub: "隔海" },
  { name: "东海", lng: 128, lat: 27, sub: "" },
  { name: "南海", lng: 115, lat: 16.5, sub: "" },
];

// 各朝事件标记的图标与颜色
const EVT_ICON = { battle: '⚔', coup: '🏛', siege: '⚔', reform: '📜', culture: '📚', uprising: '🔥', diplomacy: '🚢' };
const EVT_COLOR = { battle: '#c0392b', coup: '#8e44ad', siege: '#d35400', reform: '#1e8449', culture: '#2980b9', uprising: '#e67e22', diplomacy: '#16a085' };

// 各朝地图视口中心/缩放（让疆域大致占满画布）
const MAP_VIEW = {
  ming: { center: [36, 105], zoom: 4 },
  tang: { center: [35, 102], zoom: 4 },
  song: { center: [33, 110], zoom: 4 },
  yuan: { center: [38, 100], zoom: 4 },
  qing: { center: [38, 102], zoom: 4 },
  sui: { center: [35, 105], zoom: 4 },
  wudai: { center: [34, 106], zoom: 4 },
};

/** 归一化各朝数据，产出纯数据对象（可脱离 Leaflet 测试）：
 *  { shape, wall, songBorder, rivers, provinces, neighbors, places, events, routes } */
function buildMapData() {
  const d = currentDynasty;
  const isMing = d === 'ming';
  const isSong = d === 'song';
  const fill = DYNASTY_FILL[d] || DYNASTY_FILL.ming;
  // 疆域：优先真实边界 geojson（各区块 Polygon，供描边/标签/点击区分）；
  //       无 geojson 的朝代（宋/隋/五代）回退 FALLBACK_SHAPES 单连续多边形
  const geo = (typeof MAP_GEO !== 'undefined') ? MAP_GEO[d] : null;
  let shape;
  if (geo && geo.features && geo.features.length) {
    shape = { type: 'geojson', geo, label: fill.title };
  } else {
    const fallback = FALLBACK_SHAPES[d] || FALLBACK_SHAPES.ming;
    shape = { type: 'polygon', points: fallback, label: fill.title };
  }
  return {
    shape,
    wall: isMing ? GREAT_WALL : null,
    songBorder: isSong ? SONG_JIN_BORDER : null,
    rivers: { huanghe: HUANGHE, changjiang: CHANGJIANG },
    mountains: MOUNTAINS,
    provinces: isMing ? MING_PROVINCES : [],
    neighbors: isSong ? SONG_NEIGHBORS : NEIGHBORS,
    places: (DATA.places || []).filter((p) => p.type !== 'overseas'),
    events: eventsForEra(activeEraId),
    routes: (DATA.routes || []).filter((r) => r.id !== 'zhenghe-west'),
    zhenghe: (DATA.routes || []).find((r) => r.id === 'zhenghe-west') || null,
    fill,
  };
}

// Leaflet 实例缓存：切换朝代时复用（重设视图+图层），避免重建地图/瓦片
let leafletMap = null;
let leafletLayers = {}; // { shape, wall, songBorder, rivers, mountains, provinces, neighbors, places, events, routes, zhenghe }

/** 让传入的 [lng,lat] 点集对齐（若坐标是 [lat,lng] 顺序，则交换） */
function toLatLngs(pts) {
  return pts.map((p) => (p.length === 2 ? [p[1], p[0]] : p));
}

/** 清除旧图层（只留底图） */
function clearLeafletLayers() {
  if (!leafletMap) return;
  Object.values(leafletLayers).forEach((l) => {
    if (Array.isArray(l)) l.forEach((x) => x && leafletMap.removeLayer(x));
    else if (l && l.remove) leafletMap.removeLayer(l);
  });
  leafletLayers = {};
}

/** 把坐标点集画成 polyline（rivers/mountains/wall/songBorder 共用） */
function addPolyline(coords, opts) {
  const line = L.polyline(coords, {
    color: opts.color, weight: opts.weight || 2, opacity: opts.opacity != null ? opts.opacity : 0.7,
    dashArray: opts.dash || null, lineCap: 'round', lineJoin: 'round',
  });
  line.addTo(leafletMap);
  return line;
}

/** 地名标签：用 divIcon 文本标记（带浅色底板，避免被瓦片淹没） */
function addLabel(lng, lat, text, opts = {}) {
  // 区块名标签：弱化（小字、无底板、半透明），避免与城市/邻国标签抢眼
  const cls = opts.region ? 'map-label map-label-region' : 'map-label';
  const icon = L.divIcon({
    className: cls,
    html: `<div class="map-label-inner">${text}</div>`,
    iconSize: null,
  });
  const m = L.marker([lat, lng], { icon, interactive: false });
  m.addTo(leafletMap);
  // 加入清理列表，切朝代时自动移除
  if (!leafletLayers._labels) leafletLayers._labels = [];
  leafletLayers._labels.push(m);
  return m;
}

/** 城市点：圆圈 + 名字（divIcon），可点击弹窗 */
function addPlaceMarker(p) {
  const cls = p.type || 'city';
  const color = cls === 'capital' ? '#c0392b' : cls === 'site' ? '#f0a500' : '#247bc1';
  const modern = p.modernName && p.modernName !== p.name ? `（今${p.modernName}）` : '';
  const icon = L.divIcon({
    className: 'map-place',
    html: `<div class="map-place-inner" style="border-color:${color}">
      <span class="map-place-dot" style="background:${color}"></span>
      <span class="map-place-name">${p.name}</span>
      <span class="map-place-modern">${modern}</span>
    </div>`,
    iconSize: null,
  });
  const m = L.marker([p.lat, p.lng], { icon, title: p.name });
  m.on('click', () => showPopup(p.name, p.modernName, p.story || '（暂无故事）'));
  m.addTo(leafletMap);
  return m;
}

/** 事件点：显示该事件涉及的古地名（divIcon），点击弹地名+事件说明 */
/**
 * 稳健飞行：能飞（requestAnimationFrame 正常泵送）就用 flyTo 平滑飞行；
 * RAF 被挂起（后台标签、无合成的自动化环境）或飞行启动后卡住，则退回非动画瞬切。
 * 保证在任何环境下视图都一定能到达目标。
 */
function mapFlyTo(target, zoom, duration = 1.4, onArrive) {
  const m = leafletMap;
  if (!m) return;
  const dest = [target.lat != null ? target.lat : target[0], target.lng != null ? target.lng : target[1]];
  let done = false;
  const arrive = (how) => { if (!done) { done = true; onArrive && onArrive(how); } };
  const instant = () => { m.setView(dest, zoom, { animate: false }); arrive('instant'); };

  let rafFired = false;
  requestAnimationFrame(() => { rafFired = true; });

  setTimeout(() => {
    if (!rafFired) { instant(); return; }
    // RAF 正常：开始飞行，飞行结束（moveend）触发 arrive
    const startCenter = m.getCenter();
    const onMoveEnd = () => { m.off('moveend', onMoveEnd); arrive('fly'); };
    m.on('moveend', onMoveEnd);
    m.flyTo(dest, zoom, { duration });
    // 兜底：moveend 万一没触发，duration+400ms 后强制到达
    setTimeout(() => {
      const c = m.getCenter();
      const reached = Math.abs(c.lat - dest[0]) < 0.05 && Math.abs(c.lng - dest[1]) < 0.05 && m.getZoom() === zoom;
      if (!reached) { m.off('moveend', onMoveEnd); m.stop(); instant(); }
      else arrive('fly');
    }, duration * 1000 + 450);
    // 看门狗：飞行启动 350ms 后若中心几乎没动，说明卡住，强制瞬切
    setTimeout(() => {
      const c = m.getCenter();
      const moved = Math.abs(c.lat - startCenter.lat) + Math.abs(c.lng - startCenter.lng);
      if (moved < 0.02) { m.off('moveend', onMoveEnd); m.stop(); instant(); }
    }, 350);
  }, 110);
}

/** 按古地名聚合事件：同 place.name 合并成一个标记，避免地图上一堆重复地名标签
 *  输入：events[]（单个事件）→ 输出：clusters[] [{name, modern, lat, lng, events:[...]}] */
function buildEventClusters(events) {
  const map = new Map();
  for (const ev of events) {
    const place = ev.place || {};
    const key = place.name || ev.name;
    const lat = ev.lat, lng = ev.lng;
    if (map.has(key)) {
      map.get(key).events.push(ev);
    } else {
      map.set(key, { name: key, modern: place.modern || '', lat, lng, events: [ev] });
    }
  }
  return [...map.values()];
}

/** 事件点标记：显示古地名（同名聚合，多个事件带数量角标），点击弹该地全部事件 */
function addEventMarker(cluster) {
  const placeName = cluster.name;
  const modern = cluster.modern ? `（今${cluster.modern}）` : '';
  const n = cluster.events.length;
  const badge = n > 1 ? `<span class="map-event-count">${n}</span>` : '';
  const label = `${placeName}${n > 1 ? ' · ' + n + '个事件' : ''}`;
  const div = L.divIcon({
    className: 'map-event',
    html: `<div class="map-event-inner">
      <span class="map-event-icon">⚑</span>
      <span class="map-event-name">${placeName}</span>
      ${badge}
      <span class="map-event-modern">${modern}</span>
    </div>`,
    iconSize: null,
  });
  const m = L.marker([cluster.lat, cluster.lng], { icon: div, title: label });
  m._evtIds = cluster.events.map((e) => e.eventId);
  m._evtId = cluster.events[0].eventId; // 兼容 isEra 等旧引用
  m.on('click', () => showEventPopup(cluster.events.length > 1 ? cluster.events : cluster.events[0], cluster));
  m.addTo(leafletMap);
  if (window.__dbg) window.__dbg.eventMarkers = (window.__dbg.eventMarkers || 0) + 1;
  return m;
}

/** 路线：带箭头多段线 + 途经点/起终点标记，动画绘制 */
function addRouteLayer(r, ri) {
  const pts = (r.points || []).map((p) => [p.lat, p.lng]);
  const line = L.polyline(pts, {
    color: r.color, weight: 3, opacity: 0, dashArray: '10 6',
    lineCap: 'round', lineJoin: 'round',
  });
  line.addTo(leafletMap);
  // 途经点（跳过首末点，因为它们由 sMark/eMark 覆盖）
  const allPts = r.points || [];
  const wps = allPts.slice(1, -1).map((p) => {
    const dot = L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 2, fillColor: r.color, fillOpacity: 1, opacity: 0 });
    dot.bindTooltip(`${p.name}${p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : ''}：${p.note || ''}`, { direction: 'top' });
    dot.addTo(leafletMap);
    return dot;
  });
  const start = allPts[0], end = allPts[allPts.length - 1];
  // 起点：绿色大点；终点：红色大点。fillOpacity 始终 1（opacity 只管描边），zIndex 高
  // tooltip permanent 常显地名，动画开始时随标记一起隐藏、到达时一起显示
  const sMark = start ? L.circleMarker([start.lat, start.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2e7d32', fillOpacity: 1, opacity: 0, zIndexOffset: 1000 }) : null;
  const eMark = end ? L.circleMarker([end.lat, end.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#a0251c', fillOpacity: 1, opacity: 0, zIndexOffset: 1000 }) : null;
  if (sMark) {
    sMark.bindTooltip(`起 · ${start.name}${start.modern && start.modern !== start.name ? '（今' + start.modern + '）' : ''}`, { permanent: true, direction: 'top', className: 'route-pt-tip' });
    sMark.addTo(leafletMap);
  }
  if (eMark) {
    eMark.bindTooltip(`终 · ${end.name}${end.modern && end.modern !== end.name ? '（今' + end.modern + '）' : ''}`, { permanent: true, direction: 'bottom', className: 'route-pt-tip' });
    eMark.addTo(leafletMap);
  }
  return { line, wps, sMark, eMark };
}

/** 路线动画：从起点画到终点（dasharray 动态收拢） */
const _routeTimers = [];
function animateRoute(layer, duration = 1500) {
  if (!layer) return;
  // 立即隐藏本层所有途经点/起终点（防上一轮动画残留），定时器记录供统一清理
  if (layer.wps) layer.wps.forEach((w) => w.setStyle({ opacity: 0, fillOpacity: 0 }));
  hideRouteMarker(layer.sMark);
  hideRouteMarker(layer.eMark);
  const line = layer.line;
  line.setStyle({ opacity: 1 });
  // 用 CSS transition 收拢 dashoffset（Leaflet path 是 SVG path，可直接操作）
  const pathEl = line._path;
  if (pathEl && pathEl.getTotalLength) {
    const len = pathEl.getTotalLength();
    pathEl.style.transition = 'none';
    pathEl.style.strokeDasharray = len;
    pathEl.style.strokeDashoffset = len;
    void pathEl.getBoundingClientRect();
    pathEl.style.transition = `stroke-dashoffset ${duration}ms linear`;
    pathEl.style.strokeDashoffset = '0';
    _routeTimers.push(setTimeout(() => { pathEl.style.transition = ''; pathEl.style.strokeDasharray = '10 6'; pathEl.style.strokeDashoffset = '0'; }, duration + 60));
  }
  layer.wps.forEach((w, i) => {
    const t = ((i + 1) / (layer.wps.length + 1)) * duration;
    _routeTimers.push(setTimeout(() => w.setStyle({ opacity: 1 }), t));
  });
  // 起点：动画一开始（0.2 比例）就显示标记+常显地名；终点：动画结束才显示
  if (layer.sMark) {
    _routeTimers.push(setTimeout(() => showRouteMarker(layer.sMark), Math.min(200, duration * 0.2)));
  }
  if (layer.eMark) {
    _routeTimers.push(setTimeout(() => showRouteMarker(layer.eMark), duration));
  }
}

/** 清理所有路线动画定时器（防止旧动画残留覆盖新状态） */
function clearRouteAnimations() {
  _routeTimers.forEach(clearTimeout);
  _routeTimers.length = 0;
}

/** 隐藏一个起终点标记（样式 + 常显 tooltip 一起隐藏）；m 为 null 时安全跳过 */
function hideRouteMarker(m) {
  if (!m) return;
  m.setStyle({ opacity: 0, fillOpacity: 0 });
  if (m.closeTooltip) m.closeTooltip();
}

/** 显示一个起终点标记（样式 + 常显 tooltip 一起显示） */
function showRouteMarker(m) {
  if (!m) return;
  m.setStyle({ opacity: 1, fillOpacity: 1 });
  if (m.openTooltip) m.openTooltip();
}

function renderMap() {
  const container = $('#map-leaf');
  if (!container) return;
  const data = buildMapData();
  if (typeof L === 'undefined') {
    // 离线或 Leaflet 未加载：给出说明（页面其余功能不受影响）
    container.innerHTML = '<div class="map-unavailable">地图组件未加载（需联网加载 Leaflet 与底图）。<br>请检查网络后刷新。</div>';
    return;
  }
  if (!leafletMap) {
    leafletMap = L.map('map-leaf', {
      zoomControl: true,
      attributionControl: true,
      minZoom: 3,
      maxZoom: 10,
      zoomSnap: 1,
      zoomDelta: 1,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: true,
      touchZoom: true,
    });
    const tiles = L.tileLayer(LEAFLET_TILES.url, { attribution: LEAFLET_TILES.attribution, maxZoom: 10, subdomains: LEAFLET_TILES.subdomains || 'abc', fadeAnimation: false });
    // 瓦片加载失败（离线/被墙）：提到底图上叠一句提示，历史图层仍可看
    tiles.on('tileerror', () => {
      const el2 = $('#map-leaf .leaflet-tile-pane');
      if (el2 && !document.querySelector('#map-leaf .map-tile-warn')) {
        const w = document.createElement('div');
        w.className = 'map-tile-warn';
        w.textContent = '🌐 底图瓦片加载失败（需联网）。疆域/城市/事件等历史图层仍可查看。';
        document.querySelector('#map-leaf').appendChild(w);
      }
    });
    // 修复 Leaflet fadeAnimation 关闭后 opacity 残留 0 的问题：tileload 时强制可见
    tiles.on('tileload', (e) => { if (e.tile) e.tile.style.opacity = 1; });
    tiles.addTo(leafletMap);
  }
  clearLeafletLayers();
  const v = MAP_VIEW[currentDynasty] || MAP_VIEW.ming;
  leafletMap.setView(v.center, v.zoom);

  // ---- 疆域 ----
  if (data.shape.type === 'geojson') {
    // 双层渲染：底层用 FALLBACK 连续外轮廓整块填充（消除分区拼缝空白），
    // 上层叠加 geojson 区块仅提供分区标签与点击说明（透明填充，弱化分区线）。
    const fallback = FALLBACK_SHAPES[currentDynasty] || FALLBACK_SHAPES.ming;
    const basePoly = L.polygon(toLatLngs(fallback), {
      fillColor: data.fill.fill, fillOpacity: 0.38,
      color: data.fill.stroke, weight: 1.5, opacity: 0.85,
    });
    basePoly.addTo(leafletMap);
    leafletLayers.shape = basePoly;
    const geoLayer = L.geoJSON(data.shape.geo, {
      style: () => ({
        fillColor: 'transparent', fillOpacity: 0,
        color: data.fill.stroke, weight: 0.7, opacity: 0.4,
      }),
      onEachFeature: (f, layer) => {
        const name = f.properties?.name || '';
        if (!name) return;
        // 区块名标签：放该区块外接框中心（弱化样式）
        const c = layer.getBounds().getCenter();
        addLabel(c.lng, c.lat, name, { region: true });
        // 点击弹窗：说明这个区划是什么
        const note = REGION_NOTES[name];
        if (note) {
          layer.on('click', () => showPopup(name, '', note));
        }
      },
    });
    geoLayer.addTo(leafletMap);
    leafletLayers.shapeGeo = geoLayer;
    // 朝代号标在疆域总中心
    const c = basePoly.getBounds().getCenter();
    const shortName = { ming:'明', tang:'唐', song:'宋', yuan:'元', qing:'清', sui:'隋', wudai:'五代' }[currentDynasty] || '';
    if (shortName) addLabel(c.lng, c.lat, shortName);
  } else {
    const poly = L.polygon(toLatLngs(data.shape.points), {
      fillColor: data.fill.fill, fillOpacity: 0.32, color: data.fill.stroke,
      weight: 1.5, opacity: 0.9, dashArray: '6 4',
    });
    poly.addTo(leafletMap);
    leafletLayers.shape = poly;
    // 朝代号：用轮廓坐标质心（避免额外 getBounds 调用）
    const pts = data.shape.points;
    const clng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const clat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const shortName = { ming:'明', tang:'唐', song:'宋', yuan:'元', qing:'清', sui:'隋', wudai:'五代' }[currentDynasty] || '';
    if (shortName) addLabel(clng, clat, shortName);
  }

  // ---- 明长城（仅明朝）/ 宋金分界（仅宋朝）----
  if (data.wall) {
    const wall = addPolyline(data.wall, { color: '#7a4a22', weight: 2.5, dash: '12 4 3 4', opacity: 0.85 });
    leafletLayers.wall = wall;
    addLabel(113, 41.6, '— 明长城（九边）—', { pos: 'center' });
  }
  if (data.songBorder) {
    const jb = addPolyline(data.songBorder, { color: '#8e44ad', weight: 2.2, dash: '14 6', opacity: 0.8 });
    leafletLayers.songBorder = jb;
    addLabel(113.5, 33.9, '— 绍兴和议·宋金分界（大散关—淮河）—', { pos: 'center' });
  }

  // ---- 河流 ----
  const hh = addPolyline(data.rivers.huanghe, { color: '#5b9bd5', weight: 2.2, opacity: 0.6 });
  const cj = addPolyline(data.rivers.changjiang, { color: '#5b9bd5', weight: 2.2, opacity: 0.6 });
  leafletLayers.rivers = [hh, cj];
  addLabel(113.5, 36.3, '黄河', { pos: 'center' });
  addLabel(112.5, 29.8, '长江', { pos: 'center' });

  // ---- 山脉 ----
  leafletLayers.mountains = data.mountains.map((m) => {
    const line = addPolyline(m.pts, { color: '#a0826d', weight: 5, opacity: 0.28 });
    addLabel(m.pts[Math.floor(m.pts.length / 2)][0], m.pts[Math.floor(m.pts.length / 2)][1], m.name, { pos: 'center' });
    return line;
  });

  // ---- 省名（仅明朝）----
  leafletLayers.provinces = data.provinces.map((p) => addLabel(p.lng, p.lat, p.name, { pos: 'center' }));

  // ---- 周边政权 ----
  leafletLayers.neighbors = data.neighbors.map((n) => addLabel(n.lng, n.lat, `${n.name}${n.sub ? `（${n.sub}）` : ''}`, { pos: 'center' }));

  // ---- 城市点 ----
  leafletLayers.places = data.places.map(addPlaceMarker);

  // ---- 事件点（按古地名聚合：同地点的多个事件合并成一个标记）----
  if (window.__dbg) window.__dbg.beforeEvents = data.events.length;
  leafletLayers.events = buildEventClusters(data.events).map(addEventMarker);
  if (window.__dbg) window.__dbg.afterEvents = (leafletLayers.events || []).length;

  // ---- 路线（按钮单选，初始全部隐藏）----
  leafletLayers.routes = data.routes.map(addRouteLayer);
  // 路线详情面板 + 图例按钮
  renderMapControls(data);
}

/** 地图下方的路线按钮区 + 郑和航次选择（与图例一起挂在 route-panel） */
function renderMapControls(data) {
  const legend = $('#map-route-btns');
  if (!legend) return;
  legend.innerHTML = '';
  const curEmp = currentEraEmperor();
  const inEra = (r) => {
    if (!curEmp || !r.year) return true;
    const s = parseInt(curEmp.reign.start, 10);
    const en = parseInt(curEmp.reign.end, 10);
    return r.year >= s && r.year <= en;
  };
  const visibleDomestic = data.routes.filter(inEra);
  /** 隐藏除目标路线外的所有动态图层（其他路线/事件点/城市点/郑和航线） */
  const hideOthers = (exceptRi) => {
    (leafletLayers.routes || []).forEach((l, i) => {
      if (i === exceptRi) return; // 目标路线保留，交给 animateRoute 画
      l.line.setStyle({ opacity: 0, fillOpacity: 0 });
      l.wps.forEach((w) => w.setStyle({ opacity: 0, fillOpacity: 0 }));
      hideRouteMarker(l.sMark);
      hideRouteMarker(l.eMark);
    });
    (leafletLayers.zhenghe || []).forEach((x) => {
      if (x.setStyle) x.setStyle({ opacity: 0, fillOpacity: 0 });
    });
    // 完全移除城市点和事件点图层（divIcon setOpacity 不可靠，直接 removeLayer）
    (leafletLayers.places || []).forEach((m) => { if (m && leafletMap) leafletMap.removeLayer(m); });
    (leafletLayers.events || []).forEach((m) => { if (m && leafletMap) leafletMap.removeLayer(m); });
  };
  const showRoute = (ri) => {
    clearRouteAnimations();
    hideOthers(ri);
    const l = (leafletLayers.routes || [])[ri];
    if (l) animateRoute(l, 1500);
  };
  const showEvents = () => {
    // 隐藏所有路线与郑和
    (leafletLayers.routes || []).forEach((l) => {
      l.line.setStyle({ opacity: 0, fillOpacity: 0 });
      l.wps.forEach((w) => w.setStyle({ opacity: 0, fillOpacity: 0 }));
      hideRouteMarker(l.sMark);
      hideRouteMarker(l.eMark);
    });
    (leafletLayers.zhenghe || []).forEach((x) => { if (x.setStyle) x.setStyle({ opacity: 0, fillOpacity: 0 }); });
    // 重新加回城市点 + 事件地名点
    (leafletLayers.places || []).forEach((m) => { if (m && leafletMap) m.addTo(leafletMap); });
    (leafletLayers.events || []).forEach((m) => {
      if (m && leafletMap) {
        m.addTo(leafletMap);
        // 闪烁一下吸引注意
        const el = m.getElement && m.getElement();
        if (el) {
          el.classList.remove('map-flash');
          void el.offsetWidth; // 重触发动画
          el.classList.add('map-flash');
        }
      }
    });
  };
  const showRouteZhenghe = () => {
    clearRouteAnimations();
    // 隐藏国内路线、事件点、城市点
    (leafletLayers.routes || []).forEach((l) => {
      l.line.setStyle({ opacity: 0, fillOpacity: 0 });
      l.wps.forEach((w) => w.setStyle({ opacity: 0, fillOpacity: 0 }));
      hideRouteMarker(l.sMark);
      hideRouteMarker(l.eMark);
    });
    (leafletLayers.places || []).forEach((m) => { if (m && leafletMap) leafletMap.removeLayer(m); });
    (leafletLayers.events || []).forEach((m) => { if (m && leafletMap) leafletMap.removeLayer(m); });
    // 显示郑和航线
    (leafletLayers.zhenghe || []).forEach((x) => { if (x.setStyle) x.setStyle({ opacity: 1 }); });
    const domesticLine = (leafletLayers.zhenghe || [])[0];
    const overseasLine = (leafletLayers.zhenghe || [])[1];
    [domesticLine, overseasLine].forEach((l) => l && animateRoute({ line: l, wps: [], sMark: null, eMark: null }, 1800));
  };
  const hideRouteDetail = () => {
    const box = $('#route-detail');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  };
  visibleDomestic.forEach((r, ri) => {
    const realRi = data.routes.indexOf(r);
    const btn = el('button', 'route-btn');
    btn.textContent = `${r.name} ▶`;
    btn.dataset.layer = r.id;
    btn.style.borderColor = r.color;
    btn.addEventListener('click', () => {
      legend.querySelectorAll('.route-btn').forEach((b) => { b.style.background = ''; b.classList.remove('on'); });
      btn.style.background = r.color;
      btn.classList.add('on');
      showRoute(realRi);
      showRouteDetail(r);
      document.querySelector('#route-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    legend.appendChild(btn);
  });
  // 郑和航线：拆成国内段 + 远洋段两条 polyline（替代旧插页），点击后高亮
  if (data.zhenghe && inEra(data.zhenghe)) {
    const zh = data.zhenghe;
    const domestic = (zh.points || []).filter((p) => p.lat >= 20 && p.lng >= 110);
    const overseas = (zh.points || []).filter((p) => !(p.lat >= 20 && p.lng >= 110));
    const mk = (pts) => L.polyline(pts.map((p) => [p.lat, p.lng]), {
      color: zh.color, weight: 3, opacity: 0, dashArray: '8 5', lineCap: 'round', lineJoin: 'round',
    });
    const domesticLine = domestic.length >= 2 ? mk(domestic) : null;
    const overseasLine = overseas.length >= 2 ? mk(overseas) : null;
    if (domesticLine) domesticLine.addTo(leafletMap);
    if (overseasLine) overseasLine.addTo(leafletMap);
    leafletLayers.zhenghe = [domesticLine, overseasLine].filter(Boolean);
    // 途经点
    (zh.points || []).forEach((p) => {
      const dot = L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 2, fillColor: zh.color, fillOpacity: 1, opacity: 0 });
      dot.bindTooltip(`${p.name}${p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : ''}：${p.note || ''}`, { direction: 'top' });
      dot.addTo(leafletMap);
      leafletLayers.zhenghe.push(dot);
    });
    const btn = el('button', 'route-btn');
    btn.textContent = '郑和航线 ▶（含远洋）';
    btn.dataset.layer = 'zhenghe-west';
    btn.style.borderColor = zh.color;
    btn.addEventListener('click', () => {
      legend.querySelectorAll('.route-btn').forEach((b) => { b.style.background = ''; b.classList.remove('on'); });
      btn.style.background = zh.color;
      btn.classList.add('on');
      showRouteZhenghe();
      showRouteDetail(zh);
      const box = $('#route-detail');
      if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    legend.appendChild(btn);
  }
  // 事件按钮（默认激活）：点击后在地图下方汇总该朝所有事件涉及的古地名
  const evtBtn = el('button', 'route-btn');
  evtBtn.textContent = '📍 该朝事件';
  evtBtn.dataset.layer = 'events';
  evtBtn.style.borderColor = '#c0392b';
  evtBtn.classList.add('on');
  evtBtn.style.background = '#c0392b';
  evtBtn.addEventListener('click', () => {
    legend.querySelectorAll('.route-btn').forEach((b) => { b.style.background = ''; b.classList.remove('on'); });
    evtBtn.style.background = '#c0392b';
    evtBtn.classList.add('on');
    showEvents();
    showEventsSummary();
  });
  legend.appendChild(evtBtn);
  // 初始状态：显示城市点 + 事件点（默认"该朝事件"视图）
  showEvents();
}

/** 该朝事件汇总：列出本朝所有地图事件涉及的古地名（点击跳地图并弹窗说明） */
function showEventsSummary() {
  const box = $('#route-detail');
  if (!box) return;
  // 汇总本朝全部事件（不受年号筛选影响；若在具体年号视图则提示）
  const allEvents = DATA.mapEvents || [];
  const list = allEvents.slice().sort((a, b) => parseInt(a.date, 10) - parseInt(b.date, 10));
  if (!list.length) {
    box.classList.remove('hidden');
    box.innerHTML = `<div class="route-detail-desc">这个朝代还没有标记在地图上的事件。</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  const curEmp = currentEraEmperor();
  const noteLine = curEmp ? `<div class="route-detail-desc">当前查看「${curEmp.eraName[0]}」年间 · 点击查看事件详情</div>` : `<div class="route-detail-desc">全朝事件汇总 · 点击查看事件详情</div>`;
  const items = list.map((ev) => {
    const place = ev.place || {};
    const pn = place.name || ev.name;
    const modern = place.modern ? `（今${place.modern}）` : '';
    // 事件名为主，地名（今名）跟在后面；若事件名本身就含地名则不重复显示地名
    const placePart = (ev.name && ev.name !== pn) ? `<span class="evt-summary-name">${pn}${modern}</span>` : '';
    return `<button class="evt-summary-chip" data-evt-id="${ev.eventId}">
      <b>${ev.date}</b> ${ev.name}
      ${placePart}
    </button>`;
  }).join('');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="route-detail-head" style="border-color:#c0392b">
      <span class="route-detail-name">📍 该朝事件 · 事件名（古地名）</span>
      <span class="route-detail-year">共 ${list.length} 个</span>
    </div>
    ${noteLine}
    <div class="evt-summary-grid">${items}</div>`;
  // 点击某地名：只保留该事件的地点标记，其余事件点/城市点/路线全部隐藏
  box.querySelectorAll('.evt-summary-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const ev = (DATA.mapEvents || []).find((e) => e.eventId === chip.dataset.evtId);
      if (!ev) return;
      // 胶囊变红（单选效果）
      box.querySelectorAll('.evt-summary-chip').forEach((c) => c.classList.remove('on'));
      chip.classList.add('on');
      showSingleEvent(ev);
      document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 只展示单个事件的地点：清空地图上的其他事件点、城市点、路线，仅保留目标地点标记，飞到并弹窗 */
/** 事件 → 关联路线映射（点事件时若有关联路线，自动在地图上动态绘制）
 *  明：靖难→南下路线、郑和起锚→郑和航线、土木堡→也先南下、山海关→清军入关、
 *      张献忠成都→张献忠入川、扬州→南明流亡、徐达克大都→清军入关（元顺帝北逃方向）
 *  宋：陈桥兵变→回京路线、建炎南渡→南渡路线、郾城→岳飞北伐、崖山→流亡路线 */
const EVENT_ROUTE_MAP = {
  // 明朝
  'ming-event-jingnan': 'jingnan-south',
  'ming-event-zhenghe-qihang': 'zhenghe-west',
  'ming-event-tumu': 'yexian-nanxia',
  'ming-event-shanhaiguan': 'qing-ruguan',
  'ming-event-zhangxianzhong': 'zhangxianzhong-sichuan',
  'ming-event-yangzhou': 'nanmin-liuwang',
  'ming-event-ke-dadu': 'qing-ruguan',
  'ming-event-chongzhen-ziyi': 'lizicheng-north',
  // 宋朝
  'song-event-chenqiao': 'song-chenqiao',
  'song-event-nandu': 'song-nandu',
  'song-event-yuefei': 'song-yuefei',
  'song-event-yashan': 'song-yashan',
  // 唐朝
  'tang-event-jinyang': 'tang-jinyang-changan',
  'tang-event-mie-dongtujue': 'tang-mie-dongtujue',
  'tang-event-zheng-gaogouli': 'tang-zheng-gaogouli',
  'tang-event-anshi-baofa': 'tang-anshi',
  'tang-event-caizhou': 'tang-caizhou',
  'tang-event-huangchao-qiyi': 'tang-huangchao',
  // 元朝
  'yuan-event-miejin': 'yuan-miejin',
  'yuan-event-miesong': 'yuan-miesong',
  'yuan-event-hongjin': 'yuan-hongjin',
  'yuan-event-beiyuan': 'yuan-beiyuan',
  'yuan-event-zhenghe': 'yuan-makeluo',
  // 清朝
  'qing-event-ruguan': 'qing-ruguan-beijing',
  'qing-event-sanshun': 'qing-pingding-sanfan',
  'qing-event-taiwan': 'qing-taiwan',
  'qing-event-gaerdan': 'qing-san-zheng-gaerdan',
  'qing-event-taiping': 'qing-taiping',
  'qing-event-gengzi': 'qing-baguo',
  // 隋朝
  'sui-event-pingchen': 'sui-pingchen',
  'sui-event-zhuojun': 'sui-zheng-gaogouli',
  'sui-event-jiangdu': 'sui-jiangdu',
  // 五代
  'wudai-event-houtang': 'wudai-houtang-mie-liang',
  'wudai-event-chairong': 'wudai-chairong-beifa',
};

/** 显示与事件关联的路线（动态绘制，起终点按图例颜色：起点绿/终点深红） */
function showEventRoute(ev) {
  const routeId = EVENT_ROUTE_MAP[ev.eventId];
  if (!routeId) return;
  // 郑和航线是特殊层（zhenghe），单独处理
  if (routeId === 'zhenghe-west') {
    (leafletLayers.zhenghe || []).forEach((x) => { if (x.setStyle) x.setStyle({ opacity: 1 }); });
    const lines = leafletLayers.zhenghe || [];
    [lines[0], lines[1]].forEach((l) => l && animateRoute({ line: l, wps: [], sMark: null, eMark: null }, 1800));
    return;
  }
  // 普通路线：找 data.routes 里的索引
  const domesticRoutes = (DATA.routes || []).filter((r) => r.id !== 'zhenghe-west');
  const idx = domesticRoutes.findIndex((r) => r.id === routeId);
  const layer = (leafletLayers.routes || [])[idx];
  if (layer) animateRoute(layer, 1500);
  // 同步详情面板
  const route = domesticRoutes[idx];
  if (route) showRouteDetail(route);
}

function showSingleEvent(ev, opts = {}) {
  if (!leafletMap) return;
  // 清理旧的路线动画定时器，防止残留动画覆盖新状态（两条路线问题）
  clearRouteAnimations();
  // 默认 zoom=8 放大定位；胶囊点击传 {zoom:false} 只定位不放大（保持当前缩放）
  const targetZoom = opts.zoom === false ? Math.max(leafletMap.getZoom(), 4) : 8;
  // 隐藏所有国内路线与郑和
  (leafletLayers.routes || []).forEach((l) => {
    l.line.setStyle({ opacity: 0, fillOpacity: 0 });
    l.wps.forEach((w) => w.setStyle({ opacity: 0, fillOpacity: 0 }));
    hideRouteMarker(l.sMark);
    hideRouteMarker(l.eMark);
  });
  (leafletLayers.zhenghe || []).forEach((x) => { if (x.setStyle) x.setStyle({ opacity: 0, fillOpacity: 0 }); });
  // 移除所有事件点（再按需加回目标）
  (leafletLayers.events || []).forEach((m) => { if (m && leafletMap) leafletMap.removeLayer(m); });
  // 找到目标事件所在聚合标记（按 _evtIds 匹配）
  const target = (leafletLayers.events || []).find((m) => (m._evtIds || []).includes(ev.eventId) || m._evtId === ev.eventId);
  // 移除所有城市点
  (leafletLayers.places || []).forEach((m) => { if (m && leafletMap) leafletMap.removeLayer(m); });
  // 加回目标标记（若有聚合，只显示该聚合；否则现场建一个单点）
  let flyTarget = target;
  if (target) {
    target.addTo(leafletMap);
  } else {
    // 目标不在当前渲染的事件列表（可能被年号过滤）：直接用单事件建 marker
    const place = ev.place || {};
    const div = L.divIcon({
      className: 'map-event',
      html: `<div class="map-event-inner">
        <span class="map-event-icon">⚑</span>
        <span class="map-event-name">${place.name || ev.name}</span>
        <span class="map-event-modern">${place.modern ? '（今' + place.modern + '）' : ''}</span>
      </div>`,
      iconSize: null,
    });
    flyTarget = L.marker([ev.lat, ev.lng], { icon: div });
    flyTarget._evtIds = [ev.eventId];
    flyTarget.addTo(leafletMap);
    leafletLayers.events.push(flyTarget);
  }
  // 飞到该地点，到达后弹窗
  mapFlyTo({ lat: ev.lat, lng: ev.lng }, targetZoom, 1.4, () => {
    // 若目标是聚合（多事件同地），弹该地全部事件；单事件弹详情
    const clusterEvs = flyTarget._evtIds && flyTarget._evtIds.length > 1
      ? (flyTarget._evtIds.map((id) => (DATA.mapEvents || []).find((e) => e.eventId === id)).filter(Boolean))
      : null;
    if (clusterEvs && clusterEvs.length > 1) {
      showEventPopup(clusterEvs, { name: (ev.place && ev.place.name) || ev.name, modern: (ev.place && ev.place.modern) || '' });
    } else {
      showEventPopup(ev);
    }
    // 若事件关联路线，动态绘制该路线（起终点按图例色：绿起点/深红终点）
    showEventRoute(ev);
    setTimeout(() => {
      const el = flyTarget.getElement && flyTarget.getElement();
      if (el) {
        el.classList.remove('map-flash');
        void el.offsetWidth;
        el.classList.add('map-flash');
      }
    }, 120);
  });
}

/** 路线详情：点击路线按钮后，在地图下方展示背景说明与途经点 */
function showRouteDetail(r) {
  const box = $('#route-detail');
  if (!box) return;
  const stops = (r.points || []).map((p) =>
    `${p.name}${p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : ''}`).join(' → ');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="route-detail-head" style="border-color:${r.color || '#c0392b'}">
      <span class="route-detail-name">🛤️ ${r.name}</span>
      <span class="route-detail-year">${r.year || ''}</span>
    </div>
    <div class="route-detail-desc">${r.desc || ''}</div>
    <div class="route-detail-path"><b>路线：</b>${stops}</div>
    <ol class="route-detail-stops">${(r.points || []).map((p) => `
      <li><b>${p.name}${p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : ''}</b> —— ${p.note || ''}</li>`).join('')}
    </ol>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideRouteDetail() {
  const box = $('#route-detail');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

function showPopup(name, modern, story) {
  const pop = $('#map-popup');
  if (!pop) return;
  pop.classList.remove('hidden');
  const modernTxt = modern ? ` <small style="color:#8a7a5c">（今${modern}）</small>` : '';
  pop.innerHTML = `<button class="close" aria-label="关闭">✕</button>
    <h4>${name}${modernTxt}</h4>
    <p>${story}</p>`;
  pop.querySelector('.close').addEventListener('click', () => pop.classList.add('hidden'));
}

/** 事件弹窗：evs 为单个事件 或 同地名聚合的事件数组
 *  单个 → 详情；多个 → 该地事件列表（每行可点开看详情） */
function showEventPopup(evs, cluster) {
  const pop = $('#map-popup');
  if (!pop) return;
  pop.classList.remove('hidden');
  // 聚合模式：多个事件在同一地点
  if (Array.isArray(evs)) {
    const c = cluster || {};
    const placeName = c.name || (evs[0] && (evs[0].place && evs[0].place.name)) || '';
    const modern = c.modern ? `（今${c.modern}）` : '';
    const rows = evs.map((ev) => {
      const full = (DATA.events || []).find((e) => e.id === ev.eventId);
      const summary = (full && full.summary) || ev.summary || ev.note || '';
      return `<button class="popup-event-row" data-evt-id="${ev.eventId}">
        <b>${ev.date}年 · ${ev.name}</b>
        <span class="popup-event-summ">${summary.slice(0, 40)}${summary.length > 40 ? '…' : ''}</span>
      </button>`;
    }).join('');
    pop.innerHTML = `<button class="close" aria-label="关闭">✕</button>
      <h4>📍 ${placeName}${modern}</h4>
      <p style="font-size:13px;color:#5c5140;margin:0 0 8px">这里发生了 ${evs.length} 个事件：</p>
      <div class="popup-event-list">${rows}</div>`;
    pop.querySelector('.close').addEventListener('click', () => pop.classList.add('hidden'));
    // 点击某事件 → 替换为单事件详情
    pop.querySelectorAll('.popup-event-row').forEach((row) => {
      row.addEventListener('click', () => {
        const ev = (DATA.mapEvents || []).find((e) => e.eventId === row.dataset.evtId);
        if (ev) showEventPopup(ev);
      });
    });
    return;
  }
  // 单事件模式：完整详情
  const ev = evs;
  const full = (DATA.events || []).find((e) => e.id === ev.eventId);
  const story = full ? full.narrative : (ev.summary || ev.note || '');
  const people = full && full.participants ? full.participants.join('、') : '';
  const place = ev.place || {};
  const placeTxt = place.name ? `${place.name}${place.modern ? '（今' + place.modern + '）' : ''}` : '';
  pop.innerHTML = `<button class="close" aria-label="关闭">✕</button>
    <h4>${ev.name} <small style="color:#8a7a5c">· ${ev.date}年</small></h4>
    ${placeTxt ? `<p style="font-size:13px;color:#247bc1;font-weight:600;margin:0 0 4px">📍 ${placeTxt}</p>` : ''}
    <p style="font-size:13px;color:#c0392b;font-weight:600;margin:0 0 6px">${place.note || ev.note || ''}</p>
    ${people ? `<p style="font-size:13px;color:#247bc1;margin:0 0 6px"><b>核心人物：</b>${people}</p>` : ''}
    <p>${story}</p>`;
  pop.querySelector('.close').addEventListener('click', () => pop.classList.add('hidden'));
}

// ---------- 界面四：历史侦探 ----------
// 线索不再硬编码：每个任务给出检索词（queries）与一个开放问题（open），
// 线索由 search-core.js 在知识库里实时检索生成，每条带出处。
// 侦探谜案库按朝代组织：每朝 3 个「历史悬案」，全年龄向（儿童与成人都适用）。
// queries 用该朝 events.json 的确切事件名 / 皇帝名，保证 search-core 一定命中；
// open 为没有标准答案的思辨题（附双视角），create 为动手创作。
const DETECTIVE_TASKS_BY_DYNASTY = {
  sui: [
    {
      title: '侦探档案 · 隋 1', quest: '隋文帝攒下那么厚的家底，隋炀帝为什么十几年就亡了国？',
      queries: ['开凿大运河', '三征高句丽', '江都之变'],
      open: {
        question: '大运河利在千秋，当时却累死了无数百姓——这功过该怎么算？',
        viewpoints: ['有人说功在千秋：大运河打通南北，唐宋都靠它运粮。', '有人说操之过急：大工程、大战争一起上，百姓活不下去。'],
      },
      create: '结合线索，列出隋炀帝十几年间做了哪几件「掏空家底」的大事，说说百姓为什么会活不下去。',
    },
    {
      title: '侦探档案 · 隋 2', quest: '陈后主躲进胭脂井，近三百年的大分裂是怎么结束的？',
      queries: ['隋灭陈统一', '杨坚代周建隋', '杨坚'],
      open: {
        question: '南陈亡国，只因陈后主荒淫吗？还是统一本就是大势所趋？',
        viewpoints: ['有人说君主昏庸：陈后主醉生梦死、奏报都不看。', '有人说大势所趋：隋朝强盛，南陈气数已尽。'],
      },
      create: '结合线索，说说隋军是怎么打过长江、灭掉南陈的，为什么三百年的分裂这时能结束。',
    },
    {
      title: '侦探档案 · 隋 3', quest: '隋文帝常被和秦始皇并列，他到底做了什么了不起的事？',
      queries: ['杨坚代周建隋', '隋灭陈统一', '杨坚'],
      open: {
        question: '隋文帝勤俭治国、开创科举，却立了个败家的儿子——选继承人有多重要？',
        viewpoints: ['有人说制度重要：科举、三省六部影响深远。', '有人说接班致命：再厚的家底也架不住继承人挥霍。'],
      },
      create: '结合线索，说出隋文帝结束分裂、制度创新的两三件大事，想想他为什么能和秦始皇并列。',
    },
  ],
  tang: [
    {
      title: '侦探档案 · 唐 1', quest: '李世民为什么要在玄武门杀掉自己的亲兄弟？',
      queries: ['玄武门之变', '贞观之治', '李世民'],
      open: {
        question: '皇位靠杀兄弟夺来，却开创了贞观之治——该怎么看李世民？',
        viewpoints: ['有人说英明：贞观之治、从谏如流是最好证明。', '有人说残忍：骨肉相残，给唐朝开了武力夺嫡的坏头。'],
      },
      create: '结合线索，说说李世民和李建成兄弟怎么一步步走到兵戎相见，玄武门那天到底发生了什么。',
    },
    {
      title: '侦探档案 · 唐 2', quest: '开元盛世那么辉煌，为什么一场安史之乱就让盛唐戛然而止？',
      queries: ['安史之乱', '开元盛世', '李隆基'],
      open: {
        question: '安禄山身兼三镇节度使（手握三个军区的兵权），是谁给了他这么大权力？',
        viewpoints: ['有人说制度之祸：节度使军权、财权太大，中央压不住。', '有人说用人之失：玄宗晚年怠政、宠信杨国忠。'],
      },
      create: '结合线索，说说盛极一时的唐朝为什么压不住安禄山，安史之乱是怎么把盛唐打断的。',
    },
    {
      title: '侦探档案 · 唐 3', quest: '中国历史上唯一的女皇帝，凭什么能坐稳江山？',
      queries: ['武则天称帝', '武曌', '开元盛世'],
      open: {
        question: '武则天重用酷吏、也开创殿试——该如何评价她？',
        viewpoints: ['有人说有为：打击门阀、提拔寒门、知人善任。', '有人说严酷：告密成风，冤杀了不少人。'],
      },
      create: '结合线索，说说武则天从才人到皇帝靠的是什么手段和能力，为什么一个女人能改朝换代。',
    },
  ],
  wudai: [
    {
      title: '侦探档案 · 五代 1', quest: '石敬瑭割让燕云十六州，到底埋下了多大的祸？',
      queries: ['石敬瑭割燕云十六州', '石敬瑭', '陈桥兵变'],
      open: {
        question: '石敬瑭自称「儿皇帝」、割地求援，是短视还是无奈？',
        viewpoints: ['有人说短视：为了皇位出卖战略要地，祸害四百年。', '有人说无奈：实力不足，只能借契丹兵力翻盘。'],
      },
      create: '结合线索，说说燕云十六州为什么是中原的北大门，石敬瑭割让后，中原在之后几百年里为此吃了什么亏。',
    },
    {
      title: '侦探档案 · 五代 2', quest: '周世宗柴荣若不英年早逝，历史会改写吗？',
      queries: ['高平之战', '陈桥兵变', '柴荣'],
      open: {
        question: '柴荣励精图治却壮志未酬，这种「出师未捷」的遗憾该怎么看？',
        viewpoints: ['有人说可惜：再给十年，或许能收复燕云。', '有人说历史无如果：宋朝随后也完成了统一。'],
      },
      create: '结合线索，说说柴荣短短几年做了哪些大事（高平之战、整顿禁军、三征南唐、北伐契丹），他早逝为什么让人惋惜。',
    },
    {
      title: '侦探档案 · 五代 3', quest: '五代为什么「五十三年换五朝」，皇帝多靠兵变上台？',
      queries: ['朱温篡唐', '白马驿之祸', '陈桥兵变'],
      open: {
        question: '「天子，兵强马壮者当为之」——这种逻辑带来了什么？',
        viewpoints: ['有人说是乱世常态：谁兵强谁就说了算。', '有人说后患无穷：规矩和秩序荡然无存。'],
      },
      create: '结合线索，说说这五十三年为什么政变、兵变不断，武将拥立皇帝为什么成了常态。',
    },
  ],
  song: [
    {
      title: '侦探档案 · 宋 1', quest: '经济文化最繁荣的北宋，为什么会被金兵整窝端了？',
      queries: ['靖康之变', '王安石变法', '建炎南渡'],
      open: {
        question: '重文轻武带来了文化繁荣，也导致军力孱弱——这笔账该怎么算？',
        viewpoints: ['有人说文治可取：宋代文化、科技登峰造极。', '有人说积弱致命：亡国的教训太过惨痛。'],
      },
      create: '结合线索，说说北宋那么富、文化那么盛，为什么军力孱弱，最后被金兵攻破开封（靖康之变）。',
    },
    {
      title: '侦探档案 · 宋 2', quest: '岳飞连战连捷，为什么被十二道金牌召回、最终遇害？',
      queries: ['岳飞抗金', '绍兴和议', '岳飞'],
      open: {
        question: '宋高宗和秦桧，为什么非要杀岳飞不可？',
        viewpoints: ['有人说私心：怕岳飞迎回徽、钦二帝，皇位不保。', '有人说求和：岳飞是绍兴和议的障碍。'],
      },
      create: '结合线索，说说岳飞明明能打，宋高宗和秦桧为什么非要把他召回、害死。',
    },
    {
      title: '侦探档案 · 宋 3', quest: '王安石新法的初衷很好，为什么争议那么大？',
      queries: ['王安石变法', '庆历新政', '王安石'],
      open: {
        question: '好政策为什么一执行就走了样？',
        viewpoints: ['有人说方向对：抑制兼并、充实国库、整军强兵。', '有人说执行坏：青苗钱被强行摊派，百姓反而更苦。'],
      },
      create: '结合线索，说说王安石变法想解决什么问题，为什么有人叫好、有人反对，执行中又出了什么偏差。',
    },
  ],
  yuan: [
    {
      title: '侦探档案 · 元 1', quest: '蒙古军队为什么能打下空前辽阔的疆域？',
      queries: ['忽必烈建国号大元', '襄阳之战', '崖山海战'],
      open: {
        question: '元朝实现了大一统、留下行省制，也实行等级制度——该怎么看？',
        viewpoints: ['有人说功业：行省制、大一统影响深远。', '有人说压迫：四等人制埋下了民族矛盾。'],
      },
      create: '结合线索，说说蒙古骑兵靠什么打遍欧亚，忽必烈建元朝又留下了哪些制度（如行省）。',
    },
    {
      title: '侦探档案 · 元 2', quest: '崖山海战，陆秀夫为什么背着小皇帝投海、十万军民殉国？',
      queries: ['崖山海战', '临安出降', '襄阳之战'],
      open: {
        question: '「崖山之后无中华」这种说法成立吗？',
        viewpoints: ['有人说文化重创：十万军民殉国，南宋彻底灭亡。', '有人说文明未断：元朝也承袭中原正统、延续了制度。'],
      },
      create: '结合线索，说说南宋朝廷怎么一路败退到崖山，陆秀夫背帝投海、十万军民殉国意味着什么。',
    },
    {
      title: '侦探档案 · 元 3', quest: '脱脱修史、治河、改革，为什么还是救不了元朝？',
      queries: ['高邮之战与脱脱罢相', '红巾军起义', '明军克大都'],
      open: {
        question: '史书说「元亡自脱脱罢相始」——一个人能决定王朝的存亡吗？',
        viewpoints: ['有人说关键：临阵换帅，元军主力当场溃散。', '有人说积弊已深：社会矛盾早就激化了。'],
      },
      create: '结合线索，说说脱脱那么能干为什么还是救不了元朝，元朝是怎样一步步走向灭亡的。',
    },
  ],
  ming: [
    {
      title: '侦探档案 · 明 1', quest: '朱元璋船小，为什么能在鄱阳湖火攻灭掉强大的陈友谅？',
      queries: ['鄱阳湖之战', '朱元璋', '刘基'],
      open: {
        question: '火攻要借风，这一仗靠的是实力还是运气？',
        viewpoints: ['有人说实力：船小灵活、敢拼，能抓住战机。', '有人说运气：若不刮东北风，火船根本靠不过去。'],
      },
      create: '结合线索，说说兵力弱小的朱元璋为什么能在鄱阳湖以弱胜强、用火攻灭掉陈友谅。',
    },
    {
      title: '侦探档案 · 明 2', quest: '明英宗亲征，为什么在土木堡全军覆没、自己被俘？',
      queries: ['土木堡之变', '北京保卫战', '于谦'],
      open: {
        question: '皇帝被俘，朝廷该南迁还是死守？于谦的选择对吗？',
        viewpoints: ['有人说死守对：保住北京，就是保住明朝。', '有人说冒险：皇帝还在敌人手里，怕被加害。'],
      },
      create: '结合线索，说明英宗为什么会在土木堡惨败被俘，于谦又是怎么力挽狂澜守住北京的。',
    },
    {
      title: '侦探档案 · 明 3', quest: '崇祯帝非常勤政，明朝为什么还是亡在他手里？',
      queries: ['明末农民起义', '袁崇焕案', '崇祯自缢煤山'],
      open: {
        question: '勤政就一定能当好皇帝吗？明朝灭亡到底是谁的过错？',
        viewpoints: ['有人说大势已去：天灾、起义、清军三面夹击。', '有人说君主有过：多疑急躁、自毁长城。'],
      },
      create: '结合线索，说说崇祯那么勤政，明朝为什么还是亡了，主因有哪几条。',
    },
  ],
  qing: [
    {
      title: '侦探档案 · 清 1', quest: '八旗兵力不多，清朝为什么能入主中原、统治近 270 年？',
      queries: ['清军入关定都北京', '努尔哈赤建立后金', '皇太极改国号为清'],
      open: {
        question: '吴三桂引清兵入关，真是「冲冠一怒为红颜」吗？',
        viewpoints: ['有人说为红颜：爱妾陈圆圆被抢，怒而降清。', '有人说为利益：李自成在北京拷打明朝官员，吴三桂怕自身难保。'],
      },
      create: '结合线索，说明八旗兵力那么少，清朝为什么能入关、定都北京并坐稳近三百年天下。',
    },
    {
      title: '侦探档案 · 清 2', quest: '康熙、雍正、乾隆三朝的盛世，底下藏着什么隐患？',
      queries: ['雍正设军机处', '施琅平台湾', '马戛尔尼来华'],
      open: {
        question: '文字狱、闭关锁国和疆域一统并存，该如何评价康乾盛世？',
        viewpoints: ['有人说是盛世：疆域最大、人口激增、国库充盈。', '有人说有隐忧：思想被禁锢，又错过了西方的工业革命。'],
      },
      create: '结合线索，说说康乾盛世看似强盛，底下藏着哪些问题（如文字狱、闭关锁国、人口压力）。',
    },
    {
      title: '侦探档案 · 清 3', quest: '「天朝上国」为什么会被英国的坚船利炮打败？',
      queries: ['南京条约', '虎门销烟', '马戛尔尼来华'],
      open: {
        question: '闭关锁国几十年，落后的仅仅是武器吗？',
        viewpoints: ['有人说制度落后：专制僵化，社会没有活力。', '有人说技术差距：工业国打农业国，是代差。'],
      },
      create: '结合线索，说说鸦片战争时清朝为什么打不过英国，《南京条约》又定下了哪些屈辱条款。',
    },
  ],
};

const DYNASTY_LABEL = { sui: '隋朝', tang: '唐朝', wudai: '五代十国', song: '宋朝', yuan: '元朝', ming: '明朝', qing: '清朝' };

let detectiveIndex = 0;
function detectiveTasks() {
  return DETECTIVE_TASKS_BY_DYNASTY[currentDynasty] || DETECTIVE_TASKS_BY_DYNASTY.ming;
}
function renderDetective() {
  const tasks = detectiveTasks();
  detectiveIndex = detectiveIndex % tasks.length;
  const t = tasks[detectiveIndex];
  const openHtml = t.open ? `<div class="open-question">
      <span class="open-tag">💬 思辨一下（没有标准答案）</span>
      <span class="open-q">${t.open.question}${t.open.context ? '　' + t.open.context : ''}</span>
      ${t.open.viewpoints && t.open.viewpoints.length ? `<span class="open-views">${t.open.viewpoints.join('　｜　')}</span>` : ''}
    </div>` : '';
  $('#detective-week').innerHTML = `<h3>${t.title}</h3><div class="quest">🕵️ ${t.quest}</div>${openHtml}
    <div class="detective-nav">
      <button id="detective-prev" class="route-btn">◀ 上一案</button>
      <span class="detective-count">第 ${detectiveIndex + 1} / ${tasks.length} 案</span>
      <button id="detective-next" class="route-btn">下一案 ▶</button>
    </div>`;
  $('#detective-prev').addEventListener('click', () => {
    detectiveIndex = (detectiveIndex - 1 + tasks.length) % tasks.length;
    renderDetective();
  });
  $('#detective-next').addEventListener('click', () => {
    detectiveIndex = (detectiveIndex + 1) % tasks.length;
    renderDetective();
  });

  const cluesWrap = $('#detective-clues');
  cluesWrap.innerHTML = '<h4>🧩 收集到的线索 <small style="color:#8a7a5c;font-weight:400">（来自本项目已核对史料，每条附出处）</small></h4>';
  // 动态检索生成线索
  const clues = SEARCH.cluesFor(t);
  clues.forEach((c) => {
    const card = el('div', 'clue-card');
    card.innerHTML = `<div class="clue-title">📌 ${c.title}</div><div>${c.text}</div><div class="clue-src">${c.src}</div>`;
    cluesWrap.appendChild(card);
  });

  // AI 史老师追问：让 AI 基于史实回答（替代旧的知识库关键词检索）
  renderDetectiveAsk();

  // 你的回答（放在线索下方，作为档案作答区；输入静默保存不丢稿）
  const storeKey = `${currentDynasty}-create-${detectiveIndex}`;
  $('#detective-create').innerHTML = `<h4>✍️ 你的回答</h4>
    <div class="create-box">
      <div class="create-prompt"><b>围绕本案作答：</b>${t.quest}<br><small style="color:#8a7a5c">💡 ${t.create}</small></div>
      <textarea id="create-input" placeholder="结合上面的线索，写下你的判断或答案…"></textarea>
      <div class="create-actions">
        <button id="create-ai" class="create-save llm-btn" title="让 AI 老师结合线索与史实点评">🤖 请 AI 老师点评</button>
      </div>
      <div id="create-ai-result" class="create-ai-result"></div>
    </div>`;
  const saved = localStorage.getItem(storeKey);
  if (saved) $('#create-input').value = saved;
  $('#create-input').addEventListener('input', (e) => { localStorage.setItem(storeKey, e.target.value.trim()); });
  $('#create-ai').addEventListener('click', async () => {
    const v = $('#create-input').value.trim();
    const out = $('#create-ai-result');
    if (!v) { out.innerHTML = '<div class="ask-hint">先写下你的回答，AI 老师才能点评哦～</div>'; return; }
    out.innerHTML = '<div class="ask-hint">🤖 AI 老师正在结合线索点评…</div>';
    const clueDigest = clues.map((c) => `${c.title}：${c.text}`).join('\n');
    const d = await askHistoryTeacher(
`【本案要回答】${t.quest}
【可参考的已核对史料线索】
${clueDigest}

【我的回答】${v}

请结合上面的线索与史实点评我的回答：先用一句话肯定我抓对的地方；再指出与线索/史实不符、或遗漏的关键点；最后提一个能引我深入思考的问题。语气通俗、对学生友好。`);
    out.innerHTML = d.ok
      ? `<div class="ask-hit llm-answer"><b>🤖 AI 老师点评</b>：${formatReply(d.reply)}</div>`
      : `<div class="ask-hint">${escapeHtml(d.error || 'AI 点评失败')}</div>`;
  });

  renderDetectiveAI();
}

// 侦探页「AI 史老师」问答面板：让 AI 基于史实回答（替代旧的知识库关键词检索）
const ASK_SUGGESTIONS = [
  '这个朝代最重要的三件大事是什么？',
  '用三句话讲讲这个朝代的开国皇帝',
  '这个朝代由盛转衰的转折点是什么？',
  '假如我是当时的大臣，你会给我什么建议？',
];
function renderDetectiveAsk() {
  const wrap = $('#detective-ask');
  if (!wrap) return;
  wrap.innerHTML = '';
  const card = el('div', 'detective-ask-card');
  card.innerHTML = `
    <div class="ask-head">
      <span class="ask-head-title">🔎 还有疑问？问问 AI 史老师</span>
      <span class="ask-head-sub">让 AI 基于史实为你讲解、辩论，还能出「假如」题</span>
    </div>
    <div class="ask-chips">
      ${ASK_SUGGESTIONS.map((s) => `<button type="button" class="ask-chip">${s}</button>`).join('')}
    </div>
    <div class="ask-row">
      <input id="ask-input" placeholder="把你的历史问题写在这里，按回车提问…" />
      <button id="ask-btn" class="create-save llm-btn">提问</button>
    </div>
    <div id="ask-result"></div>`;
  wrap.appendChild(card);

  const input = $('#ask-input');
  const ask = async (q) => {
    const question = String(q || '').trim();
    const res = $('#ask-result');
    if (!question) { res.innerHTML = '<div class="ask-hint">先输入一个问题吧～</div>'; return; }
    res.innerHTML = '<div class="ask-hint">🤖 AI 史老师正在翻史料…</div>';
    const d = await askHistoryTeacher(question);
    if (d.ok) {
      res.innerHTML = `<div class="ask-hit llm-answer"><b>问：</b>${escapeHtml(question)}<br><b>🤖 AI 史老师：</b>${formatReply(d.reply)}</div>`;
    } else {
      const needConfig = /配置|接口|模型|connect|fetch|Failed/i.test(d.error || '');
      res.innerHTML = needConfig
        ? `<div class="ask-hint">还没连上 AI 史老师。点下方【🤖 AI老师配置】，填入接口地址、API Key 和模型即可。<br><button type="button" class="create-save llm-btn" id="ask-go-config" style="margin-top:8px">去配置 AI 老师</button></div>`
        : `<div class="ask-hint">${escapeHtml(d.error || 'AI 提问失败')}</div>`;
      $('#ask-go-config')?.addEventListener('click', () => {
        expandAIConfig(true);
        $('#detective-ai').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  };
  $('#ask-btn').addEventListener('click', () => ask(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(input.value); });
  card.querySelectorAll('.ask-chip').forEach((b) => {
    b.addEventListener('click', () => { input.value = b.textContent; ask(b.textContent); });
  });
}

// 带当前朝代上下文的 LLM 调用
async function askHistoryTeacher(question) {
  const label = DYNASTY_LABEL[currentDynasty] || '明朝';
  const ctx = [{ role: 'system', content: `用户当前正在学习【${label}】的历史；当用户说“这个朝代”时，指的就是${label}。回答请结合${label}的史实。` }];
  return askLLM(question, ctx);
}

/** 历史侦探页「AI老师配置」：默认折叠；模型可一键拉取 + 可搜索下拉点选（无需手填）。
 *  配置只存在本机。问答统一走上方「AI 史老师」面板，故此处不再放聊天框。 */
let fetchedModels = [];
function renderDetectiveAI() {
  const box = $('#detective-ai');
  if (!box) return;
  box.innerHTML = `
    <div class="detective-ai-card ai-config-card">
      <button type="button" id="ai-config-toggle" class="ai-config-toggle" aria-expanded="false">
        <span class="ai-config-toggle-title">🤖 AI老师配置</span>
        <span class="ai-config-toggle-sub">配置接口地址、密钥和模型 · 只保存在本机</span>
        <span class="ai-config-chevron">▾</span>
      </button>
      <div class="ai-config-body collapsed" id="ai-config-body">
        <div class="ai-config-row">
          <label class="ai-field">接口地址（OpenAI 兼容）
            <input id="ai-base-url" type="text" placeholder="https://api.deepseek.com/v1/chat/completions" />
          </label>
          <label class="ai-field">API Key
            <input id="ai-api-key" type="password" placeholder="sk-..." />
          </label>
        </div>
        <div class="ai-config-row">
          <label class="ai-field ai-field-model">默认模型
            <div class="model-combo">
              <input id="ai-model-input" type="text" placeholder="点右侧 ⬇ 自动拉取模型，再点 ▾ 选择" autocomplete="off" />
              <button type="button" id="ai-model-fetch" class="model-icon-btn" title="拉取该接口支持的模型列表">⬇</button>
              <button type="button" id="ai-model-open" class="model-icon-btn" title="展开模型列表选择">▾</button>
              <div class="model-menu hidden" id="ai-model-menu">
                <input type="text" id="ai-model-search" class="model-search" placeholder="搜索模型…" />
                <div class="model-options" id="ai-model-options"></div>
              </div>
            </div>
          </label>
          <label class="ai-field">活泼度（0-2）
            <input id="ai-temperature" type="number" min="0" max="2" step="0.1" value="0.7" />
          </label>
          <div class="ai-field ai-field-btns">
            <button id="ai-save" class="create-save llm-btn">保存配置</button>
            <span id="ai-save-msg" class="ai-save-msg"></span>
          </div>
        </div>
      </div>
    </div>`;

  // 回填已保存配置
  const c = llmConfig;
  if (c.baseUrl) $('#ai-base-url').value = c.baseUrl;
  if (c.apiKey) $('#ai-api-key').value = c.apiKey;
  if (c.model) $('#ai-model-input').value = c.model;
  if (c.temperature != null) $('#ai-temperature').value = c.temperature;

  // 折叠 / 展开
  $('#ai-config-toggle').addEventListener('click', () => {
    const collapsed = $('#ai-config-body').classList.toggle('collapsed');
    $('#ai-config-toggle').classList.toggle('open', !collapsed);
    $('#ai-config-toggle').setAttribute('aria-expanded', String(!collapsed));
  });

  // 收集当前表单（model 取 combobox 输入框）
  const collect = () => ({
    baseUrl: $('#ai-base-url').value.trim(),
    apiKey: $('#ai-api-key').value.trim(),
    model: $('#ai-model-input').value.trim(),
    temperature: parseFloat($('#ai-temperature').value),
  });

  // 先静默保存接口地址/密钥（/api/llm/models 依据已保存的 baseUrl 推导）
  async function persistSilent() {
    const body = collect();
    await fetch('/api/llm-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    llmConfig = Object.assign({}, llmConfig, body);
  }

  // 拉取模型列表
  const fetchBtn = $('#ai-model-fetch');
  async function fetchModels() {
    const msg = $('#ai-save-msg');
    fetchBtn.classList.add('spinning');
    msg.style.color = '#8a7a5c';
    msg.textContent = '正在拉取模型列表…';
    try {
      await persistSilent();
      const r = await fetch('/api/llm/models');
      const d = await r.json();
      if (d.ok && Array.isArray(d.models) && d.models.length) {
        fetchedModels = d.models;
        renderModelOptions('');
        msg.textContent = `✅ 已拉取 ${d.models.length} 个模型，点 ▾ 选择`;
        msg.style.color = '#2e7d32';
        openMenu(true);
        return true;
      }
      msg.textContent = '❌ 没拉到模型，请确认接口地址和密钥';
      msg.style.color = '#c0392b';
    } catch (e) {
      msg.textContent = '❌ 拉取失败：' + (e && e.message ? e.message : e);
      msg.style.color = '#c0392b';
    } finally {
      fetchBtn.classList.remove('spinning');
    }
    return false;
  }

  // 渲染模型选项（按搜索词过滤）
  const renderModelOptions = (filter) => {
    const f = String(filter || '').trim().toLowerCase();
    const list = fetchedModels.filter((m) => !f || m.toLowerCase().includes(f));
    const opts = $('#ai-model-options');
    if (!list.length) { opts.innerHTML = '<div class="model-empty">没有匹配的模型</div>'; return; }
    opts.innerHTML = list.map((m) =>
      `<button type="button" class="model-option" data-model="${escapeHtml(m)}">${escapeHtml(m)}</button>`).join('');
    opts.querySelectorAll('.model-option').forEach((b) => {
      b.addEventListener('click', () => {
        $('#ai-model-input').value = b.dataset.model;
        openMenu(false);
      });
    });
  };

  // 菜单开关
  const openMenu = (open) => {
    const menu = $('#ai-model-menu');
    menu.classList.toggle('hidden', !open);
    if (open) { $('#ai-model-search').value = ''; renderModelOptions(''); setTimeout(() => $('#ai-model-search').focus(), 0); }
  };

  $('#ai-model-fetch').addEventListener('click', fetchModels);
  $('#ai-model-open').addEventListener('click', async () => {
    const menu = $('#ai-model-menu');
    if (menu.classList.contains('hidden')) {
      if (!fetchedModels.length) { await fetchModels(); return; }
      openMenu(true);
    } else openMenu(false);
  });
  $('#ai-model-search').addEventListener('input', (e) => renderModelOptions(e.target.value));

  // 点菜单外部关闭
  document.addEventListener('click', (e) => {
    const combo = e.target.closest && e.target.closest('.model-combo');
    if (!combo) openMenu(false);
  });

  // 保存配置
  $('#ai-save').addEventListener('click', async () => {
    const msg = $('#ai-save-msg');
    msg.style.color = '#8a7a5c';
    msg.textContent = '保存中…';
    const body = collect();
    const r = await fetch('/api/llm-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.ok) {
      llmConfig = Object.assign({}, llmConfig, body);
      msg.textContent = '✅ 已保存，可以去问 AI 史老师了';
      msg.style.color = '#2e7d32';
    } else {
      msg.textContent = '❌ ' + (d.error || '保存失败');
      msg.style.color = '#c0392b';
    }
  });
}

/** 展开（true）或折叠（false）AI老师配置面板，供「去配置」按钮调用 */
function expandAIConfig(open) {
  const body = $('#ai-config-body');
  const toggle = $('#ai-config-toggle');
  if (!body || !toggle) return;
  body.classList.toggle('collapsed', !open);
  toggle.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
}

// ---------- 启动 ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchPage(tab.dataset.page));
});

// 朝代切换（宋 / 明）
// 按朝代应用页头/标题/地图 aria/图例/页脚文案（初始化与切换共用）
function applyDynastyText(d) {
  const txt = DYNASTY_TEXT[d] || DYNASTY_TEXT.ming;
  const brand = $('#brand');
  if (brand) brand.textContent = txt.brand;
  const title = document.querySelector('#page-timeline .page-title');
  if (title) title.textContent = txt.timelineTitle;
  const sub = document.querySelector('#page-timeline .page-sub');
  if (sub) sub.textContent = '';
  const mapLeaf = $('#map-leaf');
  if (mapLeaf) mapLeaf.setAttribute('aria-label', txt.mapAria);
  const legendNote = $('#legend-note');
  if (legendNote) legendNote.textContent = txt.legendNote;
  const footer = $('#footer');
  if (footer) footer.textContent = txt.footer;
}

async function switchDynasty(d) {
  if (d === currentDynasty) return;
  currentDynasty = d;
  activeEraId = null;
  detectiveIndex = 0;
  document.querySelectorAll('.dynasty-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.d === d);
  });
  // 更新页头/标题/图例/页脚文案（按配置表）
  applyDynastyText(d);
  // 重新加载数据并渲染
  try {
    await loadAll();
    await loadBoundaries();
    renderTimeline();
    renderDetective();
    // 切换朝代后自动展开第一位皇帝，卡片回到最左
    if (DATA.emperors && DATA.emperors[0]) {
      document.querySelectorAll('.emp-card').forEach((c) => c.classList.remove('active'));
      const wrap = $('#timeline-scroll');
      const first = wrap.querySelector('.emp-card');
      if (first) {
        first.classList.add('active');
        wrap.scrollTo({ left: 0, behavior: 'instant' });
      }
      showEmperor(DATA.emperors[0]);
    }
    // 地图页如有打开，重渲染
    if (!$('#page-map').classList.contains('hidden')) {
      renderEraStrip(); renderEraInfo(); renderMap();
      // 切换朝代后同样默认展开「该朝事件」汇总
      showEventsSummary();
      if (leafletMap) setTimeout(() => leafletMap.invalidateSize(), 60);
    }
    if (!$('#page-cases').classList.contains('hidden')) renderCases();
  } catch (e) {
    alert('切换朝代失败：' + e.message);
  }
}
document.querySelectorAll('.dynasty-btn').forEach((b) => {
  b.addEventListener('click', () => switchDynasty(b.dataset.d));
});

// 测试钩子（生产无害）：供 smoke/浏览器测试直接触发渲染
window.__mingTest = { renderMap, showEmperor, renderTimeline, renderCases, showRouteDetail, hideRouteDetail, buildMapData, switchDynasty, showEventsSummary, buildEventClusters, showSingleEvent, get DATA() { return DATA; }, get SEARCH() { return typeof SEARCH !== 'undefined' ? SEARCH : null; }, get leafletMap() { return leafletMap; } };

// 各朝真实边界 GeoJSON（loadBoundaries 填充；文件不存在则该朝为 null，地图回退示意色块）
let MAP_GEO = {};

// 加载当前朝代的边界 GeoJSON（手绘简化或 CHGIS）；文件不存在则回退硬编码示意色块
async function loadBoundaries() {
  const key = currentDynasty;
  const file = `../data/boundaries/${key}.geojson`;
  try {
    const r = await fetch(file);
    if (r.ok) {
      MAP_GEO[key] = await r.json();
    } else {
      MAP_GEO[key] = null;
    }
  } catch {
    MAP_GEO[key] = null;
  }
}

// 各朝行政区划区块说明（点击色块弹出"这是什么地方"，给孩子讲清楚划分依据）
// key 与 geojson features 的 properties.name 对应
const REGION_NOTES = {
  // 明朝：两京十三布政使司 + 辽东都司
  '京师（北直隶）': '明朝两个首都之一北京所在地，皇帝直管，所以叫"直隶"。',
  '南京（南直隶）': '朱元璋建都南京，朱棣迁都后这里仍是陪都，直属中央，管着江南富庶之地。',
  '山东': '北方大省，孔子故乡曲阜在这里。',
  '山西': '太行山以西，边军重镇，太原是大本营。',
  '河南': '中原腹地，古都洛阳、开封都在这里。',
  '陕西': '西北门户，长安（西安）就在这，长城起点嘉峪关归它管。',
  '四川': '"天府之国"，盆地富饶，成都为中心。',
  '湖广': '今天的湖南湖北两省合称，鱼米之乡。',
  '浙江': '沿海富省，杭州是丝绸之府。',
  '江西': '鄱阳湖所在地，朱元璋曾在这里大战陈友谅。',
  '福建': '东南山区沿海省，郑和下西洋常从这边出海。',
  '广东': '南方大港，广州是海外贸易重镇。',
  '广西': '多民族地区，靠近安南（越南）。',
  '云南': '西南边疆，大理、昆明都在这里。',
  '贵州': '西南山区，明中期才正式设省。',
  '辽东都司': '东北军事辖区，守护山海关外，防女真。',
  // 唐朝：十道 + 西域都护府
  '关内·京畿道': '唐朝首都长安所在的核心区，京畿直辖区。',
  '关内道·西域（安西都护府）': '唐朝在新疆一带设立的西域统治机构，管理丝绸之路。',
  '河北道': '黄河以北，今天河北、北京一带，安禄山就是从这里反的。',
  '河东道': '黄河以东（山西），太原是唐朝的龙兴之地。',
  '陇右道': '河西走廊一带，丝绸之路要道。',
  '朔方·北庭都护府': '北方草原门户，防御突厥、管理西域北部。',
  '河南道': '黄河以南到淮河，洛阳、开封一带。',
  '江南东道': '长江以南东部，苏州、杭州所在地。',
  '江南西道': '长江以南西部，今天江西一带。',
  '剑南道': '四川一带，李白就是在蜀地长大的。',
  '岭南道': '五岭以南，今天广东广西，广州是南方大港。',
  '南诏': '西南的独立王国，在今天的云南，后来与唐朝时战时和。',
  // 元朝：行省制（行省制度从此开始）
  '岭北行省': '蒙古高原大本营，首都上都就在这附近。',
  '辽阳行省': '东北地区，控制女真等部。',
  '中书省（腹里）': '元朝首都大都（今北京）所在的核心直辖区，归中书省直管。',
  '陕西行省': '西北，长安所在地。',
  '甘肃行省': '河西走廊，丝绸之路要道。',
  '四川行省': '"天府之国"，成都为中心。',
  '河南江北行省': '黄河以南、长江以北，中原腹地。',
  '湖广行省': '今天湖南湖北广西一部分，鱼米之乡。',
  '江浙行省': '最富庶的江南地区，杭州所在地，税收占全国三分之一。',
  '江西行省': '鄱阳湖一带。',
  '云南行省': '西南边疆，大理国被元朝征服后设省。',
  '陕西行省·四川行省以西（吐蕃等处宣慰司）': '青藏高原上的吐蕃地区，元朝设宣慰司管理。',
  // 清朝：乾隆年间大区
  '盛京·吉林·黑龙江': '清朝龙兴之地东北三省，盛京（今沈阳）是留都。',
  '外蒙古·喀尔喀': '漠北蒙古诸部，清朝在库伦（今乌兰巴托）设办事大臣。',
  '内蒙古·漠南': '长城以北的蒙古各部，与清朝关系最密切。',
  '直隶·山西·山东·河南': '北方核心四省，直隶是首都北京所在。',
  '陕西·甘肃·新疆（伊犁将军辖区）': '西北地区，新疆由伊犁将军统辖，平定准噶尔后纳入版图。',
  '西藏（驻藏大臣辖区）': '青藏高原，清朝派驻藏大臣与达赖喇嘛共治。',
  '四川·湖广': '长江中上游，四川盆地与两湖。',
  '浙江·江西·福建': '东南沿海三省。',
  '广东·广西·云南·贵州': '岭南与西南四省。',
  '台湾': '台湾岛，1684年清朝设台湾府，隶属福建。',
};

// 各朝区块轮换浅色调（同朝相邻区块用不同色相，肉眼可区分但整体仍是该朝主色调）
const REGION_TINTS = {
  ming: ['#e8c86a', '#d9b358', '#f0d68a', '#cfa94a', '#e3c47c'],
  tang: ['#e0b060', '#d0a050', '#edc478', '#c08a40', '#e6b978'],
  yuan: ['#a8c8b0', '#96b89e', '#bcd8c4', '#84a88c', '#b0ccb8'],
  qing: ['#c4d4c0', '#b2c4ae', '#d4e2d0', '#a0b4a0', '#c8d6c6'],
  song: ['#c8b8e0', '#b8a8d0', '#d8c8ec', '#a898c0', '#ccc0e4'],
};

// 各朝疆域色块与标题（真实边界存在时用 MAP_GEO，否则用这里的示意轮廓）
const DYNASTY_FILL = {
  ming: { fill: '#e8c86a', stroke: '#8a6d2f', title: '明 朝 疆 域（北以长城为界，轮廓据《明史·地理志》示意）' },
  tang: { fill: '#e0b060', stroke: '#9a6a1f', title: '唐 朝 疆 域（含西域安西·北庭都护府，据《中国历史地图集》简化示意）' },
  song: { fill: '#c8b8e0', stroke: '#5e4a8a', title: '宋 朝 疆 域（北宋北界白沟河·雁门，轮廓据《中国历史地图集》示意）' },
  yuan: { fill: '#a8c8b0', stroke: '#3f6b52', title: '元 朝 疆 域（岭北·辽阳各行省，据《中国历史地图集》简化示意）' },
  qing: { fill: '#c4d4c0', stroke: '#5a7a4a', title: '清 朝 疆 域（乾隆/嘉庆年间，据《中国历史地图集》简化示意）' },
  sui: { fill: '#d8c0e0', stroke: '#6a4a8a', title: '隋 朝 疆 域（据《中国历史地图集·隋时期》简化示意）' },
  wudai: { fill: '#e0b8a0', stroke: '#8a5a3a', title: '五 代 十 国（中原五代与南方十国并立，据《中国历史地图集》简化示意）' },
};

// ---------- LLM 配置（历史侦探页内卡片） ----------
// 配置经本地服务器写入 web/llm-config.json，只保存在本机
let llmConfig = {};

async function loadLLMConfig() {
  try {
    const r = await fetch('/api/llm-config');
    const d = await r.json();
    if (d.ok && d.config) llmConfig = d.config;
  } catch { /* 服务器不支持 API 时静默 */ }
  return llmConfig;
}

/** 调本地 LLM 代理（附带儿童历史系统提示词），返回 { ok, reply|error } */
async function askLLM(message, history = []) {
  const r = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, messages: history }),
  });
  return r.json();
}

(async function init() {
  try {
    await loadAll();
    // 加载当前朝代边界 GeoJSON；文件不存在则回退手绘示意
    await loadBoundaries();
    // LLM 配置（侦探页卡片内加载）
    loadLLMConfig();
    // 初始默认朝代（隋）的页头/图例/页脚文案
    applyDynastyText(currentDynasty);
    renderTimeline();
    renderDetective();
    // 默认展开第一位皇帝（隋朝即杨坚）的生平时间线，并让卡片呈现选中红底
    if (DATA.emperors && DATA.emperors[0]) {
      document.querySelectorAll('.emp-card').forEach((c) => c.classList.remove('active'));
      const wrap = $('#timeline-scroll');
      const first = wrap.querySelector('.emp-card');
      if (first) {
        first.classList.add('active');
        wrap.scrollTo({ left: 0, behavior: 'instant' });
      }
      showEmperor(DATA.emperors[0]);
    }
    // 地图在首次进入时渲染：按钮区 + 路线详情作为一个整体，插到图例前
    $('#map-route-btns') || (() => {
      const legend = document.querySelector('.map-legend');
      const panel = el('div', 'route-panel');
      panel.id = 'route-panel';
      const btns = el('div', 'route-toggle');
      btns.id = 'map-route-btns';
      const detail = el('div', 'route-detail hidden');
      detail.id = 'route-detail';
      panel.appendChild(btns);
      panel.appendChild(detail);
      legend.parentNode.insertBefore(panel, legend);
    })();
  } catch (e) {
    document.body.innerHTML = `<div style="max-width:600px;margin:80px auto;text-align:center;font-size:18px">
      <h2>😢 数据加载失败</h2>
      <p>${e.message}</p>
      <p style="color:#8a7a5c">请确认用本地服务器打开（node web/serve.mjs），而不是直接双击 HTML。</p>
    </div>`;
  }
})();