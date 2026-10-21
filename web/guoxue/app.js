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
const DATA_VER = "v117";

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
    <div class="book-card" data-i="${i}">
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
    <article class="case-card">
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
    b.textContent = `${r.name}（${n} 站）`;
    b.addEventListener("click", () => toggleRoute(ri));
    box.appendChild(b);
  });
  box.classList.toggle("hidden", routes.length === 0);
}

// 山海经示意图热点：严格按原著方位——昆仑居中，南山经在南（下），西山经在西（左），北山经在北（上），海外东经在东（右）
const SCHEMATIC_HOTS = [
  { x: 50, y: 45, name: "昆仑之丘", img: "kunlun.jpg", desc: "众神上下之都，西王母所居。《西山经》：『昆仑之丘，是实惟帝之下都，神陆吾司之。』西王母蓬发戴胜，虎齿豹尾，三青鸟为之取食。" },
  { x: 50, y: 78, name: "青丘山", img: "qingqiu.jpg", desc: "《南山经》：『青丘之山，其阳多玉，其阴多青雘。有兽焉，其状如狐而九尾，其音如婴儿，能食人，食者不蛊。』" },
  { x: 30, y: 40, name: "不周山", img: "buzhou.jpg", desc: "《西山经》：『不周之山，北望诸毗之山，临彼岳崇之山，东望泑泽，河水所潜也。』共工怒触不周山，天柱折，地维绝。" },
  { x: 38, y: 22, name: "发鸠山", img: "jingwei.jpg", desc: "《北山经》：『发鸠之山，其上多柘木。有鸟焉，其状如乌，文首、白喙、赤足，名曰精卫，其鸣自詨。』炎帝少女女娃溺于东海，化为精卫，衔木石以填海。" },
  { x: 25, y: 55, name: "姑射山", img: "gushe.jpg", desc: "《庄子·逍遥游》：『藐姑射之山，有神人居焉，肌肤若冰雪，绰约若处子，不食五谷，吸风饮露，乘云气，御飞龙，而游乎四海之外。』" },
  { x: 55, y: 18, name: "钟山·烛龙", img: "zhulong.jpg", desc: "《大荒北经》：『钟山之神，名曰烛阴，视为昼，瞑为夜，吹为冬，呼为夏，不饮，不食，不息，息为风。人面蛇身，赤色。』" },
  { x: 35, y: 12, name: "一目国", img: "yimu.jpg", desc: "《海外北经》：『一目国在其东，一目而中面。』其人只有一只眼睛，长在面部正中央。" },
  { x: 22, y: 25, name: "无肠国", img: "wuchang.jpg", desc: "《海外北经》：『无肠国在其东，其为人长，无肠。』腹内无肠，食物直通。" },
  { x: 12, y: 35, name: "奇肱国", img: "jigong.jpg", desc: "《海外西经》：『奇肱之国在其北，其人一臂三目，有阴有阳，乘文马。』其人善为机巧，能为飞车，从风远行。" },
  { x: 15, y: 18, name: "羽民国", img: "yumin.jpg", desc: "《海外南经》：『羽民国在其东南，其为人长头，身生羽。』身生羽翼，能飞翔不远。" },
  { x: 18, y: 50, name: "大人国", img: "daren.jpg", desc: "《海外东经》：『大人国在其北，为人大，坐而削船。』其人长大，孕三十六年而生。" },
  { x: 20, y: 85, name: "贯胸国", img: "guanxiong.jpg", desc: "《海外南经》：『贯胸国在其东，其为人胸有窍。』胸前贯通一孔。" },
  { x: 35, y: 90, name: "交胫国", img: "jiaojing.jpg", desc: "《海外南经》：『交胫国在其东，其为人交胫。』两脚交叉而行。" },
  { x: 50, y: 92, name: "不死民", img: "busi.jpg", desc: "《海外南经》：『不死民在其东，其为人黑色，寿，不死。』肤色乌黑，长生不死。" },
  { x: 65, y: 88, name: "三首国", img: "sanshou.jpg", desc: "《海外南经》：『三首国在其东，其为人一身三首。』一身而三首。" },
  { x: 80, y: 85, name: "长臂国", img: "changbi.jpg", desc: "《海外南经》：『长臂国在其东，长臂三尺，捕鱼水中，两手各操一鱼。』其人手下垂至地。" },
  { x: 88, y: 30, name: "黑齿国", img: "heichi.jpg", desc: "《海外东经》：『黑齿国在其北，为人黑齿，食稻啖蛇。』其人黑齿。" },
  { x: 82, y: 65, name: "君子国", img: "junzi.jpg", desc: "《海外东经》：『君子国在其北，衣冠带剑，食兽，使二文虎在旁，其人好让不争。』" },
  { x: 92, y: 45, name: "蓬莱仙岛", img: "penglai.jpg", desc: "《列子·汤问》：『勃海之东有大壑焉，其中有五山：一曰岱舆，二曰员峤，三曰方壶，四曰瀛洲，五曰蓬莱。』仙圣所居。" },
  { x: 70, y: 78, name: "女儿国", img: "nverguo.jpg", desc: "《山海经·大荒西经》：『有女子之国。』女子国在巫咸北，两女子居，水周之。" },
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
      { x: 92.5, y: 46, name: "长安", img: "", desc: "玄奘出发，唐太宗赐号三藏，出关西行。贞观十三年。" },
      { x: 85.5, y: 15, name: "两界山", img: "", desc: "刘伯钦送唐僧至此，五行山下压着孙悟空，贴'唵嘛呢叭咪吽'揭帖，悟空脱困拜师父。第一难。" },
      { x: 71.5, y: 39, name: "鹰愁涧", img: "", desc: "涧中白龙吞了白马，观音点化白龙为唐僧脚力，即白龙马。第二难。" },
      { x: 67, y: 25, name: "观音禅院", img: "", desc: "老住持贪锦襕袈裟，纵火欲烧唐僧，广智广谋反害己命。黑熊怪趁乱窃袈裟。" },
      { x: 61, y: 62, name: "高老庄", img: "", desc: "收服猪八戒，原为天蓬元帅，调戏嫦娥被贬下凡。" },
      { x: 71, y: 65, name: "流沙河", img: "", desc: "八百流沙界，弱水三千。收服沙悟净，原为卷帘大将。" },
      { x: 61.5, y: 32, name: "白虎岭", img: "", desc: "白骨夫人三变（村姑、老妇、老翁），孙悟空三打白骨精，被唐僧逐走。" },
      { x: 45, y: 27, name: "乌鸡国", img: "", desc: "全真道人推国王入井，冒充国王三年。文殊菩萨青狮精作祟。" },
      { x: 41, y: 38, name: "火云洞", img: "", desc: "红孩儿三昧真火，观音收为善财童子。" },
      { x: 37, y: 26, name: "车迟国", img: "", desc: "虎力、鹿力、羊力三妖道惑君，悟空斗法砍头、剖腹、滚油。" },
      { x: 33.5, y: 38, name: "通天河", img: "", desc: "灵感大王每年要吃童男童女，观音竹篮收妖。老鼋驮师徒过河。" },
      { x: 26, y: 60, name: "女儿国", img: "nverguo.jpg", desc: "西梁女国，国王愿以一国为聘，留唐僧为王。蝎子精摄走唐僧。" },
      { x: 47, y: 38, name: "火焰山", img: "", desc: "八百里火焰，需借芭蕉扇。三借芭蕉扇，降伏牛魔王与铁扇公主。" },
      { x: 25, y: 23, name: "小雷音", img: "", desc: "黄眉大王假设雷音寺，诱师徒拜他，困悟空于金铙。" },
      { x: 18, y: 36, name: "狮驼岭", img: "", desc: "青狮、白象、大鹏三魔，四万八千小妖，悟空钻肚降妖。" },
      { x: 22, y: 26, name: "比丘国", img: "", desc: "国丈南极仙翁白鹿精，要一千一百一十一个小儿心肝做药引。" },
      { x: 12.5, y: 23, name: "灵山", img: "", desc: "灵鹫峰雷音寺，拜见如来，取真经五千零四十八卷，成佛。贞观二十七年。" },
    ],
  },
  {
    bg: "fengshen-map.jpg",
    hots: [
      { x: 13, y: 13, name: "昆仑山", img: "", desc: "元始天尊道场，阐教发源地。姜子牙于玉虚宫修道四十年，受封神榜下山辅周。" },
      { x: 9, y: 38, name: "西岐", img: "", desc: "武王起兵之地，姜子牙金台拜帅，周营大本营，六十万大军自此东进。" },
      { x: 7, y: 62, name: "渭水", img: "", desc: "姜太公垂钓于渭水磻溪，直钩钓于石上，愿者上钩。文王出猎相遇，拜为丞相。" },
      { x: 28, y: 44, name: "金鸡岭", img: "", desc: "孔宣兵阻金鸡岭，五色神光无人能敌。准提道人东来，收孔宣为孔雀大明王。" },
      { x: 39, y: 46, name: "汜水关", img: "", desc: "五关之首，总兵韩荣把守，余化化血神刀连伤周将。哪吒、杨戬破关，余化授首。" },
      { x: 46, y: 42, name: "界牌关", img: "", desc: "通天教主命多宝道人于界牌关下摆诛仙阵，四口仙剑诛戮陷绝。老子、元始、接引、准提四圣会破。" },
      { x: 54, y: 41, name: "穿云关", img: "", desc: "总兵徐芳死守，瘟神吕岳布瘟㾮阵，周营染疫几尽。杨任持五火神焰扇下山破阵。" },
      { x: 62, y: 33, name: "潼关", img: "", desc: "总兵余化龙父子把守，余德撒五斗毒痘，周营六十万人染天花。杨戬往火云洞求神农丹药得愈。" },
      { x: 71, y: 33, name: "临潼关", img: "", desc: "潼关外通天教主再起万仙阵，四大天尊齐会破阵。总兵欧阳淳以幽魂白骨幡阻兵，邓昆、芮吉归周破关。" },
      { x: 43, y: 70, name: "渑池县", img: "", desc: "守将张奎地行术，高兰英太阳神针。黄飞虎等五岳归天，土行孙、邓婵玉殒命。指地成钢，张奎授首。" },
      { x: 76, y: 71, name: "孟津", img: "", desc: "黄河渡口，八百诸侯会盟。武王渡河，白鱼跃入王舟。梅山七怪袁洪、邬文化夜袭，终被收服。" },
      { x: 86, y: 54, name: "牧野", img: "", desc: "甲子日誓师牧野，武王列纣王十大罪。商军前徒倒戈，血流漂杵，十七万商军土崩瓦解。" },
      { x: 90, y: 22, name: "朝歌", img: "", desc: "商纣都城。纣王登鹿台，身衣珠玉自焚而死，六百年殷商遂亡。妲己被斩。" },
      { x: 12, y: 82, name: "封神台", img: "", desc: "姜子牙归岐山封神台，张挂封神榜，封三百六十五位正神，周天列宿各归其位。" },
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
    dot.innerHTML = `<span class="hs-label">${h.name}</span>`;
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
    ${h.img ? `<img src="../../data/portraits/myth-map/${h.img}" alt="${h.name}">` : ""}
    <h4>${h.name}</h4>
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
    } else {
      legendPlace.style.display = "none"; legendStart.style.display = ""; legendEnd.style.display = "";
      legendStart.innerHTML = '<i class="dot dot-route-start"></i>伐纣起点';
      legendEnd.innerHTML = '<i class="dot dot-route-end"></i>封神台';
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
      <span class="route-detail-year">${(r.points || []).length} 站</span>
    </div>
    <ol class="route-detail-stops">
      ${(r.points || []).map((p) => `<li>
        <div class="stop-head"><b>${esc(p.name || "")}</b>${p.year ? `<span class="stop-year">${esc(p.year)}</span>` : ""}</div>
        ${p.event ? `<div class="stop-event">${esc(p.event)}</div>` : ""}
      </li>`).join("")}
    </ol>`;
  syncRouteButtons();
}

/** 收起路线详情，隐藏所有路线线条 */
function hideRouteDetail() {
  activeRoute = null;
  // 恢复真实地图
  if (window.__tileLayer) window.__tileLayer.setOpacity(1);
  const mapLeaf = document.getElementById("map-leaf");
  const schematicEl = document.getElementById("map-schematic");
  if (mapLeaf) mapLeaf.style.display = "";
  if (schematicEl) schematicEl.classList.add("hidden");
  const mapWrap = document.querySelector(".map-wrap");
  if (mapWrap) mapWrap.classList.remove("schematic");
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
    b.textContent = `${routes[i].name}（${(routes[i].points || []).length} 站）`;
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
      ensureLeaflet().then(() => {
        initMap();
        refreshMapWhenVisible();
        // 仅「神话异志」的路线是示意图（schematic）：默认打开山海经并弹出昆仑之丘卡片。
        // 诗词鉴赏/思想源流等真实 Leaflet 路线默认展开第一条路线（如苏轼贬谪路线），不弹卡片。
        const firstRoute = (bookData.routes || [])[0];
        if (firstRoute && firstRoute.schematic) {
          setTimeout(() => {
            activeRoute = -1;
            toggleRoute(0);
            setTimeout(() => {
              const kunlun = (ROUTE_SCHEMATIC[0].hots || []).find(h => h.name.indexOf("昆仑") >= 0);
              if (kunlun) showSchematicDetail(kunlun);
            }, 600);
          }, 400);
        } else if (firstRoute) {
          setTimeout(() => {
            if (activeRoute !== 0) toggleRoute(0);
          }, 400);
        }
      }).catch((e) => console.error(e));
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

// 启动
loadSect(currentSect);

// 测试钩子（生产无害）：供自动化检查直接驱动地图渲染
window.__guoxueMapTest = {
  renderMapData, toggleRoute, hideRouteDetail, initMap, refreshMapWhenVisible,
  get map() { return map; },
  get mapLayers() { return mapLayers; },
  get bookData() { return bookData; },
  get activeRoute() { return activeRoute; },
  loadSect,
};
