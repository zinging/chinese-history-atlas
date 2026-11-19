/*
 * 中华历史图谱 · 搜索结果跳转与「落到行」定位
 *
 * 设计前提（很重要，别改成预生成句号）：
 *   guide-highlight.js 的 data-s 是「每次渲染按可见内容重排的全局序号」，
 *   同一篇文字在皇帝卡、路线卡、典籍章节里的 s 值都不同，且换一次渲染就变。
 *   所以索引里**不能**存句号，只能存 query；到目标页 DOM 就绪后按文本找最短窗口。
 *
 * 落点类型（k，由 scripts/build-search.mjs 按文档 type 映射）：
 *   emperor → #emperor-detail        case → .case-card      popup → #map-popup / #route-detail
 *   route   → #route-detail          stop → .route-detail-stops li
 *   chapter → #book-detail .chapter  lightbox → 灯箱          quiz → #quiz-list
 *
 * 子站（iframe 内四个板块）复用同一份文件：父壳把 q/ak 参数随 src 转发进 iframe，
 * 子站自己的 applyDeepLink 末尾调 locate() —— 不用 postMessage，避免「子站还没 ready」的竞态。
 */
(function () {
  "use strict";

  var HIT_CLASS = "atlas-hit";
  var HIT_MS = 3200;

  function isVisible(el) {
    if (!el || !el.nodeType) return false;
    var node = el;
    while (node && node.nodeType === 1) {
      var st = window.getComputedStyle(node);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      if (el.getBoundingClientRect && el.getBoundingClientRect().height === 0 && el.offsetHeight === 0) return false;
      node = node.parentElement;
    }
    return true;
  }

  /** 与 guide-highlight 的口径一致：优先 .gh-line（那就是页面上真正成句的单元） */
  function candidates(container) {
    if (!container) return [];
    var lines = container.querySelectorAll(".gh-line");
    if (lines.length) return Array.prototype.slice.call(lines);
    var blocks = container.querySelectorAll("p, li, .rs-note, .case-summary, .route-detail-desc, td, h1, h2, h3, h4");
    return Array.prototype.slice.call(blocks)
      .filter(function (el) { return (el.textContent || "").trim().length > 3; });
  }

  function containersFor(k) {
    switch (k) {
      case "emperor": return ["#emperor-detail"];
      case "case": return ["#cases-list .case-card", ".case-card"];
      case "popup": return ["#map-popup", "#route-detail"];
      case "route": return ["#route-detail"];
      case "stop": return ["#route-detail .route-detail-stops li", "#route-detail"];
      case "chapter": return ["#book-detail .chapter", "#book-detail"];
      case "quiz": return ["#quiz-list", "#detective-ask"];
      case "lightbox": return ["#lightbox", ".lightbox", "#artifact-lightbox"];
      default: return ["#map-popup", "#route-detail", "#emperor-detail", ".case-card", "#book-detail", "main"];
    }
  }

  /** 候选查询串：原串 → 按标点/空格切开的片段 → 前 6 字（中文长句几乎不会整串命中） */
  function queriesOf(q) {
    var raw = String(q || "").trim();
    if (!raw) return [];
    var out = [raw];
    var pieces = raw.split(/[\s，,。、；;：:！!？?（）()「」『』《》…·]+/).filter(function (s) { return s.length >= 2; });
    pieces.forEach(function (s) { if (s !== raw) out.push(s); });
    if (raw.length >= 6) out.push(raw.slice(0, 6));
    if (raw.length >= 4) out.push(raw.slice(0, 4));
    // 去重，保序
    var seen = {}, list = [];
    out.forEach(function (s) { if (!seen[s]) { seen[s] = 1; list.push(s); } });
    return list;
  }

  function shortestHit(container, queries) {
    var nodes = candidates(container);
    var best = null, bestQ = "", bestLen = Infinity;
    for (var qi = 0; qi < queries.length; qi++) {
      var q = queries[qi];
      for (var i = 0; i < nodes.length; i++) {
        var t = nodes[i].textContent || "";
        if (t.indexOf(q) < 0) continue;
        if (t.length < bestLen) { best = nodes[i]; bestLen = t.length; bestQ = q; }
      }
      if (best) break;   // 长串优先；长串没命中才降级到片段
    }
    return best ? { el: best, q: bestQ } : null;
  }

  /** 在内部滚动容器里居中（卡片内部滚动时 scrollIntoView 常常无效，与导览同款处理） */
  function center(el) {
    var node = el.parentElement;
    while (node && node.nodeType === 1) {
      var cs = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 2) {
        var rel = el.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
        var dest = rel - (node.clientHeight - el.getBoundingClientRect().height) / 2;
        node.scrollTop = Math.max(0, Math.min(dest, node.scrollHeight - node.clientHeight));
        return true;
      }
      node = node.parentElement;
    }
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    catch (e) { el.scrollIntoView(); }
    return true;
  }

  function flash(el) {
    var old = document.querySelectorAll("." + HIT_CLASS);
    Array.prototype.forEach.call(old, function (n) { n.classList.remove(HIT_CLASS); });
    el.classList.add(HIT_CLASS);
    setTimeout(function () { el.classList.remove(HIT_CLASS); }, HIT_MS);
  }

  function tryLocate(q, k, alt) {
    var qs = queriesOf(q);
    var qa = alt ? queriesOf(alt) : [];
    if (!qs.length && !qa.length) return false;
    var containers = containersFor(k);
    var visibleBox = null;
    for (var pass = 0; pass < 2; pass++) {
      var list = pass === 0 ? qs : qa;
      if (!list.length) continue;
      for (var i = 0; i < containers.length; i++) {
        var nodes = document.querySelectorAll(containers[i]);
        for (var j = 0; j < nodes.length; j++) {
          var box = nodes[j];
          if (!isVisible(box)) continue;
          if (!visibleBox) visibleBox = box;
          var hit = shortestHit(box, list);
          if (hit) {
            flash(hit.el);
            center(hit.el);
            try {
              var li = hit.el.closest && hit.el.closest("[data-lat][data-lng]");
              if (li && typeof window.__guideFlyTo === "function") {
                window.__guideFlyTo(parseFloat(li.dataset.lat), parseFloat(li.dataset.lng));
              }
            } catch (e) { /* 地图跟随失败不影响定位 */ }
            return true;
          }
        }
      }
    }
    // 兜底：整张卡片里没有这个串（索引的正文是从数据 JSON 提的，可能落在页面不显示的字段上），
    // 那就把卡片本身滚到中间并闪一下——「点进来却什么都没发生」比「停在卡片」更糟。
    if (visibleBox) { flash(visibleBox); center(visibleBox); return true; }
    return false;
  }

  var pending = null;

  window.__atlasJump = {
    /** 定位并高亮。返回 Promise<boolean>；目标还没渲染好时会重试（最多 ~6s）。
     *  q = 用户输入的查询串；alt = 词条标题（输入串在正文里没原样命中时兜底用）。 */
    locate: function (q, k, alt) {
      if (pending) { clearInterval(pending.timer); pending = null; }
      var altText = alt;
      if (altText == null) {
        var p0 = new URLSearchParams(location.search);
        altText = p0.get("qt") || "";
      }
      return new Promise(function (resolve) {
        var tries = 0, timer = null;
        var tick = function () {
          tries++;
          if (tryLocate(q, k, altText)) { clearInterval(timer); pending = null; resolve(true); return; }
          if (tries >= 30) { clearInterval(timer); pending = null; resolve(false); }
        };
        // 首跳给渲染让两帧，避免拿到上一份内容的旧节点
        requestAnimationFrame(function () { requestAnimationFrame(tick); });
        timer = setInterval(tick, 200);
        pending = { timer: timer };
      });
    },
    /** 当前查询串（跳到目标页后由 applyDeepLink 读取） */
    fromQuery: function () {
      var p = new URLSearchParams(location.search);
      return { q: p.get("q") || "", k: p.get("ak") || "", alt: p.get("qt") || "" };
    },
    queriesOf: queriesOf,
  };
})();
