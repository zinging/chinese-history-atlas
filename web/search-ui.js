/*
 * 中华历史图谱 · 全站搜索（壳层组件）
 *
 * 交互：右上角一枚放大镜圆钮 → 鼠标悬停 120ms 后横向展开成输入框（点击/聚焦则锁定展开）；
 *      输入即出「词条」与「正文命中」两组结果；↑↓/Enter/Esc 可用；点结果跳到对应页面并落到那一行。
 *
 * 为什么放在壳层（#app 之上，position: fixed）而不是 .topbar：
 *   顶部 header 只在「帝王谱系」内联面板里存在，切到 iframe 板块就整块消失；
 *   搜索是跨模块的入口，只能挂在壳层，且 fixed 定位不占布局 —— 桌面六档几何天然 0 差异。
 *
 * 数据：data/search/title.json（词条级，首次展开才拉）+ data/search/body-<module>.json（正文级，按需拉）。
 * 二者都由 scripts/build-search.mjs 从 MCP 的 data/search-index.json 派生，切句规则来自 web/split.js。
 */
(function () {
  "use strict";

  var BASE = "../data/search/";
  var DEBOUNCE_MS = 220;
  var MAX_SCAN = 500;         // 结果上限（防止超大 query 命中全站）
  var GROUP_DEFAULT = 6;      // 每组默认展示条数

  var TYPE_BOOST = {
    '地图事件': 6, '皇帝': 5, '悬案': 4, '典籍': 4, '公案': 4, '问典': 3, '热点': 3,
    '生平事件': 5, '百家纪事': 5, '神兽': 2, '器物': 2, '路线': 2,
  };
  var TYPE_LABEL = {
    emperor: '帝王', case: '悬案', popup: '舆图事件', route: '路线', stop: '地点',
    chapter: '典籍', lightbox: '图鉴', quiz: '问典',
  };

  function norm(s) {
    return String(s == null ? "" : s).toLowerCase()
      .replace(/[\s·・《》「」『』“”"'()（）]/g, "");
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** 把命中词标成 <mark>：只用文本节点拼接，绝不 innerHTML（数据里有「」《》，也有尖括号风险） */
  function markInto(parent, text, q) {
    var raw = String(text || "");
    var qq = String(q || "");
    if (!qq) { parent.appendChild(document.createTextNode(raw)); return; }
    var lower = raw.toLowerCase(), lq = qq.toLowerCase(), from = 0, at;
    while ((at = lower.indexOf(lq, from)) >= 0) {
      if (at > from) parent.appendChild(document.createTextNode(raw.slice(from, at)));
      var m = el("mark", "as-mark", raw.slice(at, at + qq.length));
      parent.appendChild(m);
      from = at + qq.length;
      if (from >= raw.length) break;
    }
    if (from < raw.length) parent.appendChild(document.createTextNode(raw.slice(from)));
  }

  var state = {
    open: false, locked: false, loading: false,
    title: null, titleSig: "",
    shards: {}, shardLoading: {},
    q: "", entries: [], active: -1, expanded: { doc: false, body: false },
    titleHit: 0, bodyHit: 0,
  };

  var root, btn, panel, input, listEl, tipEl, closeEl;

  function buildDom() {
    root = el("div", "as-root");
    root.id = "atlas-search";

    btn = el("button", "as-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", "全站搜索（Ctrl+K）");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", "as-panel");
    btn.title = "搜索全站 · Ctrl/Cmd+K 或 /";
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.4 15.4 L20 20"/></svg>';

    panel = el("div", "as-panel");
    panel.id = "as-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "全站搜索");
    panel.hidden = true;

    var bar = el("div", "as-bar");
    input = el("input", "as-input");
    input.type = "text";
    input.placeholder = "搜索人物、事件、地名、典籍…";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "as-list");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");

    closeEl = el("button", "as-close", "✕");
    closeEl.type = "button";
    closeEl.setAttribute("aria-label", "关闭搜索");

    listEl = el("div", "as-list");
    listEl.id = "as-list";
    listEl.setAttribute("role", "listbox");
    listEl.setAttribute("aria-label", "搜索结果");

    tipEl = el("div", "as-tip", "输入即搜 · ↑↓ 选择 · Enter 跳转 · Esc 收起");

    bar.appendChild(input);
    bar.appendChild(closeEl);
    panel.appendChild(bar);
    panel.appendChild(listEl);
    panel.appendChild(tipEl);
    root.appendChild(panel);
    root.appendChild(btn);

    (document.getElementById("app") || document.body).appendChild(root);
  }

  // ---------------- 展开 / 收起 ----------------
  var hoverTimer = null, leaveTimer = null;
  var GRACE_MS = 3000;   // hover 展开后的最低停留时间：鼠标从按钮移到输入框要时间，少于 3 秒会抓不住
  var LEAVE_MS = 460;    // 真正离开组件后的收起延迟（留一点余量，防抖一下）
  var graceUntil = 0;

  function openPanel(lock) {
    clearTimeout(leaveTimer);
    if (state.open && lock) { state.locked = true; input.focus(); return; }
    state.open = true;
    state.locked = !!lock;
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    root.classList.add("is-open");
    requestAnimationFrame(function () { root.classList.add("is-expanded"); });
    ensureTitle().then(function () { render(); });
    if (lock) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    state.locked = false;
    root.classList.remove("is-expanded");
    btn.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-expanded", "false");
    setTimeout(function () {
      if (!state.open) { panel.hidden = true; }
    }, 220);
    input.blur();
  }

  // 事件一律挂在 document 上用委托，不直接绑 btn/input：
  // 脚本比组件先执行（buildDom 在 init 里才跑），直接绑会拿到 undefined —— 本轮已踩过一次。
  document.addEventListener("mouseover", function (e) {
    var t = e.target;
    if (!t.closest || !t.closest(".as-root")) return;
    clearTimeout(leaveTimer);                     // 指针回到组件内（按钮或面板）就取消收起
    if (!t.closest(".as-btn") || state.open) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      openPanel(false);
      graceUntil = Date.now() + GRACE_MS;          // 给 3 秒窗口，让鼠标能移进面板点输入框
    }, 120);
  });
  document.addEventListener("mouseout", function (e) {
    var t = e.target;
    if (!t.closest || !t.closest(".as-root")) return;
    // 按钮 → 面板、面板内子元素之间移动，都不算离开组件（不算的话面板会在半路收起）
    var to = e.relatedTarget;
    if (to && to.closest && to.closest(".as-root")) return;
    clearTimeout(hoverTimer);
    if (state.locked || (input && input.value)) return;
    var wait = Math.max(0, graceUntil - Date.now());
    leaveTimer = setTimeout(function () { if (!state.locked) closePanel(); }, wait > 0 ? wait : LEAVE_MS);
  });
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest && t.closest(".as-btn")) { e.stopPropagation(); openPanel(!state.open); return; }
    if (t.closest && t.closest(".as-close")) { closePanel(); return; }
    if (state.open && root && !root.contains(t)) closePanel();
  });
  // 光标真的进到输入框（点或 Tab），就视为「要用它」，不再跟着鼠标离开而收起
  document.addEventListener("focusin", function (e) {
    if (e.target !== input) return;
    clearTimeout(leaveTimer);
    if (state.open) state.locked = true;
  });
  document.addEventListener("keydown", function (e) {
    var isSlash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
    var isCombo = (e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K");
    if (isCombo || isSlash) {
      var tag = (e.target && e.target.tagName) || "";
      if (isSlash && /^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (isSlash && e.target && e.target.isContentEditable) return;
      e.preventDefault();
      openPanel(true);
      return;
    }
    if (e.key === "Escape" && state.open) { e.preventDefault(); closePanel(); return; }
    if (!state.open || !state.rowMap || !state.rowMap.length) return;
    if (!input || e.target !== input) return;
    handleArrows(e);
  });
  // 中文输入法：composition 期间不触发检索（否则拼音串会当成查询词）
  document.addEventListener("compositionstart", function (e) {
    if (e.target === input) composing = true;
  });
  document.addEventListener("compositionend", function (e) {
    if (e.target === input) { composing = false; schedule(); }
  });
  document.addEventListener("input", function (e) {
    if (e.target !== input) return;
    if (composing) return;
    schedule();
  });

  // ---------------- 数据 ----------------
  function fetchJson(name) {
    return fetch(BASE + name, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error(r.status + " " + name); return r.json(); });
  }

  function ensureTitle() {
    if (state.title) return Promise.resolve(state.title);
    if (state.loading) return Promise.resolve(null);
    state.loading = true;
    return fetchJson("title.json").then(function (j) {
      state.title = (j.docs || []).map(function (d) {
        return { t: d.t, tn: norm(d.t), ty: d.ty, m: d.m, s: d.s, u: d.u, k: d.k, i: d.i };
      });
      state.titleSig = j.sig || "";
      state.loading = false;
      return state.title;
    }).catch(function () {
      state.loading = false;
      tipEl.textContent = "搜索索引加载失败：请先在项目根跑 node scripts/build-search.mjs";
      return null;
    });
  }

  function loadShard(m) {
    if (state.shards[m]) return Promise.resolve(state.shards[m]);
    if (state.shardLoading[m]) return state.shardLoading[m];
    state.shardLoading[m] = fetchJson("body-" + m + ".json").then(function (j) {
      state.shards[m] = (j.docs || []);
      return state.shards[m];
    }).catch(function () { state.shards[m] = []; return []; });
    return state.shardLoading[m];
  }

  // ---------------- 检索 ----------------
  function titleScore(d, q) {
    var nq = norm(q);
    if (!nq) return 0;
    if (d.tn === nq) return 100;
    if (d.tn.indexOf(nq) === 0) return 72;
    if (d.tn.indexOf(nq) >= 0) return 52;
    var ns = norm(d.s);
    if (ns.indexOf(nq) >= 0) return 22;
    return 0;
  }

  function bodyScan(docs, q) {
    var nq = norm(q), out = [], seen = {};
    for (var i = 0; i < docs.length && out.length < MAX_SCAN; i++) {
      var d = docs[i], sn = d.sn || [];
      for (var j = 0; j < sn.length; j++) {
        if (norm(sn[j]).indexOf(nq) < 0) continue;
        if (!seen[d.i]) {
          seen[d.i] = 1;
          out.push({ kind: "body", t: d.t, u: d.u, k: d.k, sn: sn[j], score: 10 + (TYPE_BOOST[typeOf(d.t, docs)] || 0) });
        }
        break;
      }
    }
    return out;
  }

  function typeOf() { return ""; }   // 正文分片不带 type，正文组不额外加权（词条组已经排过序）

  function search() {
    if (!state.title) return;
    var q = state.q.trim();
    state.expanded.doc = false;
    state.expanded.body = false;
    if (!q) {
      state.entries = [];
      renderEmpty();
      return;
    }
    var hits = state.title
      .map(function (d) { return { d: d, s: titleScore(d, q) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s || a.d.t.length - b.d.t.length; })
      .slice(0, MAX_SCAN);
    state.entries = hits.map(function (x) {
      return { kind: "doc", t: x.d.t, ty: x.d.ty, m: x.d.m, s: x.d.s, u: x.d.u, k: x.d.k, score: x.s };
    });
    state.docTotal = state.entries.length;
    render();
    // 正文级：先拉「已命中的模块」，再兜底补齐其余模块（并发上限 3）
    var mods = {};
    hits.slice(0, 60).forEach(function (x) { if (x.d.m) mods[x.d.m] = 1; });
    var list = Object.keys(mods);
    var all = ["emperors", "thought", "shiwen", "gewu", "myth"].filter(function (m) { return list.indexOf(m) < 0; });
    // 先查命中模块，再补齐其余模块（最多 3 片）：只查命中的那几个会漏掉
    // 「词条在 A 模块、正文在 B 模块」的情况（例如搜地名时正文散在路线与事件里）。
    var queue = list.concat(all).slice(0, 3);
    Promise.all(queue.slice(0, 3).map(loadShard)).then(function () {
      if (state.q.trim() !== q) return;   // 用户已经改了输入
      var body = [];
      queue.forEach(function (m) { body = body.concat(bodyScan(state.shards[m] || [], q)); });
      state.bodyEntries = body.sort(function (a, b) { return b.score - a.score; });
      render();
    });
  }

  // ---------------- 渲染 ----------------
  function renderEmpty() {
    listEl.innerHTML = "";
    var hint = el("div", "as-empty");
    hint.appendChild(el("b", null, "搜全站："));
    hint.appendChild(document.createTextNode("帝王、悬案、舆图事件、路线与地点、典籍与公案、问典题目，都能一步到位。"));
    var ex = el("div", "as-examples");
    ["郑和", "靖难之役", "忽鲁谟斯", "麻林", "永乐十三年"].forEach(function (w) {
      var chip = el("button", "as-chip", w);
      chip.type = "button";
      chip.addEventListener("click", function () { input.value = w; state.q = w; search(); });
      ex.appendChild(chip);
    });
    hint.appendChild(ex);
    listEl.appendChild(hint);
  }

  var ROW_H = 0;

  function row(entry, idx) {
    var r = el("button", "as-row");
    r.type = "button";
    r.setAttribute("role", "option");
    r.id = "as-opt-" + idx;
    r.dataset.idx = String(idx);

    var main = el("div", "as-row-main");
    var title = el("div", "as-row-title");
    markInto(title, entry.t, state.q);
    main.appendChild(title);

    if (entry.kind === "body") {
      var sn = el("div", "as-row-sub");
      markInto(sn, entry.sn, state.q);
      main.appendChild(sn);
    } else if (entry.s) {
      var sub = el("div", "as-row-sub");
      main.appendChild(sub);
      markInto(sub, entry.s, state.q);
    }
    r.appendChild(main);

    var tag = el("span", "as-tag", TYPE_LABEL[entry.k] || entry.ty || "词条");
    r.appendChild(tag);
    if (entry.kind === "body") r.classList.add("is-body");

    r.addEventListener("click", function (e) { e.preventDefault(); go(entry); });
    r.addEventListener("mouseenter", function () { setActive(idx); });
    return r;
  }

  function section(titleText, entries, moreLabel) {
    var box = el("div", "as-group");
    var head = el("div", "as-group-head");
    head.appendChild(el("span", "as-group-name", titleText));
    head.appendChild(el("span", "as-group-count", String(entries.length)));
    box.appendChild(head);
    return box;
  }

  function render() {
    listEl.innerHTML = "";
    state.entries = (state.entries || []).filter(function () { return true; });
    var docs = (state.entries || []).filter(function (e) { return e.kind === "doc"; });
    var bodies = state.bodyEntries || [];
    if (!docs.length && !bodies.length) {
      var none = el("div", "as-empty");
      none.appendChild(el("b", null, "没有匹配："));
      none.appendChild(document.createTextNode("换个说法试试？例如「郑和」「靖难」「忽鲁谟斯」。"));
      listEl.appendChild(none);
      setActive(-1);
      return;
    }
    var allRows = [];

    if (docs.length) {
      var g1 = section("词条", docs);
      var show = state.expanded.doc ? docs.length : Math.min(docs.length, GROUP_DEFAULT);
      for (var i = 0; i < show; i++) {
        var r1 = row(docs[i], allRows.length);
        allRows.push(docs[i]);
        g1.appendChild(r1);
      }
      if (docs.length > show) {
        var more1 = el("button", "as-more", "展开全部 " + docs.length + " 条");
        more1.type = "button";
        more1.addEventListener("click", function () { state.expanded.doc = true; render(); });
        g1.appendChild(more1);
      }
      listEl.appendChild(g1);
    }

    if (bodies.length) {
      var g2 = section("正文命中", bodies);
      var show2 = state.expanded.body ? bodies.length : Math.min(bodies.length, GROUP_DEFAULT);
      for (var k = 0; k < show2; k++) {
        var r2 = row(bodies[k], allRows.length);
        allRows.push(bodies[k]);
        g2.appendChild(r2);
      }
      if (bodies.length > show2) {
        var more2 = el("button", "as-more", "展开全部 " + bodies.length + " 条");
        more2.type = "button";
        more2.addEventListener("click", function () { state.expanded.body = true; render(); });
        g2.appendChild(more2);
      }
      listEl.appendChild(g2);
    } else if (docs.length && state.shardLoading) {
      // 正文分片还在路上，先占位，别让用户以为只有词条
      var ph = el("div", "as-loading", "正在检索正文…");
      listEl.appendChild(ph);
    }

    state.rowMap = allRows;
    setActive(allRows.length ? 0 : -1);
    input.setAttribute("aria-expanded", allRows.length ? "true" : "false");
  }

  function setActive(idx) {
    var prev = listEl.querySelector(".is-active");
    if (prev) prev.classList.remove("is-active");
    state.active = idx;
    if (idx < 0) { input.removeAttribute("aria-activedescendant"); return; }
    var node = listEl.querySelector('#as-opt-' + idx);
    if (node) {
      node.classList.add("is-active");
      input.setAttribute("aria-activedescendant", "as-opt-" + idx);
    }
  }

  function activeNode() { return listEl.querySelector('#as-opt-' + state.active); }

  function setActiveByNode(node) {
    if (!node) return;
    setActive(Number(node.dataset.idx));
  }

  function handleArrows(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      var rows = listEl.querySelectorAll(".as-row");
      if (!rows.length) return;
      var next = Math.min((state.active < 0 ? -1 : state.active) + 1, rows.length - 1);
      setActiveByNode(rows[next]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      var rows2 = listEl.querySelectorAll(".as-row");
      if (!rows2.length) return;
      var prev2 = Math.max((state.active < 0 ? rows2.length : state.active) - 1, 0);
      setActiveByNode(rows2[prev2]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      var entry = (state.rowMap || [])[state.active];
      if (entry) { go(entry); return; }
      if (state.rowMap && state.rowMap.length) go(state.rowMap[0]);
    }
  }

  // ---------------- 输入（含中文输入法） ----------------
  var composing = false, debounceTimer = null;

  function schedule() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      state.q = input.value;
      if (!state.title) { ensureTitle().then(search); return; }
      search();
    }, DEBOUNCE_MS);
  }

  // ---------------- 跳转 ----------------
  function entryUrl(entry, q) {
    var u = String(entry.u || "");
    var base = /^[a-z]+\.html\?/.test(u) ? u : "index.html?" + u;
    var sep = base.indexOf("?") >= 0 ? "&" : "?";
    var extra = "";
    if (q) extra += sep + "q=" + encodeURIComponent(q);
    if (entry.k) extra += (extra ? "&" : sep) + "ak=" + encodeURIComponent(entry.k);
    // qt：词条标题。用户输入的串在正文里没原样命中时，atlas-jump 会拿它兜底
    // （典型场景：搜「郑和下西洋」点中「忽鲁谟斯」，正文里只有地名、没有整串）。
    if (entry.t && entry.t !== q) extra += "&qt=" + encodeURIComponent(entry.t);
    return base + extra;
  }

  function go(entry) {
    if (!entry) return;
    var q = state.q.trim();
    var self = location.pathname.split("/").pop() || "index.html";
    var url = entryUrl(entry, q);
    // 已经在同一页且只换参数：交给 app.js 的 applyDeepLink 处理，避免整页重载丢状态
    closePanel();
    if (self === "index.html" && typeof window.applyDeepLink === "function") {
      try {
        history.replaceState(null, "", url);
        window.applyDeepLink();
        return;
      } catch (e) { /* 落回整页跳转 */ }
    }
    location.href = url;
  }

  // ---------------- 启动 ----------------
  function init() {
    if (document.getElementById("atlas-search")) return;
    buildDom();
    // 预取词条索引：空闲时悄悄拿一份，让第一次 hover 就能出结果（失败不打扰）
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1600); };
    idle(function () { ensureTitle(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
