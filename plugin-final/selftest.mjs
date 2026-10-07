// 验证 patch config 场景：dataDir 由 cordis.patch.yml 传入绝对路径
import { join } from 'node:path';
import { apply } from './index.js';

const registered = new Map();
const mockCtx = {
  effect: (fn) => { fn(); return () => {}; },
  tools: { register: (t) => { registered.set(t.name, t); return () => {}; } },
  get: () => undefined,
};

// 与 cordis.patch.yml 中的 config 一致
const config = { dataDir: 'D:/quant/dsh_his/data', llmProvider: '', llmModel: '' };
apply(mockCtx, config);

const exec = { signal: new AbortController().signal };
const v = await registered.get('ming_explain').execute({ topic: '朱棣', age: 9 }, exec);
console.log('patch-config 场景 ok:', v.ok);
console.log('subject:', v.data?.subject, '| ageBand:', v.data?.ageBand);
console.log('sections:', v.data?.sections?.map((s) => s.title).join(' → '));
console.log('时间线条目:', v.data?.timeline?.length, '| 地名:', v.data?.places?.length, '| 人物:', v.data?.people?.length);
console.log('出处:', v.data?.sources?.join('、'));
console.log('想一想:', v.data?.sections?.find((s) => s.title === '想一想')?.body);

// 诊断：知识层加载状态
const ev = await registered.get('ming_search').execute({ query: '土木堡' }, exec);
console.log('\n检索命中:', ev.data?.hits?.length, '条');
console.log('命中类型:', ev.data?.hits?.map((h) => `${h.type}:${h.title}`).join(' | '));
