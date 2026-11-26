/* 中国历史图谱 · 交互层逻辑
   消费知识层 data/ 数据：emperors / people / events / places / routes
   纯原生 JS，零依赖。示意地图非精确边界。 */

'use strict';

// 数据文件构建号：追加到 fetch URL 末尾，避免浏览器缓存旧的 JSON（尤其是新增文件前的 404）
const APP_BUILD = '20261127d';

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
let currentDynasty = 'all'; // 'all' | 'sui' | 'tang' | 'wudai' | 'song' | 'yuan' | 'ming' | 'qing'
// 各朝数据缓存：切换朝代不重发请求（数据只读）
const DATA_CACHE = {};
// 进行中的朝代加载：快速连点朝代按钮时复用同一个请求，避免并发重复拉取 + 竞态覆盖
const DATA_PENDING = {};

// 年份解析：公元前用负数表示（「-221」＝前 221 年），后世的纯数字照旧。
// 早先 eraForYear 把非数字字符一律删掉，于是「-221」被读成 221，秦西汉的事件
// 会全部落到「三国」之后的皇帝头上；统一走这里。
function yearNum(str) {
  const s = String(str ?? '').trim();
  const m = s.match(/^(-?\d{1,4})/);
  return m ? parseInt(m[1], 10) : NaN;
}
// 年份展示：负数加「前」字，「-221」→「前221」；正整数原样返回
function fmtYear(str) {
  const n = yearNum(str);
  if (!Number.isFinite(n)) return String(str ?? '');
  return n < 0 ? `前${Math.abs(n)}` : String(n);
}
// 把事件年份归到对应朝代
function eraForYear(yearStr) {
  const y = yearNum(yearStr);
  if (!Number.isFinite(y) || !DATA) return null;
  for (const e of DATA.emperors) {
    const s = yearNum(e.reign.start);
    const en = yearNum(e.reign.end);
    if (y >= s && y <= en) return e.id;
  }
  // 年份超出所有皇帝在位范围：归到边界皇帝
  // 建立前（如 1363 鄱阳湖之战）→ 第一帝（太祖）；灭亡后（如 1645 南明）→ 末帝（思宗）
  const first = DATA.emperors[0];
  const last = DATA.emperors[DATA.emperors.length - 1];
  if (first) {
    const fs = yearNum(first.reign.start);
    if (y < fs) return first.id;
  }
  if (last) {
    const le = yearNum(last.reign.end);
    if (y > le) return last.id;
  }
  return null;
}

function renderEraStrip() {
  const strip = $('#era-strip');
  if (!strip) return;
  strip.innerHTML = '';
  const centerTo = (btn) => {
    // 被点击的年号自动滚到视口中央（用 rect 计算：按钮现在嵌在分组容器里，offsetLeft 不再相对条带）
    if (!btn) return;
    const sr = strip.getBoundingClientRect(), br = btn.getBoundingClientRect();
    const target = br.left - sr.left + strip.scrollLeft - (strip.clientWidth - br.width) / 2;
    const max = strip.scrollWidth - strip.clientWidth;
    strip.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: 'smooth' });
  };
  // 年号按朝代分组：组头标归属朝代，「全部」单独一组。
  // 「全部」视图下 DATA.emperors 已按 dynOrder 顺序合并并带 _dynasty，据此断组；
  // 单朝视图不需要组头——顶上那排朝代胶囊已经写明了是哪一朝，再标一次是重复。
  const groupBody = (label) => {
    const g = el('div', 'era-group');
    if (label) {
      const h = el('div', 'era-group-head');
      h.textContent = label;
      g.appendChild(h);
    }
    const body = el('div', 'era-group-body');
    g.appendChild(body);
    strip.appendChild(g);
    return body;
  };
  const allBody = groupBody(currentDynasty === 'all' ? '总览' : '');
  const allBtn = el('button', 'era-btn' + (activeEraId ? '' : ' active'));
  // 「全部」的年号范围按实际首位皇帝取，别再用写死的明朝区间——三国 220 起就要显示 220
  const range = currentDynasty === 'all' && DATA && DATA.emperors && DATA.emperors.length
    ? `${fmtYear(DATA.emperors[0].reign.start)}-${fmtYear(DATA.emperors[DATA.emperors.length - 1].reign.end)}`
    : (DYNASTY_RANGE[currentDynasty] || '1368-1644');
  allBtn.innerHTML = `<span class="era-name">全部</span><span class="era-years">${range}</span>`;
  allBtn.addEventListener('click', () => {
    activeEraId = null; evtSummaryShowAll = false;
    renderEraStrip(); renderMap(); renderEraInfo();
    showPlacesOnMap();   // 「全部」回到默认视图：只有城市/名胜，事件地标等点击再上图
    showEventsSummary(); // 保持「该朝事件」汇总展开（默认视图）
    centerTo(document.querySelector('#era-strip .era-btn'));
  });
  allBody.appendChild(allBtn);
  // 分组键：「全部」按朝代断组；汉这种一个节点装三段的，按段（西汉/新莽/东汉）断组；
  // 其余单朝视图整条就是一个组，不立组头（顶上那排朝代胶囊已经写明是哪一朝）。
  const mergedView = currentDynasty === 'all';
  const segView = !!DYNASTY_SEGS[currentDynasty];
  const groupKey = (e) => (mergedView ? (e._dynasty || currentDynasty) : segView ? (e.lineage || '') : '');
  const groupLabel = (e) => (mergedView
    ? (DYNASTY_LABEL[e._dynasty || currentDynasty] || '')
    : segView ? (LINEAGE_LABEL[e.lineage] || '') : '');
  let curKey = DATA.emperors.length ? groupKey(DATA.emperors[0]) : '\u0000';
  let curBody = allBody;
  if (DATA.emperors.length && curKey !== '') curBody = groupBody(groupLabel(DATA.emperors[0]));
  DATA.emperors.forEach((e) => {
    const k = groupKey(e);
    if (k !== curKey) {
      curKey = k;
      curBody = groupBody(groupLabel(e));
    }
    const btn = el('button', 'era-btn' + (activeEraId === e.id ? ' active' : ''));
    btn.innerHTML = `<span class="era-name">${e.eraName[0]}</span><span class="era-years">${fmtYear(e.reign.start)}-${fmtYear(e.reign.end)}</span>`;
    btn.addEventListener('click', () => {
      activeEraId = (activeEraId === e.id ? null : e.id);
      // 折叠态跟着年号复位：上一个年号展开过，换年号不应仍保持全展开
      evtSummaryShowAll = false;
      renderEraStrip(); renderMap(); renderEraInfo();
      // 选中某个年号＝只是收窄下方事件胶囊的范围，地图仍只留城市/名胜；
      // 事件地标一律等用户点具体胶囊再单独上图（一个年号十几个地标铺开一样会挤成一团）
      showPlacesOnMap();
      showEventsSummary(); // 保持「该朝事件」汇总展开（默认视图）
      centerTo(document.querySelector(`#era-strip .era-btn${activeEraId ? '.active' : ''}`));
    });
    curBody.appendChild(btn);
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
    strip.onScrollOnce = update;               // 同一元素只保留一个滚动处理器
    if (!strip._scrollWired) {
      strip._scrollWired = true;
      strip.addEventListener('scroll', () => strip.onScrollOnce && strip.onScrollOnce());
    }
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
  const people = (emp.people || []).map((p) => p.name).join('、') || '—';
  box.classList.remove('hidden');
  // 该年号的事件统一在下方「该年号事件」胶囊面板呈现，此处不再重复列出「地图上的事件」
  box.innerHTML = `
    <h4>${emp.eraName[0]}年间 · ${emp.name}（${emp.templeName}） ${fmtYear(emp.reign.start)}-${fmtYear(emp.reign.end)}</h4>
    <div class="era-row"><b>核心人物：</b>${people}</div>
  `;
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
  sanguo: 'sanguo/',
  jin: 'jin/',
  xia: 'xia/',
  shang: 'shang/',
  zhou: 'zhou/',
  qin: 'qin/',
  xihan: 'xihan/',
  xin: 'xin/',
  donghan: 'donghan/',
  han: 'xihan/',   // 汉节点的首个分段；三段全部由 DYNASTY_SEGS 拼（见下）
};
/* 一个大朝由多个数据目录拼成的情形：与「晋＝西晋＋东晋」同一套思路——
   节点只有一个，内部按段（lineage）分段，段牌由 renderTimeline 的 lineageMode 自动立。
   汉＝西京（西汉）＋新莽＋东京（东汉），三段共用一张舆图。 */
const DYNASTY_SEGS = {
  han: [
    { dir: 'xihan/',   tag: 'xihan',   lineage: 'hanwest', label: '西汉' },
    { dir: 'xin/',     tag: 'xin',     lineage: 'hanxin',  label: '新莽' },
    { dir: 'donghan/', tag: 'donghan', lineage: 'haneast', label: '东汉' },
  ],
};
// 地图层开关：有「地图」数据的朝代才去拉 places/routes/map-events 三库。
// 三国、两晋的并立政权边界没有现成 geojson（见 DYNASTY_HAS_GEO），
// 但地名、事件、路线都有独立数据，所以这里必须是 true，否则整块舆图是空的。
// 秦、西汉、新莽、东汉同样没有手绘边界 geojson，走「示意」路径。
const DYNASTY_HAS_MAP = { ming: true, tang: true, song: true, yuan: true, qing: true, sui: true, wudai: true, sanguo: true, jin: true, qin: true, han: true, xihan: true, xin: true, donghan: true, xia: true, shang: true, zhou: true };
// 是否有真实边界 geojson（data/boundaries/<朝>.geojson）。没有的朝代回退示意色块，不去发 404 请求。
const DYNASTY_HAS_GEO = { ming: true, tang: true, song: true, yuan: true, qing: true, sui: true, wudai: true, sanguo: false, jin: false, qin: false, han: false, xihan: false, xin: false, donghan: false, xia: false, shang: false, zhou: false };
// 年代范围：公元前用负数（-221 即前 221 年）
const DYNASTY_RANGE = {
  ming: '1368-1644', tang: '618-907', song: '960-1279', yuan: '1271-1368', qing: '1616-1912',
  sui: '581-618', wudai: '907-960', sanguo: '220-280', jin: '265-420',
  xia: '-2070--1600', shang: '-1600--1046', zhou: '-1046--256', qin: '-221--207', han: '-202-220', xihan: '-202-8', xin: '9-23', donghan: '25-220',
};
// 各朝文件布局：明朝各库在 data/ 根目录下分目录，其他朝在朝代目录内
const DYNASTY_LAYOUT = {
  ming: { people: 'people/people.json', cases: 'cases/cases.json', events: 'events/events.json', mapEvents: 'events/map-events.json', places: 'places/places.json', routes: 'routes/routes.json' },
  tang: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  song: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  yuan: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  qing: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  sui: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  wudai: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  sanguo: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  jin: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  qin: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  han: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  xihan: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  xin: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  donghan: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  xia: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  shang: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
  zhou: { people: 'people.json', cases: 'cases.json', events: 'events.json', mapEvents: 'map-events.json', places: 'places.json', routes: 'routes.json' },
};
// 各朝文案：品牌名、朝代胶囊副标题（帝数）、地图 aria、图例注、页脚
const DYNASTY_TEXT = {
  ming: {
    brand: '明朝', dynSub: '十六帝', mapAria: '明朝示意地图',
    legendNote: '省界据《中国历史地图集·明时期》手绘简化示意',
    footer: '疆域轮廓据《明史·地理志》示意，非精确边界 · 皇帝画像为 AI 生成工笔风格，仅供示意 · 内容以《明史》《明实录》为主要依据',
  },
  tang: {
    brand: '大唐风华', dynSub: '二十一帝', mapAria: '唐朝示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·唐时期》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》唐时期示意，非精确边界 · 内容以《旧唐书》《新唐书》《资治通鉴》为主要依据',
  },
  song: {
    brand: '大宋风云', dynSub: '十八帝', mapAria: '宋朝示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·北宋/南宋》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》两宋部分示意，非精确边界 · 人物头像为示意占位 · 内容以《宋史》《续资治通鉴长编》为主要依据',
  },
  yuan: {
    brand: '大元兴起', dynSub: '十一帝', mapAria: '元朝示意地图',
    legendNote: '省界据《中国历史地图集·元时期》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》元时期示意，非精确边界 · 内容以《元史》《新元史》为主要依据',
  },
  qing: {
    brand: '大清三百年', dynSub: '十二帝', mapAria: '清朝示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·清时期》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》清时期示意，非精确边界 · 内容以《清史稿》《清实录》为主要依据',
  },
  sui: {
    brand: '大隋一统', dynSub: '三帝', mapAria: '隋朝示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·隋时期》手绘简化示意',
    footer: '疆域轮廓据谭其骧《中国历史地图集》隋时期示意，非精确边界 · 内容以《隋书》《资治通鉴》为主要依据',
  },
  wudai: {
    brand: '五代十国', dynSub: '14帝', mapAria: '五代十国示意地图',
    legendNote: '疆域据谭其骧《中国历史地图集·五代十国时期》手绘简化示意',
    footer: '五代十国是唐末到宋初的大分裂时期 · 内容以《新五代史》《资治通鉴》为主要依据',
  },
  sanguo: {
    brand: '三国鼎立', dynSub: '十一帝', mapAria: '三国示意地图',
    legendNote: '三方疆界据《中国历史地图集·三国时期》示意，魏蜀吴以秦岭—淮河—长江为界',
    footer: '三国是东汉末年后魏、蜀、吴三方并立的时期 · 皇帝画像为 AI 生成工笔风格，仅供示意 · 内容以《三国志》及裴松之注为主要依据，参校《资治通鉴》《后汉书》《晋书》',
  },
  jin: {
    brand: '两晋十六国', dynSub: '十五帝', mapAria: '两晋示意地图',
    legendNote: '西晋、东晋与十六国政权并立，暂无疆域示意图，相关政权分布见帝王世系页的并立图',
    footer: '晋是三国归晋后西晋短暂统一、东晋南渡与十六国并立的时期 · 皇帝画像为 AI 生成工笔风格，仅供示意 · 内容以《晋书》帝载记为主要依据，参校《资治通鉴》《中国通史》',
  },
  xia: {
    brand: '夏后氏', dynSub: '十四世十七王', mapAria: '夏朝示意地图',
    legendNote: '夏代尚无手绘边界，疆域示意图据《中国历史地图集》与二里头、东下冯等遗址分布推定',
    footer: '夏代年代采《夏商周断代工程》推定值（约前2070—前1600），王世据《史记·夏本纪》《竹书纪年》互证 · 帝王画像为 AI 生成工笔风格，冠服据《礼记·檀弓》「夏后氏尚黑」推定 · 内容以《史记》《竹书纪年》《左传》《尚书》为主要依据',
  },
  shang: {
    brand: '殷商', dynSub: '十七世三十王', mapAria: '商朝示意地图',
    legendNote: '王畿与方国分布据《中国历史地图集》与郑州商城、殷墟、吴城等遗址示意，非精确边界',
    footer: '商代年代采《夏商周断代工程》推定值（约前1600—前1046），王世据《史记·殷本纪》与甲骨卜辞互证，具体年份均为推定 · 帝王画像为 AI 生成工笔风格，冠服据《礼记·檀弓》「殷人尚白」推定 · 内容以《史记》《尚书》《竹书纪年》与甲骨卜辞为主要依据 · 人物画像待补',
  },
  zhou: {
    brand: '周礼天下', dynSub: '三十七王', mapAria: '周朝示意地图',
    legendNote: '西周王畿在丰镐、东周王畿在洛邑，诸侯与戎狄分布据《中国历史地图集》示意，非精确边界',
    footer: '周代年代采《夏商周断代工程》推定值（前1046 克商—前771 西周终；东周至前256 秦灭西周），西周王世据《史记·周本纪》与青铜器铭文互证，东周依《左传》系年，具体年份均为推定 · 帝王画像为 AI 生成工笔风格，冠服据《周礼》冕服与《礼记》深衣推定 · 内容以《史记》《尚书》《左传》《国语》《诗经》为主要依据 · 西周帝王与人物画像待补，诸子画像沿用既有',
  },
  qin: {
    brand: '秦制天下', dynSub: '三帝', mapAria: '秦朝示意地图',
    legendNote: '秦并六国后的疆域，北起阴山、南至象郡，暂无手绘边界，地名与事件据《史记》系年',
    footer: '秦是第一个中央集权的统一帝国，废分封、行郡县，书同文、车同轨 · 皇帝画像为 AI 生成工笔风格，冠服据秦制、相貌据《史记》推定 · 内容以《史记》秦始皇本纪、六国年表为主要依据',
  },
  xihan: {
    brand: '大汉西京', dynSub: '十二帝', mapAria: '西汉示意地图',
    legendNote: '西汉疆域东抵朝鲜、西通西域，暂无手绘边界，地名与事件据《汉书》系年',
    footer: '西汉承秦制而损益之，黄老休养在前、独尊儒术在后，奠定此后两千年的制度与意识形态 · 皇帝画像为 AI 生成工笔风格，冠服据汉制、相貌据《汉书》推定 · 内容以《汉书》帝纪、列传为主要依据',
  },
  xin: {
    brand: '新莽改制', dynSub: '一帝', mapAria: '新莽示意地图',
    legendNote: '新莽承西汉疆域，改制频繁而地名多改，暂无手绘边界，事件据《汉书·王莽传》系年',
    footer: '新莽是西汉外戚王莽代汉建立的短命王朝，托古改制、币制屡变，终以绿林赤眉之乱覆亡 · 皇帝画像为 AI 生成工笔风格，冠服据新莽土德尚黄、相貌据《汉书》推定 · 内容以《汉书》王莽传为主要依据',
  },
  donghan: {
    brand: '大汉东京', dynSub: '十四帝', mapAria: '东汉示意地图',
    legendNote: '东汉疆域与西汉大体相当而西域三通三绝，暂无手绘边界，事件据《后汉书》系年',
    footer: '东汉是光武中兴后重建的汉室，外戚宦官交替专权，终于黄巾之乱与群雄割据 · 皇帝画像为 AI 生成工笔风格，冠服据汉制火德尚赤、相貌据《后汉书》推定 · 内容以《后汉书》帝纪、列传为主要依据',
  },
  // 汉一个节点装三段：西京（西汉）→ 新莽 → 东京（东汉），与「晋＝西晋＋东晋」同一套折法。
  // 段与段之间立彩牌、卡上挂段徽，年号条按段分组，舆图三段数据合绘一张。
  han: {
    brand: '大汉四百年', dynSub: '二十七帝', mapAria: '汉朝示意地图',
    legendNote: '汉分西京（前202-8）、新莽（9-23）、东京（25-220）三段共二十七帝，中间隔十七年无汉帝；疆域按武帝极盛范围示意，暂无手绘边界，地名与事件据《汉书》《后汉书》系年',
    footer: '汉四百年分三段：西京长安、新莽代汉十五年、东京洛阳 · 皇帝画像为 AI 生成工笔风格，三段分别按水德尚黑、土德尚黄、火德尚赤定冠服，相貌据《汉书》《后汉书》推定 · 内容以《汉书》《后汉书》帝纪、列传为主要依据',
  },
  // 「全部」是十四朝 177 帝的合并视图，不代表任何一个朝代：不套用任何一朝疆域，
  // 文案也不能借用明朝口径，否则等于暗示这块地是明朝的。
  all: {
    brand: '中华历史', dynSub: '十四朝 · 一百七十七帝', mapAria: '全部朝代合并示意地图',
    legendNote: '「全部」为十四朝 177 帝合并视图（汉含西京、新莽、东京三段），只画地名、事件与路线，不套用任何单一朝代的疆域轮廓',
    footer: '本视图合并十四朝 177 位皇帝 · 单朝疆域轮廓据谭其骧《中国历史地图集》示意，非精确边界 · 已绘画像均为 AI 生成工笔风格，冠服据各朝制度、相貌据正史推定，仅供示意',
  },
};

// ===== 全局加载动画控制 =====
let _loaderTimer = null;
function showLoader() {
  const el = document.getElementById('global-loader');
  if (!el) return;
  clearTimeout(_loaderTimer);
  // 延迟300ms才显示，避免快速加载时闪烁
  _loaderTimer = setTimeout(() => el.classList.add('show'), 300);
}
function hideLoader() {
  const el = document.getElementById('global-loader');
  if (!el) return;
  clearTimeout(_loaderTimer);
  el.classList.remove('show');
}

/* 读一个数据目录（一个「段」）：朝代节点可能是单目录，也可能由 DYNASTY_SEGS 拼多段。
   返回的每条记录都打上 _dynasty（节点 id）与 _seg（段 tag，单段朝代为 null），
   帝王另外补 _segLabel 与 lineage，供时间线的段牌和年号条分段使用。 */
async function loadSeg(dyn, seg) {
  const dir = seg ? seg.dir : (DYNASTY_DIRS[dyn] || '');
  const lay = DYNASTY_LAYOUT[dyn] || DYNASTY_LAYOUT.ming;
  const hasMap = DYNASTY_HAS_MAP[dyn] || false;
  const p = (rel) => `../data/${dir}${rel}`;
  const maybe = (path) => loadJSON(path).catch(() => null);
  const bucket = { emperors: [], events: [], people: [], places: [], routes: [], mapEvents: [], institutions: [], quiz: [], cases: [], cats: [], sourcesDoc: null };
  const tag = (x) => { x._dynasty = dyn; x._seg = seg ? seg.tag : null; };
  try {
    const idx = await loadJSON(p('emperors/index.json'));
    if (idx.meta && idx.meta.lineages) Object.assign(LINEAGE_LABEL, idx.meta.lineages);
    if (!idx.emperors || !Array.isArray(idx.emperors)) return bucket;
    const emps = await Promise.all(idx.emperors.map((e) => loadJSON(p(`emperors/${e.file}`)).catch(() => null)));
    emps.filter(Boolean).forEach((emp) => {
      tag(emp);
      if (seg) { emp.lineage = seg.lineage; emp._segLabel = seg.label; }
      bucket.emperors.push(emp);
    });
    // 其余分区同样要合并：漏掉哪一块，「全部」视图对应面板就是空的
    // （「该朝事件」显示没有事件、人物关系与探案缺内容都是这个原因）。
    const [evDoc, peoDoc, plaDoc, rouDoc, mevDoc, insDoc, quizDoc, casDoc] = await Promise.all([
      maybe(p(lay.events)), maybe(p(lay.people)),
      hasMap ? maybe(p(lay.places)) : null,
      hasMap ? maybe(p(lay.routes)) : null,
      hasMap ? maybe(p(lay.mapEvents)) : null,
      dyn === 'ming' ? maybe(p('institutions/institutions.json')) : null,
      maybe(p(dyn === 'ming' ? 'quiz/quiz.json' : 'quiz.json')),
      maybe(p(lay.cases)),
    ]);
    (evDoc && evDoc.events || []).forEach(x => { tag(x); bucket.events.push(x); });
    (peoDoc && peoDoc.people || []).forEach(x => { tag(x); bucket.people.push(x); });
    (plaDoc && plaDoc.places || []).forEach(x => { tag(x); bucket.places.push(x); });
    (rouDoc && rouDoc.routes || []).forEach(x => { tag(x); bucket.routes.push(x); });
    (mevDoc && mevDoc.events || []).forEach(x => { tag(x); bucket.mapEvents.push(x); });
    (insDoc && insDoc.institutions || []).forEach(x => { tag(x); bucket.institutions.push(x); });
    (quizDoc && quizDoc.quiz || []).forEach(x => { tag(x); bucket.quiz.push(x); });
    // 悬案疑案：各朝都有自己的 cases.json 与分类，全部视图必须一起合并，
    // 否则「全部」下只显示一套分类。
    (casDoc && casDoc.cases || []).forEach(x => { tag(x); bucket.cases.push(x); });
    (casDoc && casDoc.categories || []).forEach((c) => {
      if (c && c.id) bucket.cats.push({ id: c.id, name: c.name, _dynasty: dyn });
    });
  } catch (e) { /* 单段加载失败不阻塞整朝 */ }
  return bucket;
}

/* 读一个朝代节点：有分段就逐段读再拼（顺序＝segs 顺序，即时间顺序），没有就是单目录。 */
async function loadDynasty(dyn) {
  const segs = DYNASTY_SEGS[dyn];
  const parts = segs ? await Promise.all(segs.map((s) => loadSeg(dyn, s))) : [await loadSeg(dyn, null)];
  const out = { emperors: [], events: [], people: [], places: [], routes: [], mapEvents: [], institutions: [], quiz: [], cases: [], caseCategories: [] };
  for (const b of parts) {
    out.emperors.push(...b.emperors);
    out.events.push(...b.events);
    out.people.push(...b.people);
    out.places.push(...b.places);
    out.routes.push(...b.routes);
    out.mapEvents.push(...b.mapEvents);
    out.institutions.push(...b.institutions);
    out.quiz.push(...b.quiz);
    out.cases.push(...b.cases);
    for (const c of b.cats) if (!out.caseCategories.some((x) => x.id === c.id)) out.caseCategories.push(c);
  }
  return out;
}

async function loadAll() {
  showLoader();
  try {
  // "全部"视图：加载所有朝代的皇帝并合并
  if (currentDynasty === 'all') {
    if (DATA_CACHE['all']) {
      DATA = DATA_CACHE['all'];
      if (typeof SEARCH !== 'undefined') SEARCH.setData(DATA);
      return;
    }
    const dynOrder = ['xia','shang','zhou','qin','han','sanguo','jin','sui','tang','wudai','song','yuan','ming','qing'];
    const allEmperors = [];
    const allEvents = [];
    const allPeople = [];
    const allPlaces = [];
    const allRoutes = [];
    const allMapEvents = [];
    const allInstitutions = [];
    const allQuiz = [];
    const allSources = [];
    const allCases = [];
    const allCaseCats = [];
    const seenCat = new Set();
    const seenSrc = new Set();
    // 七个朝代并发加载。原先是 for + await 串行：每个朝代都要先等 emperors/index.json
    // 回来才发下一批，7 个朝代排成 7 个往返。改成 Promise.all 后请求数量完全不变，
    // 但只需要等 1 个往返；结果再按 dynOrder 顺序拼回，
    // 保证「全部」下的帝王/事件/悬案列表顺序与串行时逐字一致。
    const [perDyn, srcDoc] = await Promise.all([
      Promise.all(dynOrder.map(async (dyn) => {
        const bucket = {
          dyn, emperors: [], events: [], people: [], places: [], routes: [],
          mapEvents: [], institutions: [], quiz: [], cases: [], cats: [],
        };
        try {
          // 一个节点可能由多段拼成（汉＝西汉＋新莽＋东汉），统一走 loadDynasty
          const got = await loadDynasty(dyn);
          bucket.emperors.push(...got.emperors);
          bucket.events.push(...got.events);
          bucket.people.push(...got.people);
          bucket.places.push(...got.places);
          bucket.routes.push(...got.routes);
          bucket.mapEvents.push(...got.mapEvents);
          bucket.institutions.push(...got.institutions);
          bucket.quiz.push(...got.quiz);
          bucket.cases.push(...got.cases);
          bucket.cats.push(...got.caseCategories);
        } catch(e) { /* 跳过加载失败的朝代 */ }
        return bucket;
      })),
      // 史料出处全朝代共用一份，与朝代循环并发取
      loadJSON('../data/sources/sources.json').catch(() => null),
    ]);
    for (const b of perDyn) {
      allEmperors.push(...b.emperors);
      allEvents.push(...b.events);
      allPeople.push(...b.people);
      allPlaces.push(...b.places);
      allRoutes.push(...b.routes);
      allMapEvents.push(...b.mapEvents);
      allInstitutions.push(...b.institutions);
      allQuiz.push(...b.quiz);
      allCases.push(...b.cases);
      // 分类按「先到先得」去重，与串行时同一套顺序（朝代顺序决定归属）
      for (const c of b.cats) {
        if (!seenCat.has(c.id)) { seenCat.add(c.id); allCaseCats.push(c); }
      }
    }
    // 史料出处按 id 去重
    for (const s of (srcDoc && srcDoc.sources) || []) {
      const key = s.id || s.title || JSON.stringify(s);
      if (!seenSrc.has(key)) { seenSrc.add(key); allSources.push(s); }
    }

    DATA = {
      emperors: allEmperors, people: allPeople, events: allEvents,
      places: allPlaces, routes: allRoutes,
      cases: allCases, caseCategories: allCaseCats,
      institutions: allInstitutions, sourcesDoc: { sources: allSources },
      quiz: allQuiz, mapEvents: allMapEvents,
    };
    // 兜底：若逐朝循环没拿到任何案件（例如某个朝代目录整批 404），
    // 再单独读一次通用案件库，保证「悬案疑案」不全空。
    if (!DATA.cases.length) {
      try {
        const casesDoc = await loadJSON('../data/cases/cases.json?v=v1');
        DATA.cases = casesDoc.cases || [];
        DATA.caseCategories = casesDoc.categories || [];
      } catch(e) { /* 案件库加载失败不阻塞 */ }
    }
    DATA_CACHE['all'] = DATA;
    // 更新「全部」按钮的帝数
    const allBtn = document.querySelector('.dynasty-btn[data-d="all"] .dyn-sub');
    if (allBtn) allBtn.textContent = `${allEmperors.length}帝`;
    if (typeof SEARCH !== 'undefined') SEARCH.setData(DATA);
    return;
  }
  // 已加载过的朝代缓存：切回不再重发请求（数据只读，切换朝代不修改）
  if (DATA_CACHE[currentDynasty]) {
    DATA = DATA_CACHE[currentDynasty];
    if (typeof SEARCH !== 'undefined') SEARCH.setData(DATA);
    return;
  }
  // 同一朝代正在加载中：复用那次请求，不重复拉取
  if (DATA_PENDING[currentDynasty]) {
    DATA = await DATA_PENDING[currentDynasty];
    if (typeof SEARCH !== 'undefined') SEARCH.setData(DATA);
    return;
  }
  const loadToken = currentDynasty;
  DATA_PENDING[loadToken] = _fetchDynasty(loadToken);
  try {
    DATA = await DATA_PENDING[loadToken];
  } finally {
    delete DATA_PENDING[loadToken];
  }
  DATA_CACHE[loadToken] = DATA;
  // 喂给检索模块（历史侦探/追问框用）
  if (typeof SEARCH !== 'undefined') SEARCH.setData(DATA);
  } finally {
    hideLoader();
  }
}

/** 真正拉取某朝全部 JSON（结果写入 DATA_CACHE 由调用方负责） */
async function _fetchDynasty(dyn) {
  // 汉这类多段节点由 loadDynasty 逐段拼接；单段朝代 loadSeg 一次读完
  const [body, sourcesDoc] = await Promise.all([
    loadDynasty(dyn),
    dyn === 'ming'
      ? loadJSON(`../data/${DYNASTY_DIRS[dyn]}sources/sources.json`).catch(() => null)
      : loadJSON('../data/sources/sources.json').catch(() => null),
  ]);
  return {
    emperors: body.emperors,
    people: body.people,
    events: body.events,
    places: body.places,
    routes: body.routes,
    institutions: body.institutions,
    sourcesDoc: sourcesDoc || { sources: [] },
    mapEvents: body.mapEvents,
    cases: body.cases,
    caseCategories: body.caseCategories,
    quiz: body.quiz,
  };
}

// ---------- 界面切换 ----------
/** 页面内容切换（朝代/皇帝/页签/模块）时停止逐句朗读与自动推进。
 *  不停止的话，旧内容的播放状态会延续到新内容：hash 里的 #s=N 指向新内容中的
 *  同序号句子，于是朗读"跨页"继续念新内容，看起来像根本停不下来。
 *  导览脚本未加载或未激活时 __guide 不存在/为空实现，调用无副作用。
 *  注意：国学四个板块是独立 iframe，各自有一份 __guide，必须一并停，
 *  否则从「格物致知」切到别的模块后，iframe 里的朗读/推进还在跑。 */
function stopGuideIfAny() {
  try {
    if (window.__guide && typeof window.__guide.stopGuide === 'function') window.__guide.stopGuide();
  } catch (e) { /* 导览不可用不影响主流程 */ }
  // 逐个通知已装载的 iframe（未装载的 src 为空、contentWindow 无 __guide，自动跳过）
  document.querySelectorAll('iframe.guoxue-frame').forEach((f) => {
    try {
      const g = f.contentWindow && f.contentWindow.__guide;
      if (g && typeof g.stopGuide === 'function') g.stopGuide();
    } catch (e) { /* 跨域或子页未就绪，忽略 */ }
  });
}

function switchPage(name) {
  stopGuideIfAny();                 // 换页签即停：朗读/推进不得跨页面继续
  for (const p of ['timeline', 'cases', 'map', 'detective']) {
    const page = document.getElementById(`page-${p}`);
    const tab = document.querySelector(`.tab[data-page="${p}"]`);
    if (!page) continue;
    const on = p === name;
    page.classList.toggle('hidden', !on);
    if (tab) tab.classList.toggle('active', on);
  }
  if (name === 'map') {
    renderEraStrip(); renderEraInfo();
    // 首次进地图页：先按需加载 Leaflet，再渲染
    ensureLeaflet().then(() => {
      loadBoundaries().then(() => {
        renderMap();
        // 首次进入地图页：默认点开「该朝事件」（展开事件古地名汇总面板）。
        // 例外：带 route 深链时目标就是那条路线——事件汇总与路线详情共用
        // #route-detail 这一个容器，调 showEventsSummary() 会把刚渲染好的路线详情整个覆盖掉。
        if (!new URLSearchParams(location.search).get('route')) showEventsSummary();
        if (leafletMap) setTimeout(() => leafletMap.invalidateSize(), 60);
      });
    }).catch((e) => console.error(e));
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
  const list = cases.filter((c) => c.category === cat.id).sort((a, b) => yearNum(a.date) - yearNum(b.date));
  wrap.innerHTML = `
    <section class="case-category">
      ${list.map(caseCard).join('')}
    </section>`;
}

function caseCard(c) {
  const people = (c.people || []).map((p) =>
    `<div class="case-person"><div class="case-person-head"><b>${p.name}</b><span class="case-person-role">${p.role}</span></div><div class="case-person-note">${p.note}</div></div>`).join('');
  const questions = (c.openQuestions || []).map((q) => `
    <div class="case-question">
      <div class="q">${q.question}</div>
      <div class="ctx">${q.context || ''}</div>
      <div class="viewpoints">${(q.viewpoints || []).map((v) => `<p>• ${v}</p>`).join('')}</div>
    </div>`).join('');
  return `
    <article class="case-card" data-id="${c.id}">
      <div class="case-head">
        <div class="case-title">${c.name}</div>
        <div class="case-date">${fmtYear(c.date)}年</div>
      </div>
      <div class="case-summary">${c.summary}</div>
      <div class="case-section">
        <b>背景介绍</b>
        <p>${c.background}</p>
        ${c.nameOrigin ? `<p style="color:#8a7a5c;margin-top:8px"><i>名字的由来：</i>${c.nameOrigin}</p>` : ''}
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
// 并立时代的继承线标签：内置三国与两晋，其余朝代可在各自 emperors/index.json 的 meta.lineages 里补充
const LINEAGE_LABEL = { wei: '魏', shu: '蜀', wu: '吴', jinwest: '西晋', jineast: '东晋', hanwest: '西汉', hanxin: '新莽', haneast: '东汉' };
function renderTimeline() {
  const wrap = $('#timeline-scroll');
  wrap.innerHTML = '';
  // 分组规则：
  //  · 单朝代且每张卡都带 lineage（三国、两晋）→ 按政权线分组，立「魏/蜀/吴/西晋/东晋」彩牌；
  //  · 「全部」视图 → 先按朝代分组，朝代交界立墨色朝代牌；同一朝代内部若分政权线（三国、晋），
  //    再立一块彩牌。此前「全部」完全不分线，首屏看到的只是 103 张卡平铺，魏/蜀/吴无处可辨。
  const lineageMode = DATA.emperors.length > 0 && DATA.emperors.every((e) => e.lineage);
  const allMode = currentDynasty === 'all';
  const groupMode = lineageMode || allMode;
  const dynOf = (emp) => emp._dynasty || currentDynasty;
  const keyOf = (emp) => (groupMode ? `${dynOf(emp)}|${emp.lineage || ''}` : '');
  let prevEmp = null;
  const pushSep = (text, colorCls, lead) => {
    const sep = el('div', 'tl-lineage-sep' + (lead ? ' tl-lineage-lead' : '') + (colorCls ? ' ' + colorCls : ''));
    sep.innerHTML = `<span>${text}</span>`;
    wrap.appendChild(sep);
  };
  DATA.emperors.forEach((e, i) => {
    const nextE = DATA.emperors[i + 1];
    const groupEnd = groupMode && (!nextE || keyOf(nextE) !== keyOf(e));
    // 段牌与朝代牌同名的不立两块（「西汉」朝代牌后面紧跟「西汉」段牌会重复一屏）
    const segPlate = (emp) => {
      const lab = LINEAGE_LABEL[emp.lineage] || '';
      const dynLab = DYNASTY_SHORT[dynOf(emp)] || DYNASTY_LABEL[dynOf(emp)] || '';
      return lab && lab !== dynLab ? lab : '';
    };
    if (allMode) {
      // 朝代交界：墨色朝代牌；该朝首帝若属某条政权线，紧跟一块彩牌（如「三国」「魏」）
      if (i === 0) {
        pushSep(DYNASTY_SHORT[dynOf(e)] || DYNASTY_LABEL[dynOf(e)] || '', 'tl-sep-dyn', true);
        if (segPlate(e)) pushSep(segPlate(e), 'lineage-' + e.lineage, false);
      } else if (dynOf(e) !== dynOf(prevEmp)) {
        pushSep(DYNASTY_SHORT[dynOf(e)] || DYNASTY_LABEL[dynOf(e)] || '', 'tl-sep-dyn', false);
        if (segPlate(e)) pushSep(segPlate(e), 'lineage-' + e.lineage, false);
      } else if (keyOf(e) !== keyOf(prevEmp) && e.lineage) {
        // 同朝换线（魏→蜀→吴、西晋→东晋）
        pushSep(LINEAGE_LABEL[e.lineage] || '', 'lineage-' + e.lineage, false);
      }
    } else if (lineageMode) {
      // 单朝代：跨继承线立彩牌，首条线也立（否则首组像缺了一段）
      if (i === 0) pushSep(LINEAGE_LABEL[e.lineage] || '', 'lineage-' + e.lineage, true);
      else if (keyOf(e) !== keyOf(prevEmp)) pushSep(LINEAGE_LABEL[e.lineage] || '', 'lineage-' + e.lineage, false);
    }
    prevEmp = e;
    const card = el('div', 'emp-card');
    if (e.lineage) card.classList.add('lineage-' + e.lineage);
    if (!e.portrait && e.lineage) card.classList.add('emp-no-portrait');   // 无画像朝代（周/商）：顶上多留一条带高，给「西周/东周」徽标让位，避免压住朱印
    if (groupEnd) card.classList.add('tl-group-end');
    // 头像按需加载 + 声明尺寸：首屏只取视口内几张卡片，其余等滚到再取（避免首屏一次性请求十几张画像）
    const lazy = ' loading="lazy" decoding="async" width="84" height="84"';
    const portrait = e.portrait
      ? `<img class="emp-portrait" src="../data/portraits/${e.portrait}" alt="${e.name}" ${lazy} onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')"/>`
      : `<div class="emp-portrait emp-portrait-fallback">${(e.templeName || e.name || '?').slice(0, 1)}</div>`;
    // 周、商诸王本无年号，eraName 只是异名：去掉与庙号同字者，避免「武王 · 武王」
    const altEra = (e.eraName || []).filter((x) => x && x !== e.templeName);
    const eraUnit = ['xia', 'shang', 'zhou'].includes((e.id || '').split('-')[0]) ? '种写法' : '个年号';
    const eraLine = altEra.length === 0
      ? (e.templeName || '')
      : `${e.templeName} · ${altEra[0]}${altEra.length > 1 ? '等' + altEra.length + eraUnit : ''}`;
    card.innerHTML = `
      ${e.lineage ? `<div class="lineage-badge">${LINEAGE_LABEL[e.lineage] || ''}</div>` : ''}
      ${portrait}
      <div class="name">${e.name}</div>
      <div class="era">${eraLine}</div>
      <div class="reign">${fmtYear(e.reign.start)} - ${fmtYear(e.reign.end)}</div>`;
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
  wrap.onScrollOnce = updateArrows;             // 同一元素只保留一个滚动处理器
  if (!wrap._scrollWired) {
    wrap._scrollWired = true;
    wrap.addEventListener('scroll', () => wrap.onScrollOnce && wrap.onScrollOnce());
  }
  updateArrows();
  // 拖拽滚动：按住左右拖动
  enableDragScroll(wrap);
  // 并立政权甘特图（有 data/<朝>/gantt.json 的朝代才显示）
  renderGantt(currentDynasty);
}

/* ---------- 纵向滚轮 → 横向滚动 ----------
   不要依赖轨道 CSS 的 scroll-snap / scroll-behavior:smooth：两者叠加会把逐格推进吞掉，
   实测连滚 12 格只推进 40px 后就彻底卡住（2026-11-25 用户报障）。
   这里按 deltaMode 归一后直接改 scrollLeft，一比一跟手。 */
function bindWheelToHorizontal(el) {
  if (!el || el._wheelHBound) return;
  el._wheelHBound = true;
  el.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // 触控板横滑交给原生滚动
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
    el.scrollLeft += e.deltaY * unit;
  }, { passive: false });
}

/* ---------- 首屏「自动慢速左移」 ----------
   只在页面刚打开、停在「全部」帝王世系时启动一次：卡片轨道以 32px/s 向左匀移。
   任何人为操作（滚轮、按下、触摸、按键、页面纵向滚动）立即并永久停止，本次页面生命周期内不再重启；
   刷新页面即重新判断（状态只存在内存里，不落 localStorage）。
   自然滑到轨道末端也会收手，且不会因为切换朝代而重新启动。 */
let _autoDriftState = 'idle';   // idle → running → stopped（单向，不回头）
const AUTO_DRIFT_SPEED = 32;    // px/s，约 9 秒走完一张卡；比首版 24 快一档，仍不抢注意力

function stopTimelineAutoDrift() {
  if (_autoDriftState === 'running') _autoDriftState = 'stopped';
}

function startTimelineAutoDrift() {
  if (_autoDriftState !== 'idle') return;
  const wrap = $('#timeline-scroll');
  const page = $('#page-timeline');
  // 首屏不是帝王世系（深链到悬案/舆图/探案）、或不是「全部」视图，都不该动
  if (!wrap || !page || page.classList.contains('hidden') || currentDynasty !== 'all' || !wrap.offsetParent) {
    _autoDriftState = 'stopped';
    return;
  }
  // 尊重系统的「减少动态效果」设置
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    _autoDriftState = 'stopped';
    return;
  }
  const maxLeft = () => wrap.scrollWidth - wrap.clientWidth;
  if (maxLeft() < 24) { _autoDriftState = 'stopped'; return; }

  _autoDriftState = 'running';
  // 轨道带 scroll-snap-type:x mandatory，逐帧的小位移会被立刻吸附回卡片边界（看上去完全不动）。
  // 动画期间关掉吸附；停止后不再归还 —— 归还的瞬间会把轨道吸回最近的卡片边界，
  // 用户刚一动就看到几十像素的突跳，比「这次访问不再吸附」更糟。刷新页面自然恢复。
  wrap.style.scrollSnapType = 'none';
  let raf = 0;
  let last = 0;
  // 累加器必须用浮点自己记：scrollLeft 读回来是整数，每帧零点几像素会被抹成 0，永远推不动
  let pos = wrap.scrollLeft;
  const tick = (ts) => {
    if (_autoDriftState !== 'running') return;
    if (!last) last = ts;
    const dt = Math.min(64, ts - last);   // 切后台再回来时不要一口气跳很远
    last = ts;
    if (!document.hidden) {
      pos += AUTO_DRIFT_SPEED * dt / 1000;
      if (pos >= maxLeft() - 0.5) {     // 滑到末端：停住，且不再重启
        wrap.scrollTo({ left: maxLeft(), behavior: 'instant' });
        _autoDriftState = 'stopped';
        return;
      }
      // 轨道 CSS 是 scroll-behavior:smooth，直接改 scrollLeft 会被平滑动画吞掉，
      // 这里显式用 instant 逐帧推进，避免每帧都在重启一段平滑滚动。
      wrap.scrollTo({ left: pos, behavior: 'instant' });
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // 只要出现任何「人在动」的信号就收手；用 once 让监听自己退场，不留垃圾
  // 注意：不要监听 window 的 scroll —— 轨道自身的横向滚动也会冒到 document，
  // 动画第一帧就会把自己杀掉（实测 2px 即停）。页面纵向滚动已由 wheel/touchstart/keydown 覆盖。
  const KILL_EVENTS = ['wheel', 'pointerdown', 'mousedown', 'touchstart', 'keydown'];
  const onUser = () => {
    if (_autoDriftState !== 'running') return;
    _autoDriftState = 'stopped';
    cancelAnimationFrame(raf);
  };
  KILL_EVENTS.forEach((ev) => window.addEventListener(ev, onUser, { passive: true, once: true }));
}

// ---------- 并立政权甘特图 ----------
// 数据在 data/<朝>/gantt.json：t0/t1 为横轴范围；rows 每行一个政权，kings 为 [[名, 起, 止]]。
// 五代十国、三国、晋（东晋十六国）共用这套渲染器；没有 gantt.json 的朝代自动隐藏。
// 注意：行与行之间没有继承关系，色块只表示"某君主在某年至某年统治该政权"。
const GANTT_CACHE = {};
const MIN_BLOCK_PX = 14, MIN_GAP_PX = 2;
let _ganttRO = null;
/* #rrggbb → rgba()：行首政权名的底色取该行族属色（与图例/色块同一套），
   淡染一层就够，不能压过墨字；左缘一条实色竖线当色标。 */
function ganttTint(hex, a) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return `rgba(138, 109, 59, ${a})`;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
/* 色块摆位：把年份比例换算成轨道内的像素。
   每次轨道宽度变化都必须重算——首次渲染时面板往往还没撑到最终宽度（侧栏卷收、
   顶栏 fitTopbar 后置都会改宽度），只按当时的宽度摆位，整幅色块会缩在左侧，
   右边空出半截轨道，和顶部年份刻度对不上（用户看到的「右侧一片空白」就是它）。*/
function layoutGanttBlocks(box) {
  if (!box || box.classList.contains('hidden')) return;
  const T0 = Number(box.dataset.t0), T1 = Number(box.dataset.t1);
  const span = T1 - T0;
  if (!Number.isFinite(span) || span <= 0) return;
  const pct = (y) => ((y - T0) / span) * 100;
  box.querySelectorAll('.gantt-track').forEach((tr) => {
    const W = tr.clientWidth;
    if (!W || W < 60) return;      // 面板隐藏或过窄时先不摆位，等 ResizeObserver 再算
    let prevRight = -Infinity;
    tr.querySelectorAll('.gantt-king').forEach((k) => {
      const s = Number(k.dataset.start), e = Number(k.dataset.end);
      if (!Number.isFinite(s) || !Number.isFinite(e)) return;
      const rawLeft = (pct(s) / 100) * W;
      const rawW = Math.max(0, ((pct(e) - pct(s)) / 100) * W);
      const w = Math.max(rawW, MIN_BLOCK_PX);
      let left = Math.max(rawLeft, prevRight + MIN_GAP_PX);
      if (left + w > W) left = Math.max(0, W - w);
      k.style.left = `${left.toFixed(2)}px`;
      k.style.width = `${w.toFixed(2)}px`;
      // 宽度不足以放名字时只留色条（.gantt-narrow）；宽度变了要跟着重判
      k.classList.toggle('gantt-narrow', w < (k.dataset.king || '').length * 12 + 8);
      prevRight = left + w;
    });
  });
}
function observeGanttResize(box) {
  if (typeof ResizeObserver !== 'function') return;
  if (_ganttRO) _ganttRO.disconnect();
  let raf = 0;
  _ganttRO = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => layoutGanttBlocks(box));
  });
  box.querySelectorAll('.gantt-track').forEach((tr) => _ganttRO.observe(tr));
}

async function renderGantt(dyn) {
  const box = $('#shiguo-gantt');
  if (!box) return;
  const dir = DYNASTY_DIRS[dyn];
  const hide = () => {
    box.classList.add('hidden'); box.innerHTML = '';
    if (_ganttRO) { _ganttRO.disconnect(); _ganttRO = null; }
  };
  if (!dir) return hide();
  if (!GANTT_CACHE[dyn]) {
    try { GANTT_CACHE[dyn] = await loadJSON(`../data/${dir}gantt.json`); }
    catch (e) { return hide(); }
  }
  const g = GANTT_CACHE[dyn];
  if (!g || !Array.isArray(g.rows) || !g.rows.length) return hide();
  const T0 = g.t0, T1 = g.t1;
  const span = T1 - T0 || 1;
  const pct = (y) => ((y - T0) / span) * 100;

  const BLOCK_META = [];   // 与 .gantt-king 的 DOM 顺序一一对应：状态名、君主、小传、是否末主
  const ROW_META = [];     // 行首政权名（.gantt-label）的政权小史数据，与 data-row 一一对应
  const bars = g.rows.map((row, ri) => {
    const kings = row.kings || [];
    const lastKing = (kings[kings.length - 1] || [])[0];
    ROW_META.push({
      state: row.name, start: row.start, end: row.end, color: row.color || '',
      family: row.family || ((g.legend || []).find((l) => l.color === row.color) || {}).label || '',
      desc: row.desc || '', kingNames: kings.map((k) => k[0]),
      founder: row.founder || '', lastKing,
    });
    // 一块只代表一位君主：同年即位的短祚君主（如刘和 310、刘粲 318）单独切块。
    // 这里先按真实年份比例占位，渲染后再按实测像素做"最小可见宽 + 顺序不重叠"的补算
    const segs = kings.map(([name, s, e], ki) => {
      const left = pct(s);
      const width = Math.max(0, pct(e) - pct(s));
      BLOCK_META.push({
        state: row.name, stateStart: row.start, stateEnd: row.end, color: row.color || '',
        family: row.family || ((g.legend || []).find((l) => l.color === row.color) || {}).label || '',
        desc: row.desc || '',
        names: [name], start: s, end: e,
        bios: row.bios || {}, founder: row.founder || '', lastKing,
        kingNames: kings.map((k) => k[0]),
      });
      return `<div class="gantt-king ${row.color || ''} ${ki % 2 ? 'alt' : ''}" data-king="${name}" data-start="${s}" data-end="${e}" tabindex="0" aria-label="${name}（${s}-${e}）" style="left:${left}%;width:${width}%">
        <span class="gantt-king-name">${name}</span>
      </div>`;
    }).join('');
    // 行首政权名的底色＝该行族属色（与图例、色块同一套色号），起到"哪行属于哪一族"的色标作用
    const rowHex = GANTT_HEX[row.color] || (ROW_META[ri] && GANTT_HEX[ROW_META[ri].color]) || '';
    const labelStyle = rowHex
      ? `background:${ganttTint(rowHex, 0.15)};border-left-color:${ganttTint(rowHex, 0.85)};`
      : '';
    const labelHtml = `<div class="gantt-label" data-row="${ri}" tabindex="0" aria-label="${row.name} 政权小史" style="${labelStyle}">
      <b>${row.name}</b>
      <span class="gantt-label-years">${row.start}-${row.end}</span>
    </div>`;
    return `<div class="gantt-row">
      ${labelHtml}
      <div class="gantt-track">${segs}</div>
    </div>`;
  }).join('');

  const axisTicks = (g.ticks || []).map((t) => `<div class="tick" style="left:${pct(t)}%">${t}</div>`).join('');
  const legend = (g.legend || []).map((l) => `<span><i class="sw" style="background:${l.color}${l.border ? `;border:1px solid ${l.border}` : ''}"></i>${l.label}</span>`).join('');

  box.innerHTML = `
    <h3>${g.title || ''}</h3>
    ${g.sub ? `<p class="gantt-sub">${g.sub}</p>` : ''}
    <div class="gantt-axis">${axisTicks}</div>
    ${bars}
    ${legend ? `<div class="gantt-legend">${legend}</div>` : ''}
    ${g.note ? `<div class="gantt-note">${g.note}</div>` : ''}
  `;
  // 图与卡片流联动：点色块 → 选中同名帝王卡 → 详情展开；
  // 十六国、十国的多数小政权没有帝卡，块宽又只有一二十像素放不下字，改为悬停（触屏点按）弹小传，不再"点了没反应"
  // 一位君主一块：短祚君主的真实任期在年份比例下可能不足 1 像素，这里按实测轨道宽补到最小可见宽，
  // 并把后面的块顺次右移，保证"按时间顺序、互不重叠"（只在块内造成极小的横向偏差）
  box.dataset.t0 = T0; box.dataset.t1 = T1;
  layoutGanttBlocks(box);
  // 首次渲染时面板可能还没撑到最终宽度（侧栏卷收、顶栏 fitTopbar 后置等），
  // 那时按旧宽度摆位会让整幅色块缩在左侧、右侧留一大截空轨道，跟顶上的年份刻度对不上。
  // 所以渲染后再补算两次，并用 ResizeObserver 跟随轨道宽度变化。
  requestAnimationFrame(() => {
    layoutGanttBlocks(box);
    requestAnimationFrame(() => layoutGanttBlocks(box));
  });
  // 行首政权名＝政权本身：悬停出「政权小史」，与色块上的「君主小传」分开，各说各的一层
  box.querySelectorAll('.gantt-label').forEach((el) => {
    const meta = ROW_META[Number(el.dataset.row)];
    if (!meta) return;
    el.addEventListener('mouseenter', () => showGanttStateTip(meta, el));
    el.addEventListener('mouseleave', () => hideGanttTip(true));
    el.addEventListener('focus', () => showGanttStateTip(meta, el));
    el.addEventListener('blur', () => hideGanttTip(true));
    el.addEventListener('click', () => showGanttStateTip(meta, el, true));
  });
  box.querySelectorAll('.gantt-king').forEach((k, idx) => {
    const meta = BLOCK_META[idx];
    if (!meta) return;
    k.addEventListener('mouseenter', () => showGanttTip(meta, k));
    k.addEventListener('mouseleave', () => hideGanttTip(true));
    k.addEventListener('focus', () => showGanttTip(meta, k));
    k.addEventListener('blur', () => hideGanttTip(true));
    k.addEventListener('click', () => {
      const first = (k.dataset.king || '').split('·')[0];
      const card = [...document.querySelectorAll('#timeline-scroll .emp-card')]
        .find((c) => ((c.querySelector('.name') || {}).textContent || '').trim() === first);
      if (card) { hideGanttTip(false); card.click(); return; }
      // 没有帝卡：点按也能看到小传（触屏没有 hover）
      showGanttTip(meta, k, true);
    });
  });
  box.classList.toggle('gantt-wide', g.rows.length > 8);
  box.classList.remove('hidden');
  observeGanttResize(box);
}

/* ---- 甘特色块的君主小传弹窗 ----
   小政权色块只有十几像素，既放不下字，又没有同名帝王卡可跳；悬停即在色块上方浮出一张纸卡，
   给"所属政权 / 族属 / 君主 / 在位 / 身份 / 一句事迹"，点击有帝卡的仍跳全文。 */
let _ganttTipEl = null, _ganttTipTimer = 0;
// 色块用的是 CSS 类名（xiongnu / song …），弹窗小色标要真实颜色，这里给一份类名→底色对照（两处弹窗共用）
const GANTT_HEX = { jinwest: '#7b3f2f', jineast: '#2f5f6b', xiongnu: '#8a5a3a', jie: '#5f5a48', xianbei: '#3f6b8a', di: '#6b4a7a', qiang: '#8a6a2a', han: '#4a6b4a', lu: '#7a5a6a', wei: '#33506b', shu: '#a8352a', wu: '#2f6b57', song: '#c8553d', 'tang-internal': '#6b8e6b' };
function ensureGanttTip() {
  if (_ganttTipEl && document.body.contains(_ganttTipEl)) return _ganttTipEl;
  _ganttTipEl = document.createElement('div');
  _ganttTipEl.className = 'gantt-tip hidden';
  document.body.appendChild(_ganttTipEl);
  // 滚动画布/页面时浮窗会脱位，直接收起（同一处理器只挂一次）
  if (!window._ganttTipScroll) {
    window._ganttTipScroll = true;
    window.addEventListener('scroll', () => hideGanttTip(false), true);
    window.addEventListener('resize', () => hideGanttTip(false));
  }
  return _ganttTipEl;
}
function hideGanttTip(delayed) {
  const tip = _ganttTipEl;
  if (!tip) return;
  clearTimeout(_ganttTipTimer);
  const doHide = () => { tip.classList.add('hidden'); tip.dataset.pinned = ''; };
  if (delayed) _ganttTipTimer = setTimeout(doHide, 140);
  else doHide();
}
function showGanttTip(meta, block, pinned) {
  const tip = ensureGanttTip();
  clearTimeout(_ganttTipTimer);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hex = GANTT_HEX[meta.color] || '#8a6d3b';
  const roleOf = (n) => (n === meta.founder ? '开国' : '') || (n === meta.lastKing ? '末主' : '');
  const orderOf = (n) => {
    const names = meta.kingNames || [];
    const i = names.indexOf(n);
    if (i < 0 || names.length < 2) return '';
    const prev = i > 0 ? names[i - 1] : '';
    const next = i < names.length - 1 ? names[i + 1] : '';
    const parts = [`${meta.state}第 ${i + 1} 位 / 共 ${names.length} 位`];
    if (prev) parts.push(`前任 ${prev}`);
    if (next) parts.push(`继任 ${next}`);
    return parts.join(' · ');
  };
  const yrOf = (m) => (m.start === m.end ? `${m.start}（在位不足一年）` : `${m.start}-${m.end}`);
  // 只讲史实：不再加「点击即跳帝卡」之类的操作提示，没小传就干脆不出这一行
  const rows = meta.names.map((n) => {
    const bio = (meta.bios || {})[n] || '';
    const role = roleOf(n);
    const ord = orderOf(n);
    return `<div class="gt-king">
      <div class="gt-king-head"><b>${esc(n)}</b>${role ? `<em>${role}</em>` : ''}<span>${yrOf(meta)}</span></div>
      ${ord ? `<div class="gt-order">${esc(ord)}</div>` : ''}
      ${bio ? `<p class="gt-bio">${esc(bio)}</p>` : ''}
    </div>`;
  }).join('');
  tip.classList.remove('gt-state-card');
  tip.innerHTML = rows;
  tip.classList.remove('hidden');
  tip.dataset.pinned = pinned ? '1' : '';
  placeGanttTip(tip, block);
  if (pinned) _ganttTipTimer = setTimeout(() => hideGanttTip(false), 3200);
}
/* 政权小史：挂在行首政权名上。人物弹窗只讲人，政权沿革（族属、结局、立国亡国）归这里 */
function showGanttStateTip(row, anchor, pinned) {
  const tip = ensureGanttTip();
  clearTimeout(_ganttTipTimer);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hex = GANTT_HEX[row.color] || '#8a6d3b';
  const names = row.kingNames || [];
  const chain = names.map((n) => (n === row.founder ? `${n}（开国）` : n === row.lastKing ? `${n}（末主）` : n)).join(' → ');
  tip.classList.add('gt-state-card');
  tip.innerHTML = `
    <div class="gt-state"><b>${esc(row.state)}</b><span>${row.start}-${row.end}</span></div>
    ${row.family ? `<div class="gt-line"><i style="background:${esc(hex)}"></i>${esc(row.family)}</div>` : ''}
    ${row.desc ? `<p class="gt-desc">${esc(row.desc)}</p>` : ''}
    <div class="gt-kings"><b>共 ${names.length} 位君主</b>${chain ? `<span>${esc(chain)}</span>` : ''}</div>
  `;
  tip.classList.remove('hidden');
  tip.dataset.pinned = pinned ? '1' : '';
  placeGanttTip(tip, anchor);
  if (pinned) _ganttTipTimer = setTimeout(() => hideGanttTip(false), 3200);
}
/* 浮窗定位：以锚点矩形居中、夹在视口内；上方放不下就落到下方并把箭头翻过来 */
function placeGanttTip(tip, block) {
  const br = block.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = br.left + br.width / 2 - tw / 2;
  x = Math.max(8, Math.min(x, vw - tw - 8));
  let y = br.top - th - 8;
  const below = y < 8;
  if (below) y = Math.min(br.bottom + 8, vh - th - 8);
  tip.classList.toggle('tip-below', below);
  tip.style.left = `${Math.round(x)}px`;
  tip.style.top = `${Math.round(y)}px`;
}
/** 已绑定过拖拽滚动的元素：同一元素只绑一次，避免每次渲染叠加监听（旧版切朝代/点年号会累积几十个处理器） */
const _dragScrollBound = new WeakSet();
function enableDragScroll(el) {
  if (!el || _dragScrollBound.has(el)) return;
  _dragScrollBound.add(el);
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
  // 周帝王：人名/谥号/带朝代前缀三种写法，均取根目录 zhou-*.jpg
  '姬发': 'zhou-wuwang.jpg',   // 武王
  '武王': 'zhou-wuwang.jpg',
  '周武王': 'zhou-wuwang.jpg',
  '姬诵': 'zhou-chengwang.jpg',   // 成王
  '成王': 'zhou-chengwang.jpg',
  '周成王': 'zhou-chengwang.jpg',
  '姬钊': 'zhou-kangwang.jpg',   // 康王
  '康王': 'zhou-kangwang.jpg',
  '周康王': 'zhou-kangwang.jpg',
  '姬瑕': 'zhou-zhaowang.jpg',   // 昭王
  '昭王': 'zhou-zhaowang.jpg',
  '周昭王': 'zhou-zhaowang.jpg',
  '姬满': 'zhou-muwang.jpg',   // 穆王
  '穆王': 'zhou-muwang.jpg',
  '周穆王': 'zhou-muwang.jpg',
  '姬繄扈': 'zhou-gongwang.jpg',   // 共王
  '共王': 'zhou-gongwang.jpg',
  '周共王': 'zhou-gongwang.jpg',
  '姬囏': 'zhou-yiwang.jpg',   // 懿王
  '懿王': 'zhou-yiwang.jpg',
  '周懿王': 'zhou-yiwang.jpg',
  '姬辟方': 'zhou-xiaowang.jpg',   // 孝王
  '孝王': 'zhou-xiaowang.jpg',
  '周孝王': 'zhou-xiaowang.jpg',
  '姬燮': 'zhou-yiwang2.jpg',   // 夷王
  '夷王': 'zhou-yiwang2.jpg',
  '周夷王': 'zhou-yiwang2.jpg',
  '姬胡': 'zhou-liwang.jpg',   // 厉王
  '厉王': 'zhou-liwang.jpg',
  '周厉王': 'zhou-liwang.jpg',
  '姬静': 'zhou-xuanwang.jpg',   // 宣王
  '宣王': 'zhou-xuanwang.jpg',
  '周宣王': 'zhou-xuanwang.jpg',
  '姬宫湦': 'zhou-youwang.jpg',   // 幽王
  '幽王': 'zhou-youwang.jpg',
  '周幽王': 'zhou-youwang.jpg',
  '姬宜臼': 'zhou-pingwang.jpg',   // 平王
  '平王': 'zhou-pingwang.jpg',
  '周平王': 'zhou-pingwang.jpg',
  '姬林': 'zhou-huanwang.jpg',   // 桓王
  '桓王': 'zhou-huanwang.jpg',
  '周桓王': 'zhou-huanwang.jpg',
  '姬佗': 'zhou-zhuangwang.jpg',   // 庄王
  '庄王': 'zhou-zhuangwang.jpg',
  '周庄王': 'zhou-zhuangwang.jpg',
  '姬阆': 'zhou-huiwang.jpg',   // 惠王
  '惠王': 'zhou-huiwang.jpg',
  '周惠王': 'zhou-huiwang.jpg',
  '姬郑': 'zhou-xiangwang.jpg',   // 襄王
  '襄王': 'zhou-xiangwang.jpg',
  '周襄王': 'zhou-xiangwang.jpg',
  '姬瑜': 'zhou-dingwang.jpg',   // 定王
  '定王': 'zhou-dingwang.jpg',
  '周定王': 'zhou-dingwang.jpg',
  '姬匄': 'zhou-jingwang.jpg',   // 敬王
  '敬王': 'zhou-jingwang.jpg',
  '周敬王': 'zhou-jingwang.jpg',
  '姬午': 'zhou-weiliewang.jpg',   // 威烈王
  '威烈王': 'zhou-weiliewang.jpg',
  '周威烈王': 'zhou-weiliewang.jpg',
  '姬扁': 'zhou-xianwang.jpg',   // 显王
  '显王': 'zhou-xianwang.jpg',
  '周显王': 'zhou-xianwang.jpg',
  '姬延': 'zhou-nanwang.jpg',   // 赧王
  '赧王': 'zhou-nanwang.jpg',
  '周赧王': 'zhou-nanwang.jpg',
  // 商帝王：人名与庙号，均取根目录 shang-*.jpg
  '成汤': 'shang-tang.jpg',   // 大乙
  '大乙': 'shang-tang.jpg',
  '外丙': 'shang-waibing.jpg',   // 卜丙
  '卜丙': 'shang-waibing.jpg',
  '太甲': 'shang-taijia.jpg',   // 大甲
  '大甲': 'shang-taijia.jpg',
  '太戊': 'shang-taiwu.jpg',   // 中宗
  '中宗': 'shang-taiwu.jpg',
  '仲丁': 'shang-zhongding.jpg',   // 中丁
  '中丁': 'shang-zhongding.jpg',
  '盘庚': 'shang-pangeng.jpg',   // 盘庚
  '武丁': 'shang-wuding.jpg',   // 高宗
  '高宗': 'shang-wuding.jpg',
  '祖甲': 'shang-zujia.jpg',   // 帝祖甲
  '帝祖甲': 'shang-zujia.jpg',
  '廪辛': 'shang-linxin.jpg',   // 且辛
  '且辛': 'shang-linxin.jpg',
  '武乙': 'shang-wuyi.jpg',   // 武乙
  '帝乙': 'shang-diyi.jpg',   // 帝乙
  '帝辛': 'shang-dixin.jpg',   // 帝辛
  '仲虺': 'zhonghui.jpg',
  '吕侯（甫侯）': 'lvhou.jpg',
  '吕侯': 'lvhou.jpg',
  '甫侯': 'lvhou.jpg',
  // 夏（帝王像在根目录，人物像在 people/）
  '禹': 'xia-yu.jpg',
  '启': 'xia-qi.jpg',
  '太康': 'xia-taikang.jpg',
  '仲康': 'xia-zhongkang.jpg',
  '相': 'xia-xiang.jpg',
  '少康': 'xia-shaokang.jpg',
  '杼': 'xia-zhu.jpg',
  '槐': 'xia-huai.jpg',
  '孔甲': 'xia-kongjia.jpg',
  '桀': 'xia-jie.jpg',
  '伯益': 'boyi.jpg',
  '皋陶': 'gaoyao.jpg',
  '女娇': 'nvjiao.jpg',
  '后羿': 'houyi.jpg',
  '寒浞': 'hanzhuo.jpg',
  '寒浇': 'hanjiao.jpg',
  '靡': 'mi.jpg',
  '女艾': 'nvai.jpg',
  '妹喜': 'meixi.jpg',
  '关龙逄': 'guanlongpang.jpg',
  '羲和': 'xihe.jpg',
  '费昌': 'feichang.jpg',
  '刘累': 'liulei.jpg',
  '终古': 'zhonggu.jpg',
  // 周（诸子根目录画像沿用既有：data/portraits/<拼音>.jpg，不新增）
  '孔子': 'kongzi.jpg',
  '老子': 'laozi.jpg',
  '孙武': 'sunwu.jpg',
  '墨子': 'mozi.jpg',
  '孟子': 'mengzi.jpg',
  '庄子': 'zhuangzi.jpg',
  '列子': 'liezi.jpg',
  '荀子': 'xunzi.jpg',
  '韩非': 'hanfei.jpg',
  '苏秦': 'suqin.jpg',
  '屈原': 'quyuan.jpg',
  '公孙龙': 'gongsunlong.jpg',
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
  // 三国人物像（工笔头肩像，320×320，data/portraits/people/）
  '曹爽': 'caoshuang.jpg', '司马懿': 'simayi.jpg', '何晏': 'heyan.jpg', '王凌': 'wangling.jpg',
  '夏侯玄': 'xiahouxuan.jpg', '司马昭': 'simazhao.jpg', '司马炎': 'jin-simayan.jpg',
  '邓艾': 'dengai.jpg', '钟会': 'zhonghui.jpg', '姜维': 'jiangwei.jpg', '贾充': 'jiachong.jpg',
  '成济': 'chengji.jpg', '王经': 'wangjing.jpg', '诸葛诞': 'zhugedan.jpg',
  '曹操': 'caocao.jpg', '陈群': 'chenqun.jpg', '曹植': 'caozhi.jpg', '吴质': 'wuzhi.jpg',
  '曹真': 'caozhen.jpg', '曹休': 'caoxiu.jpg', '诸葛亮': 'zhugeliang.jpg',
  '关羽': 'guanyu.jpg', '张飞': 'zhangfei.jpg', '赵云': 'zhaoyun.jpg', '法正': 'fazheng.jpg',
  '蒋琬': 'jiangwan.jpg', '费祎': 'feiyi.jpg', '黄皓': 'huanghao.jpg', '谯周': 'qiaozhou.jpg',
  '陆抗': 'lukang.jpg', '张悌': 'zhangti.jpg', '王濬': 'wangjun.jpg', '杜预': 'duyu.jpg',
  '韦昭': 'weizhao.jpg', '诸葛恪': 'zhugeke.jpg', '孙峻': 'sunjun.jpg', '孙綝': 'sunchen.jpg',
  '全尚': 'quanshang.jpg', '孙和': 'sunhe.jpg', '周瑜': 'zhouyu.jpg', '鲁肃': 'lusu.jpg',
  '吕蒙': 'lvmeng.jpg', '陆逊': 'luxun.jpg', '张昭': 'zhangzhao.jpg', '张布': 'zhangbu.jpg',
  '丁奉': 'dingfeng.jpg', '濮阳兴': 'puyangxing.jpg',
  // 两晋十六国人物像
  '司马越': 'simayue.jpg', '王衍': 'wangyan.jpg', '刘聪': 'liucong.jpg', '刘曜': 'liuyao.jpg',
  '石勒': 'shile.jpg', '苟晞': 'guxi.jpg', '褚裒': 'chupou.jpg', '殷浩': 'yinhao.jpg',
  '桓温': 'huanwen.jpg', '谢尚': 'xieshang.jpg', '王猛': 'wangmeng.jpg', '刘裕': 'liuyu.jpg',
  '傅亮': 'fuliang.jpg', '谢晦': 'xiehui.jpg', '褚灵媛': 'chulingyuan.jpg',
  '司马道子': 'simadaozi.jpg', '司马元显': 'simayuanxian.jpg', '桓玄': 'huanxuan.jpg',
  '孙恩': 'sunen.jpg', '司马昱': 'jin-simayu.jpg', '褚蒜子': 'chusuanzi.jpg',
  '王导': 'wangdao.jpg', '王敦': 'wangdun.jpg', '顾荣': 'gurong.jpg', '贺循': 'hexun.jpg',
  '祖逖': 'zuti.jpg', '刁协': 'diaoxie.jpg', '羊祜': 'yanghu.jpg', '杨骏': 'yangjun.jpg',
  '庾亮': 'yuliang.jpg', '温峤': 'wenqiao.jpg', '陶侃': 'taokan.jpg', '苏峻': 'sujun.jpg',
  '郗鉴': 'xijian.jpg', '谢安': 'xiean.jpg', '谢玄': 'xiexuan.jpg', '桓冲': 'huanchong.jpg',
  '苻坚': 'fujian.jpg', '张贵人': 'zhangguiren.jpg', '麴允': 'quyun.jpg', '索綝': 'suolin.jpg',
  '司马保': 'simabao.jpg', '郗超': 'xichao.jpg', '慕容垂': 'murongchui.jpg',
  '王坦之': 'wangtanzhi.jpg', '庾冰': 'yubing.jpg', '庾翼': 'yuyi.jpg', '何充': 'hechong.jpg',
  '贾南风': 'jiananfeng.jpg', '司马亮': 'simaliang.jpg', '司马玮': 'simawei.jpg',
  '张华': 'zhanghua.jpg', '司马遹': 'simayu-taizi.jpg',
  // 秦
  '李斯': 'lisi.jpg',
  '王翦': 'wangjian.jpg',
  '蒙恬': 'mengtian.jpg',
  '赵高': 'zhaogao.jpg',
  '章邯': 'zhanghan.jpg',
  // 西汉
  '萧何': 'xiaohe.jpg',
  '韩信': 'hanxin.jpg',
  '张良': 'zhangliang.jpg',
  '曹参': 'caoshen.jpg',
  '周勃': 'zhoubo.jpg',
  '周亚夫': 'zhouyafu.jpg',
  '吕后': 'lvhou.jpg',
  '贾谊': 'jiayi.jpg',
  '晁错': 'chaocuo.jpg',
  '卫青': 'weiqing.jpg',
  '霍去病': 'huoqubing.jpg',
  '张骞': 'zhangqian.jpg',
  '董仲舒': 'dongzhongshu.jpg',
  '霍光': 'huoguang.jpg',
  '丙吉': 'bingji.jpg',
  '赵充国': 'zhaochongguo.jpg',
  '石显': 'shixian.jpg',
  '王昭君': 'wangzhaojun.jpg',
  '萧望之': 'xiaowangzhi.jpg',
  '刘向': 'liuxiang.jpg',
  '桑弘羊': 'sanghongyang.jpg',
  '史丹': 'shidan.jpg',
  '师丹': 'shidan.jpg',
  '王凤': 'wangfeng.jpg',
  '王政君': 'wangzhengjun.jpg',
  '赵飞燕': 'zhaofeiyan.jpg',
  '董贤': 'dongxian.jpg',
  // 新莽
  '刘歆': 'liuxin.jpg',
  '王匡': 'wangkuang.jpg',
  '樊崇': 'fanchong.jpg',
  // 东汉
  '邓禹': 'dengyu.jpg',
  '冯异': 'fengyi.jpg',
  '窦宪': 'douxian.jpg',
  '邓绥': 'dengsui.jpg',
  '梁冀': 'liangji.jpg',
  '梁妠': 'liangna.jpg',
  '孙程': 'suncheng.jpg',
  '郑众': 'zhengzhong.jpg',
  '单超': 'danchao.jpg',
  '邓骘': 'dengzhi.jpg',
  '马援': 'mayuan.jpg',
  '王景': 'wangjing.jpg',
  '杨震': 'yangzhen.jpg',
  '皇甫嵩': 'huangfusong.jpg',
  '张让': 'zhangrang.jpg',
  '班超': 'banchao.jpg',
  '蔡伦': 'cailun.jpg',
  '李膺': 'liying.jpg',
  '董卓': 'dongzhuo.jpg',
  '楚王英': 'chuying.jpg',
  '阎皇后': 'yanhou.jpg',
  '何进': 'hejin.jpg',
  '袁绍': 'yuanshao.jpg',
  '梁商': 'liangshang.jpg',
  '张衡': 'zhangheng.jpg',
  '伏皇后': 'fuhou.jpg',
  '班固': 'bangu.jpg',
  '第五伦': 'diwwulun.jpg',
  '李固': 'ligu.jpg',
  // 帝王像复用（文件在 portraits/ 根目录）
  '王莽': 'xin-wangmang.jpg',
  '刘邦': 'xihan-gaozu.jpg',
  '刘秀': 'donghan-guangwu.jpg',
  // 南宋人物像
  '史弥远': 'shimiyuan.jpg',
  '留正': 'liuzheng.jpg',
  '童贯': 'tongguan.jpg',
  '孟珙': 'menggong.jpg',
  '韩侂胄': 'hantingzhou.jpg',
  '章惇': 'zhangdun.jpg',
  '张浚': 'zhangjun.jpg',
  '陆游': 'luyou.jpg',
  '韩琦': 'hanqi.jpg',
  '毕士安': 'bishian.jpg',
  // 明末人物像
  '商辂': 'shanglu.jpg',
  '杨涟': 'yanglian.jpg',
  '左光斗': 'zuoguandou.jpg',
  '高攀龙': 'gaopanlong.jpg',
  // 多人合称节点里的人物（横向铺开时各自出像）
  '齐泰': 'qitai.jpg',
  '黄子澄': 'huangzicheng.jpg',
  '杨士奇': 'yangshiqi.jpg',
  '杨荣': 'yangrong.jpg',
  '杨溥': 'yangpu.jpg',
  '李东阳': 'lidongyang.jpg',
  '谢迁': 'xieqian.jpg',
  // 商
  '伊尹': 'yiyin.jpg',
  '巫咸': 'wuxian.jpg',
  '伊陟': 'yizhi.jpg',
  '傅说': 'fuyue.jpg',
  '甘盘': 'ganpan.jpg',
  '妇好': 'fuhao.jpg',
  '妇妌': 'fujing.jpg',
  '祖己': 'zuji.jpg',
  '比干': 'bigan.jpg',
  '箕子': 'jizi.jpg',
  '微子启': 'weizi.jpg',
  '蜚廉': 'feilian.jpg',
  '恶来': 'elai.jpg',
  // 周
  '周公旦': 'zhougong.jpg',
  '姜尚（太公望）': 'jiangshang.jpg',
  '召公奭': 'zhaogong.jpg',
  '尹吉甫': 'yinjifu.jpg',
  '共伯和': 'gongbohe.jpg',
  '毕公高': 'bigonggao.jpg',
  '祭公谋父': 'jigongmoufu.jpg',
  '密康公': 'mikanggong.jpg',
  '非子': 'feizi.jpg',
  '齐哀公': 'qiaigong.jpg',
  '荣夷公': 'rongyigong.jpg',
  '召穆公': 'zhaomugong.jpg',
  '褒姒': 'baosi.jpg',
  '申侯': 'shenhou.jpg',
  '晋文侯': 'jinwenhou.jpg',
  '郑庄公': 'zhengzhuanggong.jpg',
  '王子朝': 'wangzichao.jpg',
  '魏文侯': 'weiwenhou.jpg',
  '管仲': 'guanzhong.jpg',
  '齐桓公': 'qihuangong.jpg',
  '晋文公': 'jinwengong.jpg',
  '楚庄王': 'chuzhuangwang.jpg',
  '伍子胥': 'wuzixu.jpg',
  '范蠡': 'fanli.jpg',
  '商鞅': 'shangyang.jpg',
  '张仪': 'zhangyi.jpg',
  '廉颇': 'lianpo.jpg',
  '蔺相如': 'linxiangru.jpg',
  '信陵君': 'xinlingjun.jpg',
  '孟尝君': 'mengchangjun.jpg',
  '白起': 'baiqi.jpg',
  '乐毅': 'yueyi.jpg',
  '田单': 'tiandan.jpg',
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
  if (['英宗（朱祁镇）','朱瞻基','李世民','武曌','郭威','柴荣','李渊','爱育黎拔力八达','赵匡胤','和世㻋','曹操','曹植','诸葛亮','司马炎','司马昱','李克用','王莽','刘邦','刘秀','禹','启','太康','仲康','相','少康','杼','槐','孔甲','桀','孔子','老子','孙武','墨子','孟子','庄子','列子','荀子','韩非','苏秦','屈原','公孙龙','姬发','武王','周武王','姬诵','成王','周成王','姬钊','康王','周康王','姬瑕','昭王','周昭王','姬满','穆王','周穆王','姬繄扈','共王','周共王','姬囏','懿王','周懿王','姬辟方','孝王','周孝王','姬燮','夷王','周夷王','姬胡','厉王','周厉王','姬静','宣王','周宣王','姬宫湦','幽王','周幽王','姬宜臼','平王','周平王','姬林','桓王','周桓王','姬佗','庄王','周庄王','姬阆','惠王','周惠王','姬郑','襄王','周襄王','姬瑜','定王','周定王','姬匄','敬王','周敬王','姬午','威烈王','周威烈王','姬扁','显王','周显王','姬延','赧王','周赧王','成汤','大乙','外丙','卜丙','太甲','大甲','太戊','中宗','仲丁','中丁','盘庚','武丁','高宗','祖甲','帝祖甲','廪辛','且辛','武乙','帝乙','帝辛'].includes(name)) {
    return `../data/portraits/${f}`;
  }
  return `../data/portraits/people/${f}`;
}

function renderRelGraph(e) {
  const people = e.people || [];
  if (!people.length) return '';
  // 左右布局：皇帝在左，人物在右竖排，描述文字给足宽度
  const W = 960;
  const rowH = 124;
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
    // 根据文字长度动态计算圆角框宽度（14px 字号，中文字约 16px，紧包 padding）
    const w = Math.max(60, rel.length * 16 + 16);
    return `<rect x="${mx - w/2}" y="${my-14}" width="${w}" height="26" rx="13" fill="#fff7e0" stroke="#c9a96a" />
      <text x="${mx}" y="${my+5}" text-anchor="middle" font-size="14" fill="#8a6d3b" font-weight="700">${rel}</text>`;
  }).join('');
  // 描述文字按宽度自动换行（SVG text 不会自动折行，手动拆 tspan）
  const wrapLines = (text, x0 = 50) => {
    if (!text) return [];
    // x0 右侧可用宽度 → 每行可放几个 14px 汉字
    const maxPerLine = Math.max(10, Math.floor((W - px - x0 - 16) / 14));
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
    return lines;
  };
  const wrapNote = (text, x0 = 50) =>
    wrapLines(text, x0).map((ln, i) =>
      `<text x="${x0}" y="${16 + i * 17}" font-size="14" fill="#6f6353">${ln}</text>`
    ).join('');
  // 合称节点（「齐泰、黄子澄」「杨士奇、杨荣、杨溥（三杨）」）拆成人名列表
  const splitNames = (name) => String(name || '').split('、')
    .map((s) => s.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean);
  const dots = nodes.map((nd) => {
    const names = splitNames(nd.p.name);
    const title = PERSON_TITLES[nd.p.name] ? ` · ${PERSON_TITLES[nd.p.name]}` : '';
    // 多人合称：头像与单人节点同大（直径 76），从左到右铺成一行，各自配小字名，正文接在行尾
    if (names.length > 1) {
      const n = names.length;
      const r = 38;
      const gap = 12;
      const leftX = -38;
      const rowW = n * r * 2 + (n - 1) * gap;
      const textX = leftX + rowW + 14;
      const faces = names.map((nm, i) => {
        const x = leftX + r + i * (r * 2 + gap);
        const portrait = personPortrait(nm);
        const img = portrait
          ? `<image x="${x - r}" y="${-r}" width="${r * 2}" height="${r * 2}" href="${portrait}" clip-path="circle(${r}px)" preserveAspectRatio="xMidYMid slice" loading="lazy" />`
          : `<text x="${x}" y="${Math.round(r * 0.3)}" text-anchor="middle" font-size="${Math.round(r * 0.8)}">人</text>`;
        return `<circle cx="${x}" cy="0" r="${r}" fill="#fff" stroke="#c9a96a" stroke-width="2.5" />
          ${img}
          <text x="${x}" y="${r + 16}" text-anchor="middle" font-size="12.5" fill="#6f6353">${nm}</text>`;
      }).join('');
      // 头像下方已有小字名，行尾不再重复合称，整块空间留给说明文字（垂直居中）
      const lines = wrapLines(nd.p.note || '', textX);
      const y0 = 5 - ((lines.length - 1) * 17) / 2;
      const noteSvg = lines.map((ln, i) =>
        `<text x="${textX}" y="${y0 + i * 17}" font-size="14" fill="#6f6353">${ln}</text>`
      ).join('');
      return `<g transform="translate(${nd.x},${nd.y})">
        ${faces}
        ${noteSvg}
      </g>`;
    }
    const portrait = personPortrait(nd.p.name);
    const img = portrait
      ? `<image x="-36" y="-36" width="72" height="72" href="${portrait}" clip-path="circle(36px)" preserveAspectRatio="xMidYMid slice" loading="lazy" />`
      : `<text x="0" y="12" text-anchor="middle" font-size="26">人</text>`;
    return `<g transform="translate(${nd.x},${nd.y})">
      <circle r="38" fill="#fff" stroke="#c9a96a" stroke-width="2.5" />
      ${img}
      <text x="50" y="-6" text-anchor="start" font-size="17" font-weight="700" fill="#3a2e1f">${nd.p.name}<tspan font-size="14" font-weight="400" fill="#6f6353">${title}</tspan></text>
      ${wrapNote(nd.p.note || '')}
    </g>`;
  }).join('');
  const centerImg = e.portrait
    ? `<image x="-60" y="-60" width="120" height="120" href="../data/portraits/${e.portrait}" clip-path="circle(60px)" preserveAspectRatio="xMidYMid slice" />`
    : `<text x="0" y="20" text-anchor="middle" font-size="36">帝</text>`;
  const center = `
    <g transform="translate(${cx},${cy})">
      <circle r="70" fill="#fff7e0" stroke="#c9a96a" stroke-width="4" />
      ${centerImg}
      <text x="0" y="92" text-anchor="middle" font-size="17" font-weight="800" fill="#8a4b1f">${e.name}</text>
    </g>`;
  return `<div class="detail-panel relation-panel">
    <h4 style="font-size:18px">${e.name}的人物关系</h4>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:960px" role="img" aria-label="${e.name}人物关系图">
      ${lines}${relLabels}${center}${dots}
    </svg>
  </div>`;
}

// ---------- 时间线 ★ 判据 ----------
// ★ 只认数据里显式标注的 highlight: true —— 这是一次人工判断，不是关键词匹配。
//
// 演进过程：最初按标题关键词打星，结果「即位」「登基」「驾崩」人人有星
// （119 条 / 21%），而壬寅宫变、大礼议、崖山海战、杯酒释兵权、张居正改革这些
// 真正的转折反而没有星；后来扩充词表把星推到 184 条（33%），仍然解决不了
// 「关键词猜不出重要性」这件事。
//
// 现在全站 189 条有星（930 条里的 20%，平均每位皇帝 1.4 条），星代表「这件事改变了走向」。
// 秦汉四朝原先一条星都没有（190 条全平），2026-11 按同一判据补了 43 条：
// 始皇灭齐称帝/筑长城/焚书、武帝张骞/漠北/巫蛊/轮台、光武昆阳/称帝/度田、王莽代汉/王田/昆阳……
// 新增或修改内容时，需要人工在该条目上加 "highlight": true。
function isCoreEvent(t) {
  return t.highlight === true;
}

/* 秦没有年号制度，只有秦王纪年（「秦王政二十六年」），所以标签不能写「年号」。
   这里按朝代给一个词：秦→纪年，其余→年号。 */
function eraWord(e) {
  const dyn = (e && (e._dynasty || e.dynasty)) || currentDynasty;
  return dyn === 'qin' ? '纪年' : '年号';
}

function showEmperor(e) {
  stopGuideIfAny();                 // 换皇帝即停：朗读/推进不得跨人物继续
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
        ? `<img class="detail-portrait" src="../data/portraits/${e.portrait}" alt="${e.name}" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')" />`
        : `<div class="detail-portrait">帝</div>`}
      <div class="meta">
        <h3 style="color:#c0392b;font-size:26px">${e.name} <small style="color:#8a7a5c;font-size:16px;font-weight:normal">${e.templeName}</small></h3>
        <div class="intro">${intro}</div>
        <div class="tags"><b style="color:#333">${eraWord(e)}</b> <span class="tag-val" title="${e.eraName.join('、')}">${e.eraName.join('、')}</span> · <b style="color:#333">在位</b> <span class="tag-val">${fmtYear(e.reign.start)}-${fmtYear(e.reign.end)}</span> · <b style="color:#333">关键人物</b>：<span class="tag-val">${people || '—'}</span></div>
      </div>
    </div>
    ${renderRelGraph(e)}
    <div class="detail-panel entry-block">
      <h4>生平时间线</h4>
      <ul class="timeline">${timeline.map((t) => {
        const isHighlight = isCoreEvent(t);
        const year = t.date || "";
        // 公元前用「前221」展示；跨年区间拆两行（区间两端都要走 fmtYear，避免出现「-221--207」）
        const years = year.match(/-?\d{3,4}/g) || [];
        const yearHtml = years.length > 1
          ? years.map(fmtYear).join('<br>-')
          : (year ? fmtYear(year) : "");
        return `
        <li class="tl-item ${isHighlight ? "tl-highlight" : ""}">
          <div class="tl-year">${yearHtml}</div>
          <div class="tl-body">
            <div class="tl-event">${t.title}${isHighlight ? " ★" : ""}</div>
            ${t.description ? `<div class="tl-note">${t.description}</div>` : ""}
          </div>
        </li>`;
      }).join("")}
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
  return `<ul class="fact-list">${facts.map((f) => `<li>${f.fact || f}</li>`).join('')}</ul>`;
}

function renderOpen(cs) {
  if (!cs || !cs.length) return '<p>想想看：如果你是这位皇帝，你会怎么做？</p>';
  return `<ul class="open-list">${cs.map((c, i) => {
    const vp = (c.viewpoints || []).join(' / ');
    const key = `deb-${currentDynasty}-${currentEmperorKey}-${i}`;
    return `
    <li class="debate-item" data-di="${i}" data-q="${escapeHtml(c.question || '')}" data-vp="${escapeHtml(vp)}">
      <div class="q">${c.question}</div>
      <div class="ctx">${c.context || ''}</div>
      <div class="viewpoints">${(c.viewpoints || []).map((v) => `<p>• ${v}</p>`).join('')}</div>
      <textarea class="deb-input" data-key="${key}" placeholder="你怎么看？写下你的理由（可以引用上面的视角或史实）…"></textarea>
      <button type="button" class="create-save llm-btn deb-ai" data-di="${i}">请 AI 老师点评我的理由</button>
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
       <button type="button" class="create-save llm-btn quiz-review" data-mode="${mode}">请 AI 老师点评</button>
       <button type="button" class="create-save llm-btn quiz-reset" data-mode="${mode}" style="background:#8a7a5c">重做</button>
       <div class="ws-result quiz-review-result"></div>`
    : `<div class="quiz-progress">已选 ${answered} / ${items.length}</div>
       <button type="button" class="create-save llm-btn quiz-submit" data-mode="${mode}">提交看答案</button>`;
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
      out.innerHTML = '<div class="ask-hint">AI 老师正在结合史实点评…</div>';
      const prompt = `下面是关于${label}${e.name}的选择题作答（题目为本项目内置）：
${digest}

请点评：我选错的题，错在哪个理解误区，用史实讲清楚；选对但题目偏开放的，补充一点我没想到的角度；最后用一句话总结我最该记住的认识。通俗简练，分点说。`;
      const d = await askHistoryTeacher(prompt);
      out.innerHTML = d.ok
        ? `<div class="ask-hit llm-answer"><b>AI 老师点评</b>：${formatReply(d.reply)}</div>`
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
      result.innerHTML = '<div class="ask-hint">AI 老师正在结合史实点评…</div>';
      const prompt = `【争议问题】${item.dataset.q}
【常见的两种视角】${item.dataset.vp || '（无）'}
【我的理由】${v}
请中立地点评：我的理由是否站得住、用了哪些史实（指出与史实不符处）、有没有忽略对方视角中有力的一点；最后提一个能让我继续思考的问题。通俗简练。`;
      const d = await askHistoryTeacher(prompt);
      result.innerHTML = d.ok
        ? `<div class="ask-hit llm-answer"><b>AI 老师点评</b>：${formatReply(d.reply)}</div>`
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
// 西汉—新莽—东汉三朝疆域外轮廓大体相同（西域都护、乐浪、交趾三端最突出），
// 差别只在西域三通三绝，图上用同一条简化轮廓示意，注释里写明差异。
const HAN_OUTLINE = [
  [75.0,40.0],[80.0,41.0],[85.0,42.0],[90.0,42.5],[95.0,42.5],[100.0,42.0],
  [105.0,42.0],[110.0,42.0],[115.0,42.0],[119.0,42.0],[121.5,42.0],[124.0,41.5],
  [125.0,40.0],[123.0,39.0],[122.0,37.5],[121.5,36.0],[121.0,34.0],[122.0,32.0],
  [121.0,30.0],[119.0,26.0],[118.0,24.0],[116.0,23.0],[113.0,22.0],[110.0,21.0],
  [108.0,20.5],[106.0,22.0],[104.0,25.0],[103.0,29.0],[102.0,33.0],[100.0,36.0],
  [97.0,37.5],[94.0,38.5],[90.0,39.0],[85.0,39.5],[80.0,39.5],[75.0,40.0],
];

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
  // 三国（220-280）三方合计范围（据谭其骧《中国历史地图集·三国时期》示意）：
  // 北：魏之幽州—并州，阴山—燕山一线（约41°N）；西：凉州敦煌（约94°E），未含西域；
  // 东：辽东（约124°E）；南：吴之交州（日南，约18°N）、蜀之南中（约22°N）
  // 说明：这是魏蜀吴三块合起来的外轮廓，不是单方边界——三方分界线见页脚说明。
  sanguo: [
    [94.0,40.0],[97.0,40.5],[100.0,40.8],[103.0,40.8],[106.0,41.0],
    [109.5,41.2],[113.5,41.0],[117.0,41.2],[119.5,41.3],[121.5,41.8],
    [123.5,41.5],[124.5,40.5],[123.0,39.5],[122.0,38.0],[121.5,36.5],
    [122.5,35.0],[121.5,33.5],[121.5,31.5],[120.5,29.0],[119.3,26.1],
    [118.2,24.5],[116.5,23.3],[113.5,22.3],[110.5,20.5],[108.0,18.3],
    [106.5,19.5],[105.0,21.0],[103.5,22.3],[101.5,21.8],[99.5,22.8],
    [98.5,24.0],[98.5,26.0],[100.5,28.5],[102.0,31.0],[103.0,33.0],
    [104.5,34.0],[104.5,36.0],[103.0,36.5],[101.0,37.5],[99.0,38.0],
    [96.5,39.0],[94.0,39.5],[94.0,40.0],
  ],
  // 两晋（265-420）取西晋太康年间（280 灭吴后）极盛范围（据《中国历史地图集·西晋时期》示意）：
  // 北界阴山—燕山（约41.5°N），西到凉州敦煌并领西域长史府（约91°E），东到辽东（约124°E），
  // 南含交州日南（约18°N）、南中（约22°N）。东晋南渡后只剩东南半壁，图上按西晋全盛示意。
  jin: [
    [91.0,40.0],[95.0,40.5],[99.0,40.8],[103.0,41.0],[107.0,41.2],
    [111.0,41.5],[113.5,41.2],[117.0,41.3],[119.5,41.4],[121.5,41.9],
    [123.5,41.6],[124.5,40.6],[123.0,39.5],[122.0,38.0],[121.5,36.5],
    [122.5,35.0],[121.5,33.5],[121.5,31.5],[120.5,29.0],[119.3,26.1],
    [118.2,24.5],[116.5,23.3],[113.5,22.3],[110.5,20.5],[108.0,18.3],
    [106.5,19.5],[105.0,21.0],[103.5,22.3],[101.5,21.8],[99.5,22.8],
    [98.5,24.0],[98.5,26.0],[100.5,28.5],[102.0,31.0],[103.0,33.0],
    [104.5,34.0],[104.5,36.0],[103.0,36.5],[101.0,37.5],[98.0,38.5],
    [94.5,39.2],[91.0,39.5],[91.0,40.0],
  ],
  // 秦（前 221-前 207）：
  // 北以秦长城为界（阴山—燕山，约 41-42°N），西到陇西（约 104°E），东到辽东（约 124°E），
  // 南置桂林、南海、象郡，抵今越南北部（约 21°N）。据《中国历史地图集·秦时期》示意。
  qin: [
    [104.0,38.0],[106.0,39.5],[108.0,40.5],[110.0,41.0],[112.0,41.5],
    [114.0,41.8],[116.0,41.5],[118.0,41.0],[120.0,40.8],[122.0,41.0],
    [124.0,40.5],[123.0,39.0],[121.5,38.0],[122.0,36.5],[121.0,35.0],
    [120.5,33.0],[121.5,31.5],[120.0,29.0],[118.0,25.0],[116.0,23.5],
    [113.5,22.5],[111.0,21.3],[109.5,21.6],[107.5,21.8],[106.0,22.5],
    [104.5,25.0],[104.0,29.0],[103.5,33.0],[104.0,36.0],[104.0,38.0],
  ],
  han: HAN_OUTLINE,
  xihan: HAN_OUTLINE,
  xin: HAN_OUTLINE,
  donghan: HAN_OUTLINE,
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

// 各朝事件标记的颜色（图标位已不再用 emoji：见 .map-event-icon 的样式化方块）
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
  sanguo: { center: [33.5, 108], zoom: 4 },
  jin: { center: [34, 106], zoom: 4 },
  qin: { center: [34, 108], zoom: 4 },
  han: { center: [34.5, 106.5], zoom: 4 },
  xihan: { center: [35, 105], zoom: 4 },
  xin: { center: [35, 106], zoom: 4 },
  donghan: { center: [34, 108], zoom: 4 },
};

/** 城市标签密度随缩放变化。
 *  三国、两晋、隋的地名几乎全挤在中原—江淮一线（洛阳、许昌、邺城、建业、寿春…），
 *  在整朝视野（zoom ≤ 5）里如果每个都常显名字，会叠成一团、互相盖住。
 *  所以低缩放下只留彩色圆点，放大到 zoom ≥ 6 再显示地名，点圆点仍可看详情。
 *  只切容器上的一个 class、由 CSS 隐藏文字，不重建任何图层。 */
function syncPlaceLabelDensity() {
  if (!leafletMap) return;
  const box = leafletMap.getContainer();
  if (!box) return;
  box.classList.toggle('map-labels-off', leafletMap.getZoom() < 6);
}

/** 归一化各朝数据，产出纯数据对象（可脱离 Leaflet 测试）：
 *  { shape, wall, songBorder, rivers, provinces, neighbors, places, events, routes } */
function buildMapData() {
  const d = currentDynasty;
  const isMing = d === 'ming';
  const isSong = d === 'song';
  const fill = DYNASTY_FILL[d] || DYNASTY_FILL.ming;
  // 疆域：优先真实边界 geojson（各区块 Polygon，供描边/标签/点击区分）；
  //       无 geojson 的朝代（宋/隋/五代）回退 FALLBACK_SHAPES 单连续多边形
  //       「全部」不画疆域——它是九朝 103 帝的合并视图，画任何一朝轮廓都是错的。
  const geo = (typeof MAP_GEO !== 'undefined') ? MAP_GEO[d] : null;
  let shape = null;
  if (d === 'all') {
    shape = null;
  } else if (geo && geo.features && geo.features.length) {
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
    places: mergePlaces((DATA.places || []).filter((p) => p.type !== 'overseas')),
    events: eventsForEra(activeEraId),
    routes: (DATA.routes || []).filter((r) => r.id !== 'zhenghe-west'),
    zhenghe: (DATA.routes || []).find((r) => r.id === 'zhenghe-west') || null,
    fill,
  };
}

// Leaflet 按需加载：首屏默认是时间线，不需要 144KB 的地图库；
// 只有用户第一次切到「舆图疆域」标签时，才注入 leaflet.css + leaflet.js。
// 这样首屏少传 ~158KB（gzip 后也少一个 144KB 脚本的解析与执行），时间线立刻可交互。
let _leafletLoading = null;
function ensureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_leafletLoading) return _leafletLoading;
  _leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet.css';
    document.head.appendChild(css);
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = 'https://tile.openstreetmap.org';
    document.head.appendChild(pre);
    const s = document.createElement('script');
    s.src = 'vendor/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = () => { _leafletLoading = null; reject(new Error('地图组件加载失败')); };
    document.body.appendChild(s);
  });
  return _leafletLoading;
}

// Leaflet 实例缓存：切换朝代时复用（重设视图+图层），避免重建地图/瓦片
let leafletMap = null;
// 路线深链只应用一次：renderMap 会因切朝代/切年号重渲染，
// 每次重渲染都触发一次胶囊 click 会把用户已调整好的视野反复复位。
let appliedDeepRoute = '';
let leafletLayers = {}; // { shape, wall, songBorder, rivers, mountains, provinces, neighbors, places, events, routes, zhenghe }

/** 让传入的 [lng,lat] 点集对齐（若坐标是 [lat,lng] 顺序，则交换） */
function toLatLngs(pts) {
  return pts.map((p) => (p.length === 2 ? [p[1], p[0]] : p));
}

/** 清除旧图层（只留底图） */
function clearLeafletLayers() {
  if (!leafletMap) return;
  // 路线起终点的「起·某地 / 终·某地」是常显 tooltip，挂在 map 的 tooltipPane 上，
  // 不随 marker 被 removeLayer 一起清掉：切朝代后会留在新朝地图上（唐→明 实测残留
  // 「起·长安 / 终·安市城」），反复切换就攒出一堆气泡把路线盖住。先逐个关掉。
  (leafletLayers.routes || []).forEach((l) => {
    if (!l) return;
    hideRouteMarker(l.sMark);
    hideRouteMarker(l.eMark);
  });
  // leafletLayers.routes 里存的是 { line, wps, sMark, eMark } 包装对象，不是 Layer 本体。
  // 旧代码直接 removeLayer(x) 传进去的是个普通对象，等于什么也没删——于是每次切朝代
  // 都把上一朝的路线折线、途经点、起终点标记留在图上（隋→唐→隋 实测攒到 8 条路线，
  // 选中的那条还保持 opacity 1，看上去「什么都没点地图上就有路线，而且不会消失」）。
  // 这里按包装对象拆开逐个移除。
  const removeLayerSafe = (x) => {
    if (!x) return;
    if (x.line || x.wps || x.sMark || x.eMark) {
      if (x.line) leafletMap.removeLayer(x.line);
      (x.wps || []).forEach((w) => w && leafletMap.removeLayer(w));
      if (x.sMark) leafletMap.removeLayer(x.sMark);
      if (x.eMark) leafletMap.removeLayer(x.eMark);
      return;
    }
    leafletMap.removeLayer(x);
  };
  Object.values(leafletLayers).forEach((l) => {
    if (Array.isArray(l)) l.forEach(removeLayerSafe);
    else removeLayerSafe(l);
  });
  leafletLayers = {};
  const pane = leafletMap.getPane ? leafletMap.getPane('tooltipPane') : null;
  if (pane) pane.querySelectorAll('.route-pt-tip').forEach((el) => el.remove());
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

/** ---- 地名归一：一座城只留一个点 ----
 *  同一座城在史料里有多个名字（长安／大兴城／西安），又被各朝各记一条；
 *  「全部」视图把九朝的 places 直接拼接，于是同一坐标叠着红点+蓝点。
 *  做法：按「别名组」合并成一条，类型取最强的一个（都城 > 诸国都城 > 城市 > 名胜），
 *  坐标、故事取自主条目，其余称谓记进 variants，弹窗里作为「历代称谓」列出。
 *  注意只按名归并，不按坐标近邻归并：长安与灞上相距 0.11°，却是两处地方。 */
const PLACE_ALIAS_GROUPS = [
  ['长安', '大兴城', '西安', '京兆'],
  ['建业', '建康', '应天府', '南京', '金陵'],
  ['北平', '北京', '大都', '燕京', '涿郡'],
  ['余杭', '杭州', '临安'],
  ['晋阳', '太原'],
  ['江都', '扬州', '广陵'],
  ['许昌', '许都'],
  ['会稽', '绍兴', '山阴'],
  ['江陵', '荆州'],
  ['邺城', '邺'],
];
/** 跨朝代合并时的显示名（中性、最通用的一种称呼）：避免「全部」视图里出现某个朝代专属的名字
 *  （如九朝合看却写着「应天府」「大兴城」「西安」）。单朝视图不走这张表，仍用当朝称谓。 */
const PLACE_DISPLAY = { '长安': '长安', '建业': '建康', '北平': '北京', '余杭': '杭州', '晋阳': '太原', '江都': '扬州' };
const PLACE_ALIAS_KEY = (() => {
  const m = new Map();
  PLACE_ALIAS_GROUPS.forEach((g) => g.forEach((n) => m.set(n, g[0])));
  return m;
})();
const PLACE_TYPE_RANK = { capital: 0, regime: 1, city: 2, site: 3 };

/** 按别名组把地名列表合并成唯一地点；「全部」视图靠它消掉跨朝的重复点 */
function mergePlaces(list) {
  const byKey = new Map();
  (list || []).forEach((p) => {
    const key = PLACE_ALIAS_KEY.get(p.name) || p.name;
    const type = p.type || 'city';
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        name: p.name, modernName: p.modernName || '', type, lat: p.lat, lng: p.lng,
        story: p.story || '', note: p.note || '', _dynasty: p._dynasty, _key: key,
        variants: [{ name: p.name, dynasty: p._dynasty, type, modernName: p.modernName || '' }],
      });
      return;
    }
    const v = { name: p.name, dynasty: p._dynasty, type, modernName: p.modernName || '' };
    // 同名不同朝也要各自留一条（成都＝三国都城＋晋战场＋明重镇），否则弹窗里说不出它在各朝的角色
    if (!cur.variants.some((x) => x.name === v.name && x.dynasty === v.dynasty)) cur.variants.push(v);
    const curRank = PLACE_TYPE_RANK[cur.type] ?? 9;
    const newRank = PLACE_TYPE_RANK[type] ?? 9;
    // 类型更强 → 换成那条作为主条；类型同级 → 取后出现的（更接近该朝后期的正式称谓，
    // 明朝「北平→北京」就会落在「北京」上，而不是洪武旧名）
    if (newRank < curRank || (newRank === curRank && p.name !== cur.name)) {
      cur.name = p.name; cur.modernName = p.modernName || cur.modernName;
      cur.type = type; cur.lat = p.lat; cur.lng = p.lng;
      // 故事与说明跟着主条走：否则会出现「标题＝北京、正文＝隋涿郡」这种错位
      cur.story = p.story || cur.story;
      cur.note = p.note || cur.note;
    }
    if (!cur.story && p.story) cur.story = p.story;
    if (!cur.note && p.note) cur.note = p.note;
  });
  // 跨朝代（「全部」视图）时用中性称谓，别让九朝合看的地图上只写某一朝的名字
  byKey.forEach((v) => {
    const dyns = new Set(v.variants.map((x) => x.dynasty).filter(Boolean));
    if (dyns.size > 1) {
      if (PLACE_DISPLAY[v._key]) v.name = PLACE_DISPLAY[v._key];
      v._multiDynasty = true;
    }
  });
  // 城内细点：名胜/小城落在某座城的 0.06° 内（紫禁城、南宫、豹房之于北京，大兴善寺之于长安），
  // 整朝视野不铺，zoom≥9 才展开，避免同一处叠成一坨。
  const anchors = [...byKey.values()].filter((v) => PLACE_TYPE_RANK[v.type] <= PLACE_TYPE_RANK.city);
  byKey.forEach((v) => {
    if (PLACE_TYPE_RANK[v.type] <= PLACE_TYPE_RANK.city) return;
    const host = anchors.find((a) => Math.abs(a.lat - v.lat) < 0.06 && Math.abs(a.lng - v.lng) < 0.06);
    if (host) v._inner = host.name;
  });
  return [...byKey.values()];
}

/** 城市点：圆圈 + 名字（divIcon），可点击弹窗 */
function addPlaceMarker(p) {
  const cls = p.type || 'city';
  // 四类点位，与图例一一对应：本朝都城（红）/ 诸国·前朝都城（褐）/ 重镇（蓝）/ 战场·名胜（黄）
  const color = cls === 'capital' ? '#c0392b'
    : cls === 'regime' ? '#8a5a2b'
    : cls === 'site' ? '#f0a500' : '#247bc1';
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
  m._place = p;
  m._inner = !!p._inner;
  m.on('click', () => showPlacePopup(p));
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

/** 把地图收回该朝的默认视野。
 *  事件胶囊会把镜头飞到 zoom 8 的单点；此后点「路线胶囊」或「该朝事件」都是回到总览，
 *  必须把镜头一起收回，否则会停在某个事件的放大视野上看整朝路线。 */
function resetMapView() {
  if (!leafletMap) return;
  const v = MAP_VIEW[currentDynasty] || MAP_VIEW.ming;
  leafletMap.setView(v.center, v.zoom, { animate: true });
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

/** 事件点标记：显示古地名（同名聚合，多个事件带数量角标），点击弹该地全部事件
 *  defer=true 时只建对象不上图——默认视图地标太多，改由「该朝事件」/年号胶囊/事件胶囊按需上图 */
function addEventMarker(cluster, defer) {
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
  if (!defer) m.addTo(leafletMap);
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
    const dot = L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 2, fillColor: r.color, fillOpacity: 0, opacity: 0 });
    dot.bindTooltip(`${p.name}${p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : ''}：${p.note || ''}`, { direction: 'top' });
    dot.addTo(leafletMap);
    return dot;
  });
  const start = allPts[0], end = allPts[allPts.length - 1];
  // 起点：绿色大点；终点：红色大点。初始必须 opacity 0 + fillOpacity 0 双关：
  // Leaflet 的 opacity 只管描边，fillOpacity 才管圆面；只关 opacity 会留下一颗实心彩点，
  // 每朝没点路线时也常驻在图上（全部视图 45 条路线就是 90 颗大点）。
  const sMark = start ? L.circleMarker([start.lat, start.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2e7d32', fillOpacity: 0, opacity: 0, zIndexOffset: 1000 }) : null;
  const eMark = end ? L.circleMarker([end.lat, end.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#a0251c', fillOpacity: 0, opacity: 0, zIndexOffset: 1000 }) : null;
  if (sMark) {
    sMark.bindTooltip(`起 · ${start.name}${start.modern && start.modern !== start.name ? '（今' + start.modern + '）' : ''}`, { permanent: true, direction: 'top', className: 'route-pt-tip' });
    sMark.addTo(leafletMap);
    // 常显 tooltip 是「addTo 即开」的，而路线初始是隐藏态（opacity 0）。
    // 不主动关掉，一进舆图就会只剩一串「起·某地/终·某地」气泡飘在空图上（各朝都中招）。
    sMark.closeTooltip();
  }
  if (eMark) {
    eMark.bindTooltip(`终 · ${end.name}${end.modern && end.modern !== end.name ? '（今' + end.modern + '）' : ''}`, { permanent: true, direction: 'bottom', className: 'route-pt-tip' });
    eMark.addTo(leafletMap);
    eMark.closeTooltip();
  }
  return { line, wps, sMark, eMark };
}

/** 路线动画：从起点画到终点（dasharray 动态收拢） */
const _routeTimers = [];
function animateRoute(layer, duration = 1500) {
  if (!layer) return;
  // 立即隐藏本层所有途经点/起终点（防上一轮动画残留），定时器记录供统一清理。
  // 注意 Leaflet 的 opacity 只作用于描边，圆面由 fillOpacity 控制：两个都要归零，
  // 否则 hide 之后仍留实心彩点；回显时两个一起恢复，不会出现空心圈。
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
    _routeTimers.push(setTimeout(() => w.setStyle({ opacity: 1, fillOpacity: 1 }), t));
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

/* ============================================================
 * 郑和下西洋：七次航次（data/routes.json 里 zhenghe-west.voyages）
 * 原先把七次合成一条「含远洋」的折线，看不出这是第几次；这里改成
 * 按航次重画：每次只画本航次的地点顺序，并在详情卡里给七个航次胶囊。
 * ============================================================ */
/** 当前选中的航次下标；-1 = 「七次叠影」态（不画单条航线，只叠七条看范围） */
let zhVoyageIndex = -1;
let zhRouteData = null;   // 当前郑和路线对象（含 voyages）

/** 清掉当前郑和航线图层（折线 + 途经点圆点），下次按新航次重建 */
function clearZhengheLayers() {
  (leafletLayers.zhenghe || []).forEach((x) => { if (x && leafletMap) leafletMap.removeLayer(x); });
  leafletLayers.zhenghe = [];
  // 还原地图缩放下限：直接改 options.minZoom，不走 Leaflet 的 setMinZoom——
  // setMinZoom 内部会 setZoom(_limitZoom(当前zoom)) 并起一段缩放动画，
  // 若此时正在按新航次 setView，那段动画会在稍后结束时把视野改回旧级别。
  if (leafletMap && leafletMap.options && leafletMap.options.minZoom < 3) leafletMap.options.minZoom = 3;
}

/** 选中某次航次时返回该次航点；叠影态返回 null（此时不画单条路线） */
function currentZhenghePoints() {
  if (!zhRouteData || !zhRouteData.voyages) return null;
  if (zhVoyageIndex < 0 || zhVoyageIndex >= zhRouteData.voyages.length) return null;
  return zhRouteData.voyages[zhVoyageIndex].points || null;
}

/** 郑和的图要独占底图：先收掉国内路线、事件点和城市点，再把旧郑和图层清干净 */
function prepareZhengheStage() {
  (leafletLayers.routes || []).forEach((l) => {
    l.line.setStyle({ opacity: 0, fillOpacity: 0 });
    l.wps.forEach((w) => w.setStyle({ opacity: 0, fillOpacity: 0 }));
    hideRouteMarker(l.sMark);
    hideRouteMarker(l.eMark);
  });
  (leafletLayers.places || []).forEach((m) => { if (m && leafletMap) leafletMap.removeLayer(m); });
  (leafletLayers.events || []).forEach((m) => { if (m && leafletMap) leafletMap.removeLayer(m); });
  clearZhengheLayers();
}

/** 把视野框到一组经纬范围。
 *  Leaflet 自带 fitBounds 在 zoomSnap=1 时会把「差一点装下」的航线向上取整，
 *  手机窄屏会出现两端被裁掉（第四次西端波斯湾落在屏幕外），所以这里按投影自己算整数级：
 *  zoom0 世界宽 256px，逐级减半；取能装下经纬跨度的最大整数级，再夹到 [2,4]。 */
function fitZhengheView(bounds) {
  if (!leafletMap || !bounds || !bounds.isValid()) return;
  const pad = 30;
  const size = leafletMap.getSize();
  const bs = leafletMap.project(bounds.getSouthEast(), 0).subtract(leafletMap.project(bounds.getNorthWest(), 0));
  const fitZoom = Math.max(2, Math.min(4,
    Math.floor(Math.log2(Math.min((size.x - pad * 2) / bs.x, (size.y - pad * 2) / bs.y)))));
  // 远洋航线在手机上得退到 zoom 2，而地图 minZoom 是 3：按需放开下限（直接改
  // options.minZoom，避开 setMinZoom 自带的缩放动画），清图层时还原。
  if (leafletMap.options && fitZoom < leafletMap.options.minZoom) leafletMap.options.minZoom = fitZoom;
  leafletMap.setView(bounds.getCenter(), fitZoom, { animate: false });
}

/** 海路整形：港口数据只有港点，直连会在陆地上拉直线（刘家港→占城横切浙闽、
 *  忽鲁谟斯→木骨都束穿阿拉伯半岛、亚丁→摩加迪沙切索马里内陆）。
 *  这里按 routes.json 的 via 补几个海上转弯点，让线贴着水走；
 *  这些点只用于整形，不是停泊港，所以既不画圆点也不进详情卡。 */
function zhSeaPath(points) {
  const via = (zhRouteData && zhRouteData.via) || {};
  const out = [];
  points.forEach((p, i) => {
    if (i > 0) {
      const prev = points[i - 1];
      const key = `${prev.name}|${p.name}`;
      const back = `${p.name}|${prev.name}`;
      if (via[key]) via[key].forEach(([lat, lng]) => out.push([lat, lng]));
      else if (via[back]) via[back].slice().reverse().forEach(([lat, lng]) => out.push([lat, lng]));
    }
    out.push([p.lat, p.lng]);
  });
  return out;
}

/** 单次航次：一条虚线航线 + 全部途经点 + 描线动画；起点/终点与主干港口加古地名标签 */
function drawZhengheRoute(points) {
  if (!leafletMap || !points || points.length < 2) return;
  clearRouteAnimations();
  prepareZhengheStage();
  const color = (zhRouteData && zhRouteData.color) || '#247bc1';
  const line = L.polyline(zhSeaPath(points), {
    color, weight: 3, opacity: 1, dashArray: '8 5', lineCap: 'round', lineJoin: 'round',
  }).addTo(leafletMap);
  const marks = points.map((p) => {
    const dot = L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, opacity: 1 });
    dot.bindTooltip(`${p.name}${p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : ''}：${p.note || ''}`, { direction: 'top' });
    dot.addTo(leafletMap);
    return dot;
  });
  // 古地名：起点、终点，以及该次经过的共同主干港口（七次都到的那几处）。
  // 同样等取景完成再看 zoom：手机退到 zoom 2 时只留起点/终点/古里，免得标签互相压住。
  fitZhengheView(line.getBounds());
  const labels = [];
  const trunk = zhTrunkStations(zhRouteData && zhRouteData.voyages);
  const seen = new Set();
  const pushLabel = (p, dir) => {
    if (!p || seen.has(p.name)) return;
    seen.add(p.name);
    const m = addZhenghePlaceLabel(p, dir);
    if (m) labels.push(m);
  };
  const tight = leafletMap.getZoom() < 3;
  pushLabel(points[0], 'top');
  pushLabel(points[points.length - 1], 'bottom');
  points.forEach((p, i) => {
    const name = p.name === '锡兰' ? '锡兰山' : p.name;
    if (tight ? name === '古里' : trunk.includes(name)) pushLabel(p, i % 2 ? 'bottom' : 'top');
  });
  leafletLayers.zhenghe = [line].concat(marks, labels);
  animateRoute({ line, wps: marks, sMark: null, eMark: null }, 1800);
}

/** 七次共同主干：七次全都到过的港口，按第一次的行进顺序排列。
 *  并集里写「锡兰」、各次写「锡兰山」，归一再求交集。 */
function zhTrunkStations(voyages) {
  if (!voyages || !voyages.length || !voyages[0].points) return [];
  const norm = (n) => (n === '锡兰' ? '锡兰山' : n);
  return voyages[0].points.map((p) => norm(p.name))
    .filter((n) => voyages.every((v) => v.points.some((p) => norm(p.name) === n)));
}

/** 郑和古地名标签：照图例那一枚「地名」做——白底胶囊 + 红色圆角方图标 + 墨色古地名 + 灰字今地名
 *  （描边与图标 #c0392b，实测自图例截图）；用 permanent tooltip 常显，方向可上可下，便于相邻地名错开。 */
function addZhenghePlaceLabel(p, dir) {
  if (!leafletMap || !p || p.lat == null || p.lng == null) return null;
  const modern = p.modern && p.modern !== p.name ? `（今${p.modern}）` : '';
  const icon = L.divIcon({ className: 'zh-place-anchor', html: '', iconSize: [0, 0] });
  const m = L.marker([p.lat, p.lng], { icon, interactive: false, keyboard: false });
  m.bindTooltip(`<span class="zh-place-dot"></span>${p.name}<span class="zh-place-modern">${modern}</span>`, {
    permanent: true, direction: dir || 'top', className: 'zh-place-tip', opacity: 1,
  });
  m.addTo(leafletMap);
  if (m.openTooltip) m.openTooltip();
  return m;
}

/** 七次叠影：主干一条略粗 + 古里以西按航次分岔加亮，配古地名标签；不画站点、不排先后。
 *  一张图上「越走越远」一眼可见，但顺序解释权只留给各航次胶囊——
 *  七次合起来不是一条连续航线，任何一条「合并折线」都会画出历史上不存在的航段。 */
function drawZhengheShadow() {
  if (!leafletMap || !zhRouteData || !zhRouteData.voyages) return;
  clearRouteAnimations();
  prepareZhengheStage();
  const color = zhRouteData.color || '#247bc1';
  const voyages = zhRouteData.voyages;
  const layers = [];
  const bounds = L.latLngBounds([]);

  // 主干：七次都到的港口直连，画得略粗，让「共同走廊」自己站出来
  const trunkNames = zhTrunkStations(voyages);
  const trunkPts = voyages[0].points.filter((p) => trunkNames.includes(p.name === '锡兰' ? '锡兰山' : p.name));
  if (trunkPts.length >= 2) {
    const trunk = L.polyline(zhSeaPath(trunkPts), {
      color, weight: 3.2, opacity: 0.62, lineJoin: 'round',
    }).addTo(leafletMap);
    trunk.bindTooltip(`七次共同主干：${trunkPts.map((p) => p.name).join(' → ')}（七次都到过的港口之间的直连）`, { sticky: true });
    bounds.extend(trunk.getBounds());
    layers.push(trunk);
  }

  // 西端分岔：古里以西的航段按航次单独加亮（第四次起才越过印度洋），越晚越浓
  const gul = voyages[0].points.find((p) => p.name === '古里') || { lat: 11.25, lng: 75.78 };
  const branches = [];
  voyages.forEach((v) => {
    const k = v.points.findIndex((p) => p.name === '古里');
    if (k < 0) return;
    // 只取古里及其以西（排除「回到锡兰山」这类回程段），少于两个点就不算一条分岔
    const west = v.points.slice(k).filter((p, i) => i === 0 || p.lng < gul.lng - 0.5);
    if (west.length >= 2) branches.push({ v, pts: west });
  });
  branches.forEach((b, k) => {
    const op = Math.round((0.45 + (k / Math.max(1, branches.length - 1)) * 0.45) * 100) / 100;
    const line = L.polyline(zhSeaPath(b.pts), {
      color, weight: 2.6, opacity: op, lineJoin: 'round',
    }).addTo(leafletMap);
    line.bindTooltip(`${b.v.name}（${b.v.years}）· 古里以西：${b.pts.slice(1).map((p) => p.name).join(' → ')}`, { sticky: true });
    bounds.extend(line.getBounds());
    layers.push(line);
  });
  if (!branches.length && trunkPts.length >= 2) bounds.extend(L.latLngBounds(trunkPts.map((p) => [p.lat, p.lng])));
  fitZhengheView(bounds);

  // 停泊港：实心圆点标出船队真正到过的港口（主干六港 + 古里以西各分岔上的港）。
  // via 里的海上转弯点只是整形用，不画点——图上「有圆点」就等于「在这里停过」。
  const portMap = new Map();
  trunkPts.forEach((p) => portMap.set(p.name, p));
  branches.forEach((b) => b.pts.forEach((p) => portMap.set(p.name, p)));
  portMap.forEach((p) => {
    const dot = L.circleMarker([p.lat, p.lng], {
      radius: 5, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1, opacity: 1,
    }).addTo(leafletMap);
    dot.bindTooltip(`${p.name}${p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : ''}`, { direction: 'top' });
    layers.push(dot);
  });

  // 古地名：主干五处（刘家港与南京相邻，省一个）+ 西端三处（波斯湾口、东非、最西）。
  // 标签在取景之后再加——手机上常退到 zoom 2，八个标签会互相压住，此时只留四个锚点。
  const labels = [];
  const zoom = leafletMap.getZoom();
  const want = zoom < 3 ? ['南京', '满剌加', '忽鲁谟斯', '幔八萨'] : ['南京', '占城', '满剌加', '锡兰山', '古里', '忽鲁谟斯', '木骨都束', '幔八萨'];
  want.forEach((name, i) => {
    const hit = trunkPts.find((p) => p.name === name)
      || branches.map((b) => b.pts.find((p) => p.name === name)).find(Boolean);
    if (!hit) return;
    const m = addZhenghePlaceLabel(hit, i % 2 ? 'bottom' : 'top');
    if (m) labels.push(m);
  });
  leafletLayers.zhenghe = layers.concat(labels);
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
        w.textContent = '底图瓦片加载失败（需联网）。疆域/城市/事件等历史图层仍可查看。';
        document.querySelector('#map-leaf').appendChild(w);
      }
    });
    // 修复 Leaflet fadeAnimation 关闭后 opacity 残留 0 的问题：tileload 时强制可见
    tiles.on('tileload', (e) => { if (e.tile) e.tile.style.opacity = 1; });
    tiles.addTo(leafletMap);
    // 缩放决定城市标签密度：低缩放下只留圆点，放大才铺地名（见 syncPlaceLabelDensity）
    leafletMap.on('zoomend', () => { syncPlaceLabelDensity(); syncInnerPlaceVisibility(); });
  }
  clearLeafletLayers();
  const v = MAP_VIEW[currentDynasty] || MAP_VIEW.ming;
  leafletMap.setView(v.center, v.zoom);
  syncPlaceLabelDensity();

  // ---- 疆域 ----
  // 「全部」视图 data.shape 为 null：九朝合并视图不画任何一朝疆域（见 buildMapData）
  if (data.shape && data.shape.type === 'geojson') {
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
    const shortName = { ming:'明', tang:'唐', song:'宋', yuan:'元', qing:'清', sui:'隋', wudai:'五代', sanguo:'三国', jin:'晋' }[currentDynasty] || '';
    if (shortName) addLabel(c.lng, c.lat, shortName);
  } else if (data.shape) {
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
    const shortName = { ming:'明', tang:'唐', song:'宋', yuan:'元', qing:'清', sui:'隋', wudai:'五代', sanguo:'三国', jin:'晋' }[currentDynasty] || '';
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
  // 默认不上图，也不在「该朝事件」/年号胶囊被点击时批量上图：
  // 只有用户点了下方具体的事件胶囊，才把该事件的那一个地标单独加到地图（见 showSingleEvent）
  if (window.__dbg) window.__dbg.beforeEvents = data.events.length;
  leafletLayers.events = buildEventClusters(data.events).map((c) => addEventMarker(c, true));
  if (window.__dbg) window.__dbg.afterEvents = (leafletLayers.events || []).length;

  // ---- 路线（按钮单选，初始全部隐藏）----
  leafletLayers.routes = data.routes.map(addRouteLayer);
  // 路线详情面板 + 图例按钮
  renderMapControls(data);
}

/** 地图下方的路线按钮区 + 郑和航次选择（与图例一起挂在 route-panel） */
// 路线胶囊是否已展开（默认收起，只露前 8 条）。每次重渲染都回到收起态。
let routeShowAll = false;
// 地名点是否展开（默认只留都城；点「地名 N 处」才把城市/战场/名胜一起铺开）
let placesShowAll = false;

/** 默认视图：只把城市/名胜点上图；事件地标一律留白。
 *  事件地标不再「整朝一次铺开」（几十个⚑会压满地图、标签互相叠住），
 *  而是跟着下方「该朝事件」胶囊点哪条上哪一个（见 showSingleEvent）。 */
function showPlacesOnMap() {
  const zoom = leafletMap ? leafletMap.getZoom() : 6;
  (leafletLayers.places || []).forEach((m) => {
    if (!m || !leafletMap) return;
    const p = m._place || {};
    let keep;
    if (placesShowAll) keep = !(p._inner && zoom < 9);   // 城内细点放大到 zoom≥9 才铺
    else keep = p.type === 'capital' || p.type === 'regime'; // 默认只留都城（本朝红 / 诸国褐）
    if (currentDynasty === 'all' && !placesShowAll) keep = false; // 九朝叠加无单一语义，默认不画
    if (keep) m.addTo(leafletMap); else leafletMap.removeLayer(m);
  });
  (leafletLayers.events || []).forEach((m) => { if (m && leafletMap) leafletMap.removeLayer(m); });
}

/** 缩放变化时补画／收回「城内细点」（紫禁城、南宫、豹房这一层），标签密度另见 syncPlaceLabelDensity */
function syncInnerPlaceVisibility() {
  if (!placesShowAll || !leafletMap) return;
  const zoom = leafletMap.getZoom();
  (leafletLayers.places || []).forEach((m) => {
    if (!m || !m._inner) return;
    if (zoom >= 9) m.addTo(leafletMap); else leafletMap.removeLayer(m);
  });
}

function renderMapControls(data) {
  const legend = $('#map-route-btns');
  if (!legend) return;
  legend.innerHTML = '';
  routeShowAll = false;
  const curEmp = currentEraEmperor();
  const inEra = (r) => {
    if (!curEmp || !r.year) return true;
    const s = yearNum(curEmp.reign.start);
    const en = parseInt(curEmp.reign.end, 10);
    return r.year >= s && r.year <= en;
  };
  const visibleDomestic = data.routes.filter(inEra);
  // 地名开关：默认只留都城（整朝视野里地名全铺开只会互相压住、也看不出重点）；
  // 点一下才把城市/战场/名胜一起铺开，再点收起。计数是归一后的地点数（一座城只算一个）。
  const placeBtn = el('button', 'route-btn place-toggle-btn');
  // 计数只算默认能铺开的点：城内的具体地点（紫禁城、南宫…）要 zoom≥9 才展开，不该算进「N 处」
  const placeTotal = (data.places || []).filter((p) => !p._inner).length;
  const placeLabel = () => (placesShowAll ? '收起地名 ▴' : `地名 ${placeTotal} 处 ▾`);
  placeBtn.textContent = placeLabel();
  placeBtn.title = placesShowAll
    ? '收起城市、战场与名胜，只留都城'
    : '铺开该视图全部城市、战场与名胜（放大到 9 级以上还会展开城内的具体地点）';
  placeBtn.addEventListener('click', () => {
    placesShowAll = !placesShowAll;
    placeBtn.textContent = placeLabel();
    placeBtn.classList.toggle('on', placesShowAll);
    placeBtn.title = placesShowAll
      ? '收起城市、战场与名胜，只留都城'
      : '铺开该视图全部城市、战场与名胜（放大到 9 级以上还会展开城内的具体地点）';
    showPlacesOnMap();
  });
  legend.appendChild(placeBtn);
  /** 隐藏除目标路线外的所有动态图层（其他路线/事件点/城市点/郑和航线） */
  const hideOthers = (exceptRi) => {
    (leafletLayers.routes || []).forEach((l, i) => {
      if (i === exceptRi) return; // 目标路线保留，交给 animateRoute 画
      l.line.setStyle({ opacity: 0, fillOpacity: 0 });
      l.wps.forEach((w) => w.setStyle({ opacity: 0, fillOpacity: 0 }));
      hideRouteMarker(l.sMark);
      hideRouteMarker(l.eMark);
    });
    clearZhengheLayers();
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
    // 先清动画定时器：上一条路线的起/终点标记是「延时打开常显 tooltip」的
    // （起 200ms、终动画结束），不清理的话收图后那个「终 · 某地」气泡会在
    // 隐藏之后又冒出来挂在空地图上（实测复现）。
    clearRouteAnimations();
    // 隐藏所有路线与郑和
    (leafletLayers.routes || []).forEach((l) => {
      l.line.setStyle({ opacity: 0, fillOpacity: 0 });
      l.wps.forEach((w) => w.setStyle({ opacity: 0, fillOpacity: 0 }));
      hideRouteMarker(l.sMark);
      hideRouteMarker(l.eMark);
    });
    clearZhengheLayers();
    // 「该朝事件」＝总览：只保留城市/名胜，事件地标一个都不上图。
    // 整朝事件动辄几十条、地名标签互相压住，改成由下方事件胶囊按条点名：
    // 点哪条，地图才飞过去只亮那一个⚑（见 showSingleEvent）。
    showPlacesOnMap();
  };
  // 路线胶囊默认只露出前 8 个，其余折进「展示更多」——「全部」朝代下七朝合计三十余条，
  // 全平铺会把地图挤出视口。郑和航线也算一条，按整体顺序一起折叠。
  const ROUTE_LIMIT = 8;
  const routeBtns = [];
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
      resetMapView();   // 从事件卡的放大视野收回该朝默认视野，再画整条路线
      showRoute(realRi);
      showRouteDetail(r);
      document.querySelector('#route-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    legend.appendChild(btn);
    routeBtns.push(btn);
  });
  // 郑和航线：不再预画任何「合并折线」，主胶囊只负责 选中态 → 画七次叠影 → 展开详情卡；
  // 具体某一次由卡里的航次胶囊决定（见 drawZhengheRoute / drawZhengheShadow）。
  if (data.zhenghe && inEra(data.zhenghe)) {
    const zh = data.zhenghe;
    zhRouteData = zh;
    zhVoyageIndex = -1;   // 重渲染后回到叠影，避免沿用一个已失效的下标
    const btn = el('button', 'route-btn');
    btn.textContent = '郑和航线 ▶（含远洋）';
    btn.dataset.layer = 'zhenghe-west';
    btn.style.borderColor = zh.color;
    btn.addEventListener('click', () => {
      legend.querySelectorAll('.route-btn').forEach((b) => { b.style.background = ''; b.classList.remove('on'); });
      btn.style.background = zh.color;
      btn.classList.add('on');
      zhVoyageIndex = -1;           // 点主胶囊＝回到七次叠影（也是从某次退回整体的入口）
      drawZhengheShadow();
      showRouteDetail(zh);
    });
    legend.appendChild(btn);
    routeBtns.push(btn);
  }
  // 折叠路口：超出 8 个时先藏起来，给一个「展示更多」胶囊（与该朝事件的同款）。
  // 只切 class、不重渲染，避免把已选中的路线和地图图层状态清掉。
  if (routeBtns.length > ROUTE_LIMIT) {
    const applyFold = (expand) => {
      routeBtns.forEach((b, i) => { if (i >= ROUTE_LIMIT) b.classList.toggle('hidden', !expand); });
    };
    applyFold(routeShowAll);
    const more = el('button', 'route-btn route-more-btn');
    more.textContent = routeShowAll
      ? '收起 ▴'
      : `展示更多（还有 ${routeBtns.length - ROUTE_LIMIT} 个）▾`;
    more.addEventListener('click', () => {
      routeShowAll = !routeShowAll;
      applyFold(routeShowAll);
      more.textContent = routeShowAll
        ? '收起 ▴'
        : `展示更多（还有 ${routeBtns.length - ROUTE_LIMIT} 个）▾`;
    });
    legend.appendChild(more);
  }
  // 路线深链：?page=map&dynasty=<朝>&route=<id>（MCP get_route 返回的帝王路线链接）。
  // 直接触发对应胶囊的 click，复用「复位视野 → 画整条路线 → 展开详情面板」这一整套真实路径，
  // 不在这里另写一份绘制/高亮逻辑——两份逻辑一旦分叉，深链与手动点击就会不一致。
  // 只在 location.search 变化时应用一次，避免重渲染时反复复位视野。
  // 必须在末尾 showEvents() 之后调用：默认「该朝事件」视图会清掉郑和图层，
  // 早一步画好的航线会被它抹掉（卡片在、图上空着）。
  const deepRouteId = new URLSearchParams(location.search).get('route');
  const applyDeepRoute = () => {
    if (!deepRouteId || appliedDeepRoute === location.search) return;
    appliedDeepRoute = location.search;
    const targetBtn = routeBtns.find((b) => b.dataset.layer === deepRouteId);
    if (!targetBtn) return;
    // 目标可能被折叠进「展示更多」里（默认只露前 8 条）
    if (targetBtn.classList.contains('hidden')) {
      const moreBtn = legend.querySelector('.route-more-btn');
      if (moreBtn) moreBtn.click();
    }
    targetBtn.click();
    // 郑和航线的航次深链：?route=zhenghe-west&voyage=4 → 直接展开第四次
    const vParam = Number(new URLSearchParams(location.search).get('voyage'));
    if (deepRouteId === 'zhenghe-west' && vParam >= 1) {
      const chip = document.querySelector(`.zh-voyage-chip[data-v="${vParam - 1}"]`);
      if (chip) chip.click();
    }
    // 全站搜索的「地点/热点」深链：?route=…&stop=<站名>。
    // 叠影态刻意不排站序（七次各有各的来回），不先定到某一次就永远找不到那一站；
    // 这里反查该站出现在第几航次，再点对应的航次胶囊——仍走 chip.click()，不另写一份切换逻辑。
    const stopParam = new URLSearchParams(location.search).get('stop');
    if (stopParam && vParam < 1) {
      const r = (DATA.routes || []).find((x) => x.id === deepRouteId);
      const vos = (r && r.voyages) || [];
      for (let i = 0; i < vos.length; i++) {
        const pts = vos[i].points || [];
        if (pts.some((p) => String(p.name) === stopParam || String(p.name).includes(stopParam))) {
          const chip = document.querySelector(`.zh-voyage-chip[data-v="${i}"]`);
          if (chip) chip.click();
          break;
        }
      }
    }
  };
  // 事件按钮（默认激活）：点击后只在地图下方汇总事件胶囊（事件名＋古地名）。
  // 地图保持城市/名胜的干净总览——事件地标不批量上图，点哪条胶囊才亮哪一个⚑。
  // 文案跟随年号切换，与汇总面板标题保持一致（点年号后只汇总该年号的事件）。
  // 外观与路线胶囊刻意区分：矩形 + 列表图标（路线胶囊是圆角胶囊 + ▶）。
  const evtBtn = el('button', 'route-btn evt-toggle-btn');
  evtBtn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">`
    + `<circle cx="3.1" cy="4" r="1.35" fill="currentColor"/>`
    + `<circle cx="3.1" cy="8" r="1.35" fill="currentColor"/>`
    + `<circle cx="3.1" cy="12" r="1.35" fill="currentColor"/>`
    + `<rect x="6.1" y="3.25" width="8.3" height="1.6" rx=".8" fill="currentColor"/>`
    + `<rect x="6.1" y="7.2" width="8.3" height="1.6" rx=".8" fill="currentColor"/>`
    + `<rect x="6.1" y="11.15" width="8.3" height="1.6" rx=".8" fill="currentColor"/>`
    + `</svg><span>${curEmp ? '该年号事件' : '该朝事件'}</span>`;
  evtBtn.dataset.layer = 'events';
  evtBtn.addEventListener('click', () => {
    legend.querySelectorAll('.route-btn').forEach((b) => { b.style.background = ''; b.classList.remove('on'); });
    evtBtn.classList.add('on');
    resetMapView();   // 回到总览：镜头从某个事件的放大视野收回该朝默认视野
    showEvents();
    showEventsSummary();
    // 上一行会把所有 route-btn 的选中态清空，地名开关的状态要补回来（它不是「路线」）
    placeBtn.classList.toggle('on', placesShowAll);
  });
  // 放在最前面：它是「总览」入口，比各条路线更基础
  legend.insertBefore(evtBtn, legend.firstChild);
  // 初始状态：默认视图只给城市/名胜点，事件地名等用户点「该朝事件」或选年号后再上图
  showPlacesOnMap();
  // 深链要在默认视图之后应用，否则航线刚画好就被 showEvents() 清掉
  applyDeepRoute();
}

/** 该朝事件汇总：列出地图事件涉及的古地名（点击跳地图并弹窗说明）。
 *
 *  列表跟随头顶的年号切换：选中某年号时只列该年号在位期间的事件，
 *  否则（「全部」年号）列本朝全部事件——地图上的事件点本来就是这么筛的
 *  （见 buildMapData 的 events: eventsForEra(activeEraId)），此前汇总面板漏了这一步，
 *  于是点了年号地图只剩几条、下面却仍平铺整朝事件，两边对不上。
 *
 *  事件多时默认只展示前若干条，其余折在「展示更多」后面：
 *  「全部」视图下七朝合计 141 条（单朝最多明 43 条），全部平铺会把地图挤到屏幕外。
 *  单个年号最多 12 条，因此年号视图下不会触发折叠。
 *  阈值 12 约合两行胶囊，切朝代/切年号时都回到折叠态。 */
const EVT_SUMMARY_LIMIT = 12;
let evtSummaryShowAll = false;

function showEventsSummary(opts) {
  const box = $('#route-detail');
  if (!box) return;
  const curEmp = currentEraEmperor();
  // 跟随年号筛选：有选中皇帝时只取其在位期间的事件
  const list = (curEmp ? eventsForEra(curEmp.id) : (DATA.mapEvents || []))
    .slice().sort((a, b) => parseInt(a.date, 10) - parseInt(b.date, 10));
  if (!list.length) {
    box.classList.remove('hidden');
    box.innerHTML = curEmp
      ? `<div class="route-detail-desc">「${curEmp.eraName[0]}」年间没有标记在地图上的事件。</div>`
      : `<div class="route-detail-desc">这个朝代还没有标记在地图上的事件。</div>`;
    if (!opts || !opts.noScroll) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  const noteLine = curEmp
    ? `<div class="route-detail-desc">${curEmp.name}（${curEmp.templeName}）在位 ${fmtYear(curEmp.reign.start)}-${fmtYear(curEmp.reign.end)} · 点击查看事件详情</div>`
    : `<div class="route-detail-desc">全朝事件汇总 · 点击查看事件详情</div>`;
  // 折叠：默认只渲染前 EVT_SUMMARY_LIMIT 条
  const overflow = list.length > EVT_SUMMARY_LIMIT;
  const shown = (overflow && !evtSummaryShowAll) ? list.slice(0, EVT_SUMMARY_LIMIT) : list;
  const items = shown.map((ev) => {
    const place = ev.place || {};
    const pn = place.name || ev.name;
    const modern = place.modern ? `（今${place.modern}）` : '';
    // 事件名为主，地名（今名）跟在后面；若事件名本身就含地名则不重复显示地名
    const placePart = (ev.name && ev.name !== pn) ? `<span class="evt-summary-name">${pn}${modern}</span>` : '';
    return `<button class="evt-summary-chip" data-evt-id="${ev.eventId}">
      <b>${fmtYear(ev.date)}</b> ${ev.name}
      ${placePart}
    </button>`;
  }).join('');
  // 超出时给「展示更多 / 收起」，按钮上写明还剩多少条，避免用户不知道被折起了
  const moreRow = overflow ? `
    <div class="evt-summary-more">
      <button class="evt-more-btn" id="evt-more-btn">${evtSummaryShowAll
        ? '收起 ▴'
        : `展示更多（还有 ${list.length - EVT_SUMMARY_LIMIT} 个）▾`}</button>
    </div>` : '';
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="route-detail-head" style="border-color:#c0392b">
      <span class="route-detail-name">${curEmp ? `该年号事件 · ${curEmp.eraName[0]}年间` : '该朝事件 · 事件名（古地名）'}</span>
      <span class="route-detail-year">共 ${list.length} 个${overflow && !evtSummaryShowAll ? ` · 显示前 ${EVT_SUMMARY_LIMIT}` : ''}</span>
    </div>
    ${noteLine}
    <div class="evt-summary-grid">${items}</div>
    ${moreRow}`;
  // 展开/收起只重绘本面板，且不触发滚动（否则点一下页面就跳走）
  const moreBtn = $('#evt-more-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      evtSummaryShowAll = !evtSummaryShowAll;
      showEventsSummary({ noScroll: true });
    });
  }
  // 点击某地名：只保留该事件的地点标记，其余事件点/城市点/路线全部隐藏
  box.querySelectorAll('.evt-summary-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const ev = (DATA.mapEvents || []).find((e) => e.eventId === chip.dataset.evtId);
      if (!ev) return;
      box.querySelectorAll('.evt-summary-chip').forEach((c) => c.classList.remove('on'));
      chip.classList.add('on');
      // 事件胶囊统一弹该事件的卡片正文，不弹地点聚合列表（聚合归地图地点标记）。
      showSingleEvent(ev);
      document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  if (!opts || !opts.noScroll) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  'tang-event-huangchao': 'tang-huangchao',
  // 元朝
  'yuan-event-miejin': 'yuan-miejin',
  'yuan-ev-1279': 'yuan-miesong',
  'yuan-ev-1351': 'yuan-hongjin',
  'yuan-ev-1368': 'yuan-beiyuan',
  'yuan-event-zhenghe': 'yuan-makeluo',
  // 清朝
  'qing-ev-1644': 'qing-ruguan-beijing',
  'qing-event-sanshun': 'qing-pingding-sanfan',
  'qing-ev-1683': 'qing-taiwan',
  'qing-event-gaerdan': 'qing-san-zheng-gaerdan',
  'qing-ev-1851': 'qing-taiping',
  'qing-ev-1900': 'qing-baguo',
  // 隋朝
  'sui-ev-589': 'sui-pingchen',
  'sui-ev-goguryeo': 'sui-zheng-gaogouli',
  'sui-ev-jiangdu': 'sui-jiangdu',
  'sui-ev-canal': 'sui-yunhe',
  // 五代
  'wudai-event-houtang': 'wudai-houtang-mie-liang',
  'wudai-event-chairong': 'wudai-chairong-beifa',
  // 三国
  'sanguo-event-chushibiao': 'sanguo-zhuge-beifa',
  'sanguo-event-wuzhangyuan': 'sanguo-zhuge-beifa',
  'sanguo-ev-228': 'sanguo-zhuge-beifa',
  'sanguo-event-mieshu': 'sanguo-dengai-mieshu',
  'sanguo-event-pingwu': 'sanguo-jin-miewu',
  // 两晋
  'jin-event-bashang': 'jin-huanwen-beifa',
  'jin-ev-369': 'jin-huanwen-fangtou',
  'jin-event-feishui': 'jin-feishui',
  'jin-event-liuyu': 'jin-liuyu-beifa',
};

/** 显示与事件关联的路线（动态绘制，起终点按图例颜色：起点绿/终点深红）
 *  只画线、不展开 #route-detail —— 路线详情面板只由「路线胶囊」驱动。 */
function showEventRoute(ev) {
  const routeId = EVENT_ROUTE_MAP[ev.eventId];
  if (!routeId) return;
  // 郑和航线是特殊层（按当前航次单独重画）：选了某次就画该次，没选就画七次叠影
  if (routeId === 'zhenghe-west') {
    if (!zhRouteData) zhRouteData = (DATA.routes || []).find((r) => r.id === 'zhenghe-west') || null;
    const pts = currentZhenghePoints();
    if (pts) drawZhengheRoute(pts); else drawZhengheShadow();
    return;
  }
  // 普通路线：找 data.routes 里的索引
  const domesticRoutes = (DATA.routes || []).filter((r) => r.id !== 'zhenghe-west');
  const idx = domesticRoutes.findIndex((r) => r.id === routeId);
  const layer = (leafletLayers.routes || [])[idx];
  if (layer) animateRoute(layer, 1500);
}

function showSingleEvent(ev, opts = {}) {
  if (!leafletMap) return;
  // 年号联动：仅在讲解员模式（深链带 guide=1）下自动切换年号，保证事件点落在年号过滤集里
  // （如靖难之役 1402 年 → 建文）。普通浏览不联动——否则点「全部」里的胶囊会因重渲染
  // 而把列表换成另一年号的子集，用户点的胶囊当场消失（发布前审查发现的回归）。
  if (new URLSearchParams(location.search).get('guide') === '1') {
    const eraId = eraForYear(ev.date);
    if (eraId && eraId !== activeEraId) {
      activeEraId = eraId;
      evtSummaryShowAll = false;
      renderEraStrip(); renderMap(); renderEraInfo();
      showEventsSummary({ noScroll: true });
    }
  }
  // 清理旧的路线动画定时器，防止残留动画覆盖新状态（两条路线问题）
  clearRouteAnimations();
  // 默认 zoom=8 放大定位；胶囊点击传 {zoom:false} 只定位不放大（保持当前缩放）
  const targetZoom = opts.zoom === false ? Math.max(leafletMap.getZoom(), 4) : 8;
  (leafletLayers.routes || []).forEach((l) => {
    l.line.setStyle({ opacity: 0, fillOpacity: 0 });
    l.wps.forEach((w) => w.setStyle({ opacity: 0, fillOpacity: 0 }));
    hideRouteMarker(l.sMark);
    hideRouteMarker(l.eMark);
  });
  clearZhengheLayers();
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
    // 事件胶囊 / 事件深链 → 弹【单事件卡片】（含该事件正文介绍）。
    // 多地事件的聚合列表只属于「地图上的地点标记」（见 addEventMarker）。
    showEventPopup(ev);
    // 关联路线只画线，不展开路线详情面板——路线详情属于「路线胶囊」的职责。
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

/** 路线详情：点击路线按钮后，在地图下方展示背景说明与途经点。
 *  郑和航线只给七枚航次胶囊（不再有「总览」）：未选航次时是「七次叠影」，
 *  只讲范围与规模、不排先后；点某一次才给该次的路线与逐站说明。 */
function showRouteDetail(r) {
  const box = $('#route-detail');
  if (!box) return;
  const voyages = r.voyages || null;
  const pickIdx = (voyages && zhVoyageIndex >= 0 && zhVoyageIndex < voyages.length) ? zhVoyageIndex : -1;
  const v = pickIdx >= 0 ? voyages[pickIdx] : null;
  // 普通路线（三国北伐、唐灭突厥这类）用的是自己的 points；只有郑和叠影态没有单次站点
  const pts = (v ? v.points : (voyages ? [] : (r.points || []))) || [];
  const headName = v ? `郑和${v.name}` : (voyages ? '郑和七次航线 · 叠影' : r.name);
  const headYear = v ? v.years : (voyages
    ? `${voyages[0].years.split('—')[0]}—${voyages[voyages.length - 1].years.split('—')[1] || ''}`
    : (r.year || ''));
  const stops = pts.map((p) =>
    `${p.name}${p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : ''}`).join(' → ');
  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const chips = voyages ? `
    <div class="zh-voyage-bar" role="tablist" aria-label="郑和下西洋七次航次">
      ${voyages.map((x, i) => `<button class="zh-voyage-chip${pickIdx === i ? ' on' : ''}" data-v="${i}" role="tab" aria-selected="${pickIdx === i}"
        title="${x.name}（${x.years}）· ${x.points.length} 站">第${CN[x.no - 1] || (i + 1)}次</button>`).join('')}
    </div>` : '';
  // 叠影态只讲「读法」与规模：主干是七次共同走的那段，西端分岔才是个体差异，
  // 七次从不是一条连续航线，所以这里刻意不排站序，顺序交给各航次。
  const totalStops = voyages ? voyages.reduce((s, x) => s + x.points.length, 0) : 0;
  const portCount = voyages ? new Set(voyages.flatMap((x) => x.points.map((p) => p.name))).size : 0;
  const trunkNames = zhTrunkStations(voyages).filter((n) => n !== '刘家港');
  // 郑和叠影态（有 voyages 但没选某一次）才讲「读法与规模」；
  // 普通路线（三国北伐、唐灭突厥…）直接排自己的站点，不能套用郑和那段话。
  const body = (voyages && !v) ? `
    <div class="route-detail-path"><b>读法：</b>图上那条略粗的主干是七次都到的港口直连（${trunkNames.join('—')}）；古里以西按航次分岔，越晚越浓——第四次起才越过印度洋抵波斯湾与东非。线按海路绕行（只补海上转弯点，不算停泊港）。<b>规模：</b>七次共 ${totalStops} 站、${portCount} 个港口。<b>顺序：</b>七次各有各的来回，并不存在一条连续航线，请点上方的「第X次」看该次的路线与地点顺序。<b>考订：</b>忽鲁谟斯自第四次起通使（永乐十年敕书已列其名，十三年其使臣随船来朝）；麻林于永乐十三年献麒麟，可证第四次确曾到访；回程多循季风原路（北风去、南风回），图上只画去程港序。</div>` : `
    <div class="route-detail-path"><b>路线：</b>${stops}</div>
    <ol class="route-detail-stops">${pts.map((p, i) => `
      <li data-station="${i}"${(p.lat && p.lng) ? ` data-lat="${p.lat}" data-lng="${p.lng}"` : ''}><b>${p.name}${p.modern && p.modern !== p.name ? '（今' + p.modern + '）' : ''}</b><span class="rs-dash"> —— </span><span class="rs-note">${p.note || ''}</span></li>`).join('')}
    </ol>`;
  box.classList.remove('hidden');
  box.innerHTML = `
    ${chips}
    <div class="route-detail-head" style="border-color:${r.color || '#c0392b'}">
      <span class="route-detail-name">${headName}</span>
      <span class="route-detail-year">${headYear}</span>
    </div>
    <div class="route-detail-desc">${(v ? v.desc : r.desc) || ''}</div>
    ${body}`;
  // 航次胶囊：切到某一次 → 地图重画该次航线 → 详情卡按该次重绘
  box.querySelectorAll('.zh-voyage-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      zhVoyageIndex = Number(chip.dataset.v);
      if (leafletMap) drawZhengheRoute(currentZhenghePoints());
      showRouteDetail(r);
      // 手机端上下堆叠（地图在上、详情卡在下），点了胶囊要能立刻看到航线重画，
      // 所以把地图滚回视野；桌面端图卡同屏，只要保住详情卡的最近位置即可。
      if (window.matchMedia('(max-width: 760px)').matches) {
        const mapEl = $('#map-leaf');
        if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideRouteDetail() {
  const box = $('#route-detail');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

// 讲解员模式：高亮走到某一路线站点时，地图平滑平移到该站（不缩放，避免频繁跳动）
window.__guideFlyTo = function (lat, lng) {
  if (!leafletMap) return;
  if (new URLSearchParams(location.search).get('guide') !== '1') return;
  if (typeof lat !== 'number' || typeof lng !== 'number') return;
  leafletMap.panTo([lat, lng], { animate: true, duration: 1.0 });
};

const DYN_SHORT = { xia: '夏', shang: '商', zhou: '周', qin: '秦', han: '汉', xihan: '西汉', xin: '新莽', donghan: '东汉', sanguo: '三国', jin: '晋', sui: '隋', tang: '唐', wudai: '五代', song: '宋', yuan: '元', ming: '明', qing: '清' };
const PLACE_KIND = { capital: '都城', regime: '诸国都城', city: '重镇', site: '战场·名胜', overseas: '海外' };

/** 地名弹窗：一城一卡。
 *  同一座城在史料里有多个名字（长安／大兴城／西安），旧版会各弹一张、看起来像「重复地点」；
 *  归一后主条给当朝称谓，其余称谓并列一行说明「这是同一座城」。 */
function showPlacePopup(p) {
  const pop = $('#map-popup');
  if (!pop) return;
  pop.classList.remove('hidden');
  const modern = p.modernName && p.modernName !== p.name ? ` <small style="color:#8a7a5c">（今${p.modernName}）</small>` : '';
  const seen = new Set([p.name]);
  const others = (p.variants || []).filter((v) => {
    if (seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });
  const aliasLine = others.length
    ? `<p class="popup-place-alias">同一座城的其他称谓：${others.map((v) => `${v.name}${v.dynasty && DYN_SHORT[v.dynasty] ? `（${DYN_SHORT[v.dynasty]}）` : ''}`).join('、')}</p>`
    : '';
  // 「全部」视图里这个点通常代表好几朝共用的同一座城：说清它在各朝扮演的角色，
  // 否则用户只会看到一个色点和一堆地名，不知道为什么要合在一起。
  const roles = [...new Set((p.variants || []).filter((v) => v.dynasty).map((v) => `${DYN_SHORT[v.dynasty] || ''}·${PLACE_KIND[v.type] || ''}`))];
  const roleLine = (p._multiDynasty && roles.length > 1)
    ? `<p class="popup-place-alias">此地在各朝的角色：${roles.join('、')}</p>`
    : '';
  const noteLine = p.note ? `<p class="popup-place-note">${p.note}</p>` : '';
  pop.innerHTML = `<button class="close" aria-label="关闭">✕</button>
    <h4>${p.name}${modern}</h4>
    ${aliasLine}${roleLine}${noteLine}
    <p>${p.story || '（暂无故事）'}</p>`;
  pop.querySelector('.close').addEventListener('click', () => pop.classList.add('hidden'));
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
        <b>${fmtYear(ev.date)}年 · ${ev.name}</b>
        <span class="popup-event-summ">${summary.slice(0, 40)}${summary.length > 40 ? '…' : ''}</span>
      </button>`;
    }).join('');
    pop.innerHTML = `<button class="close" aria-label="关闭">✕</button>
      <h4>${placeName}${modern}</h4>
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
  const eid = ev.eventId || ev.id;
  // 事件工笔彩绘图：约定 data/portraits/event-gongbi-thumb/<事件id>.jpg。
  // 弹窗宽上限 380px、扣内边距后图最大约 342px，2x 屏需 684px；缩略图为 680×510（覆盖 99.4%，
  // 最坏 0.6% 上采样，肉眼不可见），故只保留缩略图、不做点击放大。
  // 无图时 img onerror 直接移除整块，绝不破图。
  const thumbImg = `../data/portraits/event-gongbi-thumb/${eid}.jpg`;
  const fig = `<figure class="event-fig">
      <img src="${thumbImg}" alt="${ev.name}"
        onload="this.closest('.event-fig').classList.add('loaded')"
        onerror="this.closest('.event-fig').remove()"/>
    </figure>`;
  pop.innerHTML = `<button class="close" aria-label="关闭">✕</button>
    <h4>${ev.name} <small style="color:#8a7a5c">· ${fmtYear(ev.date)}年</small></h4>
    ${fig}
    ${placeTxt ? `<p style="font-size:13px;color:#247bc1;font-weight:600;margin:0 0 4px">${placeTxt}</p>` : ''}
    <p style="font-size:13px;color:#c0392b;font-weight:600;margin:0 0 6px">${place.note || ev.note || ''}</p>
    ${people ? `<p style="font-size:13px;color:#247bc1;margin:0 0 6px"><b>核心人物：</b>${people}</p>` : ''}
    <p>${story}</p>`;
  pop.querySelector('.close').addEventListener('click', () => pop.classList.add('hidden'));
}

// 点事件卡以外的任意位置即关闭（与侧栏卡片同一套交互习惯）。
// 守卫 mock-DOM 环境：冒烟测试的 document 没有 addEventListener。
// 放行三类会「自己开卡/换卡」的元素，否则会出现刚点开就被这条监听关掉的闪烁：
//   .map-event        地图上的事件标记（点它由 addEventMarker 弹卡）
//   .evt-summary-chip 该朝事件的胶囊
//   .popup-event-row  地点聚合列表里的条目
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', (e) => {
    const pop = document.getElementById('map-popup');
    if (!pop || pop.classList.contains('hidden')) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (pop.contains(t)) return;
    if (t.closest('.map-event, .evt-summary-chip, .popup-event-row, .map-place, .map-place-inner')) return;
    pop.classList.add('hidden');
  });
}

// ---------- 界面四：历史侦探 ----------
// 线索不再硬编码：每个任务给出检索词（queries）与一个开放问题（open），
// 线索由 search-core.js 在知识库里实时检索生成，每条带出处。
// 侦探谜案库按朝代组织：每朝 3 个「历史悬案」，全年龄向（儿童与成人都适用）。
// queries 用该朝 events.json 的确切事件名 / 皇帝名，保证 search-core 一定命中；
// open 为没有标准答案的思辨题（附双视角），create 为动手创作。
const DETECTIVE_TASKS_BY_DYNASTY = {
  zhou: [
    {
      title: '侦探档案 · 周 1', quest: '一个人替七岁的孩子管了七年国，然后交还了钥匙——他是忠臣，还是差一步的篡位者？',
      queries: ['周公摄政', '三监之乱·周公东征', '周公旦'],
      open: {
        question: '周公究竟是「摄政称王」，还是只是「代行王权」？',
        context: '《尚书·康诰》等篇里，周公以「王若曰」的口吻发号施令；《史记》却说他是「摄行政当国」，最后「北面就臣位」。同一批材料，能读出两种人。',
        viewpoints: ['有人说是称王：诰命中的「王」若指成王，语气不合；「践阼」二字，本义就是登位。', '有人说是代行：先秦「摄」就是代理，他以王号发令、七年而还政，恰恰证明他没有王心。'],
      },
      create: '把《大诰》《康诰》里周公自称的三种说法各抄一句，再判断：要推翻「称王说」，哪一条证据最关键？',
    },
    {
      title: '侦探档案 · 周 2', quest: '一个「点烽火骗诸侯」的故事，为什么在先秦的文献里一句都找不到？',
      queries: ['犬戎破镐', '申侯', '褒姒'],
      open: {
        question: '「烽火戏诸侯」是被后世加上去的，还是真有其事而先秦文献失载？',
        context: '《诗经》《国语》《竹书纪年》记幽王废申后、立褒姒、申侯引戎，都不及烽火；而「桀宠妹喜」「纣宠妲己」的故事结构，和它几乎一模一样。',
        viewpoints: ['有人说是层累：同一个「美女亡国」模板的第三次复用，汉代史家采摭传说写入正文。', '有人说有实据：西周或已有烽燧传警之法，「诸侯悉至」被夸大了，但传警本身未必虚构。'],
      },
      create: '列出「幽王亡国」的四个已知事实（废后、立庶、申侯、犬戎），再指出：哪一步才是真正不可逆的？',
    },
    {
      title: '侦探档案 · 周 3', quest: '天子亲自带兵去打一个诸侯，结果被对方一箭射中肩膀——礼是从这一箭开始崩的吗？',
      queries: ['繻葛之战', '郑庄公', '周桓王'],
      open: {
        question: '繻葛之败，是桓王指挥失误，还是封建秩序的必然结果？',
        context: '王师并不弱，败因是陈师先溃、侧翼动摇。但更该问的是：为什么天子的军队，已经打不过诸侯的军队？',
        viewpoints: ['有人说是战术：把内乱之国编进侧翼，一触即溃，责任在桓王。', '有人说是制度：西六师早已衰败，天子要靠诸侯从征，诸侯不肯死战，王师必败。'],
      },
      create: '按「战前—战场—战后」三段各写一条线索，再回答：郑庄公为什么不追、还要派人去「劳王」？',
    },
  ],
  shang: [
    {
      title: '侦探档案 · 商 1', quest: '一个王朝搬了五次家，最后一次才不再搬——它在躲什么？',
      queries: ['盘庚迁殷', '九世之乱', '殷'],
      open: {
        question: '迁都是为了避水患、抑制贵族，还是战略重心的转移？',
        context: '《尚书·盘庚》给的理由是「视民利用迁」，但三篇诰命大量训诫的却是抵制的贵族。',
        viewpoints: ['有人说是避患：旧都近水，地势低，殷地高而资源稳。', '有人说是抑贵族：每迁一次都，旧贵族的田产与人脉就被切断一次。'],
      },
      create: '把「嚣—相—邢—奄—殷」五座都城按时间排好，各写一句「这次搬家最可能的原因」，再指出哪一次是关键转折。',
    },
    {
      title: '侦探档案 · 商 2', quest: '一片甲骨上写着「登妇好三千，登旅万」——她是谁？',
      queries: ['妇好征鬼方', '武丁中兴', '妇好'],
      open: {
        question: '妇好是「王后」还是「统帅」？',
        viewpoints: ['有人说两者兼有：卜辞记她率军、主祭、受封邑，墓中随葬青铜钺，军权与祭权都在她手里。', '有人说别过度现代化：她的权力来自王的授权，本质仍是王室成员代王行事。'],
      },
      create: '根据卜辞的三条线索，判断「妇好出征」是常态还是非常态，并说明你的依据。',
    },
    {
      title: '侦探档案 · 商 3', quest: '纣的罪状，为什么越到后世越多？',
      queries: ['牧野之战', '帝辛', '比干'],
      open: {
        question: '亡国之君的罪状会随时间生长，这是宣传，还是史实累积？',
        context: '《牧誓》只列四条，战国增「酒池肉林」「炮烙」，汉代再增「剖心」「醢九侯」。',
        viewpoints: ['有人说是层累：罪名与夏桀高度雷同，是「亡国模板」在起作用。', '有人说有实据：东夷战争与鹿台工程确实透支民力，倒戈就是证据。'],
      },
      create: '把罪状按「最早出处」列成一张表，标出哪几条可能是后世加的，并说明判断标准。',
    },
  ],
  xia: [
    {
      title: '侦探档案 · 夏 1', quest: '一个没有当时文字的王朝，凭什么说自己存在过？',
      queries: ['大禹治水', '二里头', '斟鄩'],
      open: {
        question: '夏是「信史」，还是后人按需要拼出来的上古？',
        context: '夏代没有发现当时的成篇文字，二里头遗址的规模与年代都与文献中的夏大致相当，但「是不是夏都」仍是推论。',
        viewpoints: ['有人说是信史：二里头宫城、铸铜作坊与礼器体系，加上《史记》世系，链条已经够长。', '有人说要留余地：遗址不等于王朝，「夏」这个名字最早见于周人文献，命名本身可能带有后人的政治需要。'],
      },
      create: '结合线索，把「考古证据」与「文献证据」各列两条，再说说：你更看重哪一边，为什么。',
    },
    {
      title: '侦探档案 · 夏 2', quest: '一个君主出去打猎一百天，回来时国家已经不是他的了——这中间发生了什么？',
      queries: ['太康失国', '后羿', '寒浞代羿·夏统中绝'],
      open: {
        question: '太康失国，是君主失德，还是东夷崛起下的必然？',
        viewpoints: ['有人说失德：他离都百日，后羿只是顺手关了门。', '有人说结构：夏的共主本来靠联盟，中央一离开核心区，联盟立刻换盟主。'],
      },
      create: '结合线索，按时间顺序排出「太康—后羿—仲康—相—寒浞」五步，再指出哪一步是真正不可逆的。',
    },
    {
      title: '侦探档案 · 夏 3', quest: '夏的衰败，究竟记在孔甲账上，还是记在桀账上？',
      queries: ['孔甲乱政', '鸣条之战·夏亡', '桀'],
      open: {
        question: '一个王朝的灭亡，应该归因于最后一个坏皇帝，还是归因于长期的结构性衰败？',
        viewpoints: ['有人说记在桀：筑倾宫、杀谏臣、囚汤又放汤，最后一代把账一次结清。', '有人说记在孔甲：「夏后氏德衰，诸侯畔之」——离心从两百年前就开始了。'],
      },
      create: '结合线索，把夏亡的原因分成「长期」「短期」两栏各写三条，再判断哪一栏更致命。',
    },
  ],
  sanguo: [
    {
      title: '侦探档案 · 三国 1', quest: '曹操打赢了官渡、统一了北方，为什么到死都没能过长江？',
      queries: ['赤壁之战', '吕蒙袭荆州·关羽败亡', '曹操'],
      open: {
        question: '赤壁这一场败仗，是曹操轻敌，还是南北条件根本不允许他南下？',
        viewpoints: ['有人说轻敌：刚取荆州就顺江而下，水军未练、疫病流行。', '有人说条件不许：北人不习水战，长江天险与补给线才是真正的对手。'],
      },
      create: '结合线索，说出曹军在赤壁输在哪几件事上，再想想：如果换你指挥，会先做什么准备。',
    },
    {
      title: '侦探档案 · 三国 2', quest: '高平陵那一天，曹爽手里还有皇帝，为什么一夜之间就把权交了出去？',
      queries: ['高平陵之变', '曹芳', '司马懿'],
      open: {
        question: '曹爽不战而降，是怯懦，还是他算错了一件事？',
        viewpoints: ['有人说怯懦：桓范劝他奉少帝去许昌发兵，他舍不得家产。', '有人说被诓了：司马懿指洛水为誓只免官，他信了政治承诺。'],
      },
      create: '结合线索，梳理高平陵之变里司马懿做了哪几步，再说说曹爽错在哪一步。',
    },
    {
      title: '侦探档案 · 三国 3', quest: '蜀汉有剑阁天险、姜维主力还在，成都为什么先降了？',
      queries: ['魏灭蜀·三国格局折半', '刘禅', '邓艾'],
      open: {
        question: '刘禅开城出降，是明智止损还是弃国求安？',
        viewpoints: ['有人说明智：成都无兵，再战只会让百姓遭兵火。', '有人说弃国：主力尚存就投降，前线的抵抗全成了空。'],
      },
      create: '结合线索，说说邓艾是怎么绕过剑阁的，再判断：如果你是刘禅，会守还是降。',
    },
    {
      title: '侦探档案 · 三国 4', quest: '吴国有长江、有楼船，为什么最后还是被顺江而下打穿了？',
      queries: ['晋灭吴·三国归晋', '孙皓', '陆抗'],
      open: {
        question: '吴亡该记在孙皓的暴政上，还是记在江东士族的离心上？',
        viewpoints: ['有人说记在孙皓：杀能臣、拒直谏，陆抗一死无人守江。', '有人说记在结构：世族与皇权长期拉锯，换谁都难挡统一大势。'],
      },
      create: '结合线索，说出晋军破江防的两个关键手段，再评一评孙皓这个人。',
    },
  ],
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
  jin: [
    {
      title: '侦探档案 · 晋 1', quest: '八王之乱打了十六年，最后赢的司马越，为什么反而看着西晋亡了？',
      queries: ['贾后诛杨骏·八王乱起', '永嘉之乱·洛阳陷落', '司马越'],
      open: {
        question: '西晋是亡于内乱，还是亡于外患？',
        viewpoints: ['有人说内乱是因：诸王把中央军和财政打空，外族只是收尾。', '有人说外患是主：刘渊起兵时晋尚有天下，部署得当未必守不住洛阳。'],
      },
      create: '结合线索，把八王之乱到永嘉之乱的关键几步排成一条链，说说哪一步最不该发生。',
    },
    {
      title: '侦探档案 · 晋 2', quest: '司马睿在江东登基时，为什么必须先让王导安排一场「出行仪式」？',
      queries: ['司马睿称晋王·立国江左', '王敦之乱', '王导'],
      open: {
        question: '「王与马，共天下」是合作，还是皇权寄生？',
        viewpoints: ['有人说是合作：皇室有名分、世族有根基，各取所需才站住脚。', '有人说是寄生：皇权从一开始就没有自己的兵与财。'],
      },
      create: '结合线索，说说东晋立国靠了哪几家人，再判断：这样的朝廷能北伐成功吗？',
    },
    {
      title: '侦探档案 · 晋 3', quest: '八万北府兵打崩前秦号称百万的大军，秦军到底为什么退？',
      queries: ['淝水之战', '谢玄', '苻坚'],
      open: {
        question: '淝水之胜，是东晋的实力，还是前秦自己的崩塌？',
        viewpoints: ['有人说是实力：北府兵训练有素，洛涧一战已见差距。', '有人说是内崩：各族拼凑的大军，退阵一动就散了。'],
      },
      create: '结合线索，说出秦军退阵后发生了什么，再想想：如果你是苻坚，会怎么打这一仗。',
    },
  ],
};

const DYNASTY_LABEL = { xia: '夏朝', shang: '商朝', zhou: '周朝', qin: '秦朝', han: '汉朝', xihan: '西汉', xin: '新莽', donghan: '东汉', sanguo: '三国', jin: '晋朝', sui: '隋朝', tang: '唐朝', wudai: '五代十国', song: '宋朝', yuan: '元朝', ming: '明朝', qing: '清朝' };
// 时间线朝代立牌用两字内简称（竖排书脊签高度固定 64px，四字会撑破）
const DYNASTY_SHORT = { xia: '夏', shang: '商', zhou: '周', qin: '秦', han: '汉', xihan: '西汉', xin: '新莽', donghan: '东汉', sanguo: '三国', jin: '晋', sui: '隋', tang: '唐', wudai: '五代', song: '宋', yuan: '元', ming: '明', qing: '清' };

// 切朝代令牌：并发切换时只渲染最后一次
let _dynastyToken = 0;

let detectiveIndex = 0;
function detectiveTasks() {
  // 「全部」视图把七朝的题目合并展示；具体朝代则只看本朝。
  // 此前 all 落到 ming 的回退分支，首屏（默认就是全部）只能看到明代 3 题。
  if (currentDynasty === 'all') {
    const all = [];
    for (const key of ['sanguo', 'jin', 'sui', 'tang', 'wudai', 'song', 'yuan', 'ming', 'qing']) {
      const list = DETECTIVE_TASKS_BY_DYNASTY[key];
      if (list) list.forEach((t) => all.push(t));
    }
    return all.length ? all : DETECTIVE_TASKS_BY_DYNASTY.ming;
  }
  return DETECTIVE_TASKS_BY_DYNASTY[currentDynasty] || DETECTIVE_TASKS_BY_DYNASTY.ming;
}
function renderDetective() {
  const tasks = detectiveTasks();
  detectiveIndex = detectiveIndex % tasks.length;
  const t = tasks[detectiveIndex];
  const openHtml = t.open ? `<div class="open-question">
      <span class="open-tag">思辨一下（没有标准答案）</span>
      <span class="open-q">${t.open.question}${t.open.context ? '　' + t.open.context : ''}</span>
      ${t.open.viewpoints && t.open.viewpoints.length ? `<span class="open-views">${t.open.viewpoints.join('　｜　')}</span>` : ''}
    </div>` : '';
  const weekEl = $('#detective-week');
  weekEl.innerHTML = `<h3>${t.title}</h3><div class="quest">${t.quest}</div>${openHtml}
    <div class="detective-nav">
      <button id="detective-prev" class="route-btn">◀ 上一案</button>
      <span class="detective-count">第 ${detectiveIndex + 1} / ${tasks.length} 案</span>
      <button id="detective-next" class="route-btn">下一案 ▶</button>
    </div>`;
  // 用容器上的事件委托，而不是 innerHTML 赋值后立刻 $('#detective-prev') 查询：
  // 后者依赖「字符串赋值即时生成 DOM 节点」这一时序，真实浏览器成立，
  // 但 mock-DOM 测试环境（innerHTML 只是字符串）查不到，会抛
  // Cannot read properties of null (reading 'addEventListener') 并中断渲染。
  // 委托只绑定一次，切换朝代重建按钮后依然有效。
  if (!weekEl._navBound) {
    weekEl._navBound = true;
    weekEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('#detective-prev, #detective-next') : null;
      if (!btn) return;
      const list = detectiveTasks();
      const step = btn.id === 'detective-prev' ? -1 : 1;
      detectiveIndex = (detectiveIndex + step + list.length) % list.length;
      renderDetective();
    });
  }

  const cluesWrap = $('#detective-clues');
  cluesWrap.innerHTML = '<h4>收集到的线索 <small style="color:#8a7a5c;font-weight:400">（来自本项目已核对史料，每条附出处）</small></h4>';
  // 动态检索生成线索
  const clues = SEARCH.cluesFor(t);
  clues.forEach((c) => {
    const card = el('div', 'clue-card');
    card.innerHTML = `<div class="clue-title">${c.title}</div><div>${c.text}</div><div class="clue-src">${c.src}</div>`;
    cluesWrap.appendChild(card);
  });

  // AI 史老师追问：让 AI 基于史实回答（替代旧的知识库关键词检索）
  renderDetectiveAsk();

  // 你的回答（放在线索下方，作为档案作答区；输入静默保存不丢稿）
  const storeKey = `${currentDynasty}-create-${detectiveIndex}`;
  $('#detective-create').innerHTML = `<h4>你的回答</h4>
    <div class="create-box">
      <div class="create-prompt"><b>围绕本案作答：</b>${t.quest}<br><small style="color:#8a7a5c">${t.create}</small></div>
      <textarea id="create-input" placeholder="结合上面的线索，写下你的判断或答案…"></textarea>
      <div class="create-actions">
        <button id="create-ai" class="create-save llm-btn" title="让 AI 老师结合线索与史实点评">请 AI 老师点评</button>
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
    out.innerHTML = '<div class="ask-hint">AI 老师正在结合线索点评…</div>';
    const clueDigest = clues.map((c) => `${c.title}：${c.text}`).join('\n');
    const d = await askHistoryTeacher(
`【本案要回答】${t.quest}
【可参考的已核对史料线索】
${clueDigest}

【我的回答】${v}

请结合上面的线索与史实点评我的回答：先用一句话肯定我抓对的地方；再指出与线索/史实不符、或遗漏的关键点；最后提一个能引我深入思考的问题。语气通俗、对学生友好。`);
    out.innerHTML = d.ok
      ? `<div class="ask-hit llm-answer"><b>AI 老师点评</b>：${formatReply(d.reply)}</div>`
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
      <span class="ask-head-title">还有疑问？问问 AI 史老师</span>
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
    res.innerHTML = '<div class="ask-hint">AI 史老师正在翻史料…</div>';
    const d = await askHistoryTeacher(question);
    if (d.ok) {
      res.innerHTML = `<div class="ask-hit llm-answer"><b>问：</b>${escapeHtml(question)}<br><b>AI 史老师：</b>${formatReply(d.reply)}</div>`;
    } else {
      const needConfig = /配置|接口|模型|connect|fetch|Failed/i.test(d.error || '');
      res.innerHTML = needConfig
        ? `<div class="ask-hint">还没连上 AI 史老师。点下方【AI老师配置】，填入接口地址、API Key 和模型即可。<br><button type="button" class="create-save llm-btn" id="ask-go-config" style="margin-top:8px">去配置 AI 老师</button></div>`
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

/** AI 老师配置：挂在左侧模块栏「支持」上方的胶囊里（内容由 renderDetectiveAI 注入），
 *  展开/收起由侧栏按钮控制，故此处不再自带折叠标题。
 *  配置只存在本机。问答统一走上方「AI 史老师」面板，故此处不再放聊天框。 */
let fetchedModels = [];
function renderDetectiveAI() {
  const box = $('#detective-ai');
  if (!box) return;
  box.innerHTML = `
    <div class="detective-ai-card ai-config-card">
      <div class="ai-config-row">
        <label class="ai-field">接口地址（OpenAI 兼容）
          <input id="ai-base-url" type="text" placeholder="如：https://api.deepseek.com/v1/chat/completions" />
        </label>
        <label class="ai-field">API Key
          <input id="ai-api-key" type="password" placeholder="如：sk-..." />
        </label>
      </div>
      <div class="ai-config-row">
        <label class="ai-field ai-field-model">默认模型
          <div class="model-combo">
            <input id="ai-model-input" type="text" placeholder="如：点右侧 自动拉取模型，再点下拉选择" autocomplete="off" />
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
    </div>`;

  // 回填已保存配置
  const c = llmConfig;
  if (c.baseUrl) $('#ai-base-url').value = c.baseUrl;
  if (c.apiKey) $('#ai-api-key').value = c.apiKey;
  if (c.model) $('#ai-model-input').value = c.model;
  if (c.temperature != null) $('#ai-temperature').value = c.temperature;

  // 折叠/展开由侧栏胶囊按钮控制（见 initSidebarSupport），此处不再自带折叠标题

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
        msg.textContent = `已拉取 ${d.models.length} 个模型，点 ▾ 选择`;
        msg.style.color = '#2e7d32';
        openMenu(true);
        return true;
      }
      msg.textContent = '没拉到模型，请确认接口地址和密钥';
      msg.style.color = '#c0392b';
    } catch (e) {
      msg.textContent = '拉取失败：' + (e && e.message ? e.message : e);
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

  // 点菜单外部关闭：document 级监听只绑一次（renderDetectiveAI 会被切朝代重复调用）
  if (!document._modelMenuOutsideWired) {
    document._modelMenuOutsideWired = true;
    document.addEventListener('click', (e) => {
      const combo = e.target.closest && e.target.closest('.model-combo');
      if (!combo) openMenu(false);
    });
  }

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
      msg.textContent = '已保存，可以去问 AI 史老师了';
      msg.style.color = '#2e7d32';
    } else {
      msg.textContent = '' + (d.error || '保存失败');
      msg.style.color = '#c0392b';
    }
  });
}

/** 展开（true）或收起（false）侧栏里的「AI 配置」卡片，供「去配置 AI 老师」按钮调用。
 *  配置表单已挂到侧栏，不再有独立的折叠标题，故这里直接开关卡片本身。 */
function expandAIConfig(open) {
  const pop = $('#ai-sidebar-pop');
  const btn = $('#ai-sidebar-btn');
  if (!pop || !btn) return;
  pop.classList.toggle('hidden', !open);
  btn.setAttribute('aria-expanded', String(!!open));
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
  // 朝代胶囊副标题：每个按钮显示本朝帝数（「全部」按钮的帝数由 loadAll 聚合后设置）
  document.querySelectorAll('.dynasty-btn').forEach((b) => {
    if (b.dataset.d === 'all') return;
    const sub = b.querySelector('.dyn-sub');
    if (!sub) return;
    const own = DYNASTY_TEXT[b.dataset.d];
    sub.textContent = own ? (own.dynSub || '') : '';
  });
  const mapLeaf = $('#map-leaf');
  if (mapLeaf) mapLeaf.setAttribute('aria-label', txt.mapAria);
  const legendNote = $('#legend-note');
  if (legendNote) legendNote.textContent = txt.legendNote;
  const footer = $('#footer');
  if (footer) footer.textContent = txt.footer;
}

/** 安全设置 body 上的 data-* 背板纹样标记。
 *  mock-DOM 测试环境（smoke*.mjs）不提供 document.body，直接写 dataset 会抛
 *  「Cannot set properties of undefined」并中断整条渲染链。产品页里 body 一定存在，
 *  这里的守卫只影响测试环境，不改变任何产品行为。 */
function setBodyData(key, value) {
  const b = document.body;
  if (!b || !b.dataset) return;
  if (value == null) delete b.dataset[key];
  else b.dataset[key] = value;
}

/* 顶部朝代条：带框的横滑条吃满正文列（.module-inner）的宽度，两端箭头贴边拼在外面。
   12 个朝代一行装不下，所以条子里是一条不折行的横滑轨道，两端各给一个箭头提示还能往哪边滑。
   外扩量 --dyn-out 默认取箭头宽度（28px），实测左右留白不够时在这里按「谁先碰到邻居」收紧：
   左邻居是左侧栏右缘，右邻居是右上导航胶囊（窄屏它变成顶部横条，此时右邻居换成视口右缘）。
   两侧永远取同一个值，条子因此保持左右对称；旧实现的 --dyn-cols 折行出血在这里一并清掉。 */
function fitTopbar() {
  const bar = document.querySelector('.topbar');
  if (bar) {
    bar.style.marginLeft = '';
    bar.style.marginRight = '';
  }
  const sw = document.querySelector('#dynasty-switch');
  if (sw) {
    if (sw.style.getPropertyValue('--dyn-cols')) sw.style.removeProperty('--dyn-cols');
    sw.style.removeProperty('--dyn-out');
    if (window.innerWidth >= 700) {
      const OUT_MAX = 28;   // ＝ .dyn-arrow 宽度：默认把箭头整个推到正文列之外
      const GAP = 8;        // 与左右邻居至少留 8px，不贴脸
      // .dynasty-switch 自身始终等于正文列宽（外扩靠箭头的负外边距），左右缘直接取它的框
      const box = sw.getBoundingClientRect();
      const colL = box.left;
      const colR = box.right;
      const side = document.querySelector('.mega-sidebar');
      const leftLimit = side ? side.getBoundingClientRect().right : 0;
      const rail = document.querySelector('.tabs');
      const railBox = rail ? rail.getBoundingClientRect() : null;
      const railOnRight = !!railBox && railBox.top > box.bottom;   // 竖排时才是右侧邻居
      const spareL = colL - leftLimit - GAP;
      const spareR = (railOnRight ? railBox.left : window.innerWidth) - colR - GAP;
      const fit = Math.max(0, Math.min(OUT_MAX, Math.floor(spareL), Math.floor(spareR)));
      sw.style.setProperty('--dyn-out', fit + 'px');
    }
  }
  updateDynArrows();
}

/* 朝代条横滑：箭头可用态、按屏宽步进、滚轮也能横滚 */
function updateDynArrows() {
  const track = document.getElementById('dyn-track');
  const prev = document.getElementById('dyn-arrow-l');
  const next = document.getElementById('dyn-arrow-r');
  if (!track || !prev || !next) return;
  const max = track.scrollWidth - track.clientWidth;
  const eps = 2;
  prev.disabled = track.scrollLeft <= eps;
  next.disabled = max <= eps || track.scrollLeft >= max - eps;
}
function dynScrollBy(dir) {
  const track = document.getElementById('dyn-track');
  if (!track) return;
  const step = Math.max(180, Math.round(track.clientWidth * 0.62));
  track.scrollBy({ left: dir * step, behavior: 'smooth' });
}
/* 选中的朝代若被滑到看不见的地方，横向把它带回来（不惊动页面纵向滚动） */
function revealDynBtn(btn) {
  const track = document.getElementById('dyn-track');
  if (!track || !btn) return;
  const tr = track.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  const pad = 6;
  if (br.left < tr.left + pad) track.scrollLeft -= (tr.left + pad - br.left);
  else if (br.right > tr.right - pad) track.scrollLeft += (br.right - (tr.right - pad));
  updateDynArrows();
}
function initDynScroll() {
  const track = document.getElementById('dyn-track');
  const prev = document.getElementById('dyn-arrow-l');
  const next = document.getElementById('dyn-arrow-r');
  if (!track || !prev || !next) return;
  if (!track._dynScrollBound) {
    track._dynScrollBound = true;
    prev.addEventListener('click', () => dynScrollBy(-1));
    next.addEventListener('click', () => dynScrollBy(1));
    track.addEventListener('scroll', () => updateDynArrows(), { passive: true });
    // 鼠标纵向滚轮也能横滚（触控板横滑本身走原生滚动）
    bindWheelToHorizontal(track);
    if (window.ResizeObserver) new ResizeObserver(() => updateDynArrows()).observe(track);
  }
  updateDynArrows();
}

async function switchDynasty(d) {
  if (d === currentDynasty) return;
  stopGuideIfAny();                 // 换朝即停：朗读/推进不得跨内容继续
  currentDynasty = d;
  setBodyData('era', d === 'all' ? null : d); // 全部视图用默认背板纹样
  // 令牌：快速连点朝代时，只有最后一次切换的结果允许落地渲染（旧版会被先返回的旧朝数据覆盖）
  const token = ++_dynastyToken;
  activeEraId = null;
  detectiveIndex = 0;
  // 事件汇总回到折叠态：否则在明朝点开「展示更多」后切到清朝，会保持全展开
  evtSummaryShowAll = false;
  document.querySelectorAll('.dynasty-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.d === d);
  });
  revealDynBtn(document.querySelector('.dynasty-btn.active'));
  // 更新页头/标题/图例/页脚文案（按配置表）
  applyDynastyText(d);
  // 重新加载数据并渲染
  try {
    await Promise.all([loadAll(), loadBoundaries()]);
    if (token !== _dynastyToken) return;   // 期间又切了朝代，丢弃这次结果
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
      renderEraStrip(); renderEraInfo();
      ensureLeaflet().then(() => {
        renderMap();
        // 切换朝代后同样默认展开「该朝事件」汇总
        showEventsSummary();
        if (leafletMap) setTimeout(() => leafletMap.invalidateSize(), 60);
      }).catch((e) => console.error(e));
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
window.__mingTest = { renderMap, showEmperor, renderTimeline, renderCases, showRouteDetail, hideRouteDetail, buildMapData, switchDynasty, showEventsSummary, buildEventClusters, showSingleEvent, setEvtSummaryShowAll: (v) => { evtSummaryShowAll = !!v; }, get evtSummaryShowAll() { return evtSummaryShowAll; }, get DATA() { return DATA; }, get SEARCH() { return typeof SEARCH !== 'undefined' ? SEARCH : null; }, get leafletMap() { return leafletMap; } };

// 各朝真实边界 GeoJSON（loadBoundaries 填充；文件不存在则该朝为 null，地图回退示意色块）
let MAP_GEO = {};

// 加载当前朝代的边界 GeoJSON（手绘简化或 CHGIS）；文件不存在则回退硬编码示意色块
async function loadBoundaries() {
  const key = currentDynasty;
  // 已取过就直接复用：切回某朝不再重发（旧版每次切朝代都重拉一遍 GeoJSON）
  if (Object.prototype.hasOwnProperty.call(MAP_GEO, key)) return MAP_GEO[key];
  // 没有疆域数据的朝代（如三国三方并立、或「全部」合并视图）不去请求不存在的文件，直接回退示意色块
  if (!DYNASTY_HAS_GEO[key]) { MAP_GEO[key] = null; return null; }
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
  sanguo: { fill: '#e6cfa8', stroke: '#7a5a30', title: '三 国 疆 域（魏·蜀·吴三方合计范围，据《中国历史地图集·三国时期》示意）' },
  jin: { fill: '#cfc6e0', stroke: '#57457f', title: '两 晋 疆 域（西晋太康年间极盛范围，据《中国历史地图集》示意）' },
  // 夏商周为示意轮廓：夏尚黑、商尚白、周尚赤（《礼记·檀弓》），尚色只作点缀，可读性优先。
  xia: { fill: '#a9b4bf', stroke: '#43515e', title: '夏 朝 疆 域（豫西·晋南为核，据《中国历史地图集》与二里头遗址分布示意）' },
  shang: { fill: '#ddd6c6', stroke: '#8a7a5c', title: '商 朝 疆 域（内服王畿·外服方国，据《中国历史地图集》与郑州商城、殷墟示意）' },
  zhou: { fill: '#e6bcab', stroke: '#8a3f28', title: '周 朝 疆 域（西周王畿丰镐·东周王畿洛邑，诸侯屏周，据《中国历史地图集》示意）' },
  // 秦汉四朝没有手绘边界 geojson，这里用简化外轮廓示意；秦尚黑、汉尚赤，配色按五德终始取色。
  qin: { fill: '#bcb0a4', stroke: '#3f382f', title: '秦 朝 疆 域（前 221 年并六国，北以长城为界，据《中国历史地图集·秦时期》示意）' },
  han: { fill: '#e2a08a', stroke: '#8a3a28', title: '汉 朝 疆 域（西京·新莽·东京三段，取武帝极盛范围，据《中国历史地图集》示意）' },
  xihan: { fill: '#e2a08a', stroke: '#8a3a28', title: '西 汉 疆 域（武帝极盛，西领西域、东置乐浪，据《中国历史地图集·西汉时期》示意）' },
  xin: { fill: '#e6cf8a', stroke: '#7a6320', title: '新 莽 疆 域（承西汉旧疆而改郡县名，据《中国历史地图集》示意）' },
  donghan: { fill: '#e0a898', stroke: '#8a3a28', title: '东 汉 疆 域（西域三通三绝，据《中国历史地图集·东汉时期》示意）' },
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

// 侧栏「支持」弹出卡片：hover 展开
(function setupSupportPop() {
  const btn = document.getElementById('support-btn');
  const pop = document.getElementById('support-pop');
  const close = document.getElementById('support-close');
  if (!btn || !pop) return;
  let timer = null;
  const show = () => { clearTimeout(timer); pop.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); };
  const hide = () => { pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  // 悬停与点击必须分流，不能同时绑：真机 tap 的事件序列是 mouseenter → click，
  // 两者共用一个开合状态会让弹层「刚打开又被 click 关掉」（DOM 序列实测：
  // afterEnter=true → afterClick=false）。按输入能力二选一：
  //   · 能 hover（鼠标/触控板）→ 沿用原悬停逻辑，桌面行为与改动前完全一致；
  //   · 不能 hover（手机/平板）→ 只绑 click，并允许点弹层外关闭。
  const hoverMQ = (typeof window.matchMedia === 'function') ? window.matchMedia('(hover: hover)') : null;
  const hoverMode = hoverMQ ? hoverMQ.matches : true;
  if (hoverMode) {
    btn.addEventListener('mouseenter', show);
    pop.addEventListener('mouseenter', show);
    btn.addEventListener('mouseleave', () => { timer = setTimeout(hide, 600); });
    pop.addEventListener('mouseleave', () => { timer = setTimeout(hide, 600); });
  } else {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pop.classList.contains('hidden')) show(); else hide();
    });
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('click', (e) => {
        if (btn.contains(e.target) || pop.contains(e.target)) return;
        hide();
      });
    }
  }
  close.addEventListener('click', hide);
})();

/* 侧栏弹出卡片统一管理：「AI 配置」「模块管理」共用一套开合逻辑。
   - 点击按钮切换；点卡片外、Esc、✕ 均关闭。
   - 同时只开一个：打开一个会关掉另一个，避免卡片互相遮挡、也遮住对方按钮。
   - 「支持」卡片内容短且无输入框，仍沿用 hover 展开（见 setupSupportPop）。
   注意：不用 hover 展开前两者——卡片里有输入框和下拉菜单，鼠标移出会把正在填的表单收起。 */
(function setupSidebarPops() {
  const PAIRS = [
    { btn: 'ai-sidebar-btn', pop: 'ai-sidebar-pop', close: 'ai-sidebar-close' },
    { btn: 'modules-btn', pop: 'modules-pop', close: 'modules-close' },
    { btn: 'guide-btn', pop: 'guide-pop', close: 'guide-close' },
  ].map((p) => ({
    ...p,
    btnEl: document.getElementById(p.btn),
    popEl: document.getElementById(p.pop),
    closeEl: document.getElementById(p.close),
  })).filter((p) => p.btnEl && p.popEl);

  const show = (p) => {
    // 注意：必须显式传参（hide(o)），写成 o.hide() 会把 this 当 p、实参为 undefined
    PAIRS.forEach((o) => { if (o !== p) hide(o); });
    p.popEl.classList.remove('hidden');
    p.btnEl.setAttribute('aria-expanded', 'true');
    if (p.btn === 'modules-btn' && typeof renderModuleManager === 'function') renderModuleManager();
  };
  const hide = (p) => {
    p.popEl.classList.add('hidden');
    p.btnEl.setAttribute('aria-expanded', 'false');
  };
  // 先把 show/hide 挂到每一项，再绑事件——否则 show 内部回调 hide 时会取到 undefined
  PAIRS.forEach((p) => { p.show = show; p.hide = hide; });
  PAIRS.forEach((p) => {
    p.btnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (p.popEl.classList.contains('hidden')) show(p); else hide(p);
    });
    if (p.closeEl) p.closeEl.addEventListener('click', () => hide(p));
  });

  // 点卡片外关闭所有卡片（mock DOM 可能没有 document.addEventListener，做能力检测）
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', (e) => {
      PAIRS.forEach((p) => {
        if (p.popEl.contains(e.target) || p.btnEl.contains(e.target)) return;
        hide(p);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') PAIRS.forEach((p) => hide(p));
    });
  }
})();

// ---------- URL query 深链路由（供 MCP / 外部 AI 直接定位到皇帝、悬案、地图） ----------
// 支持：?page=timeline|cases|map|detective&dynasty=ming&emperor=<id>&case=<id>&event=<id>
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForEmp(fn, tries = 40, gap = 80) {
  for (let i = 0; i < tries; i++) {
    try { if (fn()) return true; } catch (e) { /* continue */ }
    await sleepMs(gap);
  }
  try { return !!fn(); } catch (e) { return false; }
}
async function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  const page = params.get('page');
  // 汉已合成一个节点：旧链接 dynasty=xihan/xin/donghan 一律转到 han，
  // emperor 参数不动（帝 id 没变），落地后照样展开到那位皇帝。
  const DYN_ALIAS = { xihan: 'han', xin: 'han', donghan: 'han' };
  const dynastyRaw = params.get('dynasty');
  const dynasty = (dynastyRaw && DYN_ALIAS[dynastyRaw]) || dynastyRaw;
  // 国学子站深链：?module=myth&tab=books&book=shanhaijing
  // 走主壳是为了保留左侧栏（用户可自行切换板块），而不是直接打开裸 iframe 页面。
  const moduleId = params.get('module');
  if (moduleId && moduleId !== 'history' && typeof activateModule === 'function') {
    await waitForEmp(() => document.querySelector('.mega-btn[data-mega="' + moduleId + '"]'));
    activateModule(moduleId);
    // 把子站自己的参数原样转发给 iframe（tab/book/case/sect/route/hotspot 等）
    const forward = new URLSearchParams();
    for (const [k, v] of params.entries()) {
      if (k === 'module') continue;
      forward.set(k, v);
    }
    const frame = document.getElementById(moduleId + '-frame');
    if (frame) {
      const entry = (frame.getAttribute('src') || '').split('?')[0];
      // hash 也要带给 iframe：逐句导读的锚点是 #s=N，而 hash 不属于 searchParams，
      // 只转发查询串会让 MCP 给的「第 8 句」「第 20 句」这类链接全部落到同一页的第 0 句。
      const hash = /^#s=\d+$/.test(location.hash) ? location.hash : '';
      if (entry) frame.src = entry + (forward.toString() ? '?' + forward.toString() : '') + hash;
    }
    return;   // 子站自己处理后续定位；主站不再走 page/emperor 分支
  }
  if (dynasty && dynasty !== currentDynasty) {
    await switchDynasty(dynasty);
  }
  if (page && ['timeline', 'cases', 'map', 'detective'].includes(page)) {
    // 首页默认恢复的是上次停留的 iframe 模块，深链进帝王页必须先切回 history 内联面板
    try { sessionStorage.setItem('dsh-active-module', 'history'); } catch { /* 忽略 */ }
    if (typeof activateModule === 'function') {
      // 等模块清单渲染完（侧栏按钮可能尚未就绪）
      await waitForEmp(() => document.querySelector('.mega-btn[data-mega="history"]'));
      activateModule('history');
    }
    switchPage(page);
    // 兜底：模块切换可能在朝代切换之后异步完成，确保胶囊高亮与朝代一致
    if (dynasty) {
      document.querySelectorAll('.dynasty-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.d === dynasty);
      });
      setBodyData('era', dynasty !== 'all' ? dynasty : null);
    }
  }
  // 皇帝：展开指定皇帝
  const emperorId = params.get('emperor');
  if (emperorId && (!page || page === 'timeline')) {
    const idx = (DATA.emperors || []).findIndex((e) => e.id === emperorId);
    if (idx >= 0) {
      const ok = await waitForEmp(() => document.querySelectorAll('#timeline-scroll .emp-card')[idx]);
      if (ok) document.querySelectorAll('#timeline-scroll .emp-card')[idx].click();
    }
  }
  // 悬案：切到对应分类并高亮
  const caseId = params.get('case');
  if (page === 'cases' && caseId) {
    const c = (DATA.cases || []).find((x) => x.id === caseId);
    if (c) { activeCaseCat = c.category; renderCases(); }
    const ok = await waitForEmp(() => document.querySelector(`#cases-list .case-card[data-id="${caseId}"]`));
    if (ok) {
      const el = document.querySelector(`#cases-list .case-card[data-id="${caseId}"]`);
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
      el.style.outline = '2px solid #b03a2e';
      setTimeout(() => { el.style.outline = ''; }, 3000);
    }
  }
  // 地图事件：定位并弹出单个事件
  const eventId = params.get('event');
  if (page === 'map' && eventId) {
    const findEv = () =>
      (DATA.mapEvents || []).find((e) => e.id === eventId || e.eventId === eventId) ||
      (DATA.events || []).find((e) => e.id === eventId || e.eventId === eventId);
    // 地图初始化要等 Leaflet + 边界 GeoJSON，冷启动 3 秒不够（实测深链会静默失败），给到 10 秒
    const ok = await waitForEmp(() => leafletMap && findEv(), 100, 100);
    if (ok) {
      showSingleEvent(findEv());
      // 等弹窗真的挂出来，否则后面的落行定位会拿不到正文（搜索跳转会「什么都没发生」）
      await waitForEmp(() => {
        const p = document.querySelector('#map-popup');
        return p && !p.classList.contains('hidden');
      }, 30, 120);
    }
  }
  // 全站搜索跳转：q=用户输入的查询串，ak=落点类型（emperor/case/popup/route/stop/chapter…）。
  // 只带 query 不带句号——data-s 每次渲染重排，索引里存句号必然错位（见 web/atlas-jump.js 文件头）。
  const jumpQ = params.get('q');
  if (jumpQ && window.__atlasJump) {
    window.__atlasJump.locate(jumpQ, params.get('ak') || '');
  }
}

(async function init() {
  try {
    // 只拉时间线必需的帝纪数据；边界 GeoJSON 是地图专用，延迟到首次开地图再取，
    // 避免首屏多等一个 JSON 往返，让帝纪文字先渲染出来。
    await loadAll();
    // LLM 配置（侦探页卡片内加载）
    loadLLMConfig();
    // 初始默认朝代的页头/图例/页脚文案
    applyDynastyText(currentDynasty);
    setBodyData('era', currentDynasty !== 'all' ? currentDynasty : null);
    renderTimeline();
    renderDetective();
    initDynScroll();
    fitTopbar();
    // 深链指定了靠后的朝代（?dynasty=ming 等），首屏就把它滑进可视区
    revealDynBtn(document.querySelector('.dynasty-btn.active'));
    if (!window._fitTopbarBound) {
      window._fitTopbarBound = true;
      let raf = 0;
      const relay = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitTopbar); };
      window.addEventListener('resize', relay);
      const side = document.querySelector('.mega-sidebar');
      if (side && window.ResizeObserver) new ResizeObserver(relay).observe(side);
      if (window.ResizeObserver) new ResizeObserver(relay).observe(document.querySelector('.module-inner'));
    }
    // 鼠标滚轮横向滚动帝王卡片
    bindWheelToHorizontal($('#timeline-scroll'));
    // 地图年号条也支持滚轮横滚
    bindWheelToHorizontal($('#era-strip'));
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
    // URL query 深链：定位到具体皇帝/悬案/地图事件
    await applyDeepLink();
    // 首屏氛围动画：只有「刚打开、停在全部」才启动；之后任何操作都会永久停掉（刷新才重置）
    startTimelineAutoDrift();
  } catch (e) {
    document.body.innerHTML = `<div style="max-width:600px;margin:80px auto;text-align:center;font-size:18px">
      <h2>数据加载失败</h2>
      <p>${e.message}</p>
      <p style="color:#8a7a5c">请确认用本地服务器打开（node web/serve.mjs），而不是直接双击 HTML。</p>
    </div>`;
  }
})();
// 左侧模块栏收缩/展开：只留图标 ↔ 完整显示（状态存 localStorage，刷新保持）
(function initSidebarToggle() {
  const btn = document.getElementById('sidebar-toggle');
  if (!btn) return;
  const KEY = 'dsh-sidebar-collapsed';
  const apply = (collapsed) => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? '展开侧栏' : '卷收侧栏');
    btn.title = collapsed ? '展开侧栏' : '卷收侧栏';
    const label = btn.querySelector('.label');
    if (label) label.textContent = collapsed ? '展开' : '卷收';
    const caret = btn.querySelector('.caret');
    if (caret) caret.style.transform = collapsed ? 'scaleX(-1)' : '';
    // 收起后 iframe 若已加载，通知子页重排（子页按窗口宽度算正文位置）
    const frame = document.getElementById('guoxue-frame');
    if (frame && frame.contentWindow) {
      try { frame.contentWindow.dispatchEvent(new Event('resize')); } catch { /* 忽略跨域 */ }
    }
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(KEY) === '1'; } catch { /* 隐私模式 */ }
  apply(collapsed);
  btn.addEventListener('click', () => {
    collapsed = !collapsed;
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* 忽略 */ }
    apply(collapsed);
  });
})();

/* ============================================================
 * 移动端顶部提示条：小屏竖屏时显示「建议用电脑打开…」，可关闭并记住选择。
 * 媒体查询与 style.css 里 .tip-bar 的显示条件逐字一致（≤760px 且竖屏）；
 * 桌面端这里直接 return，不碰 body 类名，桌面布局零影响。
 * ============================================================ */
(function initTipBar() {
  const bar = document.getElementById('tip-bar');
  if (!bar) return;
  const MQ = '(max-width: 760px) and (orientation: portrait)';
  const mql = (typeof window.matchMedia === 'function') ? window.matchMedia(MQ) : null;
  if (!mql || !mql.matches) return;      // 桌面 / 手机横屏：不显示，也不加 body 状态
  const KEY = 'dsh.tip.desktopDismissed';
  let dismissed = false;
  try { dismissed = localStorage.getItem(KEY) === '1'; } catch (e) { dismissed = false; }
  if (dismissed) return;
  const close = document.getElementById('tip-close');
  bar.hidden = false;
  document.body.classList.add('tip-open');
  if (close) {
    close.addEventListener('click', () => {
      bar.hidden = true;
      document.body.classList.remove('tip-open');
      try { localStorage.setItem(KEY, '1'); } catch (e) { /* 隐私模式下忽略 */ }
    });
  }
})();

/* ============================================================
 * 移动端导航：≤760px 视口把侧栏改成抽屉。
 * 桌面端（≥1024）永不触发——isMobile() 是纯宽度判断，与 UA 无关。
 * 做四件事：
 *   1) body.is-mobile 时在顶部插入汉堡按钮 .mobile-menu-btn；
 *   2) 点按钮 → body.sidebar-open，CSS 把侧栏滑入并显示遮罩；
 *   3) 选模块（activateModule）自动关闭抽屉；
 *   4) 跨越断点（旋转/缩放窗口）时清理 mobile-only 状态。
 * ============================================================ */
(function initMobileNav() {
  // 必须与 web/style.css 末尾移动端块的媒体查询逐字一致（窄视口 或 手机横屏）。
  // 不一致的后果是死锁：CSS 已把侧栏推出视口，但这里判定不是移动端 → 不装汉堡按钮
  // → 手机上再也打不开导航。
  const MQ = '(max-width: 760px), (max-height: 500px) and (pointer: coarse) and (orientation: landscape)';
  const mql = (typeof window.matchMedia === 'function') ? window.matchMedia(MQ) : null;
  // matchMedia 不可用的极端环境（冒烟测试的 mock DOM）：跳过移动端逻辑
  if (!mql) return;

  const isMobile = () => !!mql.matches;
  const sidebar = document.querySelector('.mega-sidebar');
  const btn = document.createElement('button');
  btn.className = 'mobile-menu-btn';
  btn.id = 'mobile-menu-btn';
  btn.setAttribute('aria-label', '打开导航');
  btn.setAttribute('aria-expanded', 'false');
  // 汉堡图标：与站点暖色系一致
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';

  // 抽屉的可见关闭入口：只有遮罩可点等于"没有可见的关闭方式"，触屏用户不知道能退出去。
  const closeBtn = document.createElement('button');
  closeBtn.className = 'drawer-close';
  closeBtn.id = 'drawer-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '关闭导航');
  closeBtn.textContent = '✕';

  let backdrop = null;
  function ensureBackdrop() {
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.addEventListener('click', closeSidebar);
    return backdrop;
  }
  /* 抽屉关闭时把侧栏设为 inert：否则键盘 Tab 会跳进一个屏幕外的容器，
     焦点看不见也带不回来（读屏同样会读到隐藏内容）。 */
  function setSidebarInert(on) {
    if (!sidebar) return;
    if (on) {
      sidebar.setAttribute('inert', '');
      sidebar.setAttribute('aria-hidden', 'true');
    } else {
      sidebar.removeAttribute('inert');
      sidebar.removeAttribute('aria-hidden');
    }
  }
  /* 取容器里「真的可见」的控件：`.mega-collapse-btn` 在移动端是 display:none，
     直接 focus() 会静默失败（焦点仍留在 body）。 */
  function visibleFocusables(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const out = [];
    for (const el of root.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(el);
    }
    return out;
  }
  function focusFirst(el) {
    if (!el || typeof el.focus !== 'function') return;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  }
  function openSidebar() {
    document.body.classList.add('sidebar-open');
    // 锁背景滚动：锁在 html 上，body 的 overflow 已被 overflow-x:hidden 打断传播
    document.documentElement.classList.add('drawer-lock');
    document.body.appendChild(ensureBackdrop());
    if (!closeBtn.parentNode) document.body.appendChild(closeBtn);
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', '关闭导航');
    setSidebarInert(false);
    // 焦点进抽屉：汉堡按钮在打开态被 display:none 隐藏，不主动转移焦点会直接掉到
    // body，键盘用户就再也找不到可关闭的控件（只能靠点遮罩）。
    // 延后一拍落焦，避开「tap 结束时浏览器把焦点还给被点按钮」的默认行为；
    // 若这一拍之内抽屉已被关掉，就不再落焦（否则焦点会掉进隐藏的抽屉里）。
    setTimeout(() => {
      if (!document.body.classList.contains('sidebar-open')) return;
      const first = closeBtn.parentNode ? closeBtn : (visibleFocusables(sidebar)[0] || null);
      focusFirst(first);
    }, 0);
  }
  function closeSidebar(restoreFocus) {
    const wasOpen = document.body.classList.contains('sidebar-open');
    document.body.classList.remove('sidebar-open');
    document.documentElement.classList.remove('drawer-lock');
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    if (closeBtn.parentNode) closeBtn.parentNode.removeChild(closeBtn);
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', '打开导航');
    setSidebarInert(isMobile());
    if (wasOpen && isMobile() && restoreFocus !== false && btn.parentNode) focusFirst(btn);
  }
  function toggleSidebar() {
    if (document.body.classList.contains('sidebar-open')) closeSidebar();
    else openSidebar();
  }

  btn.addEventListener('click', toggleSidebar);
  closeBtn.addEventListener('click', () => closeSidebar());
  // Esc 关闭抽屉 + Tab 不逃出抽屉：抽屉打开时背景已锁滚且被遮罩盖住，
  // 允许 Tab 跑到遮罩后面的正文只会让焦点落到看不见的地方。
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('sidebar-open')) return;
      if (e.key === 'Escape') { closeSidebar(); return; }
      if (e.key !== 'Tab') return;
      const list = [closeBtn].concat(visibleFocusables(sidebar));
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      const active = document.activeElement;
      const inside = list.indexOf(active) >= 0;
      if (!inside) { e.preventDefault(); focusFirst(e.shiftKey ? last : first); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); focusFirst(last); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); focusFirst(first); }
    });
  }

  /** 进入移动端：装按钮；离开：清 mobile-only 状态 */
  function applyMode() {
    const mobile = isMobile();
    document.body.classList.toggle('is-mobile', mobile);
    if (mobile) {
      // 桌面「卷收」态在移动端无意义且有害：抽屉会只剩 64px（--sidebar-w-collapsed），
      // 连「AI 配置」弹层都被压成 45px。移动端一律按展开态呈现；
      // localStorage 值原样保留，回到桌面时 initSidebarToggle 会重新应用它。
      document.body.classList.remove('sidebar-collapsed');
      if (!btn.parentNode) document.body.appendChild(btn);
      // 抽屉默认是关的：关着就让侧栏 inert，Tab 不会跳进屏幕外
      if (!document.body.classList.contains('sidebar-open')) setSidebarInert(true);
    } else {
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      if (closeBtn.parentNode) closeBtn.parentNode.removeChild(closeBtn);
      closeSidebar();
      // 回到桌面：侧栏是主入口，必须可聚焦、可被读屏读到
      setSidebarInert(false);
      // 回到桌面：恢复用户此前保存的「卷收」偏好（移动端期间被临时清掉了）
      let collapsed = false;
      try { collapsed = localStorage.getItem('dsh-sidebar-collapsed') === '1'; } catch { /* 隐私模式 */ }
      document.body.classList.toggle('sidebar-collapsed', collapsed);
    }
  }

  // 初次进入即生效
  applyMode();
  // 监听断点跨越（旋转/分屏/窗口拖拽）
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', applyMode);
  else if (typeof mql.addListener === 'function') mql.addListener(applyMode);  // 老 Safari
  // resize 兜底（极少数环境 matchMedia.change 不触发）
  window.addEventListener('resize', applyMode);

  // 暴露给 activateModule：选中模块后自动关闭抽屉
  window.__atlasCloseMobileSidebar = closeSidebar;
})();

/* ============================================================
 * 模块运行时：从 web/modules.json 读取有哪些板块，生成侧栏按钮与面板。
 * 新增板块 = 加一条清单 + 放一份资源；停用 = enabled:false（或在界面里关掉）。
 *   - kind=inline：面板已写在 index.html 里（#mega-<id>），只负责显隐。
 *   - kind=iframe：独立页面，懒加载——首次进入才设 src，之后复用同一实例。
 * 停用的模块既不显示也不加载资源（未启用的 iframe 面板会被移除）。
 * ============================================================ */

/** 读取用户停用的模块（localStorage 优先于 modules.json 的 enabled） */
function loadDisabledModules() {
  try {
    const raw = localStorage.getItem('dsh-disabled-modules');
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function saveDisabledModules(set) {
  try { localStorage.setItem('dsh-disabled-modules', JSON.stringify([...set])); } catch { /* 隐私模式忽略 */ }
}

/** 侧栏图标：与清单里的 icon 字段对应。新增图标在此加一条。 */
const MODULE_ICONS = {
  crown: `<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="9" width="22" height="2.5" rx="1"/>
      <line x1="8" y1="11.5" x2="8" y2="20"/><circle cx="8" cy="13.5" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="8" cy="18.5" r="1"/>
      <line x1="12.5" y1="11.5" x2="12.5" y2="20"/><circle cx="12.5" cy="13.5" r="1"/><circle cx="12.5" cy="16" r="1"/><circle cx="12.5" cy="18.5" r="1"/>
      <line x1="16" y1="11.5" x2="16" y2="20"/><circle cx="16" cy="13.5" r="1"/><circle cx="16" cy="16" r="1"/><circle cx="16" cy="18.5" r="1"/>
      <line x1="19.5" y1="11.5" x2="19.5" y2="20"/><circle cx="19.5" cy="13.5" r="1"/><circle cx="19.5" cy="16" r="1"/><circle cx="19.5" cy="18.5" r="1"/>
      <line x1="24" y1="11.5" x2="24" y2="20"/><circle cx="24" cy="13.5" r="1"/><circle cx="24" cy="16" r="1"/><circle cx="24" cy="18.5" r="1"/>
      <line x1="4" y1="10.2" x2="28" y2="10.2" stroke-width="1.2"/>
    </svg>`,
  scroll: `<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="7" cy="16" rx="2.5" ry="6"/>
      <ellipse cx="25" cy="16" rx="2.5" ry="6"/>
      <path d="M9.5 11 L22.5 11 M9.5 21 L22.5 21"/>
      <line x1="12" y1="14.5" x2="20" y2="14.5"/>
      <line x1="12" y1="17.5" x2="20" y2="17.5"/>
    </svg>`,
  seal: `<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="5" width="22" height="22" rx="2" fill="currentColor" fill-opacity=".12"/>
      <text x="16" y="22" text-anchor="middle" font-size="16" font-weight="bold" fill="currentColor" stroke="none" font-family="serif">诗</text>
    </svg>`,
  gear: `<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="16" cy="16" r="10"/>
      <circle cx="16" cy="16" r="1.5"/>
      <path d="M16 9 L18 16 L16 23 L14 16 Z" fill="currentColor" fill-opacity=".25"/>
      <line x1="16" y1="4" x2="16" y2="6"/>
      <line x1="16" y1="26" x2="16" y2="28"/>
      <line x1="4" y1="16" x2="6" y2="16"/>
      <line x1="26" y1="16" x2="28" y2="16"/>
    </svg>`,
  cloud: `<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10.5" cy="13.5" r="2.8"/>
      <circle cx="10.5" cy="13.5" r="0.9"/>
      <circle cx="21.5" cy="13.5" r="2.8"/>
      <circle cx="21.5" cy="13.5" r="0.9"/>
      <path d="M7 10 C 5 8 6 5.5 8.5 6.5 C 10 7 10 8.5 9 9.5"/>
      <path d="M25 10 C 27 8 26 5.5 23.5 6.5 C 22 7 22 8.5 23 9.5"/>
      <path d="M16 7 L 16 18"/>
      <path d="M14.5 18 C 14.5 16.5 17.5 16.5 17.5 18 C 17.5 19.5 14.5 19.5 14.5 18 Z"/>
      <path d="M8 17 C 6 18 6.5 20.5 9 20.5"/>
      <path d="M24 17 C 26 18 25.5 20.5 23 20.5"/>
      <path d="M11 22 L 12.5 24.5"/>
      <path d="M21 22 L 19.5 24.5"/>
      <path d="M14 25 L 16 26.5 L 18 25"/>
    </svg>`,
};

/** 运行时状态：已启用的模块清单（启动后填充） */
let ACTIVE_MODULES = [];
let MEGA_MODULES = [];

/** 切换到指定模块：其余面板隐藏，选中项首次进入时懒加载 */
function activateModule(which) {
  stopGuideIfAny();                 // 换模块即停：朗读/推进不得跨模块继续
  document.querySelectorAll('.mega-btn[data-mega]').forEach((b) => {
    b.classList.toggle('active', b.dataset.mega === which);
  });
  for (const m of MEGA_MODULES) {
    const panel = document.getElementById('mega-' + m.id);
    if (panel) panel.classList.toggle('hidden', m.id !== which);
    // iframe 模块：首次进入才装载，之后复用同一实例
    if (m.id === which && m.kind === 'iframe') {
      const frame = document.getElementById(m.id + '-frame');
      if (frame && !frame.src && m.entry) frame.src = m.entry;
    }
  }
  // 背板纹样随模块切换：history 模块用朝代纹，其余用各自专属纹。
  // setBodyData 内部守卫 mock-DOM 环境（见其定义）。
  if (which === 'history') {
    setBodyData('module', null);
    setBodyData('era', currentDynasty !== 'all' ? currentDynasty : null);
  } else {
    setBodyData('module', which);
  }
  try { sessionStorage.setItem('dsh-active-module', which); } catch { /* 忽略 */ }
  // 移动端：选完模块自动收起抽屉（桌面端该函数不存在，不产生任何效果）
  if (typeof window.__atlasCloseMobileSidebar === 'function') {
    try { window.__atlasCloseMobileSidebar(); } catch { /* 忽略 */ }
  }
}

/** 依据清单渲染侧栏按钮，并为 iframe 模块补出懒加载面板 */
function renderModuleList(modules) {
  const sidebar = document.querySelector('.mega-sidebar');
  if (!sidebar) return;
  // 清掉旧按钮（保留卷收、logo、模块管理、AI 配置、支持等固定元素）
  sidebar.querySelectorAll('.mega-btn[data-mega]').forEach((b) => b.remove());
  const anchor = sidebar.querySelector('.mega-support');

  // 逐个插到锚点之前（不用 createDocumentFragment：部分 mock DOM 未实现它）
  modules.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className = 'mega-btn' + (i === 0 ? ' active' : '');
    btn.dataset.mega = m.id;
    btn.title = `${m.name} · ${m.sub || ''}`;
    btn.innerHTML = `<div class="mega-icon">${MODULE_ICONS[m.icon] || MODULE_ICONS.scroll}</div>`
      + `<div class="mega-name">${m.name}</div>`
      + `<div class="mega-sub">${m.sub || ''}</div>`;
    btn.addEventListener('click', () => activateModule(m.id));
    if (anchor && sidebar.insertBefore) sidebar.insertBefore(btn, anchor);
    else sidebar.appendChild(btn);
  });

  // iframe 模块：面板已写在 index.html 里；这里只在缺失时补建，
  // 并对 setAttribute/appendChild 等能力做检测（冒烟测试的 mock DOM 不完整）。
  for (const m of modules) {
    if (m.kind !== 'iframe') continue;
    let panel = document.getElementById('mega-' + m.id);
    if (panel) continue;
    if (!document.createElement || !document.getElementById('app')) continue;
    panel = document.createElement('div');
    panel.className = 'mega-area hidden';
    panel.id = 'mega-' + m.id;
    const frame = document.createElement('iframe');
    frame.id = m.id + '-frame';
    frame.className = 'guoxue-frame';
    frame.title = m.name;
    if (frame.setAttribute) frame.setAttribute('frameborder', '0');
    if (panel.appendChild) panel.appendChild(frame);
    const app = document.getElementById('app');
    if (app.appendChild) app.appendChild(panel);
  }
  // 停用的模块：移除面板，一个字节都不加载
  for (const m of modules) {
    if (m.kind !== 'iframe') continue;
    const panel = document.getElementById('mega-' + m.id);
    const frame = document.getElementById(m.id + '-frame');
    if (frame && frame.src) frame.removeAttribute('src');   // 已装载的先卸载
    if (panel && !m.enabled) panel.remove();
  }
}

/** 启动：读清单 → 应用用户停用 → 渲染侧栏 → 恢复上次停留的模块 */
async function initModules() {
  let modules = [];
  try {
    const r = await loadJSON('modules.json');
    modules = (r && r.modules) || [];
  } catch (e) {
    // 清单读不到时回退到内置清单，保证站点仍可用（例如某些测试的 mock 环境没有 fetch）
    console.warn('modules.json 读取失败，回退到内置清单', e && e.message);
    modules = [
      { id: 'history', name: '帝王谱系', sub: '历代皇帝', kind: 'inline', enabled: true, icon: 'crown' },
      { id: 'guoxue', name: '思想源流', sub: '圣贤书林', kind: 'iframe', entry: 'guoxue/index.html', enabled: true, icon: 'scroll' },
      { id: 'shici', name: '诗词鉴赏', sub: '诗心词韵', kind: 'iframe', entry: 'guoxue/shici.html', enabled: true, icon: 'seal' },
      { id: 'gewu', name: '格物致知', sub: '百工格物', kind: 'iframe', entry: 'guoxue/gewu.html', enabled: true, icon: 'gear' },
    ];
  }
  // 用户的停用选择优先于清单默认
  const disabled = loadDisabledModules();
  ACTIVE_MODULES = modules.map((m) => ({ ...m, enabled: m.enabled !== false && !disabled.has(m.id) }));
  MEGA_MODULES = ACTIVE_MODULES.filter((m) => m.enabled);

  if (!MEGA_MODULES.length) {
    console.warn('所有模块均已停用，侧栏为空');
    return;
  }
  renderModuleList(MEGA_MODULES);

  // 恢复上次停留的模块；停用了就退回第一个
  let which = MEGA_MODULES[0].id;
  try {
    const last = sessionStorage.getItem('dsh-active-module');
    if (last && MEGA_MODULES.some((m) => m.id === last)) which = last;
  } catch { /* 忽略 */ }
  activateModule(which);
}

// 侧栏卷收与 AI 配置/支持卡片在 DOM 就绪时绑定；模块清单随后异步加载
initModules();

/* ---------- 模块管理面板：勾选启用/停用 ---------- */
function renderModuleManager() {
  const box = $('#modules-list');
  if (!box || !ACTIVE_MODULES.length) return;
  box.innerHTML = ACTIVE_MODULES.map((m) => `
    <label class="modules-item">
      <input type="checkbox" data-mid="${m.id}" ${m.enabled ? 'checked' : ''} />
      <span class="modules-item-name">${m.name}</span>
      <span class="modules-item-sub">${m.sub || ''}</span>
    </label>`).join('');
  box.querySelectorAll('input[data-mid]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.mid;
      const def = ACTIVE_MODULES.find((m) => m.id === id);
      if (def) def.enabled = cb.checked;
      const disabled = loadDisabledModules();
      if (cb.checked) disabled.delete(id); else disabled.add(id);
      saveDisabledModules(disabled);
      // 立刻生效：重算启用集合并重绘侧栏
      MEGA_MODULES = ACTIVE_MODULES.filter((m) => m.enabled);
      renderModuleList(MEGA_MODULES);
      if (MEGA_MODULES.length) {
        const cur = MEGA_MODULES.some((m) => m.id === id) ? id : MEGA_MODULES[0].id;
        activateModule(cur);
      }
    });
  });
}

/* 「恢复全部模块」按钮：清空停用记录并刷新。
   卡片的开合逻辑已并入 setupSidebarPops，这里只处理重置动作。 */
(function setupModulesReset() {
  const reset = document.getElementById('modules-reset');
  if (!reset) return;
  reset.addEventListener('click', () => {
    saveDisabledModules(new Set());
    location.reload();
  });
})();

/* 「导览设置」：朗读 / 文本推进两个开关。
   默认全关 = 纯静态网页（不建控制条、不排计时、不出声）。
   开关状态由 web/guide-highlight.js 持久化到 localStorage（键 dsh-guide-settings），
   本文件只负责 UI 同步与调用 window.__guide.setSettings。 */
(function setupGuideSettings() {
  const SPEECH = document.getElementById('guide-speech');
  const DWELL = document.getElementById('guide-dwell');
  const HINT = document.getElementById('guide-hint');
  if (!SPEECH || !DWELL) return;

  /** 每帧轮询直到 guider-haighlight 暴露接口（脚本加载顺序可能在其后） */
  function withGuide(fn) {
    if (window.__guide && typeof window.__guide.setSettings === 'function') { fn(window.__guide); return; }
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (window.__guide && typeof window.__guide.setSettings === 'function') {
        clearInterval(t); fn(window.__guide);
      } else if (tries > 40) {
        clearInterval(t); renderHint(null);
      }
    }, 100);
  }

  function renderHint(cur) {
    if (!HINT) return;
    if (!cur) { HINT.textContent = ''; return; }
    if (cur.speech && window.__guide && !window.__guide.hasSpeech()) {
      HINT.textContent = '当前浏览器不支持语音朗读，已自动改用文本推进。';
    } else if (cur.speech) {
      HINT.textContent = '朗读已开启：点正文任意一句，从该句开始逐句朗读并自动往下走。';
    } else if (cur.dwell) {
      HINT.textContent = '文本推进已开启：点正文任意一句，从该句开始自动切换高亮，不出声。';
    } else {
      HINT.textContent = '两项均关闭：页面处于纯静态浏览状态。';
    }
  }

  function syncUI(cur) {
    if (!cur) return;
    SPEECH.checked = !!cur.speech;
    DWELL.checked = !!cur.dwell;
    renderHint(cur);
  }

  withGuide((g) => {
    syncUI(g.getSettings());
    SPEECH.addEventListener('change', () => {
      const next = g.setSettings({ speech: SPEECH.checked });
      // 朗读不可用时退回文本推进
      if (SPEECH.checked && !g.hasSpeech()) {
        const r = g.setSettings({ speech: false, dwell: true });
        syncUI(r);
        return;
      }
      syncUI(next);
    });
    DWELL.addEventListener('change', () => {
      syncUI(g.setSettings({ dwell: DWELL.checked }));
    });
  });
})();
