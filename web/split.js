/*
 * 中华历史图谱 · 逐句切分（全站唯一实现）
 *
 * 为什么单独抽一个文件：切句规则必须「页面包句」与「索引分句」完全一致，
 * 否则搜索结果算出的句子与页面上的 .gh-line 对不上，落到行就会错位。
 * 历史上这条规则在三个地方各有一份拷贝：
 *   1) web/guide-highlight.js（页面包句）
 *   2) web/tools/history-mcp-server.mjs（MCP 下发的 #s=N 锚点）
 *   3) 本人这次新增的构建脚本 scripts/build-search.mjs
 * 从 gapp27 起三处统一到这里：浏览器挂 window.__split，Node 走 module.exports。
 *
 * 规则（与服务端历史实现逐字等价，改之前先想清楚 #s=N 深链会不会错位）：
 *   - 句末标点：。！？；;!?  → 切句，保留句末标点
 *   - 省略号 …… 不切句（它常表示语气停顿，不是句界）
 *   - 只有引号/括号收尾符组成的残句，并回上一句
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__split = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var TERM_RE = /[。！？；;!?]/;
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

  return { split: splitSentences, TERM_RE: TERM_RE, CLOSE_RE: CLOSE_RE };
});
