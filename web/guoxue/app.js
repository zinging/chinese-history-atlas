// 国学图谱 · app.js
const SECT_META = {
  rujia:   { name: "儒家", intro: "中国人的底层操作系统。从孔子开始，讲的是人和人怎么相处、怎么做人、怎么治国。", data: "rujia" },
  daojia:  { name: "道家", intro: "中国人的退路。老子讲「无为」，庄子讲「逍遥」——当儒家让你扛不动的时候，道家告诉你可以放下。", data: "daojia" },
  foxue:   { name: "佛学", intro: "从印度来，但在中国长成了自己的样子。禅宗更是中国特产——不立文字，直指人心。", data: "foxue" },
  zhuzi:   { name: "诸子", intro: "百家争鸣时期的各种「解决方案」：墨子兼爱非攻、韩非子法治、孙子兵法、鬼谷子纵横。", data: "zhuzi" },
  lixue:   { name: "理学心学", intro: "宋明知识分子把儒释道捏成一套。朱熹讲「存天理」，王阳明讲「致良知」。", data: "lixue" },
  shiwen:  { name: "诗文", intro: "中国人的审美和情绪出口。诗词不是用来背的，是一个人在某个处境下写的一句话。", data: "shiwen" },
};

let currentSect = "daojia";
let currentPage = "books";
let currentEra = "all";
let bookData = {};
let map = null;

const ERAS = ["先秦", "汉魏", "唐", "五代两宋", "明清"];

const $ = (sel) => document.querySelector(sel);

async function loadSect(sect) {
  currentSect = sect;
  currentEra = "all";
  document.querySelectorAll(".sect-btn").forEach(b => b.classList.toggle("active", b.dataset.s === sect));
  const meta = SECT_META[sect];
  try {
    const r = await fetch(`/data/${meta.data}/index.json?v=v56`, { cache: 'no-store' });
    bookData = await r.json();
  } catch (e) {
    bookData = { books: [], cases: [], places: [], routes: [], quiz: [] };
  }
  activeCaseCat = null;
  renderBooks();
  renderCases();
  renderQuiz();
  initMap();
}

function renderBooks() {
  const wrap = $("#books-scroll");
  let books = bookData.books || [];

  // 诗文：按朝代筛选
  const eraBar = $("#era-filter");
  if (currentSect === "shiwen" && books.some(b => b.era)) {
    eraBar.classList.remove("hidden");
    eraBar.innerHTML = `<button class="era-btn ${currentEra === "all" ? "active" : ""}" data-era="all">全部</button>` +
      ERAS.map(e => `<button class="era-btn ${currentEra === e ? "active" : ""}" data-era="${e}">${e}</button>`).join("");
    eraBar.querySelectorAll(".era-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        currentEra = btn.dataset.era;
        renderBooks();
      });
    });
    if (currentEra !== "all") books = books.filter(b => b.era === currentEra);
  } else {
    eraBar.classList.add("hidden");
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
      ${b.portrait ? `<div class="portrait"><img src="/data/portraits/${b.portrait}" alt="${b.person || b.name}"></div>` : `<div class="icon">${b.icon || "📖"}</div>`}
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
      renderBookDetail(books[+card.dataset.i]);
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
    renderBookDetail(books[0]);
  }
}

function renderBookDetail(b) {
  const el = $("#book-detail");
  el.classList.remove("hidden");
  const portraitHtml = b.portrait
    ? `<img class="detail-portrait" src="/data/portraits/${b.portrait}" alt="${b.person || b.name}">`
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
  // 人生时间线（诗文卡片）
  if (b.timeline && b.timeline.length) {
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
function renderCases() {
  const list = $("#cases-list");
  const tabsEl = $("#case-tabs");
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

function renderQuiz() {
  const list = $("#quiz-list");
  const quiz = bookData.quiz || [];
  if (!quiz.length) {
    list.innerHTML = `<div style="color:var(--muted);padding:30px;">该流派题目整理中…</div>`;
    return;
  }
  list.innerHTML = quiz.map((q, i) => `
    <div class="quiz-card" data-i="${i}">
      <div class="q">${q.q}</div>
      <div class="opts">
        ${q.opts.map((o, j) => `<button class="opt" data-r="${j}">${o}</button>`).join("")}
      </div>
      <div class="explain">${q.explain || ""}</div>
    </div>
  `).join("");
  list.querySelectorAll(".quiz-card").forEach(card => {
    const q = quiz[+card.dataset.i];
    card.querySelectorAll(".opt").forEach(btn => {
      btn.addEventListener("click", () => {
        card.querySelectorAll(".opt").forEach(b => b.disabled = true);
        const r = +btn.dataset.r;
        if (r === q.answer) btn.classList.add("correct");
        else {
          btn.classList.add("wrong");
          card.querySelectorAll(".opt")[q.answer].classList.add("correct");
        }
        card.querySelector(".explain").classList.add("show");
      });
    });
  });
}

function initMap() {
  const container = $("#map-leaf");
  if (!map) {
    map = L.map(container).setView([34.5, 108.9], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap", maxZoom: 12
    }).addTo(map);
  }
  // 清旧 marker
  if (window.__markers) window.__markers.forEach(m => map.removeLayer(m));
  window.__markers = [];
  const places = bookData.places || [];
  places.forEach(p => {
    const mk = L.marker([p.lat, p.lng]).addTo(map);
    mk.bindPopup(`<b>${p.name}</b><br>${p.note || ""}`);
    window.__markers.push(mk);
  });
  // 路线
  (bookData.routes || []).forEach(r => {
    const latlngs = r.points.map(p => [p.lat, p.lng]);
    L.polyline(latlngs, { color: "#c0392b", weight: 3 }).addTo(map);
    window.__markers.push(L.polyline(latlngs, { color: "#c0392b", weight: 3 }));
  });
  if (places.length) {
    map.setView([places[0].lat, places[0].lng], 6);
  }
}

// 切换 tab
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    currentPage = t.dataset.page;
    document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
    $("#page-" + currentPage).classList.remove("hidden");
    if (currentPage === "map" && map) setTimeout(() => map.invalidateSize(), 50);
  });
});

// 切换流派
document.querySelectorAll(".sect-btn").forEach(b => {
  b.addEventListener("click", () => loadSect(b.dataset.s));
});

// 支持按钮
$("#support-btn").addEventListener("click", () => $("#support-pop").classList.toggle("hidden"));
$("#support-close").addEventListener("click", () => $("#support-pop").classList.add("hidden"));

// 启动
loadSect(currentSect);
