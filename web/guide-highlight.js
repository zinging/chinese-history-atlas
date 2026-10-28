/*
 * 中华历史图谱 · AI 讲解员「歌词跟随高亮」
 * 仅在 URL 含 ?guide=1（讲解员模式）时激活；普通浏览（无该参数）本脚本立即退出、不改动任何 DOM。
 *
 * 激活后：
 *  - 把当前讲解对象（皇帝档案 / 地图事件 / 路线站点 / 典籍名篇 / 神话热点）的正文
 *    按句切分，包成 <span class="gh-line" data-s="全局序号">。
 *  - 监听 hash #s=N，高亮第 N 句（金色加粗 + 暖金底，桌面歌词风）并平滑滚动到视口中央。
 *  - 前端切句规则必须与 MCP Server（history-mcp-server.mjs 的 splitSentences）完全一致，
 *    保证 MCP 下发的 steps[i] 与页面 data-s 一一对齐。
 */
(function () {
  "use strict";

  var QUERY = new URLSearchParams(location.search);
  if (QUERY.get("guide") !== "1") return; // 非讲解员模式：完全不介入

  // ---------- 仅讲解员模式注入的样式 ----------
  var styleEl = document.createElement("style");
  styleEl.textContent = [
    ".gh-line{border-radius:3px;padding:0 1px;margin:0 -1px;transition:background .28s ease,color .28s ease,box-shadow .28s ease;}",
    ".gh-line.gh-active{color:#8a5a00;font-weight:700;background:linear-gradient(180deg,rgba(255,242,198,0) 0%,rgba(255,223,128,.62) 52%,rgba(255,210,92,.85) 100%);box-shadow:0 0 0 1px rgba(184,134,11,.35);}",
    ".gh-line.gh-done{color:#9b7a3d;}",
    "/* 讲解推进控制条（仅讲解员模式） */",
    "#gh-player{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:linear-gradient(180deg,#fdf6e3 0%,#f3e6c4 100%);border:1px solid #c9b380;box-shadow:0 6px 22px rgba(80,55,15,.28);font-family:inherit;user-select:none;}",
    "#gh-player button{appearance:none;border:none;background:transparent;cursor:pointer;color:#7a4a12;font-size:16px;line-height:1;padding:4px 6px;border-radius:50%;}",
    "#gh-player button:hover{background:rgba(160,110,30,.14);color:#5a3408;}",
    "#gh-player .gh-main{font-size:18px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#a8732f;color:#fdf6e3;}",
    "#gh-player .gh-prog{font-size:12.5px;color:#7a5a28;font-variant-numeric:tabular-nums;min-width:44px;text-align:center;}",
    "#gh-player .gh-speed{font-size:12.5px;color:#7a4a12;border:1px solid #c9b380;border-radius:999px;padding:2px 8px;cursor:pointer;background:#fdf6e3;}",
    "#gh-player .gh-speed:hover{background:#f3e6c4;}",
    "#gh-player .gh-title{font-size:12px;color:#9b7a3d;letter-spacing:1px;}",
  ].join("\n");
  (document.head || document.documentElement).appendChild(styleEl);

  // ---------- 与服务端共享的切句规则（句号/问号/感叹号/分号，保留句末标点；省略号 …… 不切句，仅作句中停顿） ----------
  var TERM_RE = /[。！？；;!?]/;
  // 仅由引号/括号收尾符组成的残句（如『…』 切出的孤立「』」）要并回上一句，前后端必须一致
  var CLOSE_RE = /^[\s』」』”）》〉、，]+$/;
  function splitSentences(text) {
    var s = String(text == null ? "" : text), out = [], buf = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      buf += ch;
      if (TERM_RE.test(ch)) {
        var t = buf.trim();
        if (t) out.push(t);
        buf = "";
      }
    }
    var tail = buf.trim();
    if (tail) out.push(tail);
    // 残句合并：孤立的引号/括号收尾符并回前一句
    var merged = [];
    out.forEach(function (t) {
      if (merged.length && CLOSE_RE.test(t)) {
        merged[merged.length - 1] = merged[merged.length - 1] + t;
      } else {
        merged.push(t);
      }
    });
    return merged;
  }

  function textNodes(el) {
    return Array.prototype.slice.call(el.childNodes).filter(function (n) {
      return n.nodeType === 3 && n.nodeValue.replace(/\s/g, "").length > 0;
    });
  }

  // 把一组连续文本节点替换为句子 span；句子序号写入 state.n
  function wrapGroup(nodes, state) {
    if (!nodes || !nodes.length) return 0;
    var prose = nodes.map(function (n) { return n.nodeValue; }).join("");
    var sents = splitSentences(prose);
    if (!sents.length) return 0;
    var parent = nodes[0].parentNode;
    var ref = nodes[nodes.length - 1].nextSibling;
    nodes.forEach(function (n) { parent.removeChild(n); });
    sents.forEach(function (se) {
      var span = document.createElement("span");
      span.className = "gh-line";
      span.setAttribute("data-s", String(state.n++));
      span.textContent = se;
      parent.insertBefore(span, ref);
    });
    return sents.length;
  }

  // 把一个文本节点原地替换为若干句子 span（DocumentFragment，保证文档顺序=创建顺序=data-s）
  function wrapTextNodeInPlace(textNode, state) {
    if (!textNode || textNode.nodeType !== 3) return;
    if (textNode.nodeValue.replace(/\s/g, "").length === 0) return;
    var sents = splitSentences(textNode.nodeValue);
    if (!sents.length) return;
    var parent = textNode.parentNode;
    var frag = document.createDocumentFragment();
    sents.forEach(function (se) {
      var sp = document.createElement("span");
      sp.className = "gh-line";
      sp.setAttribute("data-s", String(state.n++));
      sp.textContent = se;
      frag.appendChild(sp);
    });
    parent.replaceChild(frag, textNode);
  }

  // 描述符：
  //  {k:'pure', el}      容器内全部文本节点即一段语料
  //  {k:'afterTag', el}  跳过首个元素子节点（如「💡 点评」标签），其前文本节点为语料
  //  {k:'afterEl', el, child}  跳过指定子元素（如路线站名 <b>），其后文本节点为语料
  //  {k:'hot', el}       神话热点卡正文：原文文本段与 <span class="tr"> 译文段交错（可能多组），按文档顺序逐句替换
  function wrapHotSeq(el, state) {
    // 先快照子节点，替换会实时改变 DOM
    Array.prototype.forEach.call(Array.prototype.slice.call(el.childNodes), function (node) {
      if (node.nodeType === 3) {
        wrapTextNodeInPlace(node, state);
      } else if (node.nodeType === 1) {
        if (node.classList && node.classList.contains("tr")) {
          // 译文段：逐句替换其内部文本节点
          Array.prototype.slice.call(node.childNodes).forEach(function (c) {
            if (c.nodeType === 3) wrapTextNodeInPlace(c, state);
            else if (c.nodeType === 1) wrapHotSeq(c, state);
          });
        } else {
          // 非 .tr 内联元素：视作原文，递归替换其文本节点
          wrapHotSeq(node, state);
        }
      }
    });
  }
  function wrapDescriptor(d, state) {
    if (d.k === "hot") {
      wrapHotSeq(d.el, state);
      return;
    }
    if (d.k === "afterTag" || d.k === "afterEl") {
      var keep = d.k === "afterTag" ? d.el.firstElementChild : d.child;
      var after = textNodes(d.el).filter(function (n) {
        if (!keep) return true;
        return (keep.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) === Node.DOCUMENT_POSITION_FOLLOWING;
      });
      wrapGroup(after, state);
      return;
    }
    wrapGroup(textNodes(d.el), state);
  }

  // ---------- 采集当前讲解对象的语料块（返回 null 表示内容尚未渲染） ----------
  function collectBlocks() {
    var isGuoxue = /\/guoxue\//.test(location.pathname);
    var p = new URLSearchParams(location.search);
    var page = p.get("page"), tab = p.get("tab");
    var event = p.get("event"), emperor = p.get("emperor"),
        book = p.get("book"), hotspot = p.get("hotspot");

    if (!isGuoxue) {
      // 帝王谱系主站
      if (page === "map" && event) {
        var pop = document.querySelector("#map-popup:not(.hidden)");
        var blocks = [];
        if (pop) {
          var story = pop.querySelector("p:not([style])");
          if (story) blocks.push({ k: "pure", el: story });
        }
        // 若该事件关联路线（#route-detail 内确有逐站列表），把路线概述与逐站解说也纳入，
        // 顺序必须与 MCP Server 一致：事件正文 → 路线概述 → 逐站（站名后为解说）。
        var rd = document.querySelector("#route-detail:not(.hidden)");
        var stopLis = rd ? rd.querySelectorAll(".route-detail-stops li") : [];
        if (stopLis && stopLis.length) {
          var desc = rd.querySelector(".route-detail-desc");
          if (desc && desc.textContent.trim()) blocks.push({ k: "pure", el: desc });
          var sIdx = 0;
          Array.prototype.forEach.call(stopLis, function (li) {
            li.setAttribute("data-gh-station", String(sIdx++));
            // 仅包裹解说正文（.rs-note），站名 <b> 与破折号不参与切句，保证与服务端一致
            var note = li.querySelector(".rs-note");
            if (note && note.textContent.trim()) blocks.push({ k: "pure", el: note });
          });
        }
        return blocks.length ? blocks : null;
      }
      if ((!page || page === "timeline") && emperor) {
        var detail = document.querySelector("#emperor-detail");
        if (!detail || detail.classList.contains("hidden")) return null;
        var list = [];
        var intro = detail.querySelector(".intro");
        if (intro && intro.textContent.trim()) list.push({ k: "pure", el: intro });
        Array.prototype.forEach.call(detail.querySelectorAll(".timeline .tl-note"), function (n) {
          if (n.textContent.trim()) list.push({ k: "pure", el: n });
        });
        return list.length ? list : null;
      }
      if (page === "map") {
        var rd = document.querySelector("#route-detail:not(.hidden)");
        if (rd) {
          var rlist = [];
          var desc = rd.querySelector(".route-detail-desc");
          if (desc && desc.textContent.trim()) rlist.push({ k: "pure", el: desc });
          Array.prototype.forEach.call(rd.querySelectorAll(".route-detail-stops li"), function (li) {
            var b = li.querySelector("b");
            rlist.push({ k: "afterEl", el: li, child: b });
          });
          return rlist.length ? rlist : null;
        }
        return null;
      }
      return [];
    }

    // 国学四板块（独立页或 iframe 内）
    if (tab === "books" && book) {
      var root = document.querySelector("#book-detail .entry-panel[data-panel='chapters']");
      if (!root) return null;
      var groups = [];
      Array.prototype.forEach.call(root.querySelectorAll(".chapter"), function (ch) {
        var ctx = ch.querySelector(".context");
        var ori = ch.querySelector(".original");
        var glo = ch.querySelector(".gloss");
        var aft = ch.querySelector(".afterword");
        if (ctx) groups.push({ k: "pure", el: ctx });
        if (ori) groups.push({ k: "pure", el: ori });
        if (glo) groups.push({ k: "pure", el: glo });
        if (aft) groups.push({ k: "afterTag", el: aft });
      });
      return groups.length ? groups : null;
    }
    if (tab === "map" && hotspot) {
      var card = document.querySelector(".sch-detail");
      if (!card) return null;
      var src = card.querySelector(".sch-detail-src");
      var descP = card.querySelector("p:not(.sch-detail-src)");
      var g = [];
      if (src) g.push({ k: "pure", el: src });
      if (descP) g.push({ k: "hot", el: descP });
      return g.length ? g : null;
    }
    return [];
  }

  var state = { n: 0, sig: "" };
  var wrappedKey = null;
  var lastIndex = -1;

  // 还原所有已包裹的句子为原始文本节点（重建前先解包，避免 data-s 重复）
  function unwrapAll() {
    Array.prototype.forEach.call(document.querySelectorAll(".gh-line"), function (sp) {
      var parent = sp.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(sp.textContent), sp);
      try { parent.normalize(); } catch (e) { /* 忽略 */ }
    });
  }

  function sigOf(blocks) {
    return blocks.map(function (b) { return b.el.textContent.length; }).join("|");
  }

  function build() {
    var blocks = collectBlocks();
    if (blocks === null) return false; // 内容未就绪
    unwrapAll();
    blocks = collectBlocks();        // 解包后 DOM 文本节点已重建，重新采集
    if (blocks === null) return false;
    state.n = 0;
    blocks.forEach(function (d) { wrapDescriptor(d, state); });
    wrappedKey = location.search;
    state.sig = sigOf(blocks);      // 内容指纹：路线卡等异步后到时据此触发重建
    lastIndex = -1; // DOM 被重建，允许重新滚动定位
    return true;
  }

  function currentS() {
    var mm = /#s=(\d+)/.exec(location.hash || "");
    return mm ? parseInt(mm[1], 10) : 0;
  }

  // 找到最近的内部可滚动容器（如神话热点卡），返回 {scroller, visible}；无则返回 null（页面级滚动）
  function visibilityInScroller(el) {
    var node = el.parentElement;
    while (node && node.nodeType === 1) {
      var st = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 2) {
        var r = el.getBoundingClientRect();
        var sr = node.getBoundingClientRect();
        return { scroller: node, visible: r.top >= sr.top + 2 && r.bottom <= sr.bottom - 2 };
      }
      node = node.parentElement;
    }
    return null;
  }

  // 显式把句子在内部滚动容器内居中（直接赋值 scrollTop，避免 smooth scrollIntoView 在卡片内失效）
  function centerInScroller(target) {
    var node = target.parentElement;
    while (node && node.nodeType === 1) {
      var st = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 2) {
        var rel = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
        var dest = rel - (node.clientHeight - target.getBoundingClientRect().height) / 2;
        node.scrollTop = Math.max(0, Math.min(dest, node.scrollHeight - node.clientHeight));
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function scrollActive(target) {
    // 内部容器（热点卡）先显式居中
    if (!centerInScroller(target)) {
      // 无内部容器才走页面级滚动
      try { target.scrollIntoView({ block: "center", behavior: "smooth" }); }
      catch (e) { target.scrollIntoView(); }
    }
    // 热点卡等含图片的容器，内部滚动在图片加载后才出现：分几次补滚，仅当该句仍为当前句且未完整可见时
    [120, 350, 700, 1000, 1400, 1900].forEach(function (delay) {
      setTimeout(function () {
        if (!target.isConnected || target.getAttribute("data-s") !== String(currentS())) return;
        var v = visibilityInScroller(target);
        if (v && !v.visible) centerInScroller(target);
      }, delay);
    });
  }

  function highlight(s) {
    var lines = document.querySelectorAll(".gh-line");
    var target = null;
    Array.prototype.forEach.call(lines, function (el) {
      var idx = parseInt(el.getAttribute("data-s"), 10);
      el.classList.toggle("gh-active", idx === s);
      el.classList.toggle("gh-done", idx < s);
      if (idx === s) target = el;
    });
    // 仅在高亮句变化时滚动，避免常驻观察导致与用户滚动抢焦点
    if (target && s !== lastIndex) {
      lastIndex = s;
      scrollActive(target);
      // 路线逐站：高亮句位于某一站内时，通知地图平移到该站（app.js 提供 __guideFlyTo）
      var li = target.closest && target.closest("[data-gh-station]");
      if (li && li.dataset.lat && li.dataset.lng && typeof window.__guideFlyTo === "function") {
        try { window.__guideFlyTo(parseFloat(li.dataset.lat), parseFloat(li.dataset.lng)); } catch (e) { /* 忽略 */ }
      }
    }
  }

  // 高亮变化后的推进调度。
  // 两条踩过的坑：
  //   1) 不能靠「给 refresh 重新赋值」挂钩——行 369 的 setInterval 早已捕获旧的 refresh
  //      （函数声明提升），重赋值对已注册的定时器与 MutationObserver 无效。
  //   2) 状态变量必须声明在 refresh 之前。refresh 会在 200ms 轮询里先于下方播放器代码执行，
  //      若 playing/lastScheduled 声明在下文，此处读到的是 var 提升后的 undefined，
  //      判断恒假、永不排计时。
  var afterHighlight = null;   // 由播放器部分在就绪后挂上
  var playing = false;
  var playingSpeaking = false; // 本轮播放由朗读驱动（而非字数计时）
  var dwellTimer = null;
  var lastScheduled = -1;

  function refresh() {
    var blocks = collectBlocks();
    if (blocks === null) { highlight(currentS()); if (afterHighlight) afterHighlight(); return; } // 内容尚未渲染
    // 指纹变化（如路线概述/逐站在事件卡之后才插入）或无包裹行时重建
    var sig = sigOf(blocks);
    var needBuild =
      wrappedKey !== location.search ||
      state.sig !== sig ||
      document.querySelectorAll(".gh-line").length === 0;
    if (needBuild) {
      if (!build()) { if (afterHighlight) afterHighlight(); return; }
    }
    highlight(currentS());
    if (afterHighlight) afterHighlight();
  }

  // 内容由 applyDeepLink 异步渲染（神话热点卡甚至会在约 900ms 后被覆盖重弹）：
  // 轮询 + MutationObserver 双保险，卡片被替换（.gh-line 归零）时自愈重建。
  var pollTimer = setInterval(refresh, 200);
  var debounce = null;
  var mo = new MutationObserver(function () {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 80);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 同页只改 hash（逐句推进）：只移动高亮，不重新加载
  window.addEventListener("hashchange", function () {
    if (location.search !== wrappedKey) { wrappedKey = null; lastIndex = -1; }
    refresh();
  });
  window.addEventListener("popstate", function () { wrappedKey = null; lastIndex = -1; refresh(); });

  // 自动逐句推进：两种驱动源，由「导览设置」里的两个开关决定。
  //   - 朗读功能（speech）：用浏览器原生 speechSynthesis 逐句朗读，
  //     以 onend（该句念完）为推进信号——节奏来自真实语音时长，不再靠字数估算。
  //   - 文本推进（dwell）：无语音时的静默推进，按字数估算阅读时间 + 速度倍率。
  // 两者都关闭 → 不建控制条、不排任何计时、不动 DOM，回到纯静态网页。
  var wantAutoplay = QUERY.get("autoplay") === "1";

  // ---------- 设置持久化（localStorage，缺省全关） ----------
  var SET_KEY = "dsh-guide-settings";
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SET_KEY);
      if (!raw) return { speech: false, dwell: false };
      var o = JSON.parse(raw);
      return { speech: !!o.speech, dwell: !!o.dwell };
    } catch (e) { return { speech: false, dwell: false }; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch (e) { /* 隐私模式忽略 */ }
  }
  var settings = loadSettings();
  // URL 显式带 autoplay=1（AI 深链）时视为要求文本推进，但仅在用户未主动关过时生效
  if (wantAutoplay && !localStorage.getItem(SET_KEY)) settings.dwell = true;
  var guideEnabled = function () { return settings.speech || settings.dwell; };

  // 每句停留：按字数估算读者扫读一句的时间（约 9 字/秒，含回看余量），
  // 2.5s 起、9s 封顶，再除以速度倍率。目的是让高亮跟着读者的阅读走，不抢也不拖。
  var SPEEDS = [0.6, 1, 1.5, 2];
  var speedIdx = 1;
  function dwellFor(text) {
    var len = String(text || "").replace(/\s/g, "").length;
    var base = Math.min(9000, Math.max(2500, (1.2 + len * 0.11) * 1000));
    return base / SPEEDS[speedIdx];
  }

  // ---------- 朗读（浏览器原生 speechSynthesis） ----------
  // 选 zh-CN 音色；语速随控制条倍率变化。关闭朗读时彻底不创建任何 utterance。
  var synth = (typeof window !== "undefined" && window.speechSynthesis) || null;
  var voice = null;
  function pickVoice() {
    if (!synth) return null;
    var vs = synth.getVoices() || [];
    var zh = vs.filter(function (v) { return /^zh(-|_)?/i.test(v.lang || ""); });
    // 优先中文、优先本地音色（离线可用）
    voice = zh.find(function (v) { return v.localService && /CN|Hans|Xiaoxiao|Huihui|Yaoyao|Kangkang/i.test((v.lang || "") + (v.name || "")); })
      || zh.find(function (v) { return v.localService; })
      || zh[0] || null;
    return voice;
  }
  if (synth) {
    pickVoice();
    if (typeof synth.onvoiceschanged !== "undefined") synth.onvoiceschanged = pickVoice;
  }
  var speaking = false;
  var speakWatchdog = null;
  var speakStartTimer = null;
  // 记录「哪些句号已判定朗读失败」。失败只作用于那一句（下一句仍重试朗读），
  // 但同一句不能反复重试——否则 watchdog → scheduleNext → 再 speak → 再设 watchdog，
  // 形成永不推进的死循环，表现为整条讲解卡在第一句。
  var speechFailedAt = {};
  function speakCurrent() {
    if (!synth || !settings.speech) return false;
    var el = document.querySelector(".gh-line.gh-active");
    if (!el) return false;
    var text = (el.textContent || "").trim();
    if (!text) return false;
    // 该句已判定朗读无效 → 不再重试，直接交给计时推进（避免死循环）
    if (speechFailedAt[currentS()]) return false;
    // Chrome 的长朗读队列会进入静默挂起（paused=true 但不出声），每句开念前先唤醒
    try { if (synth.paused) synth.resume(); } catch (e) { /* 忽略 */ }
    try { synth.cancel(); } catch (e) { /* 忽略 */ }
    var u = new SpeechSynthesisUtterance(text);
    if (!voice) pickVoice();
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || "zh-CN";
    u.rate = SPEEDS[speedIdx];
    u.pitch = 1;
    var started = false;
    // 真正开始出声才算成功——部分环境 speak() 不报错但从不 onstart，
    // 只有 onstart 能区分「在念」和「被静默吞掉」。
    u.onstart = function () { started = true; speaking = true; };
    // 该句念完 → 推进下一句（真实语音时长，最准的时间轴）
    u.onend = function () {
      speaking = false;
      if (playing && settings.speech && playingSpeaking) next();
    };
    u.onerror = function () {
      speaking = false;
      // 单句朗读失败 → 只对这一句改用计时推进，下一句仍会重试朗读
      if (playing) { lastScheduled = -1; scheduleNext(); }
    };
    playingSpeaking = true;
    speaking = true;
    try { synth.speak(u); } catch (e) { speaking = false; playingSpeaking = false; return false; }
    // 兜底 watchdog：窗口内既没 onstart 也没推进 → 判为本句朗读无效，仅本句改用计时。
    // 不做全局永久降级，否则一旦首句失败后面全静音（用户反馈「开头有声、后面没声」的成因之一）。
    clearTimeout(speakWatchdog);
    var sAt = currentS();
    var chars = text.replace(/\s/g, "").length;
    var expectMs = Math.min(30000, Math.max(4000, chars * 320 / SPEEDS[speedIdx]));
    // 快速失败窗口：语音应在 1.2 秒内 onstart，否则基本可判定本句不会出声。
    // 这样无效环境不必等满整个 expectMs，讲解不会显得卡住。
    var startDeadline = setTimeout(function () {
      if (!playing || !settings.speech) return;
      if (currentS() !== sAt) return;
      if (started) return;                       // 已开始出声，交给 onend / expectMs 窗口
      speaking = false;
      speechFailedAt[sAt] = true;
      lastScheduled = -1;
      try { synth.cancel(); } catch (e) { /* 忽略 */ }
      scheduleNext();
    }, Math.min(1200, expectMs));
    speakWatchdog = setTimeout(function () {
      if (!playing || !settings.speech) return;
      if (currentS() !== sAt) return;            // 已推进，说明 onend 生效
      if (started && synth && synth.speaking) return;   // 确实在念，交给 onend
      clearTimeout(startDeadline);
      speaking = false;
      speechFailedAt[sAt] = true;                // 仅标记这一句失败，下一句仍会朗读
      lastScheduled = -1;
      scheduleNext();                            // 本句无进展 → 计时推进下一句
    }, expectMs);
    speakStartTimer = startDeadline;
    return true;
  }
  function stopSpeaking() {
    playingSpeaking = false;
    speaking = false;
    clearTimeout(speakWatchdog);
    clearTimeout(speakStartTimer);
    if (synth) { try { synth.cancel(); } catch (e) { /* 忽略 */ } }
  }

  function totalLines() { return document.querySelectorAll(".gh-line").length; }

  function goTo(s) {
    var total = totalLines();
    if (!total) return;
    s = Math.max(0, Math.min(total - 1, s));
    // 手动跳句时立即打断正在朗读/排程的旧句，避免语音与高亮错位
    stopSpeaking();
    clearTimeout(dwellTimer);
    lastScheduled = -1;
    if (s !== currentS()) location.hash = "#s=" + s;   // 同页 hash 推进，不刷新
    else if (playing) scheduleNext();
  }

  function next() {
    var total = totalLines();
    if (currentS() >= total - 1) { setPlaying(false); return; }
    goTo(currentS() + 1);
  }
  function prev() { goTo(currentS() - 1); }

  function scheduleNext() {
    // 同一句已排过计时不重排：200ms 轮询会高频调到 afterHighlight → 这里，
    // 若无条件 clearTimeout 重排，定时器永远等不到触发（被下一次轮询清掉）。
    var s = currentS();
    if (s === lastScheduled) return;
    clearTimeout(dwellTimer);
    if (!playing) return;
    lastScheduled = s;
    // 朗读优先：由语音 onend 驱动推进，不排字数计时。
    // 单句失败由 speakCurrent 内部的 watchdog 处理（仅该句改用计时），不做全局降级。
    if (settings.speech) {
      playingSpeaking = true;
      if (speakCurrent()) return;
      playingSpeaking = false;   // speak 内部抛错 → 回落计时
    }
    playingSpeaking = false;
    var activeEl = document.querySelector(".gh-line.gh-active");
    // 该句朗读已判定失败（本环境出不了声）→ 用较短的计时，避免用户干等
    var ms = dwellFor(activeEl ? activeEl.textContent : "");
    if (settings.speech && speechFailedAt[s]) ms = Math.min(ms, 3000 / SPEEDS[speedIdx]);
    dwellTimer = setTimeout(next, ms);
  }

  function setPlaying(on) {
    // 未带 autoplay 参数时，读者主动点播放也允许（同一台控制条）
    playing = on;
    clearTimeout(dwellTimer);
    var btn = document.getElementById("gh-main");
    if (btn) btn.textContent = on ? "⏸" : "▶";
    if (on) {
      var total = totalLines();
      if (total && currentS() >= total - 1) goTo(0);
      lastScheduled = -1;      // 重新播放时允许为本句重新排程
      scheduleNext();
    } else {
      stopSpeaking();
    }
  }

  function buildBar() {
    if (document.getElementById("gh-player")) return;
    if (!guideEnabled()) return;   // 两个开关都关 → 不建控制条，保持纯静态
    var bar = document.createElement("div");
    bar.id = "gh-player";
    bar.innerHTML =
      '<span class="gh-title">' + (settings.speech ? "朗读" : "讲解") + '</span>' +
      '<button id="gh-prev" title="上一句（←）">⏮</button>' +
      '<button id="gh-main" title="' + (settings.speech ? "朗读 / 暂停" : "自动推进 / 暂停") + '（空格）">▶</button>' +
      '<button id="gh-next" title="下一句（→）">⏭</button>' +
      '<span class="gh-prog">0 / 0</span>' +
      '<button class="gh-speed" title="播放/朗读速度">1×</button>';
    (document.body || document.documentElement).appendChild(bar);
    document.getElementById("gh-prev").addEventListener("click", function () { setPlaying(false); prev(); });
    document.getElementById("gh-next").addEventListener("click", function () { setPlaying(false); next(); });
    document.getElementById("gh-main").addEventListener("click", function () { setPlaying(!playing); });
    document.querySelector("#gh-player .gh-speed").addEventListener("click", function () {
      speedIdx = (speedIdx + 1) % SPEEDS.length;
      this.textContent = SPEEDS[speedIdx] + "×";
      if (playing) { lastScheduled = -1; scheduleNext(); }   // 变速立即对当前句生效
    });
  }
  function removeBar() {
    setPlaying(false);
    var bar = document.getElementById("gh-player");
    if (bar) bar.remove();
  }

  // 高亮变化后重排下一句计时（含自动推进本身引起的 hash 变化）。
  // 挂到 refresh 内部钩子上——见文件上方 afterHighlight 的注释，不能靠重赋值 refresh。
  afterHighlight = function () {
    if (!guideEnabled()) return;
    var total = totalLines();
    var prog = document.querySelector("#gh-player .gh-prog");
    if (prog && total) prog.textContent = (currentS() + 1) + " / " + total;
    // 播放中且本句尚未排过计时 → 排下一次推进
    if (total && playing && currentS() !== lastScheduled) scheduleNext();
  };

  // 内容就绪后建控制条；autoplay=1 且用户已启用推进时自动开始
  var bootTimer = setInterval(function () {
    if (totalLines()) {
      if (guideEnabled()) {
        buildBar();
        refresh();
        if (wantAutoplay && !playing) setPlaying(true);
      }
      clearInterval(bootTimer);
    }
  }, 250);

  // ---------- 对外接口：供「导览设置」面板与页面脚本切换开关 ----------
  // 关掉两个开关时：移除控制条、停止朗读、清空计时，页面回到纯静态浏览状态。
  window.__guide = {
    refresh: refresh,
    currentS: currentS,
    setPlaying: setPlaying,
    goTo: goTo,
    getSettings: function () { return { speech: settings.speech, dwell: settings.dwell }; },
    setSettings: function (patch) {
      if (patch && typeof patch.speech === "boolean") settings.speech = patch.speech;
      if (patch && typeof patch.dwell === "boolean") settings.dwell = patch.dwell;
      saveSettings(settings);
      if (!guideEnabled()) {
        removeBar();
        stopSpeaking();
        clearTimeout(dwellTimer);
        playing = false;
        lastScheduled = -1;
        return settings;
      }
      buildBar();          // 首次开启时补建
      refresh();
      // 朗读开关变化后重建标题/提示
      var title = document.querySelector("#gh-player .gh-title");
      if (title) title.textContent = settings.speech ? "朗读" : "讲解";
      // 刚启用任一开关时自动开始推进（用户开启即是想看它动）
      if (!playing) { lastScheduled = -1; setPlaying(true); }
      return settings;
    },
    hasSpeech: function () { return !!synth; },
  };
})();