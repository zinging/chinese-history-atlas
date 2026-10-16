// 国学图谱 · app.js
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
const DATA_VER = "v99";

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
}

const $ = (sel) => document.querySelector(sel);

async function loadSect(sect) {
  currentSect = sect;
  currentEra = "all";
  document.querySelectorAll(".sect-btn").forEach(b => b.classList.toggle("active", b.dataset.s === sect));

  // "全部"视图：加载五个流派的书籍并合并
  if (sect === 'all') {
    if (SECT_CACHE['all']) {
      bookData = SECT_CACHE['all'];
      renderSect();
      return;
    }
    const sects = ['rujia','daojia','foxue','zhuzi','lixue'];
    const allBooks = [];
    for (const s of sects) {
      try {
        const meta = SECT_META[s];
        const r = await fetch(`../../data/${meta.data}/index.json?v=${DATA_VER}`);
        if (r.ok) {
          const d = await r.json();
          const books = d.books || [];
          books.forEach(b => { b._sect = s; b._sectName = meta.name; });
          allBooks.push(...books);
        }
      } catch(e) { /* 跳过 */ }
    }
    bookData = { books: allBooks, cases: [], places: [], routes: [], quiz: [] };
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
  // 人生时间线（诗文卡片）；格物致知改用"章节介绍"自上而下列篇目
  if (currentSect === "gewu" && b.outline && b.outline.length) {
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
      html += b.funFacts.map(f => `<div class="funfact">${f.fact}</div>`).join("");
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
  tabsEl.innerHTML = cats.map(cat => {
    const n = cases.filter(c => c.category === cat.id).length;
    return `<button class="case-tab${cat.id === activeCaseCat ? ' active' : ''}" data-cat="${cat.id}">${cat.name}<span class="case-tab-n">${n}</span></button>`;
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

/** 器物图谱（百工图鉴）：按书分组，书为容器，器物为子卡 */
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
    } catch (e) {
      grid.innerHTML = `<div class="lazy-error">图鉴加载失败，请稍后重试。</div>`;
      return;
    }
  }
  const all = bookData.artifacts || [];
  const list = currentEra === "all" ? all : all.filter((x) => x.cat === currentEra);
  if (!list.length) {
    grid.innerHTML = `<div style="color:var(--muted);padding:30px;">该分类的器物图鉴整理中…</div>`;
    return;
  }
  const catColor = {
    "工艺营造": "#8b5a2b", "医药本草": "#4a7c59", "农书": "#a8893c",
    "算历": "#3d5a80", "地理博物": "#6b8e6b", "生活艺术": "#9c5a5a",
  };
  // 按书分组（cat字段=书名），书顺序与 books 一致
  const bookOrder = (bookData.books || []).map((b) => b.name);
  const groups = {};
  for (const a of list) {
    (groups[a.cat] = groups[a.cat] || []).push(a);
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
        ${a.image ? `<div class="artifact-img" data-full="${esc(a.image)}"><img src="${esc(a.image)}" alt="${esc(a.name)}" loading="lazy"/></div>` : ""}
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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 12,
      // 瓦片加载失败时给一句提示，图层功能仍可用
      errorTileUrl: "",
    }).addTo(map);
  }
  renderMapData();
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
    renderMapData();
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

  // 路线：线 + 起终点常显标签（与帝王谱系图例同款配色）
  routes.forEach((r, ri) => {
    const pts = r.points || [];
    if (pts.length < 2) return;
    const line = L.polyline(pts.map((p) => [p.lat, p.lng]), {
      color: "#c0392b", weight: 3, opacity: 0.55, dashArray: "6 6",
    }).addTo(map);
    mapLayers.routes.push(line);

    const start = pts[0], end = pts[pts.length - 1];
    [[start, "route-start"], [end, "route-end"]].forEach(([pt, cls]) => {
      const m = L.circleMarker([pt.lat, pt.lng], {
        radius: 6, color: "#fff", weight: 2,
        fillColor: cls === "route-start" ? "#2e7d32" : "#a0251c", fillOpacity: 1,
      }).addTo(map);
      m.bindTooltip(
        `<span class="route-pt-tip">${esc(pt.name || "")}</span>`,
        { direction: cls === "route-start" ? "top" : "bottom", offset: [0, 8], permanent: true, className: "map-route-tip" }
      );
      mapLayers.routes.push(m);
    });
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

/** 展开/收起一条路线：展示途经点，并高亮对应线条 */
function toggleRoute(ri) {
  const routes = bookData.routes || [];
  const r = routes[ri];
  if (!r) return;
  if (activeRoute === ri) { hideRouteDetail(); return; }
  activeRoute = ri;

  // 仅当前路线加粗高亮，其余恢复默认淡线
  setRouteStyles(ri, { opacity: 1, weight: 5, dashArray: null });

  const box = $("#route-detail");
  if (!box) return;
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="route-detail-head" style="border-left-color:#c0392b">
      <span class="route-detail-name">${esc(r.name)}</span>
      <span class="route-detail-year">${(r.points || []).length} 站</span>
    </div>
    <ol class="route-detail-stops">
      ${(r.points || []).map((p, i) => `<li><b>${i + 1}. ${esc(p.name || "")}</b></li>`).join("")}
    </ol>`;
  syncRouteButtons();
}

/** 收起路线详情，恢复所有线条默认样式 */
function hideRouteDetail() {
  activeRoute = null;
  const box = $("#route-detail");
  if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
  setRouteStyles();
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
    renderEraSwitch();
    renderSect();
    // 进入地图页：容器由 display:none 变可见，必须让 Leaflet 重新量尺寸，
    // 否则地图显示为空白（尺寸停在 0）。
    if (currentPage === "map") {
      ensureLeaflet().then(() => {
        initMap();
        refreshMapWhenVisible();
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
