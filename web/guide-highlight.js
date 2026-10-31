/*
 * 中华历史图谱 · 逐句导览（文本推进 + 朗读）
 *
 * 这是网页自身的能力，不依赖 AI 讲解：
 *   a) 用户在侧栏「导览设置」勾选「朗读功能 / 文本推进」→ 本脚本激活，
 *      鼠标点到哪一句，就从该句开始自动推进（并按需朗读）。
 *   b) AI 讲解深链带 ?guide=1 → 本脚本激活，并由地址栏 #s=N 定位到指定句。
 * 两条路径都不满足时，本脚本不介入：不包句、不建控制条、不注入样式、不动 DOM。
 *
 * 结构：只有一个引擎实例（惰性建立一次）。开启/关闭只是在同一实例上
 * active 置真/置假，不新建第二个实例——否则每开关一次就会多一套
 * 监听器、MutationObserver 与样式，且侧栏持有的引用会停在旧实例上。
 *
 * 激活后：
 *  - 把当前正在显示的内容（皇帝档案 / 地图事件 / 路线站点 / 典籍名篇 / 神话热点）的正文
 *    按句切分，包成 <span class="gh-line" data-s="全局序号">。定位只看「哪块真的显示着」，
 *    不看 URL 参数——普通浏览没有 page/event/emperor 这些参数。
 *  - 高亮第 N 句（金色加粗 + 暖金底，桌面歌词风）。
 *  - 前端切句规则必须与 MCP Server（history-mcp-server.mjs 的 splitSentences）完全一致，
 *    保证 MCP 下发的锚点与页面 data-s 一一对齐。
 */
(function () {
  "use strict";

  var QUERY = new URLSearchParams(location.search);
  var guideMode = QUERY.get("guide") === "1";

  // ---------- 设置持久化 ----------
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
  var wantAutoplay = QUERY.get("autoplay") === "1";
  // 带 autoplay 的深链视为要求推进，但仅在用户从未设置过时生效
  if (wantAutoplay && !localStorage.getItem(SET_KEY)) settings.dwell = true;

  function guideEnabled() { return settings.speech || settings.dwell; }
  // 要不要包句/定位高亮：AI 深链或任一开关打开
  function viewActive() { return guideMode || guideEnabled(); }

  var engine = null;   // 唯一实例，惰性建立

  function getEngine() {
    if (!engine) engine = buildEngine();
    return engine;
  }

  // ---------- 对外接口：单一对象，始终存在 ----------
  // 关闭状态也必须可调用（侧栏要读 getSettings 才能回显勾选状态），
  // 所以这里不能再用「stub 或真实实现」两个对象来回换。
  window.__guide = {
    refresh: function () { if (engine) engine.refresh(); },
    currentS: function () { return engine ? engine.currentS() : 0; },
    setPlaying: function (on) { if (engine) engine.setPlaying(on); },
    goTo: function (s, o) { if (engine) engine.goTo(s, o); },
    stopGuide: function () { if (engine) engine.stopGuide(); },
    hasSpeech: function () { return !!window.speechSynthesis; },
    getSettings: function () { return { speech: settings.speech, dwell: settings.dwell }; },
    setSettings: function (patch) {
      if (patch && typeof patch.speech === "boolean") settings.speech = patch.speech;
      if (patch && typeof patch.dwell === "boolean") settings.dwell = patch.dwell;
      saveSettings(settings);
      var e = getEngine();          // 首次开启时建立；之后一直是同一个实例
      if (guideEnabled() || guideMode) e.activate();
      else e.deactivate();          // 关掉 → 真正回到纯静态（停播、撤条、解包、撤样式）
      return { speech: settings.speech, dwell: settings.dwell };
    },
  };

  function buildEngine() {
    // ============================ 样式与切句 ============================
    var STYLE_ID = "gh-style";
    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return;
      var styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      styleEl.textContent = [
        ".gh-line{border-radius:3px;padding:0 1px;margin:0 -1px;transition:background .28s ease,color .28s ease,box-shadow .28s ease;}",
        ".gh-line.gh-active{color:#8a5a00;font-weight:700;background:linear-gradient(180deg,rgba(255,242,198,0) 0%,rgba(255,223,128,.62) 52%,rgba(255,210,92,.85) 100%);box-shadow:0 0 0 1px rgba(184,134,11,.35);}",
        ".gh-line.gh-done{color:#9b7a3d;}",
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
    }
    function removeStyle() {
      var el = document.getElementById(STYLE_ID);
      if (el) el.remove();
    }

    // 与服务端共享的切句规则（句号/问号/感叹号/分号，保留句末标点；省略号 …… 不切句）
    var TERM_RE = /[。！？；;!?]/;
    // 仅由引号/括号收尾符组成的残句要并回上一句，前后端必须一致。
    var CLOSE_RE = /^[\s』」”）》〉、，]+$/;
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
    //  {k:'afterTag', el}  跳过首个元素子节点（如「点评」标签），其前文本节点为语料
    //  {k:'afterEl', el, child}  跳过指定子元素（如路线站名 <b>），其后文本节点为语料
    //  {k:'hot', el}       神话热点卡正文：原文与译文段交错，按文档顺序逐句替换
    function wrapHotSeq(el, state) {
      Array.prototype.forEach.call(Array.prototype.slice.call(el.childNodes), function (node) {
        if (node.nodeType === 3) {
          wrapTextNodeInPlace(node, state);
        } else if (node.nodeType === 1) {
          if (node.classList && node.classList.contains("tr")) {
            Array.prototype.slice.call(node.childNodes).forEach(function (c) {
              if (c.nodeType === 3) wrapTextNodeInPlace(c, state);
              else if (c.nodeType === 1) wrapHotSeq(c, state);
            });
          } else {
            wrapHotSeq(node, state);
          }
        }
      });
    }
    function wrapDescriptor(d, state) {
      if (d.k === "hot") { wrapHotSeq(d.el, state); return; }
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

    // ---------- 采集当前正在显示的内容的语料块（返回 null 表示内容尚未渲染） ----------
    // 只看「哪块真的显示着」，不依赖 URL 参数——
    // 普通浏览没有 page/event/emperor 这些参数，且切换朝代/皇帝只是改 class，不改地址。
    //
    // 判断「真的显示着」不能只看元素自己有没有 .hidden：帝王面板 #mega-history 整块隐藏时，
    // 里面的 #emperor-detail 自身仍不带 .hidden（它上次展开后就没收），
    // 于是切到别的板块后，导览仍会采集那套不可见的隋朝帝纪——表现为「念的都是隋朝」。
    // 因此统一用 isVisible() 向上查祖先，任一层 display:none / hidden 类都算不可见。
    function isVisible(el) {
      if (!el) return false;
      var node = el;
      while (node && node.nodeType === 1) {
        if (node.classList && node.classList.contains("hidden")) return false;
        var st = window.getComputedStyle(node);
        if (st.display === "none" || st.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    }
    /** 取第一个「存在且真的可见」的容器 */
    function firstVisible(sel) {
      var list = document.querySelectorAll(sel);
      for (var i = 0; i < list.length; i++) {
        if (isVisible(list[i])) return list[i];
      }
      return null;
    }

    function collectBlocks() {
      var isGuoxue = /\/guoxue\//.test(location.pathname);
      if (!isGuoxue) {
        // 1) 地图事件弹窗（最具体，优先）
        var pop = firstVisible("#map-popup");
        if (pop) {
          var blocks = [];
          var story = pop.querySelector("p:not([style])");
          if (story && story.textContent.trim()) blocks.push({ k: "pure", el: story });
          var rd = firstVisible("#route-detail");
          var stopLis = rd ? rd.querySelectorAll(".route-detail-stops li") : [];
          if (stopLis && stopLis.length) {
            var desc = rd.querySelector(".route-detail-desc");
            if (desc && desc.textContent.trim()) blocks.push({ k: "pure", el: desc });
            var sIdx = 0;
            Array.prototype.forEach.call(stopLis, function (li) {
              li.setAttribute("data-gh-station", String(sIdx++));
              var note = li.querySelector(".rs-note");
              if (note && note.textContent.trim()) blocks.push({ k: "pure", el: note });
            });
          }
          return blocks.length ? blocks : null;
        }
        // 2) 皇帝档案（时间线页选中皇帝后显示）
        var detail = firstVisible("#emperor-detail");
        if (detail) {
          var list = [];
          var intro = detail.querySelector(".intro");
          if (intro && intro.textContent.trim()) list.push({ k: "pure", el: intro });
          Array.prototype.forEach.call(detail.querySelectorAll(".timeline .tl-note"), function (n) {
            if (n.textContent.trim()) list.push({ k: "pure", el: n });
          });
          if (list.length) return list;
        }
        // 3) 路线详情卡（地图页）
        var rd2 = firstVisible("#route-detail");
        if (rd2) {
          var rlist = [];
          var rdesc = rd2.querySelector(".route-detail-desc");
          if (rdesc && rdesc.textContent.trim()) rlist.push({ k: "pure", el: rdesc });
          Array.prototype.forEach.call(rd2.querySelectorAll(".route-detail-stops li"), function (li) {
            var b = li.querySelector("b");
            rlist.push({ k: "afterEl", el: li, child: b });
          });
          if (rlist.length) return rlist;
        }
        return [];
      }

      // 国学四板块（iframe 内）
      var card = firstVisible(".sch-detail");
      if (card && card.textContent.trim()) {
        var src = card.querySelector(".sch-detail-src");
        var descP = card.querySelector("p:not(.sch-detail-src)");
        var g = [];
        if (src && src.textContent.trim()) g.push({ k: "pure", el: src });
        if (descP && descP.textContent.trim()) g.push({ k: "hot", el: descP });
        if (g.length) return g;
      }
      // 典籍正文：#book-detail 收起时（切了页签/换了书）里面的章节仍在 DOM，
      // 不判可见就会继续念上一本书——与帝王面板同一个坑。
      var bookDetail = firstVisible("#book-detail");
      var bookRoot = bookDetail && bookDetail.querySelector(".entry-panel[data-panel='chapters']");
      if (bookRoot) {
        var groups = [];
        Array.prototype.forEach.call(bookRoot.querySelectorAll(".chapter"), function (ch) {
          var ctx = ch.querySelector(".context");
          var ori = ch.querySelector(".original");
          var glo = ch.querySelector(".gloss");
          var aft = ch.querySelector(".afterword");
          if (ctx && ctx.textContent.trim()) groups.push({ k: "pure", el: ctx });
          if (ori && ori.textContent.trim()) groups.push({ k: "pure", el: ori });
          if (glo && glo.textContent.trim()) groups.push({ k: "pure", el: glo });
          if (aft && aft.textContent.trim()) groups.push({ k: "afterTag", el: aft });
        });
        if (groups.length) return groups;
      }
      return [];
    }

    var st = { n: 0, sig: "" };
    var lastIndex = -1;

    // 还原所有已包裹的句子为原始文本节点（重建前先解包，避免 data-s 重复）
    function unwrapAll() {
      Array.prototype.forEach.call(document.querySelectorAll(".gh-line"), function (sp) {
        var parent = sp.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(sp.textContent), sp);
        try { parent.normalize(); } catch (e) { /* 忽略 */ }
      });
      st.n = 0;
      st.sig = "";
      lastIndex = -1;
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
      st.n = 0;
      blocks.forEach(function (d) { wrapDescriptor(d, st); });
      st.sig = sigOf(blocks);         // 内容指纹：路线卡等异步后到时据此触发重建
      lastIndex = -1;                 // DOM 被重建，允许重新滚动定位
      return true;
    }

    // 当前句号只存内存，绝不写地址栏。两个踩过的坑都出在写这一行上：
    //   1) 写 location.hash 会触发浏览器锚点滚动 → 点一句页面自己跳；
    //   2) 用 replaceState 清/写 hash 会把 AI 深链的 #s=N 抹掉 → 深链永远停在第 0 句。
    // 只读不写就同时避开两者：深链在启动时读一次，之后外部改 hash（点 AI 给的
    // 多个 #s=i 链接、前进后退）由 hashchange 监听处理。
    var curS = 0;
    // pendingS：地址栏里那个 #s=N 还没「落到新内容上」。深链会先渲染占位内容、
    // 再切换皇帝/书等目标对象，中途 stopGuide 会把 curS 归零；若不留这个待定位目标，
    // 深链就永远走不到第 N 句。消费一次即清空，用户后来点句/播放不再被它抢回。
    var pendingS = null;
    function currentS() { return curS; }
    function hashS() {
      var m = /#s=(\d+)/.exec(location.hash || "");
      return m ? parseInt(m[1], 10) : null;
    }
    function syncCurFromHash() {
      var v = hashS();
      curS = v == null ? 0 : v;
      pendingS = null;
    }
    var suppressScroll = false; // 点击定位时不抢滚动（用户本来就盯着那句）
    var active = false;

    // 显式把句子在内部滚动容器内居中（直接赋值 scrollTop，避免 smooth scrollIntoView 在卡片内失效）
    function centerInScroller(target) {
      var node = target.parentElement;
      while (node && node.nodeType === 1) {
        var cs = window.getComputedStyle(node);
        if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 2) {
          var rel = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
          var dest = rel - (node.clientHeight - target.getBoundingClientRect().height) / 2;
          node.scrollTop = Math.max(0, Math.min(dest, node.scrollHeight - node.clientHeight));
          return true;
        }
        node = node.parentElement;
      }
      return false;
    }

    // 该句是否已完整落在可视范围内（页面级或内部滚动容器）。
    // 补滚定时器必须先用它判断——否则已可见的句子会被反复强行居中，表现为「点一下页面自己跳」。
    function isFullyVisible(el) {
      var r = el.getBoundingClientRect();
      var node = el.parentElement;
      while (node && node.nodeType === 1) {
        var cs = window.getComputedStyle(node);
        if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 2) {
          var sr = node.getBoundingClientRect();
          return r.top >= sr.top + 2 && r.bottom <= sr.bottom - 2;
        }
        node = node.parentElement;
      }
      return r.top >= 2 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight) - 2;
    }

    function scrollActive(target) {
      if (suppressScroll) return;
      if (!centerInScroller(target)) {
        try { target.scrollIntoView({ block: "center", behavior: "smooth" }); }
        catch (e) { target.scrollIntoView(); }
      }
      // 含图片的容器，内部滚动在图片加载后才出现：分几次补滚，仅当仍为当前句且尚未完整可见时
      [120, 350, 700, 1000, 1400, 1900].forEach(function (delay) {
        setTimeout(function () {
          if (!active || suppressScroll) return;                          // 已关闭或用户刚点过句
          if (!target.isConnected) return;
          if (target.getAttribute("data-s") !== String(curS)) return;       // 已换句，旧定时器作废
          if (isFullyVisible(target)) return;                              // 已看得见，别再动
          centerInScroller(target);
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

    // 高亮变化后的推进调度。不能靠「给 refresh 重新赋值」挂钩（函数声明提升，
    // MutationObserver 早已捕获旧的 refresh），故用 afterHighlight 变量挂上。
    var afterHighlight = null;
    var playing = false;
    var userPaused = false;      // 用户手动暂停过 → 不再自动重新起播
    var playingSpeaking = false; // 本轮播放由朗读驱动（而非字数计时）
    var dwellTimer = null;
    var lastScheduled = -1;

    function refresh() {
      if (!active) return;
      var blocks = collectBlocks();
      if (blocks === null) { highlight(curS); if (afterHighlight) afterHighlight(); return; } // 内容尚未渲染
      if (!blocks.length) {
        // 当前没有任何可读内容（如未选皇帝）：清掉可能残留的包裹行即可，不必反复重建
        if (document.querySelectorAll(".gh-line").length) unwrapAll();
        if (afterHighlight) afterHighlight();
        return;
      }
      var sig = sigOf(blocks);
      var needBuild = st.sig !== sig || document.querySelectorAll(".gh-line").length === 0;
      if (needBuild) {
        if (!build()) { if (afterHighlight) afterHighlight(); return; }
      }
      highlight(curS);
      if (afterHighlight) afterHighlight();
      settlePending();   // 深链 #s=N：内容就绪后把待定位目标落到位
    }

    // 把「地址栏里待定位的 #s=N」落到当前内容上（内容每次重建后都试一次）。
    // 只在真的存在可定位句子时消费，避免内容还没渲染就把它浪费掉。
    function settlePending() {
      if (pendingS == null) return false;
      var total = totalLines();
      if (!total) return false;
      var s = Math.max(0, Math.min(total - 1, pendingS));
      pendingS = null;
      if (s !== curS) { curS = s; lastIndex = -1; }
      highlight(curS);
      return true;
    }
    // 内容由 applyDeepLink 异步渲染（神话热点卡甚至会在约 900ms 后被覆盖重弹）：
    // 仅用 MutationObserver（防抖 80ms）自愈重建，不额外挂常驻轮询定时器。
    var debounce = null;
    var mo = new MutationObserver(function () {
      if (!active) return;
      clearTimeout(debounce);
      debounce = setTimeout(function () { refresh(); boot(); }, 80);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // ============================ 朗读 ============================
    var SPEEDS = [0.6, 1, 1.5, 2];
    var speedIdx = 1;
    function dwellFor(text) {
      var len = String(text || "").replace(/\s/g, "").length;
      var base = Math.min(9000, Math.max(2500, (1.2 + len * 0.11) * 1000));
      return base / SPEEDS[speedIdx];
    }

    var synth = (typeof window !== "undefined" && window.speechSynthesis) || null;
    var voice = null;
    function pickVoice() {
      if (!synth) return null;
      var vs = synth.getVoices() || [];
      var zh = vs.filter(function (v) { return /^zh(-|_)?/i.test(v.lang || ""); });
      voice = zh.find(function (v) { return v.localService && /CN|Hans|Xiaoxiao|Huihui|Yaoyao|Kangkang/i.test((v.lang || "") + (v.name || "")); })
        || zh.find(function (v) { return v.localService; })
        || zh[0] || null;
      return voice;
    }
    if (synth) {
      pickVoice();
      if (typeof synth.onvoiceschanged !== "undefined") synth.onvoiceschanged = pickVoice;
    }
    var speakWatchdog = null;
    var speakStartTimer = null;
    // 记录「哪些句已判定朗读失败」。失败只作用于那一句（下一句仍重试朗读），
    // 但同一句不能反复重试——否则 watchdog → scheduleNext → 再 speak → 再设 watchdog，形成死循环。
    var speechFailedAt = {};
    function speakCurrent() {
      if (!synth || !settings.speech) return false;
      var el = document.querySelector(".gh-line.gh-active");
      if (!el) return false;
      var text = (el.textContent || "").trim();
      if (!text) return false;
      if (speechFailedAt[curS]) return false; // 该句已判定朗读无效 → 交给计时推进
      try { if (synth.paused) synth.resume(); } catch (e) { /* 忽略 */ }
      try { synth.cancel(); } catch (e) { /* 忽略 */ }
      var u = new SpeechSynthesisUtterance(text);
      if (!voice) pickVoice();
      if (voice) u.voice = voice;
      u.lang = (voice && voice.lang) || "zh-CN";
      u.rate = SPEEDS[speedIdx];
      u.pitch = 1;
      var started = false;
      // 真正开始出声才算成功——只有 onstart 能区分「在念」和「被静默吞掉」。
      u.onstart = function () { started = true; };
      // 该句念完 → 推进下一句（真实语音时长，最准的时间轴）
      u.onend = function () {
        if (playing && settings.speech && playingSpeaking) next();
      };
      u.onerror = function () {
        if (playing) { lastScheduled = -1; scheduleNext(); }
      };
      playingSpeaking = true;
      // cancel 后立刻 speak 在部分 Chrome 上会被丢弃（不出声）：让出一个事件循环再念。
      // 这是兼容性兜底，不是唯一出声条件；语音引擎缺失时由下方 watchdog 转计时推进。
      try {
        setTimeout(function () { try { synth.speak(u); } catch (e) { /* 忽略 */ } }, 60);
      } catch (e) { playingSpeaking = false; return false; }
      clearTimeout(speakWatchdog);
      var sAt = curS;
      var chars = text.replace(/\s/g, "").length;
      var expectMs = Math.min(30000, Math.max(4000, chars * 320 / SPEEDS[speedIdx]));
      // 快速失败窗口：语音应在 1.2 秒内 onstart，否则基本可判定本句不会出声。
      var startDeadline = setTimeout(function () {
        if (!playing || !settings.speech) return;
        if (curS !== sAt) return;
        if (started) return;                       // 已开始出声，交给 onend / expectMs 窗口
        speechFailedAt[sAt] = true;
        lastScheduled = -1;
        try { synth.cancel(); } catch (e) { /* 忽略 */ }
        scheduleNext();
      }, Math.min(1200, expectMs));
      speakStartTimer = startDeadline;
      // 兜底 watchdog：到点仍未推进就强制推进下一句。
      // 不能信 synth.speaking —— 有的环境报告 speaking=true 却永不触发 onend
      // （无音频输出的 headless、以及 Chrome 已知的 onend 丢失），一味等 onend
      // 会让讲解永久卡在该句。上限取「文本推进节奏」而不是语音时长估算：
      //   - 有语音：正常在 onend 就推进了，根本走不到这里；
      //   - 无语音/丢 onend：按读者扫读一句的时间推进，与没开朗读时的观感一致，
      //     不会因为等一个永远不来的 onend 而停滞十几秒。
      var speakFallbackMs = dwellFor(text);
      speakWatchdog = setTimeout(function () {
        if (!playing || !settings.speech) return;
        if (curS !== sAt) return;                  // 已推进，说明 onend 生效
        clearTimeout(startDeadline);
        speechFailedAt[sAt] = true;                // 仅标记这一句失败，下一句仍会朗读
        lastScheduled = -1;
        try { synth.cancel(); } catch (e) { /* 忽略 */ }
        scheduleNext();                            // 本句无进展 → 计时推进下一句
      }, speakFallbackMs);
      return true;
    }
    function stopSpeaking() {
      playingSpeaking = false;
      clearTimeout(speakWatchdog);
      clearTimeout(speakStartTimer);
      if (synth) { try { synth.cancel(); } catch (e) { /* 忽略 */ } }
    }

    function totalLines() { return document.querySelectorAll(".gh-line").length; }

    function goTo(s, opts) {
      if (!active) return;
      var total = totalLines();
      if (!total) return;
      s = Math.max(0, Math.min(total - 1, s));
      stopSpeaking();
      clearTimeout(dwellTimer);
      lastScheduled = -1;
      if (opts && opts.fromClick) suppressScroll = true;  // 用户点了哪句就该句，不滚走
      curS = s;                                         // 只改内存，不动地址栏
      highlight(curS);                                  // 先高亮（.gh-active 就位）
      if (opts && opts.fromClick) suppressScroll = false;
      setPlaying(true);                                 // 再从该句开始推进/朗读
    }

    function next() {
      var total = totalLines();
      if (curS >= total - 1) { setPlaying(false); return; }
      goTo(curS + 1);
    }
    function prev() { goTo(curS - 1); }

    function scheduleNext() {
      // 同一句已排过计时不重排
      var s = curS;
      if (s === lastScheduled) return;
      clearTimeout(dwellTimer);
      if (!playing) return;
      lastScheduled = s;
      // 朗读优先：由语音 onend 驱动推进，不排字数计时。
      if (settings.speech) {
        playingSpeaking = true;
        if (speakCurrent()) return;
        playingSpeaking = false;   // speak 内部抛错 → 回落计时
      }
      playingSpeaking = false;
      var activeEl = document.querySelector(".gh-line.gh-active");
      var ms = dwellFor(activeEl ? activeEl.textContent : "");
      if (settings.speech && speechFailedAt[s]) ms = Math.min(ms, 3000 / SPEEDS[speedIdx]);
      dwellTimer = setTimeout(next, ms);
    }

    function setPlaying(on) {
      if (on) userPaused = false;   // 用户主动播放（按钮/空格/点句/autoplay）→ 解除「手动暂停」标记
      playing = on;
      clearTimeout(dwellTimer);
      var btn = document.getElementById("gh-main");
      if (btn) btn.textContent = on ? "⏸" : "▶";
      if (on) {
        var total = totalLines();
        if (total && curS >= total - 1) { curS = 0; highlight(0); }
        lastScheduled = -1;      // 重新播放时允许为本句重新排程
        scheduleNext();
      } else {
        stopSpeaking();
      }
    }

    function buildBar() {
      if (document.getElementById("gh-player")) return;
      if (!guideEnabled()) return;   // 两个开关都关 → 不建控制条，保持纯静态
      var titleText = settings.speech ? "朗读" : (guideMode ? "讲解" : "导览");
      var bar = document.createElement("div");
      bar.id = "gh-player";
      bar.innerHTML =
        '<span class="gh-title">' + titleText + '</span>' +
        '<button id="gh-prev" title="上一句（←）">⏮</button>' +
        '<button id="gh-main" title="' + titleText + ' / 暂停（空格）">▶</button>' +
        '<button id="gh-next" title="下一句（→）">⏭</button>' +
        '<span class="gh-prog">0 / 0</span>' +
        '<button class="gh-speed" title="播放/朗读速度">1×</button>';
      (document.body || document.documentElement).appendChild(bar);
      document.getElementById("gh-prev").addEventListener("click", function () { setPlaying(false); prev(); });
      document.getElementById("gh-next").addEventListener("click", function () { setPlaying(false); next(); });
      document.getElementById("gh-main").addEventListener("click", function () {
        if (playing) userPaused = true;   // 用户按了暂停 → 深链不再自动抢回播放
        setPlaying(!playing);
      });
      document.querySelector("#gh-player .gh-speed").addEventListener("click", function () {
        speedIdx = (speedIdx + 1) % SPEEDS.length;
        this.textContent = SPEEDS[speedIdx] + "×";
        if (playing) { lastScheduled = -1; scheduleNext(); }   // 变速立即对当前句生效
      });
    }
    function removeBar() {
      playing = false;
      clearTimeout(dwellTimer);
      stopSpeaking();
      var bar = document.getElementById("gh-player");
      if (bar) bar.remove();
    }

    // 高亮变化后重排下一句计时（含自动推进本身引起的 hash 变化）。
    afterHighlight = function () {
      if (!active || !guideEnabled()) return;
      var total = totalLines();
      var prog = document.querySelector("#gh-player .gh-prog");
      if (prog && total) prog.textContent = (curS + 1) + " / " + total;
      // AI 深链（autoplay=1）的「打开即逐句推进」要能跨越内容切换：
      // 深链先渲染占位内容、再由 applyDeepLink 选中目标对象，中途的 stopGuide 会停掉播放，
      // 若不在新内容就绪后重新起播，链接就停在 ▶ 不动了。用户手动暂停过则不再自动抢回。
      if (wantAutoplay && !userPaused && !playing && total) { lastScheduled = -1; setPlaying(true); return; }
      if (total && playing && curS !== lastScheduled) scheduleNext();
    };

    // 建控制条并起播。不能「等 totalLines()>0 再 refresh」——句子是被 refresh 包出来的，
    // 没有任何 DOM 变动（如未选皇帝）时永远等不到，形成死锁。故先主动 refresh 一次。
    var booted = false;
    function boot() {
      if (!active || booted) return;
      if (!viewActive()) return;
      refresh();                     // 先包句 + 高亮（guide=1 无开关也应定位 #s=N）
      settlePending();                // 深链 #s=N 尽快落位
      if (!totalLines()) return;     // 内容还没渲染，交给 MutationObserver 稍后再来
      booted = true;
      if (guideEnabled()) {
        buildBar();
        refresh();                   // 控制条就位后再刷一次，进度/高亮才对
        if (wantAutoplay && !playing) setPlaying(true);
      }
    }

    // 点正文任意一句 → 从该句开始推进（并按需朗读）。这是导览脱离 AI 讲解也能用的关键。
    document.addEventListener("click", function (e) {
      if (!active || !guideEnabled()) return;
      var line = e.target && e.target.closest ? e.target.closest(".gh-line") : null;
      if (!line) return;
      var s = parseInt(line.getAttribute("data-s"), 10);
      if (isNaN(s)) return;
      goTo(s, { fromClick: true });
    });

    // 切换朝代/皇帝/模块/书/热点时，主程序会调用 stopGuide() 停下播放，
    // 避免旧内容的朗读/推进跨到新内容继续。
    // 这里只停播并归零，绝不改写地址栏——抹掉 #s=N 会让 AI 深链永远定位到第 0 句。
    function stopGuide() {
      setPlaying(false);
      clearTimeout(dwellTimer);
      stopSpeaking();
      curS = 0;
      lastScheduled = -1;
      lastIndex = -1;
      // 地址栏若仍带 #s=N（AI 深链），记下待定位目标，等内容切换完再落位；
      // 普通浏览没有 #s，pendingS 保持 null，就是干净归零。
      pendingS = hashS();
    }

    // 激活：只做一次性的安装（样式、首次包句、起播）
    function activate() {
      if (active) { refresh(); return; }
      active = true;
      booted = false;
      ensureStyle();
      syncCurFromHash();
      boot();
    }

    // 关闭：停播、撤条、解包、撤样式 → 页面真正回到纯静态
    function deactivate() {
      if (!active) return;
      active = false;
      booted = false;
      removeBar();
      clearTimeout(dwellTimer);
      clearTimeout(debounce);
      stopSpeaking();
      unwrapAll();
      removeStyle();
    }

    // 挂 hash / popstate 监听（只挂一次）
    window.addEventListener("hashchange", function () { if (!active) return; syncCurFromHash(); refresh(); });
    window.addEventListener("popstate", function () { if (!active) return; syncCurFromHash(); refresh(); });

    return {
      activate: activate,
      deactivate: deactivate,
      refresh: refresh,
      currentS: currentS,
      setPlaying: setPlaying,
      goTo: goTo,
      stopGuide: stopGuide,
    };
  }

  // 初次进入：如果 URL 或已存设置要求导览，立刻激活；否则保持纯静态，
  // 等用户在侧栏勾选时由 setSettings → activate() 启动。
  if (guideMode || guideEnabled()) getEngine().activate();
})();
