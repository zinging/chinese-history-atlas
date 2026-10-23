// 国学图谱 · app.js

// ===== 全局加载动画 =====
let _glTimer = null;
function showLoader() {
  const el = document.getElementById('global-loader');
  if (!el) return;
  clearTimeout(_glTimer);
  _glTimer = setTimeout(() => el.classList.add('show'), 300);
}
function hideLoader() {
  const el = document.getElementById('global-loader');
  if (!el) return;
  clearTimeout(_glTimer);
  el.classList.remove('show');
}

const SECT_META = {
  rujia:   { name: "儒家", intro: "中国人的底层操作系统。从孔子开始，讲的是人和人怎么相处、怎么做人、怎么治国。", data: "rujia" },
  daojia:  { name: "道家", intro: "中国人的退路。老子讲「无为」，庄子讲「逍遥」——当儒家让你扛不动的时候，道家告诉你可以放下。", data: "daojia" },
  foxue:   { name: "佛学", intro: "从印度来，但在中国长成了自己的样子。禅宗更是中国特产——不立文字，直指人心。", data: "foxue" },
  zhuzi:   { name: "诸子", intro: "百家争鸣时期的各种「解决方案」：墨子兼爱非攻、韩非子法治、孙子兵法、鬼谷子纵横。", data: "zhuzi" },
  lixue:   { name: "理学心学", intro: "宋明知识分子把儒释道捏成一套。朱熹讲「存天理」，王阳明讲「致良知」。", data: "lixue" },
  shiwen:  { name: "诗文", intro: "中国人的审美和情绪出口。诗词不是用来背的，是一个人在某个处境下写的一句话。", data: "shiwen" },
  gewu:    { name: "格物", intro: "中国人怎么理解和改造物质世界：从《考工记》到《天工开物》，工艺、医药、农算、地理、博物。", data: "gewu" },
  myth:    { name: "神话", intro: "古人怎么想象天地山川和幽冥世界：从《山海经》的九尾狐、精卫、刑天，看中国想象力的源头。", data: "myth" },
};

/** 当前流派由页面声明：<body data-sect="..."> 优先（诗词鉴赏锁定为诗文），
 *  否则取顶部流派条上标记 .active 的那一项（典籍长河的六派切换）。
 *  这样同一份 app.js 既能服务六派典籍长河，也能服务单派诗词鉴赏。 */
const initialSectBtn = document.querySelector('.sect-btn[data-s].active');
const initialSect = document.body.dataset.sect || (initialSectBtn && initialSectBtn.dataset.s) || "rujia";
let currentSect = initialSect;
let currentPage = "books";
let currentEra = "all";
let bookData = {};
// 各流派数据缓存：切回已看过的流派不再重发请求
const SECT_CACHE = {};
/**
 * 数据版本号：数据文件改动时统一递增，避免浏览器缓存旧分片。
 * 清单 index.json 与 books/*.json、artifacts/discourses/cases 分片共用同一个版本号。
 */
const DATA_VER = "v125";

// Leaflet 按需加载：默认页是典籍长廊，不需要 144KB 地图库；
// 只有用户第一次切到「智慧舆图/诗路舆图」标签时才注入 leaflet.css + leaflet.js。
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

let map = null;
// 图层句柄：按类型分组，切换流派时只清这些，不动底图
const mapLayers = { places: [], routes: [], routeLabels: [] };
// 路线分组：每条路线一个 { line, marks[] }，默认隐藏，点按钮才显示
let routeLayerGroups = [];
// 路线动画定时器（切换流派/收起路线时统一清理）
let routeTimers = [];
// 当前展开的路线序号（null = 不展开）
let activeRoute = null;

/** 地名分类：书院寺观 vs 圣贤故里（决定圆点颜色，对应图例两项） */
function placeKind(name) {
  return /寺|观|庵|祠|院|书院|精舍|草堂|禅|庙|宫/.test(name) ? "site" : "place";
}

/** 转义：地名与 note 来自数据文件，插进 popup 前统一处理 */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 清空本模块添加的图层（保留底图瓦片） */
function clearMapLayers() {
  routeTimers.forEach((t) => clearTimeout(t));
  routeTimers = [];
  for (const k of Object.keys(mapLayers)) {
    mapLayers[k].forEach((l) => map.removeLayer(l));
    mapLayers[k] = [];
  }
  routeLayerGroups.forEach((g) => {
    map.removeLayer(g.line);
    g.marks.forEach((m) => map.removeLayer(m));
  });
  routeLayerGroups = [];
}

const $ = (sel) => document.querySelector(sel);

async function loadSect(sect) {
  showLoader();
  try {
  currentSect = sect;
  currentEra = "all";
  document.querySelectorAll(".sect-btn").forEach(b => b.classList.toggle("active", b.dataset.s === sect));

  // "全部"视图：加载五个流派的数据并合并。
  // 公案与探案也必须一并合并——此前只合并了 books，把 cases/quiz/discourses 留空，
  // 而「全部」是默认视图，于是首屏进公案/探案页永远显示「整理中」，
  // 用户必须手动切到某个具体流派才看得到内容。
  if (sect === 'all') {
    if (SECT_CACHE['all']) {
      bookData = SECT_CACHE['all'];
      renderSect();
      return;
    }
    const sects = ['rujia','daojia','foxue','zhuzi','lixue'];
    const allBooks = [];
    const allCases = [];
    const allQuiz = [];
    const allDiscourses = [];
    const allCats = [];
    const seenCat = new Set();
    for (const s of sects) {
      try {
        const meta = SECT_META[s];
        const r = await fetch(`../../data/${meta.data}/index.json?v=${DATA_VER}`);
        if (r.ok) {
          const d = await r.json();
          const books = d.books || [];
          books.forEach(b => { b._sect = s; b._sectName = meta.name; });
          allBooks.push(...books);
          // 打上流派标记，卡片上能看出这条公案/探案属于哪一派
          (Array.isArray(d.cases) ? d.cases : []).forEach(c => { c._sect = s; c._sectName = meta.name; });
          (Array.isArray(d.quiz) ? d.quiz : []).forEach(q => { q._sect = s; q._sectName = meta.name; });
          (Array.isArray(d.discourses) ? d.discourses : []).forEach(x => { x._sect = s; x._sectName = meta.name; });
          allCases.push(...(Array.isArray(d.cases) ? d.cases : []));
          allQuiz.push(...(Array.isArray(d.quiz) ? d.quiz : []));
          allDiscourses.push(...(Array.isArray(d.discourses) ? d.discourses : []));
          // categories 决定公案分组标签，各流派的分类按并集合并
          for (const c of (Array.isArray(d.categories) ? d.categories : [])) {
            if (!seenCat.has(c.id)) { seenCat.add(c.id); allCats.push(c); }
          }
        }
      } catch(e) { /* 跳过该流派，不影响其余 */ }
    }
    bookData = { books: allBooks, cases: allCases, quiz: allQuiz, discourses: allDiscourses, categories: allCats, places: [], routes: [] };
    SECT_CACHE['all'] = bookData;
    renderSect();
    return;
  }

  const meta = SECT_META[sect];
  // 已加载过的流派直接复用：切回不再重发请求（数据只读，切流派不修改）
  if (SECT_CACHE[sect]) {
    bookData = SECT_CACHE[sect];
    renderSect();
    return;
  }
  try {
    // 数据路径必须用相对路径：本页面在 web/guoxue/ 下，../../data/ 指向仓库 data/。
    // 若写成绝对路径 /data/，本地 serve.mjs 能命中，但部署到 GitHub Pages 子目录
    // （如 /chinese-history-atlas/web/guoxue/）时会解析到域名根，必然 404。
    const r = await fetch(`../../data/${meta.data}/index.json?v=${DATA_VER}`);
    bookData = await r.json();
    SECT_CACHE[sect] = bookData;
  } catch (e) {
    bookData = { books: [], cases: [], places: [], routes: [], quiz: [] };
  }
  renderSect();
  } finally {
    hideLoader();
  }
}

/**
 * 按需加载（数据基座）。
 * 数据已由"单体 index.json"演进为"清单 + 分片"：
 *   - index.json 只放书籍卡片字段与各分区指针（{src, count, byGroup}）
 *   - books/<id>.json 单本书详情，点开卡片时才加载
 *   - artifacts.json / discourses.json / cases.json 分区分片，切到对应 tab 时才加载
 * 其余六流派仍是内联单体，下面的判断用"数组=已就绪、{src}=待加载"两种形态兼容。
 */
function sectDataUrl(rel, book) {
  let dataDir;
  if (currentSect === 'all' && book && book._sect) {
    dataDir = SECT_META[book._sect].data;
  } else {
    dataDir = SECT_META[currentSect].data;
  }
  const sep = rel.includes("?") ? "&" : "?";
  return `../../data/${dataDir}/${rel}${sep}v=${DATA_VER}`;
}

/** 加载某个分区分片（artifacts/discourses/cases）。已加载或本就内联则直接返回。 */
async function ensureSection(name) {
  const v = bookData[name];
  if (Array.isArray(v)) return v;
  if (v && v.src) {
    if (!v.__p) {
      v.__p = fetch(sectDataUrl(v.src))
        .then((r) => {
          if (!r.ok) throw new Error(`加载 ${v.src} 失败 (${r.status})`);
          return r.json();
        })
        .then((arr) => { bookData[name] = arr; return arr; })
        .catch((err) => { v.__p = null; throw err; });
    }
    return v.__p;
  }
  return [];
}

/** 加载某本书的详情分片（intro/core/chapters/golden/funFacts/outline 等）。 */
async function ensureBookDetail(book) {
  if (!book || !book.src || book.__loaded) return book;
  if (!book.__p) {
    book.__p = fetch(sectDataUrl(book.src, book))
      .then((r) => {
        if (!r.ok) throw new Error(`加载 ${book.src} 失败 (${r.status})`);
        return r.json();
      })
      .then((detail) => {
        Object.assign(book, detail);
        book.__loaded = true;
        return book;
      })
      .catch((err) => { book.__p = null; throw err; });
  }
  return book.__p;
}

/** 数据就绪后的统一渲染入口（缓存命中与首次加载共用，避免两处重复维护渲染顺序） */
function renderSect() {
  activeCaseCat = null;
  renderEraSwitch();   // 顶部朝代条：随当前流派的数据重建
  renderBookFilter();
  renderBooks();
  renderCases();
  renderQuiz();
  renderArtifacts();
  // 地图初始化/重绘：必须在各分区渲染之后仍执行，否则切流派或刷新时
  // 地图永远空白（initMap 曾在此处缺失，导致地图页取不到任何图层）。
  // 容器此刻若仍是 display:none，Leaflet 量到的尺寸为 0；
  // 故进入地图页时另有一次 invalidateSize + 重绘（见 tab 切换处）。
  initMap();
}

/** 朝代分档与副标题。
 *  ERA_META 给出每个朝代的起止年份与短名，用于顶部朝代条的副标题，
 *  与帝王谱系「朝代 · 年份 / 数量」同一套读法。 */
const ERA_META = {
  "先秦":     { years: "?-前221", sub: "n" },
  "汉魏":     { years: "前206-580", sub: "n" },
  "唐":       { years: "618-907", sub: "n" },
  "五代两宋": { years: "907-1279", sub: "n" },
  "明清":     { years: "1368-1912", sub: "n" },
};
const ERAS = Object.keys(ERA_META);

/** 渲染顶部朝代条：仅诗词鉴赏（页面声明了 data-sect="shiwen"）启用。
 *  样式复用 .sect-switch/.sect-btn——与帝王谱系朝代条同一套类，观感一致。 */
function renderEraSwitch() {
  const bar = document.querySelector("#era-switch");
  if (!bar) return;                      // 典籍长河六派页面没有这条
  const books = bookData.books || [];
  // 格物致知用 category（工艺营造/医药本草/...）；诗词鉴赏用 era（先秦/汉魏/...）
  const isCategory = books.some((b) => b.category);
  if (!isCategory && !books.some((b) => b.era)) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");

  const counts = {};
  const rawItems = currentPage === "quiz"
    ? (bookData.discourses || [])
    : currentPage === "artifacts"
      ? (bookData.artifacts || [])
      : books;
  let total;
  if (rawItems && !Array.isArray(rawItems) && rawItems.src) {
    // 分片尚未加载：用清单里预聚合的分类计数，角标仍能即时显示
    Object.assign(counts, rawItems.byGroup || {});
    total = rawItems.count || 0;
  } else {
    const items = Array.isArray(rawItems) ? rawItems : [];
    for (const b of items) {
      const k = isCategory ? (b.category || b.cat) : b.era;
      if (k) counts[k] = (counts[k] || 0) + 1;
    }
    total = items.length;
  }
  const keys = isCategory
    ? (bookData.categories
        ? bookData.categories.map(c => c.name).filter(k => counts[k])
        : ["工艺营造","医药本草","农书","算历","地理博物","生活艺术"].filter(k => counts[k]))
    : ERAS.filter(k => counts[k]);

  const cell = (key, label, sub) => {
    const active = currentEra === key;
    return `<button class="sect-btn${active ? " active" : ""}" data-era="${key}">`
      + `<span class="sect-main">${esc(label)}</span>`
      + `<span class="sect-sub">${esc(sub)}</span></button>`;
  };

  const unit = currentPage === "quiz" ? "题" : currentPage === "artifacts" ? "件" : "部";
  let html = cell("all", "全部", `${total} ${unit}`);
  for (const k of keys) {
    html += cell(k, k, `${counts[k] || 0} ${unit}`);
  }
  bar.innerHTML = html;

  // 字体自适应：长标签自动缩小字号以填满边框不溢出
  const fitEraFont = () => {
    bar.querySelectorAll(".sect-btn").forEach((btn) => {
      const main = btn.querySelector(".sect-main");
      if (!main) return;
      main.style.fontSize = "";
      const base = 16;
      let size = base;
      main.style.fontSize = size + "px";
      while (main.scrollWidth > btn.clientWidth - 8 && size > 10) {
        size -= 0.5;
        main.style.fontSize = size + "px";
      }
    });
  };
  fitEraFont();
  window.addEventListener("resize", fitEraFont);

  bar.querySelectorAll(".sect-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.era;
      if (currentEra === key) return;    // 再点已选中的朝代不做切换（避免误触清空）
      currentEra = key;
      currentBook = "all";
      renderSect();
      if (currentPage === "books") scrollBooksToTop();
      // 神话舆图：顶部分类胶囊联动下方事件路线胶囊
      // 上古神话→山海经、神魔长篇→西游记（封神可再点路线胶囊）、鬼狐笔记→聊斋、小说总集→太平
      if (currentPage === "map" && initialSect === "myth") {
        const catToRoute = { "all": 0, "上古神话": 0, "神魔长篇": 1, "鬼狐笔记": 3, "小说总集": 4 };
        const target = Object.prototype.hasOwnProperty.call(catToRoute, key) ? catToRoute[key] : 0;
        setTimeout(() => {
          if (activeRoute !== target) {
            toggleRoute(target);
          } else {
            // 同一路线（如「全部」与「上古神话」都是山海经）：点胶囊的外部点击
            // 会关掉卡片，这里重新弹出该路线的默认热点卡。
            const cfg = ROUTE_SCHEMATIC[target];
            const first = cfg && cfg.hots && cfg.hots[0];
            if (first) showSchematicDetail(first);
          }
        }, 60);
      }
    });
  });
}

/** 切换朝代后把卡片条滚回最左，避免停留在上一屏 */
function scrollBooksToTop() {
  const wrap = $("#books-scroll");
  if (wrap) wrap.scrollTo({ left: 0, behavior: "smooth" });
}

function renderBooks() {
  const wrap = $("#books-scroll");
  let books = bookData.books || [];

  // 朝代/分类筛选由顶部条驱动（诗词鉴赏按 era，格物致知按 category）
  if (currentEra !== "all") {
    books = books.filter((b) => b.category ? b.category === currentEra : b.era === currentEra);
  }

  if (!books.length) {
    wrap.innerHTML = `<div style="color:var(--muted);padding:30px;">该流派内容正在整理中…</div>`;
    $("#book-detail").classList.add("hidden");
    return;
  }
  wrap.innerHTML = books.map((b, i) => {
    const cardMeta = b.cardMeta || (b.meta || "").split("·").pop().trim();
    const topLabel = b.collectionName ? `《${b.collectionName}》` : `《${b.name}》`;
    return `
    <div class="book-card" data-i="${i}" data-id="${b.id}">
      <div class="book-name">${topLabel}</div>
      ${b.portrait ? `<div class="portrait"><img src="../../data/portraits/${b.portrait}" alt="${b.person || b.name}" loading="lazy" decoding="async" width="84" height="84"></div>` : `<div class="icon">${b.icon || "📖"}</div>`}
      ${b.person ? `<div class="person-name">${b.person}</div>` : ""}
      <div class="meta">${cardMeta}</div>
    </div>`;
  }).join("");
  wrap.querySelectorAll(".book-card").forEach(card => {
    card.addEventListener("click", () => {
      wrap.querySelectorAll(".book-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      // 选中卡片自动居中
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      openBook(books[+card.dataset.i]);
    });
  });
  // 鼠标滚轮横向滚动
  wrap.onwheel = (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      wrap.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };
  // 默认展开第一本
  if (books[0]) {
    wrap.querySelector(".book-card").classList.add("active");
    openBook(books[0]);
  }
}

/** 打开某本书：详情在分片里则先按需加载（卡片字段清单已具备，先给骨架，再渲染）。 */
async function openBook(b) {
  if (!b) return;
  const el = $("#book-detail");
  if (b.src && !b.__loaded) {
    el.classList.remove("hidden");
    el.innerHTML = `<div class="lazy-loading">《${b.name}》详情加载中…</div>`;
    try {
      await ensureBookDetail(b);
    } catch (e) {
      el.innerHTML = `<div class="lazy-error">详情加载失败，请稍后重试。</div>`;
      return;
    }
  }
  renderBookDetail(b);
}

function renderBookDetail(b) {
  const el = $("#book-detail");
  el.classList.remove("hidden");
  const portraitHtml = b.portrait
    ? `<img class="detail-portrait" src="../../data/portraits/${b.portrait}" alt="${b.person || b.name}">`
    : `<div class="detail-icon">${b.icon || "📖"}</div>`;
  const bookTagHtml = b.person
    ? `<span class="book-tag">《${b.name}》</span> · `
    : "";
  let html = `<div class="detail-head">${portraitHtml}<div class="detail-info">
    <h2>${b.person || b.name}</h2>
    <div class="meta">${bookTagHtml}${(b.meta || "").replace(/^[^·]+·\s*/, "")}</div>
  </div></div>`;
  if (b.intro) html += `<p style="margin-bottom:10px;">${b.intro}</p>`;
  if (b.core) {
    html += `<h4>核心思想</h4><div class="core-box"><p>${b.core}</p></div>`;
  }
  // 人生时间线（诗文卡片）；格物致知与神话异志改用"章节介绍"自上而下列篇目
  if ((currentSect === "gewu" || currentSect === "myth") && b.outline && b.outline.length) {
    // 格物致知：以章节顺序介绍书籍结构（不按时间，按篇目先后）
    html += `<h4>章节介绍</h4><ul class="timeline">`;
    html += b.outline.map((c, i) => `
      <li class="tl-item">
        <div class="tl-year">${String(i + 1).padStart(2, "0")}</div>
        <div class="tl-body">
          <div class="tl-event">${esc(c.title || "")}</div>
          ${c.note ? `<div class="tl-note">${esc(c.note)}</div>` : ""}
        </div>
      </li>`).join("");
    html += `</ul>`;
  } else if (b.timeline && b.timeline.length) {
    html += `<h4>人生时间线</h4><ul class="timeline">`;
    html += b.timeline.map(t => {
      const isHighlight = /★|转折点|悟道|入幕|亡国|之变/.test(t.event || "");
      return `
      <li class="tl-item ${isHighlight ? "tl-highlight" : ""}">
        <div class="tl-year">${t.year}</div>
        <div class="tl-body">
          <div class="tl-event">${t.event}</div>
          ${t.note ? `<div class="tl-note">${t.note}</div>` : ""}
          ${t.works && (Array.isArray(t.works) ? t.works.some(x => x && String(x).trim()) : String(t.works).trim()) ? `<div class="tl-works">代表作：${(Array.isArray(t.works) ? t.works : [t.works]).filter(x => x && String(x).trim()).map(x => { x = String(x).trim(); return x.startsWith('《') ? x : `《${x}》`; }).join("、")}</div>` : ""}
        </div>
      </li>`;
    }).join("");
    html += `</ul>`;
  }

  // 胶囊 tab：名篇精读 / 金句 / 冷知识
  const hasChapters = b.chapters && b.chapters.length;
  const hasGolden = b.golden && b.golden.length;
  const hasFunFacts = b.funFacts && b.funFacts.length;
  const chips = [];
  if (hasChapters) chips.push({ key: "chapters", label: "📖 名篇精读", color: "chip-facts" });
  if (hasGolden)   chips.push({ key: "golden",   label: "✨ 金句",     color: "chip-open" });
  if (hasFunFacts) chips.push({ key: "funfacts", label: "💡 冷知识",   color: "chip-make" });
  if (chips.length) {
    const defaultTab = chips[0].key;
    html += `<div class="entry-chip-row">`;
    chips.forEach((c, i) => {
      html += `<button class="entry-chip ${c.color} ${i === 0 ? "active" : ""}" data-tab="${c.key}">${c.label}</button>`;
    });
    html += `</div>`;
    if (hasChapters) {
      html += `<div class="entry-panel" data-panel="chapters" style="${defaultTab === "chapters" ? "" : "display:none;"}">`;
      html += b.chapters.map(c => {
        // 标题格式：典籍类加书名号前缀（《道德经》—— 第一章 · 道可道）；
        // 诗文类 c.title 已自带书名号（《将进酒》 · 约752年），不再加书名号但加诗人名前缀
        let titleHtml;
        if (c.title.startsWith("《")) {
          const collectionTail = b.collectionName ? ` · <span class="title-collection">收录《${b.collectionName}》</span>` : "";
          titleHtml = `<div class="title">${c.title}${collectionTail}</div>`;
        } else {
          titleHtml = `<div class="title">《${b.name}》—— ${c.title}</div>`;
        }
        return `
        <div class="chapter">
          ${titleHtml}
          ${c.context ? `<div class="context">📍 ${c.context}</div>` : ""}
          <div class="original">${c.original || ""}</div>
          <div class="gloss">${c.gloss || ""}</div>
          ${c.afterword ? `<div class="afterword"><span class="afterword-tag">💡 点评</span>${c.afterword}</div>` : ""}
        </div>`;
      }).join("");
      html += `</div>`;
    }
    if (hasGolden) {
      html += `<div class="entry-panel" data-panel="golden" style="${defaultTab === "golden" ? "" : "display:none;"}"><ul class="golden-list">`;
      html += b.golden.map(g => {
        if (typeof g === "string") return `<li>${g}</li>`;
        const src = g.source ? `<span class="g-source">—— ${g.source}</span>` : "";
        return `<li><div class="g-text">${g.text} ${src}</div><div class="g-explain">${g.explain || ""}</div></li>`;
      }).join("");
      html += `</ul></div>`;
    }
    if (hasFunFacts) {
      html += `<div class="entry-panel" data-panel="funfacts" style="${defaultTab === "funfacts" ? "" : "display:none;"}">`;
      html += b.funFacts.map(f => {
        const text = typeof f === "string" ? f : (f.fact || f.text || "");
        return `<div class="funfact">${text}</div>`;
      }).join("");
      html += `</div>`;
    }
  }
  el.innerHTML = html;
  // 绑定胶囊切换
  el.querySelectorAll(".entry-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      el.querySelectorAll(".entry-chip").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      const key = btn.dataset.tab;
      el.querySelectorAll(".entry-panel").forEach(p => {
        p.style.display = (p.dataset.panel === key) ? "" : "none";
      });
    });
  });
}

let activeCaseCat = null;
async function renderCases() {
  const list = $("#cases-list");
  const tabsEl = $("#case-tabs");
  if (!list || !tabsEl) return;
  // 分片按需加载：仅当公案 tab 为当前页时才拉 cases.json
  const needsLoad = bookData.cases && !Array.isArray(bookData.cases) && !!bookData.cases.src;
  if (needsLoad && currentPage !== "cases") return;
  if (needsLoad) {
    list.innerHTML = `<div class="lazy-loading">工艺公案加载中…</div>`;
    tabsEl.innerHTML = "";
    try {
      await ensureSection("cases");
    } catch (e) {
      list.innerHTML = `<div class="lazy-error">公案加载失败，请稍后重试。</div>`;
      return;
    }
  }
  const cases = bookData.cases || [];
  const cats = bookData.categories || [];
  if (!cases.length) {
    list.innerHTML = `<div style="color:var(--muted);padding:30px;">该流派公案整理中…</div>`;
    tabsEl.innerHTML = "";
    return;
  }
  if (!activeCaseCat && cats.length) activeCaseCat = cats[0].id;
  // 只显示有案件的分类，去掉数量为0的按钮
  const catsWithCases = cats.map(cat => ({
    ...cat,
    count: cases.filter(c => c.category === cat.id).length
  })).filter(c => c.count > 0);
  tabsEl.innerHTML = catsWithCases.map(cat => {
    return `<button class="case-tab${cat.id === activeCaseCat ? ' active' : ''}" data-cat="${cat.id}">${cat.name}<span class="case-tab-n">${cat.count}</span></button>`;
  }).join("");
  tabsEl.querySelectorAll(".case-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeCaseCat = btn.dataset.cat;
      renderCases();
    });
  });
  const list2 = cases.filter(c => c.category === activeCaseCat);
  list.innerHTML = list2.map(c => {
    const people = (c.people || []).map(p =>
      `<div class="case-person"><div class="case-person-head"><b>${p.name}</b><span class="case-person-role">${p.role}</span></div><div class="case-person-note">${p.note}</div></div>`
    ).join("");
    const questions = (c.openQuestions || []).map(q => `
      <div class="case-question">
        <div class="q">❓ ${q.question}</div>
        <div class="ctx">${q.context || ""}</div>
        <div class="viewpoints">${(q.viewpoints || []).map(v => `<p>• ${v}</p>`).join("")}</div>
      </div>`).join("");
    return `
    <article class="case-card" data-id="${c.id}">
      <div class="case-head">
        <div class="case-title">⚖️ ${c.name}</div>
        <div class="case-date">${c.date}年</div>
      </div>
      <div class="case-summary">${c.summary}</div>
      <div class="case-section"><b>背景介绍</b><p>${c.background}</p>
        ${c.nameOrigin ? `<p style="color:#8a7a5c;margin-top:8px"><i>名字的由来：</i>${c.nameOrigin}</p>` : ""}
      </div>
      ${people ? `<div class="case-section"><b>关键人物</b><div class="case-people">${people}</div></div>` : ""}
      <div class="case-section"><b>经过</b><p>${c.process}</p></div>
      <div class="case-section"><b>结果</b><p>${c.result}</p></div>
      <div class="case-section"><b>影响</b><p>${c.impact}</p></div>
      <div class="case-section"><b>想一想</b>${questions || "<p>（暂无开放讨论题）</p>"}</div>
    </article>`;
  }).join("");
}

let discIndex = 0;
let discEra = "__init__";

/** 书籍筛选条：仅在神兽图鉴/器物图谱页显示，按书筛选图鉴 */
function renderBookFilter() {
  const bar = $("#book-filter");
  if (!bar) return;
  if (currentPage !== "artifacts") { bar.style.display = "none"; bar.innerHTML = ""; return; }
  let books = bookData.books || [];
  // 顶部分类胶囊选中时，书籍胶囊同步过滤到该分类下的书
  if (currentEra !== "all") {
    books = books.filter((b) => b.category ? b.category === currentEra : b.era === currentEra);
  }
  if (!books.length) { bar.style.display = "none"; return; }
  const all = bookData.artifacts || [];
  const rawItems = Array.isArray(all) ? all : [];
  // 全部按钮计数也按顶部分类过滤
  const items = currentEra === "all" ? rawItems : rawItems.filter((x) => x.cat === currentEra);
  const counts = {};
  for (const a of items) { const k = a.book || a.cat || a.from; if (k) counts[k] = (counts[k] || 0) + 1; }
  let html = `<button class="book-filter-btn${currentBook === "all" ? " active" : ""}" data-book="all">全部<em>${items.length}</em></button>`;
  for (const b of books) {
    const cn = b.name;
    const cnt = counts[cn] || 0;
    html += `<button class="book-filter-btn${currentBook === cn ? " active" : ""}" data-book="${esc(cn)}">${esc(cn)}<em>${cnt}</em></button>`;
  }
  bar.innerHTML = html;
  bar.style.display = "flex";
  bar.querySelectorAll(".book-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentBook = btn.dataset.book;
      renderBookFilter();
      renderArtifacts();
    });
  });
}

/**
 * 器物图谱（百工图鉴）：卡片图用缩略图、点击放大用原图。
 *
 * 原图是 1600–2364px、平均 531KB，而卡片只显示 220×160（2x 屏需 440×320）——
 * 一屏 27 张要传 7.2MB，其中 95% 是浪费。故卡片改用 480px 宽的缩略图
 * （data/portraits/artifacts-thumb/ 同名文件，由 web/tools/make-artifact-thumbs.mjs 生成）。
 *
 * 缩略图是构建产物、可能缺失（只 checkout 源码而没跑生成脚本时会 404），
 * 故把原图路径写进 data-fallback，由下方捕获阶段的 error 监听兜底换回原图。
 * 用监听而非内联 onerror：路径若含引号会把内联 JS 的字符串截断，静默失效。
 */
function thumbUrl(full) {
  return String(full).replace("/artifacts/", "/artifacts-thumb/");
}
function artifactImgHtml(a) {
  const full = esc(a.image);
  const thumb = esc(thumbUrl(a.image));
  return `<div class="artifact-img" data-full="${full}">`
    + `<img src="${thumb}" data-fallback="${full}" alt="${esc(a.name)}" `
    + `loading="lazy" decoding="async" width="300" height="160" fetchpriority="low"/></div>`;
}
// 缩略图加载失败时回退到原图。error 事件不冒泡，故用捕获阶段。
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!img || img.tagName !== "IMG") return;
  const fb = img.dataset && img.dataset.fallback;
  if (!fb) return;
  img.removeAttribute("data-fallback");   // 防止原图也失败时无限循环
  img.src = fb;
}, true);

async function renderArtifacts() {
  const grid = $("#artifacts-grid");
  if (!grid) return;
  // 分片按需加载：仅当图鉴 tab 为当前页时才拉 artifacts.json，避免首屏并发拉全部分片
  const needsLoad = bookData.artifacts && !Array.isArray(bookData.artifacts) && !!bookData.artifacts.src;
  if (needsLoad && currentPage !== "artifacts") return;
  if (needsLoad) {
    grid.innerHTML = `<div class="lazy-loading">百工图鉴加载中…</div>`;
    try {
      await ensureSection("artifacts");
      renderBookFilter();
    } catch (e) {
      grid.innerHTML = `<div class="lazy-error">图鉴加载失败，请稍后重试。</div>`;
      return;
    }
  }
  const all = bookData.artifacts || [];
  let list = currentEra === "all" ? all : all.filter((x) => x.cat === currentEra);
  if (currentBook !== "all") list = list.filter((x) => (x.book || x.cat) === currentBook);
  if (!list.length) {
    grid.innerHTML = `<div style="color:var(--muted);padding:30px;">该分类的器物图鉴整理中…</div>`;
    return;
  }
  const catColor = {
    "工艺营造": "#8b5a2b", "医药本草": "#4a7c59", "农书": "#a8893c",
    "算历": "#3d5a80", "地理博物": "#6b8e6b", "生活艺术": "#9c5a5a",
  };
  // 按书分组，书顺序与 books 一致
  const bookOrder = (bookData.books || []).map((b) => b.name);
  const groups = {};
  for (const a of list) {
    const bk = a.book || a.cat;
    (groups[bk] = groups[bk] || []).push(a);
  }
  const sortedKeys = Object.keys(groups).sort((x, y) => {
    const ix = bookOrder.indexOf(x), iy = bookOrder.indexOf(y);
    return (ix === -1 ? 999 : ix) - (iy === -1 ? 999 : iy);
  });
  const bookMeta = {};
  for (const b of (bookData.books || [])) bookMeta[b.name] = b;

  grid.innerHTML = sortedKeys.map((bookName) => {
    const items = groups[bookName];
    const meta = bookMeta[bookName] || {};
    const cards = items.map((a) => `
      <div class="artifact-card">
        ${a.image ? artifactImgHtml(a) : ""}
        <div class="artifact-name">${esc(a.name)}<span class="artifact-from"> · ${esc(a.from || "")}</span></div>
        <div class="artifact-note">${esc(a.note)}</div>
      </div>`).join("");
    return `
      <div class="artifact-group">
        <div class="artifact-group-head">
          <span class="artifact-group-book">《${esc(bookName)}》</span>
          <span class="artifact-group-count">${items.length} 件</span>
        </div>
        <div class="artifact-group-body">${cards}</div>
      </div>`;
  }).join("");
}

async function renderQuiz() {
  const list = $("#quiz-list");
  if (!list) return;
  // 分片按需加载：仅当问典 tab 为当前页时才拉 discourses.json
  const needsLoad = bookData.discourses && !Array.isArray(bookData.discourses) && !!bookData.discourses.src;
  if (needsLoad && currentPage !== "quiz") return;
  if (needsLoad) {
    list.innerHTML = `<div class="lazy-loading">问典题目加载中…</div>`;
    try {
      await ensureSection("discourses");
    } catch (e) {
      list.innerHTML = `<div class="lazy-error">题目加载失败，请稍后重试。</div>`;
      return;
    }
  }
  const all = bookData.discourses || [];
  // 顶部分类/朝代条驱动：「全部」展示全部，否则按 category 或 era 过滤
  const disc = currentEra === "all"
    ? all
    : all.filter((x) => x.category ? x.category === currentEra : x.era === currentEra);
  if (!disc.length) {
    list.innerHTML = `<div style="color:var(--muted);padding:30px;">该分类的题目整理中…</div>`;
    return;
  }
  // 切了朝代就回到该朝代第一题，避免索引错位
  if (discEra !== currentEra) { discEra = currentEra; discIndex = 0; }
  discIndex = discIndex % disc.length;
  const d = disc[discIndex];

  const cluesHtml = (d.clues || []).map((c, i) => `
    <div class="det-clue">
      <div class="det-clue-label">📌 ${esc(c.label)}</div>
      <div class="det-clue-text">${esc(c.text)}</div>
    </div>`).join("");

  const openHtml = d.open ? `
    <div class="det-debate">
      <span class="det-debate-label">💬 思辨一下（没有标准答案）</span><span class="det-debate-quest">${esc(d.open.question)}</span>
      <div class="det-debate-views">${(d.open.viewpoints || []).map((v) => esc(v)).join("<span class='det-sep'>｜</span>")}</div>
    </div>` : "";

  const pageTitle = currentSect === "shiwen"
    ? "诗坛问典 · 像侦探一样读诗人"
    : "探问问典 · 像侦探一样读典籍";

  list.innerHTML = `
    <div class="det-wrap">
      <div class="det-card">
        <div class="det-quest">🕵️ ${esc(d.quest)}</div>
        ${openHtml}
        <div class="det-nav">
          <button class="det-btn" id="disc-prev">◀ 上一题</button>
          <span class="det-count">第 ${discIndex + 1} / ${disc.length} 题</span>
          <button class="det-btn" id="disc-next">下一题 ▶</button>
        </div>
      </div>

      <div class="det-section">
        <h4 class="det-sec-title">🔍 收集到的线索 <small>（来自本项目已核对史料）</small></h4>
        ${cluesHtml}
      </div>

      <div class="det-section">
        <h4 class="det-sec-title">🖊️ 你的回答</h4>
        <div class="det-answer-box">
          <div class="det-answer-quest"><b>围绕本题作答：</b>${esc(d.quest)}</div>
          <div class="det-answer-hint">💡 ${esc(d.create)}</div>
          <textarea id="disc-input" placeholder="结合上面的线索，写下你的判断或答案…"></textarea>
        </div>
      </div>
    </div>`;

  $("#disc-prev").addEventListener("click", () => {
    discIndex = (discIndex - 1 + disc.length) % disc.length;
    renderQuiz();
    list.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#disc-next").addEventListener("click", () => {
    discIndex = (discIndex + 1) % disc.length;
    renderQuiz();
    list.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const storeKey = "shiwen-disc-" + (d.title || discIndex);
  const input = $("#disc-input");
  const saved = localStorage.getItem(storeKey);
  if (saved) input.value = saved;
  input.addEventListener("input", () => localStorage.setItem(storeKey, input.value.trim()));
}

function initMap() {
  const container = $("#map-leaf");
  if (!container) return;
  // 神话异志·神话舆图：纯古式示意图（想象世界），不使用 Leaflet 真实地图
  if (initialSect === "myth") return;
  if (!window.L) return; // Leaflet 还没加载（懒加载），等用户切到地图标签再初始化
  if (!map) {
    map = L.map(container, { scrollWheelZoom: true });
    window.__tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 12,
      errorTileUrl: "",
    }).addTo(map);
  }
  try { renderMapData(); } catch(e) { console.warn("initMap render:", e.message); }
  // 容器若处在隐藏的页面里，Leaflet 首次量到的尺寸是 0，图层会画到看不见的地方。
  // 这里不强行 invalidateSize（隐藏元素量不出尺寸），交由进入地图页时统一修正：
  // 见 tab 切换里的 requestAnimationFrame + invalidateSize + renderMapData。
  if (!map._dshSized && container.clientWidth > 0) {
    map.invalidateSize();
    map._dshSized = true;
  }
}

/** 进入地图页后修正尺寸并重绘：容器从 display:none 变可见时，Leaflet 必须重新量尺寸，
 *  否则地图显示为空白（尺寸仍停在 0）。用 requestAnimationFrame 等布局完成后执行。 */
function refreshMapWhenVisible() {
  if (!map) return;
  requestAnimationFrame(() => {
    map.invalidateSize();
    map._dshSized = true;
    try { renderMapData(); } catch(e) { console.warn("renderMapData:", e.message); }
  });
}

/** 按当前流派数据重绘地名与路线图层（切换流派/进入地图页时调用） */
function renderMapData() {
  // 神话异志：神话舆图全部为古式示意图，不渲染真实 Leaflet 图层
  if (initialSect === "myth") return;
  if (!map) return;
  clearMapLayers();

  const places = bookData.places || [];
  const routes = bookData.routes || [];

  // 地名：圆点 + 常显名称标签，点击弹窗看今名与故事
  places.forEach((p) => {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") return;
    const kind = placeKind(p.name);
    const dot = L.circleMarker([p.lat, p.lng], {
      radius: 7, color: "#ffffff", weight: 2,
      fillColor: kind === "site" ? "#f0a500" : "#c0392b", fillOpacity: 0.95,
    });
    dot.bindTooltip(
      `<span class="map-place-inner"><i class="dot dot-${kind}"></i>${esc(p.name)}</span>`,
      { direction: "right", offset: [8, 0], permanent: true, className: "map-place-tip" }
    );
    dot.bindPopup(
      `<b>${esc(p.name)}</b>${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}`
    );
    dot.addTo(map);
    mapLayers.places.push(dot);
  });

  // 路线：线 + 起终点标签，默认全部隐藏，点按钮才显示对应那条
  routeLayerGroups = [];
  routes.forEach((r, ri) => {
    const pts = (r.points || []).filter(p => typeof p.lat === "number" && typeof p.lng === "number");
    if (pts.length < 2) return;
    const line = L.polyline(pts.map((p) => [p.lat, p.lng]), {
      color: "#c0392b", weight: 4, opacity: 0, dashArray: null,
    });
    routeLayerGroups.push({ line, marks: [], arrows: [] });

    pts.forEach((pt, i) => {
      const m = L.circleMarker([pt.lat, pt.lng], {
        radius: i === 0 ? 7 : 5, color: "#fff", weight: 2,
        fillColor: i === 0 ? "#2e7d32" : (i === pts.length - 1 ? "#a0251c" : "#c0392b"),
        fillOpacity: 0,
      });
      m.bindTooltip(
        `<span class="route-pt-tip"><b>${esc(pt.name || "")}</b>${pt.modern ? `<small>${esc(pt.modern)}</small>` : ""}</span>`,
        { direction: "top", offset: [0, 8], permanent: true, className: "map-route-tip", opacity: 0 }
      );
      routeLayerGroups[routeLayerGroups.length - 1].marks.push(m);
    });

    // 每段中点放一个指向行进方向的三角箭头
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const midLat = (a.lat + b.lat) / 2;
      const midLng = (a.lng + b.lng) / 2;
      // 北向为0、顺时针的方位角，墨卡托投影下东西向按纬度修正
      const φ0 = midLat * Math.PI / 180;
      const dy = (b.lat - a.lat);
      const dx = (b.lng - a.lng) * Math.cos(φ0);
      const ang = Math.atan2(dx, dy) * 180 / Math.PI;
      const icon = L.divIcon({
        className: "route-arrow-wrap",
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        html: `<div class="route-arrow" style="transform:rotate(${ang}deg)"></div>`,
      });
      const am = L.marker([midLat, midLng], { icon, interactive: false, keyboard: false, opacity: 0 });
      routeLayerGroups[routeLayerGroups.length - 1].arrows.push(am);
    }
  });

  // 全部加到地图但默认透明
  routeLayerGroups.forEach((g) => {
    g.line.addTo(map);
    g.marks.forEach((m) => m.addTo(map));
    g.arrows.forEach((a) => a.addTo(map));
  });

  renderRouteButtons(routes);
  hideRouteDetail();

  // 视野：优先按路线外接框，否则按地名外接框；都没有则保持默认中国视野
  const bounds = (routes.length
    ? routes.flatMap((r) => (r.points || []).map((p) => [p.lat, p.lng]))
    : places.map((p) => [p.lat, p.lng]));
  if (bounds.length) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
  } else {
    map.setView([34.5, 108.9], 5);
  }
}

/** 路线开关按钮：点一下展开该条路线的途经点详情，再点收起 */
function renderRouteButtons(routes) {
  const box = $("#map-route-btns");
  if (!box) return;
  box.innerHTML = "";
  routes.forEach((r, ri) => {
    const n = (r.points || []).length;
    const b = document.createElement("button");
    b.className = "route-btn";
    b.textContent = `${r.name}（${n} ${r.unit || "站"}）`;
    b.addEventListener("click", () => toggleRoute(ri));
    box.appendChild(b);
  });
  box.classList.toggle("hidden", routes.length === 0);
}

// 山海经示意图热点：严格按原著方位——昆仑居中，南山经在南（下），西山经在西（左），北山经在北（上），海外东经在东（右）
const SCHEMATIC_HOTS = [
  { x: 50, y: 45, name: "昆仑之丘", img: "kunlun.jpg", desc: "《西山经》：『昆仑之丘，是实惟帝之下都，神陆吾司之。』<span class='tr'>译文：昆仑山是天帝在下界的都邑，由天神陆吾掌管。</span>陆吾虎身九尾、人面虎爪。《大荒西经》：『西海之南，流沙之滨，赤水之后，黑水之前，有大山，名曰昆仑之丘……其下有弱水之渊环之，其外有炎火之山，投物辄然。』<span class='tr'>译文：西海以南、流沙岸边、赤水与黑水之间，有座大山叫昆仑之丘；山下有弱水深渊环绕，山外是燃着大火的山，东西投进去立刻就烧起来。</span>西王母蓬发戴胜、虎齿豹尾，穴居于此，司天之厉及五残，三青鸟为之取食。<span class='tr'>译文：西王母蓬发上戴着玉胜，长着老虎的牙齿、豹子的尾巴，穴居于此；她掌管上天的灾厉与五刑残杀，有三只青鸟替她往返取食。</span>" },
  { x: 27, y: 80, name: "招摇山", img: "zhaoyao.jpg", desc: "《南山经》开篇第一山：『南山经之首曰鹊山，其首曰招摇之山，临于西海之上，多桂，多金玉。』<span class='tr'>译文：南山经首列叫鹊山，鹊山第一座就是招摇山，紧邻西海，多产桂树、金属与玉石。</span>有祝余草，状如韭而青华，食之不饥；有迷榖木，状如榖而黑理，其华四照，佩之不迷；有狌狌，状如禺而白耳，伏行人走，食之善走。丽麂之水出焉，西流注于海，其中多育沛，佩之无瘕疾。<span class='tr'>译文：山中还有祝余草，形状像韭菜、开青花，吃了就不饿；迷榖树纹理发黑、花能照亮四方，佩带它就不会迷路；狌狌兽像长尾猿却长着白耳，伏行也能直立走，吃了肉善于奔跑。丽麂水从此山发源，向西流入大海，水中多产育沛，佩带它就不会生腹中结块的病。</span>" },
  { x: 50, y: 78, name: "青丘山", img: "qingqiu.jpg", desc: "《南山经》：『青丘之山，其阳多玉，其阴多青雘。有兽焉，其状如狐而九尾，其音如婴儿，能食人；食者不蛊。』<span class='tr'>译文：青丘山南坡多玉、北坡多青色颜料；山中有一种兽，形状像狐狸却长着九条尾巴，叫声像婴儿啼哭，会吃人；人吃了它的肉，便不受妖邪蛊惑。</span>有鸟曰灌灌，状如鸠，佩之不惑；英水南流注于即翼之泽，其中多赤鱬，鱼身人面，食之不疥。<span class='tr'>译文：还有灌灌鸟，形状像斑鸠，佩带它的羽毛就不受蛊惑；英水向南流入即翼泽，泽中多产赤鱬，长着鱼的身子、人的脸，吃了它的肉就不生疥疮。</span>" },
  { x: 22, y: 38, name: "长留山", img: "changliu.jpg", desc: "《西山经》：『又西二百里，曰长留之山，其神白帝少昊居之。其兽皆文尾，其鸟皆文首，是多文玉石。』<span class='tr'>译文：再往西二百里是长留山，山神白帝少昊就住在这里；山中野兽都长着花纹尾巴，飞鸟都长着花纹脑袋，还多产有纹理的玉石。</span>山为员神磈氏之宫，其神主司反景——日入之时，霞光反照皆归其所司。山中文鸟、文兽、文玉五色相宣，是为西方白帝之庭。<span class='tr'>译文：这座山是员神磈氏的宫馆，这位神专管落日时霞光反照的景象；山中彩鸟、彩兽、彩玉五色相映，正是西方白帝少昊的庭园。</span>" },
  { x: 30, y: 40, name: "不周山", img: "buzhou.jpg", desc: "《大荒西经》：『西北海之外，大荒之隅，有山而不合，名曰不周负子，有两黄兽守之。』<span class='tr'>译文：西北海之外、大荒的角落，有一座山体缺了一块合不拢的山，叫不周负子，有两只黄色神兽看守。</span>《淮南子·天文训》：共工与颛顼争为帝，怒触不周之山，天柱折，地维绝。天倾西北，故日月星辰移焉；地不满东南，故水潦尘埃归焉。<span class='tr'>译文：共工与颛顼争夺帝位，一怒撞断不周山，撑天的柱子折了、系地的绳子断了；天向西北倾斜，日月星辰都朝西北移动；地的东南塌陷，流水泥沙都向东南汇集。</span>" },
  { x: 38, y: 22, name: "发鸠山", img: "jingwei.jpg", desc: "《北山经》：『发鸠之山，其上多柘木。有鸟焉，其状如乌，文首、白喙、赤足，名曰精卫，其鸣自詨。』<span class='tr'>译文：发鸠山上长着很多柘树；山中有一种鸟，形状像乌鸦，花脑袋、白嘴壳、红脚爪，名叫精卫，叫声就像在呼唤自己的名字。</span>是炎帝之少女，名曰女娃，游于东海溺而不返，故为精卫，常衔西山之木石，以堙于东海。<span class='tr'>译文：它本是炎帝的小女儿，名叫女娃，在东海游泳溺死没有回来，化身为精卫鸟；它常常衔来西山的树枝和石块，用来填塞东海。</span>" },
  { x: 55, y: 18, name: "钟山", img: "zhulong.jpg", desc: "《大荒北经》：『钟山之神，名曰烛阴，视为昼，瞑为夜，吹为冬，呼为夏，不饮，不食，不息，息为风，人面蛇身，赤色，身长千里，居钟山下。』<span class='tr'>译文：钟山山神叫烛阴，睁眼就是白天、闭眼就是黑夜；吹口气成冬天、哈口气成夏天；不喝不吃不呼吸，一呼吸就变作风；他人面蛇身、通体赤红，身长千里，住在钟山脚下。</span>开目为昼、闭目为夜，是为烛龙。其子曰鼓，人面龙身，曾与钦鴀杀葆江于昆仑之阳，帝戮之于钟山东崖。<span class='tr'>译文：它睁眼是昼、闭眼是夜，所以又叫烛龙。它的儿子叫鼓，人面龙身，曾和钦鴀一起在昆仑山之南杀死葆江，天帝便把他们诛戮在钟山东坡。</span>" },
  { x: 25, y: 55, name: "姑射山", img: "gushe.jpg", desc: "《山海经》列姑射、北姑射、南姑射诸山。《庄子·逍遥游》：『藐姑射之山，有神人居焉，肌肤若冰雪，绰约若处子，不食五谷，吸风饮露，乘云气，御飞龙，而游乎四海之外。』<span class='tr'>译文：在遥远的姑射山上住着一位神人，肌肤像冰雪般洁白，姿态像处女般柔美；不吃五谷，吸清风、饮露水，乘着云气、驾着飞龙，遨游于四海之外。</span>神凝则物不疵疠而年谷熟。<span class='tr'>译文：神人神志凝寂，能让万物不生灾害、五谷丰登。</span>" },
  { x: 35, y: 12, name: "一目国", img: "yimu.jpg", desc: "《海外北经》：『一目国在其东，一目中其面而居。』<span class='tr'>译文：一目国在它的东边，那里的人只在脸的正中间长着一只眼睛。</span>《大荒北经》：『有人一目，当面中生，一曰是威姓，少昊之子，食黍。』<span class='tr'>译文：那里的人一只眼睛长在脸正中；一说他们姓威，是少昊的后代，以黄米为食。</span>" },
  { x: 22, y: 25, name: "无肠国", img: "wuchang.jpg", desc: "《海外北经》：『无肠国在深目东，其为人长而无肠。』<span class='tr'>译文：无肠国在深目国的东边，那里的人身材高大，肚子里却没有肠子。</span>郭璞注：其人长大，腹内无肠，食物过腹直通。《大荒北经》亦有无肠之国。<span class='tr'>译文：郭璞注释说：那里的人身形高大，腹中没有肠子，食物穿腹而过；《大荒北经》也记载有无肠之国。</span>" },
  { x: 12, y: 35, name: "奇肱国", img: "jigong.jpg", desc: "《海外西经》：『奇肱之国在其北，其人一臂三目，有阴有阳，乘文马。』<span class='tr'>译文：奇肱国在它的北边，那里的人只有一条胳膊，却长着三只眼睛，眼分阴阳，骑着带花纹的马。</span>郭璞注：其人善为机巧，以杀百禽，能为飞车，从风远行。商汤时西风至，车随风至豫州，汤破其车，十年后东风起，乃复遣归。<span class='tr'>译文：郭璞注释说：那里的人擅长机械技巧，能猎取百禽，还会造飞车乘风远行；商汤时一次西风大作，飞车随风飞到豫州，汤王把车子留下，十年后东风起，才让他们乘飞车返回。</span>" },
  { x: 15, y: 18, name: "羽民国", img: "yumin.jpg", desc: "《海外南经》：『羽民国在其东南，其为人长头，身生羽。』<span class='tr'>译文：羽民国在它的东南方，那里的人脑袋细长，身上长着羽毛。</span>《大荒南经》：『有羽民之国，其民皆生毛羽。』<span class='tr'>译文：有个羽民国，那里的人浑身都长着羽毛。</span>卵生能飞而不能远，其地近鸾鸟自歌、凤鸟自舞之野。<span class='tr'>译文：他们由卵孵化而生，能飞却飞不远；那地方邻近鸾鸟自歌、凤鸟自舞的原野。</span>" },
  { x: 18, y: 50, name: "大人国", img: "daren.jpg", desc: "《海外东经》：『大人国在其北，为人大，坐而削船。』<span class='tr'>译文：大人国在它的北边，那里的人身材高大，坐下来就伸手削修船只。</span>《大荒东经》：『有波谷山者，有大人之国，有大人之市，名曰大人之堂。』<span class='tr'>译文：有座波谷山，那里有大人国，还有大人做买卖的市集，叫大人之堂。</span>《博物志》载其孕三十六年而生，生儿白头。<span class='tr'>译文：《博物志》记载：那里的人怀孕三十六年才生产，生下来的婴儿就是白头发。</span>" },
  { x: 20, y: 85, name: "贯胸国", img: "guanxiong.jpg", desc: "《海外南经》：『贯胸国在其东，其为人胸有窍。』<span class='tr'>译文：贯胸国在它的东边，那里的人胸口都有一个贯通的洞。</span>胸前贯通一孔，尊者出行，以竹木贯胸，使人舁抬而行。<span class='tr'>译文：他们胸前贯通一个孔洞，尊贵的人出行时，让人把竹木穿过胸口，抬着他走。</span>" },
  { x: 35, y: 90, name: "交胫国", img: "jiaojing.jpg", desc: "《海外南经》：『交胫国在其东，其为人交胫。』<span class='tr'>译文：交胫国在它的东边，那里的人两条小腿交叉着长。</span>郭璞注：脚胫曲戾相交，故谓之交胫。<span class='tr'>译文：郭璞注释说：他们的小腿弯曲交叉，所以叫交胫国。</span>" },
  { x: 50, y: 92, name: "不死民", img: "busi.jpg", desc: "《海外南经》：『不死民在其东，其为人黑色，寿，不死。』<span class='tr'>译文：不死民在它的东边，那里的人皮肤黝黑，长生不死。</span>郭璞注：有员丘山，上有不死树，食之乃寿；有赤泉，饮之不老。其地又有甘木，食之长生。<span class='tr'>译文：郭璞注释说：那里有员丘山，山上长着不死树，吃了就能长寿；还有赤泉，喝了就不会衰老；又有甘木，吃了便能长生。</span>" },
  { x: 65, y: 88, name: "三首国", img: "sanshou.jpg", desc: "《海外南经》：『三首国在其东，其为人一身三首。』<span class='tr'>译文：三首国在它的东边，那里的人一个身子上长着三个脑袋。</span>一身而三首，三首各戴一面。<span class='tr'>译文：一个身子上长着三个头，三个脑袋各朝一个方向。</span>" },
  { x: 80, y: 85, name: "长臂国", img: "changbi.jpg", desc: "《海外南经》：『长臂国在其东，捕鱼水中，两手各操一鱼。』<span class='tr'>译文：长臂国在它的东边，那里的人在水中捕鱼，两只手各抓着一条鱼。</span>郭璞注：其人手下垂至地，长臂三丈，便于捕鱼海中，如常人之取物。<span class='tr'>译文：郭璞注释说：那里的人手臂下垂能到地面，臂长三丈，在海里捕鱼就像平常人取东西一样方便。</span>" },
  { x: 88, y: 30, name: "黑齿国", img: "heichi.jpg", desc: "《海外东经》：『黑齿国在其北，为人黑齿，食稻啖蛇，一赤一青，在其旁。』<span class='tr'>译文：黑齿国在它的北边，那里的人牙齿乌黑，吃米饭也吃蛇，身旁常有一红一青两条蛇。</span>《大荒东经》：『有黑齿之国，姜姓，黍食，使四鸟。』<span class='tr'>译文：有个黑齿国，姓姜，以黄米为食，能役使四种鸟兽。</span>其人以漆染齿，啖稻饭而食蛇。<span class='tr'>译文：那里的人用漆把牙齿染黑，吃米饭，也吃蛇。</span>" },
  { x: 82, y: 65, name: "君子国", img: "junzi.jpg", desc: "《海外东经》：『君子国在其北，衣冠带剑，食兽，使二大虎在旁，其人好让不争。有薰华草，朝生夕死。』<span class='tr'>译文：君子国在它的北边，那里的人衣冠整齐、腰佩宝剑，吃兽肉，身边跟着两只大老虎；国人谦让有礼，不争不斗；还有一种薰华草，早晨发芽、晚上就枯死。</span>国人谦谦有礼，市易相让，耕者让畔。<span class='tr'>译文：那里的人谦让有礼，集市买卖互相推让，种田的人互相让田埂。</span>" },
  { x: 92, y: 45, name: "蓬莱仙岛", img: "penglai.jpg", desc: "《海内北经》：『蓬莱山在海中。』<span class='tr'>译文：蓬莱山坐落在大海之中。</span>《列子·汤问》：『渤海之东不知几亿万里，有大壑焉……其中有五山焉：一曰岱舆，二曰员峤，三曰方壶，四曰瀛洲，五曰蓬莱。』<span class='tr'>译文：在渤海以东不知几亿万里处有一个巨大的沟壑，沟里有五座仙山：岱舆、员峤、方壶、瀛洲、蓬莱。</span>所居皆仙圣之种，金银为宫阙，鸟兽尽白，五山之根无所连著，常随潮上下，帝命巨鳌十五举首而戴之。<span class='tr'>译文：山上住的都是仙圣一类，宫阙用金银建造，鸟兽全是白色；五座山的根不连着大地，常随潮水上下漂动，天帝便命十五只巨鳌交替抬头把山驮住。</span>" },
  { x: 70, y: 78, name: "女儿国", img: "nverguo.jpg", desc: "《海外西经》：『女子国在巫咸北，两女子居，水周之。一曰居一门中。』<span class='tr'>译文：女子国在巫咸国的北边，两个女子住在那里，国土四周被水环绕；一说她们同住一门之中。</span>《大荒西经》：『有女子之国。』<span class='tr'>译文：有一个女子之国。</span>其国无男，四周环水，女子浴于黄池而孕。<span class='tr'>译文：这个国家没有男子，四周被水环绕，女子在黄池沐浴就会怀孕。</span>" },
];

// 每条路线的示意图配置：背景图 + 热点坐标
const ROUTE_SCHEMATIC = [
  {
    bg: "world-map.jpg",
    hots: SCHEMATIC_HOTS,
  },
  {
    bg: "xiyou-map.jpg",
    hots: [
      { x: 92.5, y: 46, name: "长安", img: "xy-changan.jpg", desc: "贞观十三年，玄奘于长安化生寺讲经，观音菩萨显化，指点西天有大乘佛法。太宗赐号“三藏”，于长安关外率百官亲送，赐紫金钵盂、通关文牒；三藏执九环锡杖、披锦襕袈裟，跨白马西行。（《西游记》第十二回）<span class='tr'>译文：贞观十三年，玄奘在长安化生寺讲经，观音菩萨化身指点他西天有大乘佛法；唐太宗赐号三藏，亲自送到关外，赐紫金钵盂和通关文牒；玄奘持九环锡杖、披锦襕袈裟，骑白马一路向西。</span>" },
      { x: 85.5, y: 15, name: "两界山", img: "xy-liangjie.jpg", desc: "《西游记》第十四回：王莽篡汉时天降五行山，下压神猴。三藏至两界山，揭下山顶“唵嘛呢叭咪吽”六字真言金帖，五行山崩裂，孙悟空破石而出，拜唐僧为师，戴上金箍，法号行者。<span class='tr'>译文：王莽篡汉时天上落下五行山压住神猴孙悟空；唐僧到两界山，揭下山顶六字真言金帖，五行山崩裂，孙悟空破石而出，拜唐僧为师，戴上金箍，取法号行者。</span>" },
      { x: 71.5, y: 39, name: "鹰愁涧", img: "xy-yingchou.jpg", desc: "《西游记》第十五回：蛇盘山鹰愁涧，西海龙王三太子玉龙吞了唐僧白马。观音菩萨以玉净瓶水化龙为马，白龙马从此驮负三藏西行，唐僧再得脚力。<span class='tr'>译文：蛇盘山鹰愁涧，西海龙王三太子玉龙一口吞了唐僧的白马；观音菩萨用玉净瓶的水把龙化成白马，从此白龙马驮着唐僧西行。</span>" },
      { x: 67, y: 25, name: "观音禅院", img: "xy-chanyuan.jpg", desc: "《西游记》第十六回：黑风山观音禅院，金池长老贪图锦襕袈裟，欲放火烧死唐僧。悟空借辟火罩护住师父，黑风洞黑熊精趁乱盗走袈裟；后观音收黑熊精为落伽山守山大神。<span class='tr'>译文：黑风山观音禅院的金池长老贪图锦襕袈裟，想放火烧死唐僧；悟空借来辟火罩护住师父，黑熊精趁乱偷走袈裟；后来观音把黑熊精收为落伽山守山大神。</span>" },
      { x: 61, y: 62, name: "高老庄", img: "xy-gaolao.jpg", desc: "《西游记》第十八回：高老庄高太公之女被妖怪强占。悟空变作高小姐模样于房中戏耍，得知妖怪本是天蓬元帅，错投猪胎。观音点化等候取经人；次回悟空于云栈洞收伏，唐僧收之为二徒，摩顶受戒，赐号八戒。<span class='tr'>译文：高太公的女儿被妖怪强占；悟空变成高小姐的模样在房中戏耍，得知这妖怪本是天蓬元帅错投猪胎。观音点化他等候取经人；悟空在云栈洞收伏他，唐僧收为二徒，摩顶受戒，赐号八戒。</span>" },
      { x: 71, y: 65, name: "流沙河", img: "xy-liusha.jpg", desc: "《西游记》第二十二回：八百里流沙河，弱水三千，鹅毛不浮。卷帘大将被贬于此，红发蓝脸，颈挂九颗取经人骷髅。惠岸奉法旨以葫芦与骷髅结成法船，渡唐僧过河，收为三徒沙悟净。<span class='tr'>译文：八百里流沙河，弱水三千，鹅毛都浮不起来；卷帘大将被贬到此，红发蓝脸，颈挂九颗取经人的骷髅。惠岸奉法旨用葫芦和骷髅结成法船，渡唐僧过河，收为三徒沙悟净。</span>" },
      { x: 61.5, y: 32, name: "白虎岭", img: "xy-baihu.jpg", desc: "《西游记》第二十七回：白虎岭白骨夫人三变村姑、老妇、老翁戏唐僧，悟空三打白骨精。唐僧不识妖魔，怒逐悟空回花果山，师徒因此离散，后宝象国遇难方和好。<span class='tr'>译文：白虎岭白骨精三次变成村姑、老妇、老翁来戏耍唐僧，悟空三次打死白骨精；唐僧不识妖怪，怒把悟空逐回花果山，师徒离散，后来在宝象国遇难才和好。</span>" },
      { x: 45, y: 27, name: "乌鸡国", img: "xy-wuji.jpg", desc: "《西游记》第三十九回：青毛狮子精化作全真道人，将乌鸡国王推入御花园琉璃井，霸占王位三年。井底龙王以定颜珠护尸。悟空向太上老君求来还魂丹救活国王，文殊菩萨收伏狮猁怪。<span class='tr'>译文：青毛狮子精变成全真道人，把乌鸡国国王推入御花园琉璃井，霸占王位三年；井底龙王用定颜珠保住尸体。悟空向太上老君求来还魂丹救活国王，文殊菩萨收伏狮猁怪。</span>" },
      { x: 41, y: 38, name: "火云洞", img: "xy-huoyun.jpg", desc: "《西游记》第四十回：号山枯松涧火云洞，红孩儿会三昧真火，假扮孩童掳走唐僧。悟空请四海龙王降雨反被烟熏，观音以净瓶海水、天罡刀化作莲花台，收红孩儿为善财童子。<span class='tr'>译文：号山枯松涧火云洞的红孩儿会三昧真火，假扮小孩掳走唐僧；悟空请四海龙王降雨反被烟熏，观音用净瓶海水和天罡刀化成莲花台，收红孩儿做善财童子。</span>" },
      { x: 37, y: 26, name: "车迟国", img: "xy-chechi.jpg", desc: "《西游记》第四十四回：车迟国虎力、鹿力、羊力三大仙尊道灭僧，与悟空赌求雨、坐禅、隔板猜物，又赌砍头、剖腹、下油锅，三妖皆现原形而亡，国中五百众僧获救。<span class='tr'>译文：车迟国虎力、鹿力、羊力三大仙尊道灭僧，和悟空赌求雨、坐禅、隔板猜物，又赌砍头、剖腹、下油锅，三妖都现原形而死，国中五百个和尚得救。</span>" },
      { x: 33.5, y: 38, name: "通天河", img: "xy-tongtian.jpg", desc: "《西游记》第四十七回：八百里通天河，灵感大王（观音莲池金鱼）要陈家庄年年献童男童女。悟空、八戒变作童男陈关保、童女一秤金降妖；唐僧夜阻通天，老鼋驮渡，又因冰河陷落。<span class='tr'>译文：八百里通天河，灵感大王本是观音莲池里的金鱼，要陈家庄年年进献童男童女；悟空、八戒变成童男陈关保、童女一秤金降妖；唐僧夜阻通天河，老鼋驮他渡河，又曾因冰河陷落。</span>" },
      { x: 26, y: 60, name: "女儿国", img: "xy-nverguo.jpg", desc: "《西游记》第五十三回：三藏误饮子母河水怀胎，解阳山取落胎泉；第五十四回入西梁女国，女王欲以王位招赘，三藏坚辞；后毒敌山琵琶洞蝎子精摄走唐僧，昴日星官降伏。<span class='tr'>译文：唐僧误饮子母河水怀了孕，去解阳山取落胎泉水；进入西梁女国，女王想用王位招赘唐僧，唐僧坚决推辞；后来毒敌山琵琶洞蝎子精摄走唐僧，昴日星官降伏了它。</span>" },
      { x: 47, y: 38, name: "火焰山", img: "xy-huoyan.jpg", desc: "《西游记》第五十九回：八百里火焰山，唯铁扇公主芭蕉扇能灭。悟空一借被扇至小须弥山，二借变虫入腹、三借大战牛魔王，得灵吉定风丹与八戒相助，终于扇灭大火，师徒过山。<span class='tr'>译文：八百里火焰山，只有铁扇公主的芭蕉扇能灭；悟空第一次借扇被扇到小须弥山，第二次变虫子钻进她肚子，第三次大战牛魔王；靠灵吉菩萨的定风丹和八戒相助，终于扇灭大火，师徒过山。</span>" },
      { x: 25, y: 23, name: "小雷音", img: "xy-leiyin.jpg", desc: "《西游记》第六十五回：黄眉老佛假设小雷音寺，以金铙合住悟空，又以人种袋（后天袋）擒尽诸天神将。弥勒佛东来，以西瓜为计，令黄眉现形为黄眉童儿，师徒脱困。<span class='tr'>译文：黄眉老佛假搭小雷音寺，用金铙把悟空合住，又用人种袋把诸天神将全部擒住；弥勒佛东来，用西瓜设计，让黄眉现回黄眉童儿原形，师徒才脱难。</span>" },
      { x: 18, y: 36, name: "狮驼岭", img: "xy-shituo.jpg", desc: "《西游记》第七十四回：八百里狮驼岭，青毛狮子、白象、大鹏金翅雕三魔王，骷髅若岭、骸骨如林。大鹏乃如来娘舅，掳唐僧入狮驼城。悟空求如来、文殊、普贤同至，三魔皆被收伏。<span class='tr'>译文：八百里狮驼岭有青毛狮子、白象、大鹏金翅雕三个魔王，骷髅堆成岭、白骨多如林；大鹏是如来的娘舅，把唐僧掳进狮驼城。悟空请来如来、文殊、普贤，三魔都被收伏。</span>" },
      { x: 22, y: 26, name: "比丘国", img: "xy-biqiu.jpg", desc: "《西游记》第七十八回：比丘国（小子城）国丈白鹿精（南极仙翁坐骑）欲以一千一百一十一个小儿心肝做药引，美后白面狐狸精惑主。悟空救出群婴，南极仙翁收回白鹿。<span class='tr'>译文：比丘国（小子城）国丈白鹿精本是南极仙翁的坐骑，要用一千一百一十一个小孩的心肝做药引，美后白面狐狸精蛊惑国王；悟空救出小孩，南极仙翁收回白鹿。</span>" },
      { x: 12.5, y: 23, name: "灵山", img: "xy-lingshan.jpg", desc: "《西游记》第九十八回：师徒至灵鹫峰灵山雷音寺，阿傩、伽叶索人事，初传无字经，后以紫金钵盂换得真经。归途老鼋因唐僧忘问年寿，将师徒淬入水中，经书残缺，终完八十一难。<span class='tr'>译文：师徒到灵鹫峰灵山雷音寺，阿傩、伽叶索取人事，第一次给的是无字经，后来用紫金钵盂才换得真经；回去路上老鼋因为唐僧忘了问它的寿命，把师徒淬进水里，经书残缺，至此凑满八十一难。</span>" },
    ],
  },
  {
    bg: "fengshen-map.jpg",
    hots: [
      { x: 13, y: 13, name: "昆仑山", img: "fs-kunlun.jpg", desc: "《封神演义》第十五回：姜子牙登昆仑，元始天尊命其下山封神，赐封神榜、打神鞭、杏黄旗，并嘱“旁人叫你，切不可应”。玉虚宫为阐教祖庭，十二金仙皆出于此，子牙由此辅佐周室。<span class='tr'>译文：姜子牙登上昆仑山，元始天尊命他下山封神，赐给他封神榜、打神鞭、杏黄旗，并叮嘱旁人叫他千万不可答应；玉虚宫是阐教祖庭，十二金仙都出自这里，姜子牙由此下山辅佐周室。</span>" },
      { x: 9, y: 38, name: "西岐", img: "fs-xiqi.jpg", desc: "《封神演义》：西伯侯姬昌于岐山得姜尚，拜为丞相；武王姬发继位，以姜子牙为帅，凤鸣于岐山，三分天下有其二。西岐为周室龙兴之地，会诸侯、东进五关，兴兵伐商。<span class='tr'>译文：西伯侯姬昌在岐山得到姜尚，拜为丞相；武王姬发继位后以姜子牙为帅，凤鸣岐山，那时天下三分之二已归周。西岐是周室龙兴之地，从此会盟诸侯、东进五关，兴兵伐商。</span>" },
      { x: 7, y: 62, name: "渭水", img: "fs-weishui.jpg", desc: "《封神演义》第二十四回：姜尚隐居渭水磻溪，以直钩垂钓，离水三尺，愿者上钩。周文王出猎遇之，同载而归，亲自拉车八百零八步，子牙遂保周朝八百零八年。<span class='tr'>译文：姜尚隐居在渭水磻溪，用直钩离水三尺垂钓，愿者上钩；周文王出猎遇到他，和他同车回来，亲自拉车八百零八步，姜子牙便保周朝八百零八年。</span>" },
      { x: 28, y: 44, name: "金鸡岭", img: "fs-jinjiling.jpg", desc: "《封神演义》第六十九回：孔宣兵阻金鸡岭，背后青、黄、赤、白、黑五色神光，刷物擒将，燃灯、陆压皆不能敌。准提道人至，以七宝妙树破神光，收孔宣现孔雀原形，引归西方。<span class='tr'>译文：孔宣在金鸡岭挡住周兵，背后有青黄赤白黑五色神光，刷一下就能把人收走，燃灯、陆压都打不过他；准提道人赶来，用七宝妙树破了神光，收孔宣现出孔雀原形，引归西方。</span>" },
      { x: 39, y: 46, name: "汜水关", img: "fs-sishui.jpg", desc: "《封神演义》：汜水关为朝歌西部门户，守将韩荣父子把关，余化（七首将军）骑火眼金睛兽，以化血神刀连败周将，连伤哪吒、雷震子。后杨戬求得解药，余化授首，汜水关破。<span class='tr'>译文：汜水关是朝歌西部门户，守将韩荣父子把关，余化骑火眼金睛兽，用化血神刀连败周将，伤了哪吒、雷震子；后来杨戬求来解药，余化授首，汜水关被攻破。</span>" },
      { x: 46, y: 42, name: "界牌关", img: "fs-jiepai.jpg", desc: "《封神演义》第七十七回：通天教主于界牌关下布设诛仙阵，诛、戮、陷、绝四口仙剑分镇四方阵门，杀气冲天。老子、元始、接引、准提四圣会齐，共破诛仙阵，四剑尽归阐教。<span class='tr'>译文：通天教主在界牌关下设诛仙阵，诛、戮、陷、绝四口仙剑分镇四方阵门，杀气冲天；老子、元始、接引、准提四圣会齐，共同破了诛仙阵，四口仙剑都归阐教。</span>" },
      { x: 54, y: 41, name: "穿云关", img: "fs-chuanyun.jpg", desc: "《封神演义》第八十回：瘟神吕岳于穿云关摆瘟癀阵，二十一把瘟癀伞、阵台高筑，令周营六师染疫。清虚道德真君门人杨任以五火神焰扇，会同哪吒、杨戬破阵，吕岳受戮，封瘟癀昊天大帝。<span class='tr'>译文：瘟神吕岳在穿云关摆瘟癀阵，二十一把瘟癀伞高筑阵台，让周营三军染上瘟疫；清虚道德真君的门人杨任用五火神焰扇，会同哪吒、杨戬破阵，吕岳被杀，封为瘟癀昊天大帝。</span>" },
      { x: 62, y: 33, name: "潼关", img: "fs-tongguan.jpg", desc: "《封神演义》第八十一回：潼关守将余化龙有五子，幼子余德施法，以五方斗布下痘疹毒，周营六师皆染天花。杨戬往火云洞求神农赐升麻丹药，全军痊愈。潼关破后余氏父子封五方痘神。<span class='tr'>译文：潼关守将余化龙有五个儿子，小儿子余德施法，用五方斗布下痘疹毒，周营三军都染上天花；杨戬往火云洞求神农赐下升麻丹药，全军痊愈。潼关攻破后，余氏父子被封为五方痘神。</span>" },
      { x: 71, y: 33, name: "临潼关", img: "fs-lintong.jpg", desc: "《封神演义》第八十五回：临潼关守将邓昆、芮吉本为商臣，见纣王无道、周室当兴，遂献关归周，周军兵不血刃过临潼关，五关之路遂通，兵锋直抵渑池。<span class='tr'>译文：临潼关守将邓昆、芮吉本是商臣，见纣王无道、周室当兴，便献关归周；周军兵不血刃过了临潼关，五关之路打通，兵锋直抵渑池。</span>" },
      { x: 43, y: 70, name: "渑池县", img: "fs-mianchi.jpg", desc: "《封神演义》第八十六回：渑池县张奎精地行术，日行一千五百里，骑独角乌烟兽，连斩五岳（黄飞虎等）；夫人高兰英施日月神针、太阳神针，致周将目眩。后杨戬以指地成钢术、韦护降魔杵擒杀张奎。<span class='tr'>译文：渑池县张奎精于地行术，日行一千五百里，骑独角乌烟兽，连斩五岳黄飞虎等；夫人高兰英施日月神针、太阳神针，让周将目眩。后来杨戬用指地成钢术、韦护用降魔杵擒杀张奎。</span>" },
      { x: 76, y: 71, name: "孟津", img: "fs-mengjin.jpg", desc: "《封神演义》第八十八回：武王兵至孟津，天下八百诸侯不期而会，歃血为盟，共推姬发为盟主，陈兵黄河北岸，旌旗蔽日。诸侯之师于此誓师，牧野之战一触即发。<span class='tr'>译文：武王兵到孟津，天下八百诸侯不约而会，歃血为盟，共推姬发做盟主，陈兵黄河北岸，旌旗遮天；诸侯之师在这里誓师，牧野之战一触即发。</span>" },
      { x: 86, y: 54, name: "牧野", img: "fs-muye.jpg", desc: "《封神演义》：甲子昧爽，武王以革车三百乘、虎贲三千，与商军七十万战于牧野。姜尚以白旄黄钺麾师冲锋，商军前徒倒戈，血流漂杵，商师大溃，纣王败走朝歌。<span class='tr'>译文：甲子日黎明，武王用革车三百辆、虎贲三千，和商军七十万在牧野决战；姜尚举白旄黄钺麾军冲锋，商军前线倒戈，血流得能漂起杵来，商军大溃，纣王败逃回朝歌。</span>" },
      { x: 90, y: 22, name: "朝歌", img: "fs-zhaoge.jpg", desc: "《封神演义》第九十七回：牧野兵败，纣王见大势已去，登摘星楼，于鹿台举火，殷商六百年社稷亡。妲己等轩辕坟三妖被女娲缚交杨戬，武王入殷，散鹿台之财、发巨桥之粟，商民大悦。<span class='tr'>译文：牧野兵败，纣王见大势已去，登上摘星楼，在鹿台举火自焚，殷商六百年社稷灭亡；妲己等轩辕坟三妖被女娲捆了交给杨戬，武王入殷，散发鹿台财货、巨桥粮食，商民大喜。</span>" },
      { x: 12, y: 82, name: "封神台", img: "fs-fengshen.jpg", desc: "《封神演义》第九十九回：姜子牙于岐山封神台开读封神榜，敕封三百六十五位正神：黄飞虎封东岳泰山天齐仁圣大帝、闻仲封九天应元雷声普化天尊、黄天化封管领三山正神炳灵公；杨戬、哪吒、李靖等七人肉身成圣，不在榜中，余者各有职司。<span class='tr'>译文：姜子牙在岐山封神台开读封神榜，敕封三百六十五位正神：黄飞虎封东岳泰山天齐仁圣大帝、闻仲封九天应元雷声普化天尊、黄天化封管领三山正神炳灵公；杨戬、哪吒、李靖等七人肉身成圣不在榜中，其余各有职司。</span>" },
    ],
  },
  {
    // 聊斋志异·夜世界：场景分布图（非路线），热点按典型故事场景落位，不连线
    bg: "liaozhai-map.jpg",
    hots: [
      { x: 17, y: 28, name: "兰若寺", img: "lanruosi.jpg", desc: "聂小倩葬于此。宁采臣借宿，小倩夜来诱之，宁正色拒绝。小倩感其正直，求他迁骨，后得复生，结为夫妻。《聂小倩》：『小倩，姓聂氏，十八夭殂，葬寺侧。』<span class='tr'>译文：聂小倩姓聂，十八岁早逝，葬在寺院旁边。宁采臣借宿时小倩夜里来诱他，宁采臣正色拒绝；小倩被他的正直感动，请他迁葬遗骨，后来还魂复生，两人结为夫妻。</span>" },
      { x: 10, y: 60, name: "闽江水滨", img: "liancheng.jpg", desc: "史连城，史孝廉之女，爱乔大年诗，以绣帕相赠。连城病逝，乔生往吊，一痛而绝。二人魂归地府，终得同返。《连城》：『连城，史孝廉女，知乔大年之才，终身相许。』<span class='tr'>译文：连城是史孝廉的女儿，深知乔大年的才华，愿终身相许。她病逝后乔生往吊，一痛而绝，二人魂归地府，终得同返人间。</span>" },
      { x: 22, y: 78, name: "枉死城", img: "xifangping.jpg", desc: "席方平为父伸冤，魂入地府，历经城隍、冥王皆贪赃枉法，被火床拷打，皮肉糜烂，仍不屈。后二郎神昭雪，父子复生。《席方平》：『冥王命以火床，肉焦黑，问曰：「敢再讼乎？」席曰：「大冤未伸，寸心不死。」』<span class='tr'>译文：冥王下令把他按上火床，皮肉烤得焦黑，问：还敢再告状吗？席方平说：大冤没伸，我这颗心不死。后来二郎神为他昭雪，父子复生。</span>" },
      { x: 48, y: 40, name: "莒州山岗", img: "yingshan.jpg", desc: "王子服上山采药，遇一姑娘捻梅花一枝，容华绝代，笑容可掬。原来乃是姨表妹婴宁，狐女所生。婴宁爱笑，笑声不可抑制。《婴宁》：『捻梅花一枝，容华绝代，笑容可掬。』<span class='tr'>译文：手里捻着一枝梅花，容貌绝代，笑容满面。原来她就是姨表妹婴宁，狐女所生；婴宁爱笑，笑声不可抑制。</span>" },
      { x: 50, y: 72, name: "陵阳地府", img: "lupan.jpg", desc: "朱尔旦与陆判官交好，求其为自己换慧心。陆判夜入，自腹中取一窍塞之，朱遂文思大进。后又为其妻换美人头。《陆判》：『陆曰：「君欲贵，须先换慧心。」乃解衣出刀，剖腹出肠胃，一一整理，复纳之。』<span class='tr'>译文：陆判说：你要显贵，得先换一颗慧心。于是解衣动刀，剖开肚子拿出肠胃，一一整理好，再放回去；朱尔旦从此文思大进，后来又求陆判为其妻换了美人头。</span>" },
      { x: 74, y: 38, name: "太原王宅", img: "huapi.jpg", desc: "太原王生早行，遇一女郎，携归书斋。后遇道士曰『君身妖气』。王生潜窥，见一恶鬼，翠面锯齿，铺人皮于榻，执彩笔绘之，披身化为女子。《画皮》：『铺人皮于榻上，执彩笔而绘之；已而，举皮如振衣状，披于身，遂化为女子。』<span class='tr'>译文：恶鬼把人皮铺在床上，拿彩笔往上画；画好后像抖衣服一样举起人皮披在身上，就变成了女子。王生潜窥之下才知早晚相伴的女郎原是恶鬼披皮所化。</span>" },
      { x: 82, y: 70, name: "华阴小院", img: "cuzhi.jpg", desc: "宣德间宫中尚促织之戏，华阴成名被差役逼迫，倾尽家产寻蟋蟀。其子魂化一只小虫，轻捷善斗，献入宫中，竟得富贵。《促织》：『宣德间，宫中尚促织之戏，岁征民间。此物故非西产；有华阴令欲媚上官，以一头进。』<span class='tr'>译文：宣德年间宫里盛行斗蟋蟀，每年向民间征取；这东西本不是陕西出产，有个华阴县令想讨好上官，就进献了一只。成名被差役逼迫倾尽家产寻蟋蟀，其子魂化小虫轻捷善斗，献入宫中竟得富贵。</span>" },
      { x: 87, y: 20, name: "崂山", img: "laoshan.jpg", desc: "王生入崂山求道，不堪砍柴之苦。师父授以穿墙之咒，嘱其归后勿炫耀。王生回家向妻演示，头撞硬墙，额上起大包。《崂山道士》：『俯首骤入，勿逡巡。王果去墙数步，奔而入，及墙，虚若无物，回视，果在墙外矣。』<span class='tr'>译文：低头快进去，别犹豫。王生果然退到几步外冲进去，到墙边像没东西一样穿过去，回头一看，果然已在墙外；他回家向妻演示时却头撞硬墙，额上起了大包。</span>" },
    ],
  },
  {
    // 太平广记·唐前奇闻时空图：跨汉魏至唐600年的故事叠加，不连线；热点带朝代小签（汉/唐）与卷次出处
    bg: "taiping-map.jpg",
    hots: [
      { x: 90, y: 78, tag: "汉", name: "天台山", img: "tiantai.jpg", src: "《太平广记·卷六十一·女仙六·天台二女》（出《幽明录》）", desc: "东汉永平五年，刘晨、阮肇入天台山采药，迷不得返。经十三日饥，遥望山上桃树熟，跻险援葛，啖数枚，饥止体充。下山取水，见芜菁叶与胡麻饭随杯流出，遂遇二仙女，邀归留居半年。还乡时乡邑零落，已历七世。<span class='tr'>译文：东汉永平五年，刘晨、阮肇进天台山采药迷路走不出来；饿了十三天，望见山上桃树熟了，攀藤摘了几个桃子，吃了就不饿了。下山取水，看见芜菁叶和胡麻饭随杯子漂出来，于是遇到两位仙女，邀他们回去住了半年；回乡时乡邑零落，人间已经过了七世。</span>" },
      { x: 6, y: 52, tag: "唐", name: "马嵬驿", img: "changhen.jpg", src: "《太平广记·卷四百八十六·杂传记三·长恨传》（陈鸿撰）", desc: "天宝十五载安史之乱，玄宗幸蜀，次马嵬驿。六军不发，诛杨国忠，赐杨贵妃缢于佛堂梨树下。陈鸿《长恨传》：『及玄宗幸蜀，次马嵬，六军徘徊，持戟不进。』<span class='tr'>译文：等玄宗逃往蜀地，走到马嵬，六军徘徊不前，持着兵器不肯再走。六军遂诛杨国忠，赐杨贵妃缢于佛堂梨树下。</span>" },
      { x: 27, y: 42, tag: "唐", name: "长安平康坊", img: "liwa.jpg", src: "《太平广记·卷四百八十四·杂传记一·李娃传》（白行简撰）", desc: "天宝中，荥阳公子郑生赴长安应试，游平康坊，遇名妓李娃，两情相悦，资财荡尽。后郑生落魄为挽歌郎，几冻馁而死。李娃赎身相救，励其苦读，终登甲第，夫妇偕老，李娃封汧国夫人。<span class='tr'>译文：天宝年间，荥阳公子郑生到长安应试，游平康坊遇到名妓李娃，两情相悦，资财花光；后来郑生落魄做了挽歌郎，几乎冻饿而死。李娃赎身救他，勉励他苦读，终于中了甲第，夫妻白头偕老，李娃封汧国夫人。</span>" },
      { x: 48, y: 13, tag: "唐", name: "邯郸客店", img: "zhenzhong.jpg", src: "《太平广记·卷八十二·异人·吕翁》（沈既济《枕中记》）", desc: "开元中，少年卢生途经邯郸客店，遇道士吕翁，自叹困顿。翁授青瓷枕，生枕之入梦：娶清河崔氏女、登进士第、出将入相，两度遭贬，寿逾八十。梦醒，店主人所炊黄粱饭尚未熟，顿悟荣枯皆幻。<span class='tr'>译文：开元年间，少年卢生路过邯郸客店，遇到道士吕翁，自叹困顿；吕翁给他一个青瓷枕，他枕着入梦：娶清河崔氏女、中进士、出将入相，两度遭贬，活到八十多岁。梦醒时店主煮的黄粱饭还没熟，他顿悟荣辱富贵都是一场梦。</span>" },
      { x: 38, y: 23, tag: "唐", name: "蒲州普救寺", img: "yingying.jpg", src: "《太平广记·卷四百八十八·杂传记五·莺莺传》（元稹撰）", desc: "贞元中，张生游蒲州，寓普救寺。值军人乘乱扰掠，张生护崔氏母女得全。崔女莺莺才色冠世，侍女红娘传书递简，西厢密会。后张生赴京另娶，始乱终弃，自辩为「善补过」，遂成千古恨事。<span class='tr'>译文：贞元年间，张生游蒲州住在普救寺，赶上军人乘乱抢掠，张生保护崔氏母女平安；崔女莺莺才貌冠世，侍女红娘传书递简，两人在西厢密会。后来张生赴京另娶，始乱终弃，反自辩善于补过，成了千古恨事。</span>" },
      { x: 15, y: 46, tag: "唐", name: "长安西市", img: "renshi.jpg", src: "《太平广记·卷四百五十二·狐六·任氏》（沈既济撰）", desc: "天宝九年，郑子于长安西市遇狐女任氏，容色绝代，市人皆惊，遂倾心相许。任氏虽为狐精，却忠贞聪慧、不畏强暴，助郑子成家立业。后随郑子赴金城，途中为猎犬所害，哀恸而亡。<span class='tr'>译文：天宝九年，郑子在长安西市遇到狐女任氏，容色绝代，满城人都惊叹，于是倾心相许；任氏虽是狐精，却忠贞聪慧、不畏强暴，帮郑子成家立业。后来随郑子赴金城，途中被猎犬咬死，郑子哀痛不已。</span>" },
      { x: 85, y: 42, tag: "唐", name: "广陵东槐里", img: "nanke.jpg", src: "《太平广记·卷四百七十五·昆虫三·淳于棼》（李公佐《南柯太守传》）", desc: "淳于棼家住广陵郡东十里，宅南有大古槐一株，清阴数亩。醉卧东庑，梦入槐安国，招为驸马，出守南柯郡二十年，贵极一时。后兵败妻丧，被遣归。醒后掘槐下蚁穴，宛然城郭，方知一梦。<span class='tr'>译文：淳于棼家住在广陵郡城东十里，宅子南边有一棵大古槐，清荫几亩；他醉卧东厢房，梦入槐安国，被招为驸马，出守南柯郡二十年，贵极一时。后来兵败妻丧，被遣送回乡；醒来掘开槐树下的蚁穴，里面宛然是座城郭，才知是一场梦。</span>" },
      { x: 61, y: 80, tag: "唐", name: "洞庭湖君山", img: "liuyi.jpg", src: "《太平广记·卷四百一十九·龙二·柳毅》（李朝威撰）", desc: "仪凤中，儒生柳毅应举下第，将还湘滨，至泾阳，遇洞庭龙君之女牧羊于野，风鬟雨鬓，蛾脸不舒。龙女托他传书洞庭。柳毅入龙宫送书，钱塘君救回龙女。几经曲折，柳毅终与龙女结为夫妻，同登仙籍。<span class='tr'>译文：仪凤年间，儒生柳毅应举落第，要回湘滨，走到泾阳，遇到洞庭龙君的女儿在野外放羊，风鬟雨鬓、满面愁容；龙女托他给洞庭龙宫送信。柳毅进龙宫送书，钱塘君救回龙女，几经周折，柳毅终于和龙女结为夫妻，同登仙籍。</span>" },
    ],
  },
];

function renderSchematicHotspots() {
  const wrap = document.getElementById("schematic-hotspots");
  if (!wrap) return;
  const cfg = ROUTE_SCHEMATIC[activeRoute] || ROUTE_SCHEMATIC[0];
  // 更新背景图
  const bg = document.getElementById("schematic-bg");
  if (bg && bg.src.indexOf(cfg.bg) < 0) {
    bg.src = "../../data/portraits/myth-map/" + cfg.bg;
  }
  wrap.innerHTML = "";
  cfg.hots.forEach((h) => {
    const dot = document.createElement("div");
    dot.className = "sch-hotspot";
    dot.style.left = h.x + "%";
    dot.style.top = h.y + "%";
    dot.innerHTML = `<span class="hs-label">${h.tag ? `<i class="hs-tag hs-tag-${h.tag}">${h.tag}</i>` : ""}${h.name}</span>`;
    dot.addEventListener("click", () => showSchematicDetail(h));
    wrap.appendChild(dot);
  });
}

function showSchematicDetail(h) {
  // 移除旧面板
  const old = document.querySelector(".sch-detail");
  if (old) old.remove();
  const panel = document.createElement("div");
  panel.className = "sch-detail";
  panel.innerHTML = `
    <button class="sch-detail-close" aria-label="关闭">×</button>
    ${h.img ? `<img src="../../data/portraits/myth-map-thumb/${h.img}" data-fallback="../../data/portraits/myth-map/${h.img}" alt="${h.name}" decoding="async">` : ""}
    <h4>${h.name}</h4>
    ${h.src ? `<p class="sch-detail-src">${h.src}</p>` : ""}
    <p>${h.desc}</p>
  `;
  document.querySelector(".map-wrap").appendChild(panel);
  // 关闭按钮
  panel.querySelector(".sch-detail-close").addEventListener("click", (e) => {
    e.stopPropagation();
    panel.remove();
  });
  // 点击面板外部关闭
  setTimeout(() => {
    const outsideHandler = (e) => {
      if (!panel.contains(e.target)) {
        panel.remove();
        document.removeEventListener("click", outsideHandler);
      }
    };
    document.addEventListener("click", outsideHandler);
  }, 0);
}

/** 展开/收起一条路线：SVG从起点画到终点，途经点依次出现 */
function toggleRoute(ri) {
  const routes = bookData.routes || [];
  const r = routes[ri];
  if (!r) return;
  if (activeRoute === ri) { hideRouteDetail(); return; }
  activeRoute = ri;

  // 示意图路线（如山海经想象世界）：切换为古式世界示意图
  const schematic = !!r.schematic;
  // 清除旧的示意图详情面板
  const oldSch = document.querySelector(".sch-detail");
  if (oldSch) oldSch.remove();
  const mapLeaf = document.getElementById("map-leaf");
  const schematicEl = document.getElementById("map-schematic");
  if (schematicEl) schematicEl.classList.toggle("hidden", !schematic);
  if (mapLeaf) mapLeaf.style.display = schematic ? "none" : "";
  if (window.__tileLayer) window.__tileLayer.setOpacity(schematic ? 0 : 1);
  const mapWrap = document.querySelector(".map-wrap");
  if (mapWrap) mapWrap.classList.toggle("schematic", schematic);
  if (schematic) renderSchematicHotspots();

  // 图例随路线切换
  const legendPlace = document.getElementById("sch-legend-place");
  const legendStart = document.getElementById("sch-legend-start");
  const legendEnd = document.getElementById("sch-legend-end");
  if (legendPlace) {
    if (ri === 0) {
      legendPlace.style.display = ""; legendStart.style.display = "none"; legendEnd.style.display = "none";
      legendPlace.innerHTML = '<i class="dot dot-place"></i>神山异国';
    } else if (ri === 1) {
      legendPlace.style.display = "none"; legendStart.style.display = ""; legendEnd.style.display = "";
      legendStart.innerHTML = '<i class="dot dot-route-start"></i>取经起点';
      legendEnd.innerHTML = '<i class="dot dot-route-end"></i>灵山终点';
    } else if (ri === 2) {
      legendPlace.style.display = "none"; legendStart.style.display = ""; legendEnd.style.display = "";
      legendStart.innerHTML = '<i class="dot dot-route-start"></i>伐纣起点';
      legendEnd.innerHTML = '<i class="dot dot-route-end"></i>封神台';
    } else if (ri === 4) {
      // 太平广记·奇闻时空图：朝代小签图例（汉=青，唐=赭红）
      legendPlace.style.display = ""; legendStart.style.display = "none"; legendEnd.style.display = "none";
      legendPlace.innerHTML = '<i class="hs-tag hs-tag-汉">汉</i>汉代奇闻　<i class="hs-tag hs-tag-唐">唐</i>唐代传奇';
    } else {
      // 聊斋夜世界：场景分布图，无起终点
      legendPlace.style.display = ""; legendStart.style.display = "none"; legendEnd.style.display = "none";
      legendPlace.innerHTML = '<i class="dot dot-place"></i>聊斋夜话';
    }
  }

  // 清理旧动画定时器
  routeTimers.forEach((t) => clearTimeout(t));
  routeTimers = [];

  // 隐藏所有路线
  routeLayerGroups.forEach((g, gi) => {
    g.line.setStyle({ opacity: 0 });
    if (g.line._path) g.line._path.removeAttribute("marker-mid");
    g.marks.forEach((m) => {
      m.setStyle({ fillOpacity: 0 });
      const tip = m.getTooltip && m.getTooltip();
      if (tip) tip.setOpacity(0);
    });
    g.arrows.forEach((a) => {
      if (a.getElement) { const el = a.getElement(); if (el) el.style.opacity = 0; }
    });
  });
  // 有路线展开时，隐藏全局"故里"地名点，只保留当前路线站点
  mapLayers.places.forEach((p) => {
    p.setStyle({ opacity: 0, fillOpacity: 0 });
    const tip = p.getTooltip && p.getTooltip();
    if (tip) tip.setOpacity(0);
  });

  // 对选中路线做SVG画线路动画
  const g = routeLayerGroups[ri];
  if (g) {
    const line = g.line;
    line.setStyle({ opacity: 1, weight: 4 });
    const pathEl = line._path;
    const duration = 3500;
    if (pathEl && pathEl.getTotalLength) {
      const len = pathEl.getTotalLength();
      pathEl.style.transition = 'none';
      pathEl.style.strokeDasharray = len;
      pathEl.style.strokeDashoffset = len;
      void pathEl.getBoundingClientRect();
      pathEl.style.transition = `stroke-dashoffset ${duration}ms linear`;
      pathEl.style.strokeDashoffset = '0';
      routeTimers.push(setTimeout(() => {
        pathEl.style.transition = '';
        pathEl.style.strokeDasharray = '10 6';
        pathEl.style.strokeDashoffset = '0';
      }, duration + 60));
    }
    // 途经点依次出现
    g.marks.forEach((m, i) => {
      const t = ((i + 1) / (g.marks.length + 1)) * duration;
      routeTimers.push(setTimeout(() => {
        m.setStyle({ fillOpacity: 1 });
        const tip = m.getTooltip && m.getTooltip();
        if (tip) tip.setOpacity(1);
      }, t));
    });
    // 方向箭头随画线路进度依次出现
    g.arrows.forEach((a, i) => {
      const t = ((i + 1.5) / (g.arrows.length + 1)) * duration;
      routeTimers.push(setTimeout(() => {
        if (a.getElement) { const el = a.getElement(); if (el) el.style.opacity = 1; }
      }, t));
    });
    // 视野切到当前路线范围
    if (g.line.getBounds && !g.line.getBounds().isValid()) {
      // 空路径保护
    } else if (g.line.getBounds) {
      map.fitBounds(g.line.getBounds(), { padding: [50, 50], maxZoom: 7 });
    }
  }

  const box = $("#route-detail");
  if (!box) return;
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="route-detail-head" style="border-left-color:#c0392b">
      <span class="route-detail-name">${esc(r.name)}</span>
      <span class="route-detail-year">${(r.points || []).length} ${r.unit || "站"}</span>
    </div>
    <ol class="route-detail-stops">
      ${(r.points || []).map((p) => `<li>
        <div class="stop-head"><b>${esc(p.name || "")}</b>${p.year ? `<span class="stop-year">${esc(p.year)}</span>` : ""}</div>
        ${p.event ? `<div class="stop-event">${esc(p.event)}</div>` : ""}
      </li>`).join("")}
    </ol>`;
  syncRouteButtons();
  // 古式示意图：切换路线后自动弹出该路线第一个热点的卡片明细
  // （昆仑之丘 / 长安 / 昆仑山 / 兰若寺 / 天台山）
  if (schematic) {
    const cfg = ROUTE_SCHEMATIC[ri];
    const first = cfg && cfg.hots && cfg.hots[0];
    if (first) {
      routeTimers.push(setTimeout(() => showSchematicDetail(first), 450));
    }
  }
}

/** 收起路线详情，隐藏所有路线线条 */
function hideRouteDetail() {
  activeRoute = null;
  const mapLeaf = document.getElementById("map-leaf");
  const schematicEl = document.getElementById("map-schematic");
  const mapWrap = document.querySelector(".map-wrap");
  if (initialSect === "myth") {
    // 神话舆图：没有真实地图，古式示意图常驻（只收起底部路线详情与卡片）
    if (mapLeaf) mapLeaf.style.display = "none";
    if (schematicEl) schematicEl.classList.remove("hidden");
    if (mapWrap) mapWrap.classList.add("schematic");
  } else {
    // 恢复真实地图
    if (window.__tileLayer) window.__tileLayer.setOpacity(1);
    if (mapLeaf) mapLeaf.style.display = "";
    if (schematicEl) schematicEl.classList.add("hidden");
    if (mapWrap) mapWrap.classList.remove("schematic");
  }
  // 移除示意图详情面板
  const oldDetail = document.querySelector(".sch-detail");
  if (oldDetail) oldDetail.remove();
  const box = $("#route-detail");
  if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
  routeLayerGroups.forEach((g) => {
    g.line.setStyle({ opacity: 0 });
    if (g.line._path) g.line._path.removeAttribute("marker-mid");
    g.marks.forEach((m) => {
      m.setStyle({ fillOpacity: 0 });
      const tip = m.getTooltip && m.getTooltip();
      if (tip) tip.setOpacity(0);
    });
    g.arrows.forEach((a) => {
      if (a.getElement) { const el = a.getElement(); if (el) el.style.opacity = 0; }
    });
  });
  // 无路线展开时，恢复全局"故里"地名点
  mapLayers.places.forEach((p) => {
    p.setStyle({ opacity: 1, fillOpacity: 0.95 });
    const tip = p.getTooltip && p.getTooltip();
    if (tip) tip.setOpacity(1);
  });
  syncRouteButtons();
}

/**
 * 只对「真正的线/面图层」设置样式。
 * 注意别对 tooltip 调 setStyle —— L.tooltip 没有该方法，一调就抛异常中断整个渲染。
 */
function setRouteStyles(hiIndex = -1, hiStyle = null) {
  let pi = 0;
  mapLayers.routes.forEach((l) => {
    const isLine = l instanceof L.Polyline && !(l instanceof L.Polygon);
    if (!isLine || typeof l.setStyle !== 'function') return;
    const isHi = pi === hiIndex;
    l.setStyle(hiStyle && isHi ? hiStyle : { opacity: 0.55, weight: 3, dashArray: "6 6" });
    pi++;
  });
}

/** 让当前展开的路线按钮呈选中态 */
function syncRouteButtons() {
  const box = $("#map-route-btns");
  if (!box) return;
  const routes = bookData.routes || [];
  [...box.children].forEach((b, i) => {
    b.classList.toggle("on", i === activeRoute);
    b.textContent = `${routes[i].name}（${(routes[i].points || []).length} ${routes[i].unit || "站"}）`;
  });
}

// 切换 tab
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    currentPage = t.dataset.page;
    document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
    $("#page-" + currentPage).classList.remove("hidden");
    currentEra = "all";
    currentBook = "all";
    renderEraSwitch();
    renderBookFilter();
    renderSect();
    // 进入地图页：容器由 display:none 变可见，必须让 Leaflet 重新量尺寸，
    // 否则地图显示为空白（尺寸停在 0）。
    if (currentPage === "map") {
      if (initialSect === "myth") {
        // 神话舆图：全部为古式示意图，无真实 Leaflet 地图。
        // 先渲染 5 条路线胶囊（renderMapData 在神话页被守卫跳过，需在此显式渲染），
        // 再默认展开「山海经·想象世界」，由 toggleRoute 自动弹出昆仑之丘卡片。
        const mapLeaf = document.getElementById("map-leaf");
        if (mapLeaf) mapLeaf.style.display = "none";
        const schematicEl = document.getElementById("map-schematic");
        if (schematicEl) schematicEl.classList.remove("hidden");
        const mapWrap = document.querySelector(".map-wrap");
        if (mapWrap) mapWrap.classList.add("schematic");
        renderRouteButtons(bookData.routes || []);
        if (activeRoute !== 0) {
          setTimeout(() => {
            activeRoute = -1;
            toggleRoute(0);
          }, 300);
        }
      } else {
        ensureLeaflet().then(() => {
          initMap();
          refreshMapWhenVisible();
          // 诗词鉴赏/思想源流等真实 Leaflet 路线默认展开第一条路线（如苏轼贬谪路线），不弹卡片。
          const firstRoute = (bookData.routes || [])[0];
          if (firstRoute && !firstRoute.schematic) {
            setTimeout(() => {
              if (activeRoute !== 0) toggleRoute(0);
            }, 400);
          }
        }).catch((e) => console.error(e));
      }
    }
  });
});

// 切换流派
document.querySelectorAll(".sect-btn").forEach(b => {
  b.addEventListener("click", () => loadSect(b.dataset.s));
});

// 支持按钮：hover 展开（入口位于主站侧栏底部；单独打开本页时也有同一入口）
const supportBtn = $("#support-btn");
const supportPop = $("#support-pop");
if (supportBtn && supportPop) {
  let supportTimer = null;
  const showSupport = () => { clearTimeout(supportTimer); supportPop.classList.remove("hidden"); };
  const hideSupport = () => { supportPop.classList.add("hidden"); };
  supportBtn.addEventListener("mouseenter", showSupport);
  supportPop.addEventListener("mouseenter", showSupport);
  supportBtn.addEventListener("mouseleave", () => { supportTimer = setTimeout(hideSupport, 600); });
  supportPop.addEventListener("mouseleave", () => { supportTimer = setTimeout(hideSupport, 600); });
  const closeBtn = $("#support-close");
  if (closeBtn) closeBtn.addEventListener("click", hideSupport);
}

// 器物图谱：点击图片放大（轻量 lightbox）
document.addEventListener("click", (e) => {
  const box = e.target.closest(".artifact-img[data-full]");
  if (!box) return;
  const src = box.dataset.full;
  const lb = document.createElement("div");
  lb.className = "artifact-lightbox";
  lb.innerHTML = `<img src="${src}" alt=""/><span class="lb-close">×</span>`;
  lb.addEventListener("click", () => lb.remove());
  document.body.appendChild(lb);
});

// ---------- URL query 深链路由（供 MCP / 外部 AI 直接定位到具体卡片） ----------
// 支持参数：
//   ?sect=rujia|daojia|...（仅思想页）
//   &tab=books|cases|artifacts|map|quiz
//   &cat=<分类胶囊 id>   &book=<书 id>   &name=<器物/神兽名>
//   &case=<案件 id>
//   &route=<路线序号>    &hotspot=<神话热点名>
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, tries = 30, gap = 60) {
  for (let i = 0; i < tries; i++) {
    try { if (fn()) return true; } catch (e) { /* 继续等 */ }
    await sleep(gap);
  }
  try { return !!fn(); } catch (e) { return false; }
}
async function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  // 1. 思想页先切宗派
  const sect = params.get("sect");
  if (sect && sect !== currentSect && SECT_META[sect]) {
    await loadSect(sect);
  }
  // 2. 切 tab
  const tab = params.get("tab");
  if (tab) {
    const tabBtn = document.querySelector(`.tab[data-page="${tab}"]`);
    if (tabBtn) tabBtn.click();
  }
  // 3. 分类胶囊（books / artifacts / 神话 map 的路线联动）
  const cat = params.get("cat");
  if (cat) {
    await waitFor(() => document.querySelector(`.sect-btn[data-era="${cat}"]`));
    const btn = document.querySelector(`.sect-btn[data-era="${cat}"]`);
    if (btn) btn.click();
  }
  // 4. 典籍卡片：打开指定书
  const bookId = params.get("book");
  if (tab === "books" && bookId) {
    const ok = await waitFor(() => document.querySelector(`#books-scroll .book-card[data-id="${bookId}"]`));
    if (ok) document.querySelector(`#books-scroll .book-card[data-id="${bookId}"]`).click();
  }
  // 5. 图鉴：打开指定器物/神兽（lightbox 放大）
  const artName = params.get("name");
  if (tab === "artifacts" && artName) {
    const ok = await waitFor(() => {
      const grid = document.getElementById("artifacts-grid");
      return grid && [...grid.querySelectorAll("img")].some((im) => im.alt === artName);
    });
    if (ok) {
      const im = [...document.querySelectorAll("#artifacts-grid img")].find((x) => x.alt === artName);
      const cell = im && im.closest(".artifact-img");
      if (cell) { cell.scrollIntoView({ block: "center", behavior: "instant" }); cell.click(); }
    }
  }
  // 6. 公案：切到对应分类并高亮定位
  const caseId = params.get("case");
  if (tab === "cases" && caseId) {
    const found = (bookData.cases || []).find((c) => c.id === caseId);
    if (found && found.category) {
      activeCaseCat = found.category;
      renderCases();
    }
    const ok = await waitFor(() => document.querySelector(`.case-card[data-id="${caseId}"]`));
    if (ok) {
      const el = document.querySelector(`.case-card[data-id="${caseId}"]`);
      el.scrollIntoView({ block: "start", behavior: "instant" });
      el.style.outline = "2px solid #b03a2e";
      setTimeout(() => { el.style.outline = ""; }, 3000);
    }
  }
  // 7. 舆图：神话示意图热点 / 其他板块真实地图路线
  const routeRaw = params.get("route");
  const hotspot = params.get("hotspot");
  if (tab === "map" && routeRaw !== null) {
    const ri = parseInt(routeRaw, 10);
    if (initialSect === "myth") {
      // 切 tab 时默认会在 300ms 后打开路线0；等它渲染完
      const btnsReady = await waitFor(() => document.querySelectorAll("#map-route-btns .route-btn").length);
      if (!btnsReady) return;
      const openHotspot = () => {
        if (!hotspot) return;
        const cfg = ROUTE_SCHEMATIC[ri] || ROUTE_SCHEMATIC[0];
        const h = (cfg.hots || []).find((x) => x.name === hotspot);
        if (h) showSchematicDetail(h);
      };
      if (ri === 0) {
        // 默认 toggleRoute(0) 在 300ms 后触发，其内部 450ms 后自动弹首点卡片；
        // 指定热点必须排在那之后再覆盖弹出
        await waitFor(() => activeRoute === 0);
        setTimeout(openHotspot, 900);
      } else {
        await sleep(360);
        toggleRoute(ri);
        setTimeout(openHotspot, 900);
      }
    } else {
      // Leaflet 真实地图：切 tab 后默认 400ms 打开路线0
      await waitFor(() => document.querySelectorAll("#map-route-btns .route-btn").length);
      if (!Number.isNaN(ri)) {
        await sleep(500);
        if (activeRoute !== ri) toggleRoute(ri);
      }
    }
  }
}

// 启动
loadSect(currentSect).then(() => applyDeepLink()).catch(() => {});

// 测试钩子（生产无害）：供自动化检查直接驱动地图渲染
window.__guoxueMapTest = {
  renderMapData, toggleRoute, hideRouteDetail, initMap, refreshMapWhenVisible,
  get map() { return map; },
  get mapLayers() { return mapLayers; },
  get bookData() { return bookData; },
  get activeRoute() { return activeRoute; },
  loadSect,
};
