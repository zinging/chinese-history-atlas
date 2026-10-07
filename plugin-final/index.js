/**
 * 明朝演变学习 · 教学编排层骨架（Phase 1）
 *
 * 六个 Agent 以「模型可调用工具」形态落地，全部走知识层 data/ 数据，零 LLM 依赖。
 * 每个 Agent 对应一个工具，输入孩子的请求，输出教学素材（含出处、开放问题、视觉数据）。
 *
 * 设计原则落法：
 *  - 非应试：所有输出带 controversies（开放问题），不判对错
 *  - 图文并茂：输出带 timeline / places / people 视觉数据位
 *  - 孩子当导演：决策场景输出分支，让孩子选
 *
 * 数据加载：插件激活时把 data/ 下 JSON 读入内存只读缓存（内容层已过校验）。
 * LLM 增强：config.llmProvider/llmModel 配置后走 ctx.llm.stream；未配置则走确定性模板。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const inject = ['tools'];

/** 插件目录上级（D:\quant\dsh_his\plugin → D:\quant\dsh_his）即内容层根目录 */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(PLUGIN_DIR, '..', 'data');

function loadJson(dir, file) {
  try {
    return JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } catch (e) {
    return { error: `无法加载 ${file}: ${e.message}` };
  }
}

function loadKnowledge(dataDir) {
  const k = { emperors: {} };
  k._dataDir = dataDir;
  try {
    const idx = loadJson(dataDir, 'emperors/index.json');
    if (Array.isArray(idx.emperors)) {
      for (const e of idx.emperors) {
        const entry = loadJson(dataDir, `emperors/${e.file}`);
        if (entry && entry.id) k.emperors[entry.id] = entry;
      }
    } else {
      k._error = idx.error || 'emperors/index.json 缺少 emperors 数组';
    }
  } catch (e) {
    k._error = `emperors/index.json 加载失败: ${e.message}`;
  }
  k.events = loadJson(dataDir, 'events/events.json');
  k.people = loadJson(dataDir, 'people/people.json');
  k.institutions = loadJson(dataDir, 'institutions/institutions.json');
  k.places = loadJson(dataDir, 'places/places.json');
  k.sources = loadJson(dataDir, 'sources/sources.json');
  k.cases = loadJson(dataDir, 'cases/cases.json');
  k._ready = true;
  return k;
}

function resolveEmperor(k, input) {
  const s = String(input || '').trim();
  if (!s) return undefined;
  for (const e of Object.values(k.emperors)) {
    if (s === e.name || s === e.templeName || s.includes(e.name) || s.includes(e.templeName)) return e;
  }
  for (const e of Object.values(k.emperors)) {
    if (e.eraName.some((y) => s.includes(y))) return e;
  }
  return undefined;
}

function sourceTitle(k, id) {
  const s = k.sources?.sources?.find((x) => x.id === id);
  return s ? s.title : id;
}

function makeTool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: { type: 'object' }, note: { type: 'string' } }, additionalProperties: true },
      render(args, value) {
        const blocks = [{ type: 'text', text: `## ${name}` }];
        if (value?.data) blocks.push({ type: 'text', text: JSON.stringify(value.data, null, 2) });
        if (value?.note) blocks.push({ type: 'text', text: `\n${value.note}` });
        return blocks;
      },
    },
    execute: async (args, exec) => {
      try {
        return await execute(args, exec);
      } catch (e) {
        return { ok: false, data: { error: String(e?.message || e) }, note: `执行出错：${e?.message || e}` };
      }
    },
  };
}

export function apply(ctx, config = {}) {
  // 数据目录：config 优先，否则插件目录上级（内容层根目录）
  const dataDir = config.dataDir || DEFAULT_DATA_DIR;
  const knowledge = loadKnowledge(dataDir);
  const llmProvider = config.llmProvider || '';
  const llmModel = config.llmModel || '';
  const hasLlm = Boolean(llmProvider && llmModel);

  function register(tool) {
    ctx.effect(() => ctx.tools.register(tool));
  }

  async function maybeLlm(system, user, signal) {
    if (!hasLlm) return null;
    const llm = ctx.get?.('llm');
    if (!llm?.stream) return null;
    let text = '';
    try {
      for await (const chunk of llm.stream({
        provider: llmProvider,
        model: llmModel,
        system,
        messages: [{ role: 'user', content: user }],
        signal,
      })) {
        if (chunk.type === 'text-delta') text += chunk.text;
        if (chunk.type === 'finish' && chunk.reason?.kind === 'error') return null;
      }
    } catch {
      return null;
    }
    return text.trim() || null;
  }

  // Agent 1: 分龄讲解
  register(makeTool(
    'ming_explain',
    '根据孩子的年龄段，讲解一个明朝皇帝或历史事件。输出分段讲解稿（含开放问题）。',
    {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '皇帝名、庙号、年号或事件名，如 朱棣 / 永乐 / 靖难之役' },
        age: { type: 'integer', description: '孩子年龄，6-12', minimum: 6, maximum: 12 },
      },
      required: ['topic'],
    },
    async (args, exec) => {
      const topic = String(args.topic || '');
      const age = Number(args.age || 9);
      const emperor = resolveEmperor(knowledge, topic);
      if (emperor) {
        const ageBand = age <= 8 ? '低年级（6-8岁）' : age <= 10 ? '中年级（9-10岁）' : '高年级（11-12岁）';
        const data = {
          subject: emperor.name,
          ageBand,
          sections: [
            { title: '他是谁', body: emperor.intro },
            { title: '干了什么', body: (emperor.majorEvents || []).map((m) => `${m.name}：${m.summary}`).join('；') },
            { title: '想一想', body: (emperor.controversies || []).map((c) => c.question).join('；') || '你觉得这位皇帝做得对吗？为什么？' },
          ],
          timeline: emperor.timeline,
          places: emperor.places,
          people: emperor.people,
          sources: (emperor.sources || []).map(sourceTitle.bind(null, knowledge)),
        };
        const llmText = await maybeLlm(
          '你是明朝演变学习的分龄讲解老师。用孩子听得懂的话讲历史，不设标准答案，多用开放问题。',
          `用${ageBand}的讲法介绍 ${emperor.name}：${emperor.intro}。`,
          exec.signal,
        );
        if (llmText) data.llmDraft = llmText;
        return { ok: true, data, note: `已按${ageBand}输出 ${emperor.name} 讲解稿。` };
      }
      const ev = (knowledge.events?.events || []).find((e) => topic.includes(e.name) || e.name.includes(topic));
      if (ev) {
        const data = {
          subject: ev.name,
          sections: [
            { title: '发生了什么', body: ev.narrative },
            { title: '影响', body: ev.impact },
            { title: '想一想', body: (ev.controversies || []).map((c) => c.question).join('；') },
          ],
          participants: ev.participants,
          funFacts: ev.funFacts,
          sources: (ev.sources || []).map(sourceTitle.bind(null, knowledge)),
        };
        return { ok: true, data, note: `已输出 ${ev.name} 讲解稿。` };
      }
      return { ok: false, data: {}, note: `没找到「${topic}」，试试：朱棣、靖难之役、郑和下西洋、土木堡之变、张居正改革。` };
    },
  ));

  // Agent 2: RAG 检索
  register(makeTool(
    'ming_search',
    '在明朝知识库里检索孩子的问题，返回匹配的史料片段（带出处），供讲解引用。',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: '孩子的提问，如 郑和为什么下西洋' },
      },
      required: ['query'],
    },
    async (args) => {
      const q = String(args.query || '').trim();
      if (!q) return { ok: false, data: {}, note: '请输入问题。' };
      const hits = [];
      const push = (type, title, text, sources) => hits.push({ type, title, text, sources: (sources || []).map(sourceTitle.bind(null, knowledge)) });
      for (const e of knowledge.events?.events || []) {
        if (q.includes(e.name) || e.name.includes(q) || q.includes(e.era)) push('事件', e.name, `${e.summary} ${e.narrative}`, e.sources);
      }
      for (const p of knowledge.people?.people || []) {
        if (q.includes(p.name) || p.name.includes(q)) push('人物', p.name, p.bio, p.sources);
      }
      for (const i of knowledge.institutions?.institutions || []) {
        if (q.includes(i.name) || i.name.includes(q)) push('制度', i.name, `${i.intro} ${i.howItWorks}`, i.sources);
      }
      const em = resolveEmperor(knowledge, q);
      if (em) push('皇帝', em.name, `${em.intro} ${(em.majorEvents || []).map((m) => `${m.name}：${m.summary}`).join('；')}`, em.sources);
      for (const p of knowledge.places?.places || []) {
        if (q.includes(p.name) || q.includes(p.modernName)) push('地名', p.name, `${p.name}（今${p.modernName}）：${p.note}`, ['zhongguoditu']);
      }
      for (const c of knowledge.cases?.cases || []) {
        if (q.includes(c.name) || c.name.includes(q)) push('案件', c.name, `${c.summary} ${c.background} ${c.process} ${c.result} ${c.impact}`, c.sources);
      }
      if (!hits.length) return { ok: false, data: {}, note: `知识库里没找到和「${q}」相关的内容，换个问法试试？` };
      return { ok: true, data: { query: q, hits }, note: `找到 ${hits.length} 条相关史料。` };
    },
  ));

  // Agent 3: 测验生成（无标准答案）
  register(makeTool(
    'ming_quiz',
    '生成无标准答案的讨论题和决策场景，鼓励孩子追问和选择。',
    {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '范围：皇帝名、事件名或制度名' },
        count: { type: 'integer', description: '题目数量 1-3', minimum: 1, maximum: 3 },
      },
      required: ['topic'],
    },
    async (args) => {
      const topic = String(args.topic || '');
      const count = Math.min(3, Math.max(1, Number(args.count || 2)));
      const em = resolveEmperor(knowledge, topic);
      const ev = (knowledge.events?.events || []).find((e) => topic.includes(e.name) || e.name.includes(topic));
      const inst = (knowledge.institutions?.institutions || []).find((i) => topic.includes(i.name) || i.name.includes(topic));
      const pool = [];
      if (em) pool.push(...(em.controversies || []).map((c) => ({ kind: '讨论', title: em.name, question: c.question, context: c.context, viewpoints: c.viewpoints })));
      if (ev) pool.push(...(ev.controversies || []).map((c) => ({ kind: '讨论', title: ev.name, question: c.question, context: c.context, viewpoints: c.viewpoints })));
      if (inst) pool.push({ kind: '讨论', title: inst.name, question: `你觉得${inst.name}这样的制度，如果今天还在，会是什么样子？`, context: inst.howItWorks, viewpoints: ['它会带来方便，比如……', '它会带来麻烦，比如……'] });
      if (em) pool.push({
        kind: '决策',
        title: em.name,
        question: `如果你是${em.name}，${(em.controversies || []).map((c) => c.context).join('；') || '面对这个难题'}，你会怎么做？`,
        context: '没有标准答案，说出你的理由。',
        viewpoints: ['方案A：按你的第一直觉做。', '方案B：先问问身边人。', '方案C：先拖一拖再看看。'],
      });
      if (!pool.length) return { ok: false, data: {}, note: `没找到「${topic}」可出的题。` };
      const picked = pool.slice(0, count);
      return {
        ok: true,
        data: {
          topic,
          questions: picked.map((q, i) => ({ no: i + 1, kind: q.kind, title: q.title, question: q.question, context: q.context, viewpoints: q.viewpoints, prompt: '你怎么看？没有对错，说说你的理由。' })),
        },
        note: '这些题没有标准答案，重在让孩子说出自己的想法。',
      };
    },
  ));

  // Agent 4: 可视化数据
  register(makeTool(
    'ming_visualize',
    '为一个皇帝或事件生成时间线/地图/人物卡片所需的 JSON 数据（供前端渲染）。',
    {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '皇帝名或事件名' },
      },
      required: ['topic'],
    },
    async (args) => {
      const topic = String(args.topic || '');
      const em = resolveEmperor(knowledge, topic);
      if (em) {
        return {
          ok: true,
          data: {
            subject: em.name,
            timeline: (em.timeline || []).map((t) => ({ date: t.date, title: t.title, description: t.description })),
            map: (em.places || []).map((p) => ({ name: p.name, modernName: p.modernName, lat: p.lat, lng: p.lng, note: p.note })),
            cards: (em.people || []).map((p) => ({ name: p.name, relation: p.relation, note: p.note })),
            funFacts: (em.funFacts || []).map((f) => f.fact),
          },
          note: '时间线、地图热区、人物卡片数据已就绪，前端直接渲染。',
        };
      }
      const cs = (knowledge.cases?.cases || []).find((c) => topic.includes(c.name) || c.name.includes(topic));
      if (cs) {
        const cat = (knowledge.cases?.categories || []).find((c) => c.id === cs.category);
        return {
          ok: true,
          data: {
            subject: cs.name,
            category: cat?.name || cs.category,
            date: cs.date,
            summary: cs.summary,
            nameOrigin: cs.nameOrigin,
            background: cs.background,
            people: cs.people,
            process: cs.process,
            result: cs.result,
            impact: cs.impact,
            sources: (cs.sources || []).map(sourceTitle.bind(null, knowledge)),
          },
          note: '案件卡数据已就绪（背景/人物/经过/结果/影响）。',
        };
      }
      const ev = (knowledge.events?.events || []).find((e) => topic.includes(e.name) || e.name.includes(topic));
      if (ev) {
        return {
          ok: true,
          data: {
            subject: ev.name,
            date: ev.date,
            participants: ev.participants,
            summary: ev.summary,
            funFacts: ev.funFacts,
          },
          note: '事件卡片数据已就绪。',
        };
      }
      return { ok: false, data: {}, note: `没找到「${topic}」的视觉数据。` };
    },
  ));

  // Agent 5: 角色扮演
  register(makeTool(
    'ming_roleplay',
    '生成一个历史人物的角色扮演剧本，含场景、台词、分支选择（孩子当导演）。',
    {
      type: 'object',
      properties: {
        person: { type: 'string', description: '历史人物名，如 于谦、朱棣、郑和' },
        scene: { type: 'string', description: '场景，如 北京保卫战前夜' },
      },
      required: ['person'],
    },
    async (args) => {
      const person = String(args.person || '');
      const scene = String(args.scene || '');
      const p = (knowledge.people?.people || []).find((x) => person.includes(x.name) || x.name.includes(person));
      const em = resolveEmperor(knowledge, person);
      const target = p || em;
      if (!target) return { ok: false, data: {}, note: `人物库/皇帝库都没找到「${person}」。` };
      const name = target.name;
      const era = target.era || target.eraName?.[0] || '明代';
      const bio = target.bio || target.intro || '';
      const data = {
        role: name,
        era,
        scene: scene || `${era}的一个关键时刻`,
        opening: `你是${name}（${bio}）。现在是${scene || '你人生中的重要时刻'}，你面前有一个选择。`,
        choices: [
          { label: '方案A', consequence: '你选择了一条路，接下来会发生什么？', prompt: '说出你的理由，我来扮演回应你。' },
          { label: '方案B', consequence: '你选择另一条路，结果可能完全不同。', prompt: '想想你会失去什么、得到什么。' },
          { label: '方案C', consequence: '你也可以什么都不做——不做选择也是一种选择。', prompt: '会发生什么？' },
        ],
        prompt: '你来当导演：选一个方案，告诉我你的理由，我扮演这个人物回应你。',
      };
      return { ok: true, data, note: `已生成 ${name} 的角色扮演剧本，让孩子当导演。` };
    },
  ));

  // Agent 6: 家长报告
  register(makeTool(
    'ming_report',
    '根据孩子的提问记录，生成给家长的成长报告：孩子问了什么、做了什么选择、有哪些值得鼓励的思维。',
    {
      type: 'object',
      properties: {
        records: {
          type: 'array',
          items: { type: 'string', description: '一条孩子的提问或发言' },
          description: '孩子最近的问题/发言列表',
        },
      },
      required: ['records'],
    },
    async (args) => {
      const records = Array.isArray(args.records) ? args.records.map(String) : [];
      if (!records.length) return { ok: false, data: {}, note: '没有孩子的问题记录可分析。' };
      const topics = [];
      for (const r of records) {
        const em = resolveEmperor(knowledge, r);
        if (em) topics.push(em.name);
        const ev = (knowledge.events?.events || []).find((e) => r.includes(e.name));
        if (ev) topics.push(ev.name);
        const per = (knowledge.people?.people || []).find((p) => r.includes(p.name));
        if (per) topics.push(per.name);
      }
      const unique = [...new Set(topics)];
      const data = {
        summary: `孩子问了 ${records.length} 个问题，对 ${unique.length || '明朝'} 的历史产生了兴趣。`,
        topics: unique,
        highlights: [
          records.filter((r) => /为什么|怎么|如果|你觉得/.test(r)).length
            ? '孩子大量使用「为什么」「如果」——这正是开放提问的好习惯，值得鼓励。'
            : '可以引导孩子多用「为什么」「如果你是」来提问。',
          '孩子问了问题、做了选择，就是主动学习；不急着给标准答案，让他自己慢慢想。',
        ],
        suggestions: [
          '和孩子一起重演一个历史场景，让他当导演，你当演员。',
          '鼓励他把「如果是你会怎么做」的答案说给你听，不问对错。',
        ],
      };
      return { ok: true, data, note: '报告已生成（无标准答案、鼓励探索视角）。' };
    },
  ));

  return () => {
    // 已注册工具的清理由 ctx.effect 在卸载时自动执行
  };
}