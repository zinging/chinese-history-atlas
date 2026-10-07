/* 检索核心：与 DSH 插件 ming_search 相同的检索规则，供前端（历史侦探等）使用。
   数据源：../data 各库。每条命中带出处（书名）。 */

'use strict';

const SEARCH = (() => {
  let DATA = null;

  function setData(data) { DATA = data; }

  function sourceTitle(id) {
    const s = DATA?.sourcesDoc?.sources?.find((x) => x.id === id);
    return s ? s.title : id;
  }

  /** 与插件 resolveEmperor 同规则：名字/庙号精确或包含，年号包含 */
  function resolveEmperor(input) {
    const s = String(input || '').trim();
    if (!s) return undefined;
    for (const e of DATA.emperors) {
      if (s === e.name || s === e.templeName || s.includes(e.name) || s.includes(e.templeName)) return e;
    }
    for (const e of DATA.emperors) {
      if ((e.eraName || []).some((y) => s.includes(y))) return e;
    }
    return undefined;
  }

  /** 皇帝大事文本：各朝统一有 timeline[{date,title,description}]，优先使用；
   *  无 timeline 时回退 majorEvents（明为 {name,summary}，其余多为字符串）。 */
  function emperorTimelineText(em) {
    const fmtItem = (t) => {
      if (typeof t === 'string') return t;
      const head = `${t.date ? t.date + ' ' : ''}${t.title || t.name || ''}`;
      const body = t.description || t.summary || '';
      return body ? `${head}：${body}` : head;
    };
    if (Array.isArray(em.timeline) && em.timeline.length) return em.timeline.map(fmtItem).join('；');
    if (Array.isArray(em.majorEvents) && em.majorEvents.length) return em.majorEvents.map(fmtItem).join('；');
    return '';
  }

  /** 检索：query → hits[{type,title,text,sources[],id}] */
  function search(query) {
    const q = String(query || '').trim();
    if (!q || !DATA) return [];
    const hits = [];
    const push = (type, id, title, text, sources) =>
      hits.push({ type, id, title, text: text == null ? '' : String(text), sources: (sources || []).map(sourceTitle) });

    for (const e of DATA.events) {
      if (q.includes(e.name) || e.name.includes(q) || q.includes(e.era)) {
        push('事件', e.id, e.name, `${e.summary} ${e.narrative}`, e.sources);
      }
    }
    for (const p of DATA.people) {
      if (q.includes(p.name) || p.name.includes(q)) {
        // 各朝字段不一：多数用 bio，唐/宋用 note；附 role（身份/官职）
        const bioText = p.bio || p.note || '';
        push('人物', p.id, p.name, `${p.role ? `【${p.role}】` : ''}${bioText}`, p.sources);
      }
    }
    for (const i of DATA.institutions) {
      if (q.includes(i.name) || i.name.includes(q)) push('制度', i.id, i.name, `${i.intro} ${i.howItWorks}`, i.sources);
    }
    const em = resolveEmperor(q);
    if (em) push('皇帝', em.id, em.name, `${em.intro || em.summary || ''} ${emperorTimelineText(em)}`, em.sources);
    for (const p of DATA.places) {
      if (q.includes(p.name) || q.includes(p.modernName)) {
        push('地名', p.name, p.name, `${p.name}（今${p.modernName}）：${p.note}${p.story ? ' ' + p.story : ''}`, ['zhongguoditu']);
      }
    }
    for (const c of DATA.cases || []) {
      const cn = c.name || c.title;
      if (!cn) continue;
      if (q.includes(cn) || cn.includes(q)) {
        push('案件', c.id, cn, `${c.summary || ''} ${c.background || ''} ${c.process || ''} ${c.result || ''}`, c.sources);
      }
    }
    return hits;
  }

  /** 命中与检索词的相关度：标题完全一致 > 互相包含 > 年号等弱匹配 */
  function hitScore(h, q) {
    const t = h.title || '';
    if (t === q) return 3;
    if (q.includes(t) || t.includes(q)) return 2;
    return 1;
  }

  /** 历史侦探线索生成：按任务配置的检索词，返回带出处的线索卡
   *  task: { queries: [检索词...], open: 开放问题（无标准答案，附双视角） }
   *  规则：每个检索词先按相关度、再按文本长度挑最优命中；跨检索词按 type:id 去重，
   *  已被前面检索词占用的命中不再出现（避免线索重复）；无可用命中则跳过该词。 */
  function cluesFor(task) {
    const out = [];
    const used = new Set();
    let n = 0;
    for (const q of task.queries) {
      const hits = search(q)
        .filter((h) => h.text && String(h.text).trim())
        .sort((a, b) => (hitScore(b, q) - hitScore(a, q)) || b.text.length - a.text.length);
      const h = hits.find((x) => !used.has(`${x.type}:${x.id}`));
      if (h) {
        used.add(`${h.type}:${h.id}`);
        n += 1;
        out.push({
          title: `线索${'一二三四'[n - 1] || n} · ${h.type}：${h.title}`,
          text: h.text,
          src: `知识库 · ${h.title} · 出处：${h.sources.join('、')}`,
          type: h.type,
        });
      }
    }
    // 开放问题不再作为线索卡，改由页面在档案标题下方以小字展示（思辨引导）
    return out;
  }

  return { setData, search, cluesFor, resolveEmperor };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SEARCH;
