// search-core 单元测试：验证检索规则与插件 ming_search 一致
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync('web/search-core.js', 'utf8');
const context = { module: { exports: {} }, exports: {} };
vm.createContext(context);
vm.runInContext(src, context);
const SEARCH = context.module.exports;

// 喂数据
const j = (p) => JSON.parse(readFileSync(`data/${p}`, 'utf8'));
const data = {
  emperors: j('emperors/index.json').emperors.map((e) => JSON.parse(readFileSync(`data/emperors/${e.file}`, 'utf8'))),
  people: j('people/people.json').people,
  events: j('events/events.json').events,
  institutions: j('institutions/institutions.json').institutions,
  places: j('places/places.json').places,
  sourcesDoc: j('sources/sources.json'),
};
SEARCH.setData(data);

let fail = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' ' + extra}`);
  if (!cond) fail++;
}

// 事件检索
let hits = SEARCH.search('郑和为什么下西洋');
check('检索"郑和为什么下西洋"命中郑和', hits.some((h) => h.type === '人物' && h.title === '郑和'));
check('命中带出处', hits[0].sources.length > 0);

hits = SEARCH.search('土木堡之变');
check('检索"土木堡之变"命中事件', hits.some((h) => h.type === '事件' && h.title === '土木堡之变'));

hits = SEARCH.search('张居正改革');
check('检索"张居正改革"命中事件/人物', hits.length > 0, `实际 ${hits.length}`);

hits = SEARCH.search('迁都北京');
check('检索"迁都北京"命中事件', hits.some((h) => h.type === '事件' && h.title === '迁都北京'));
hits = SEARCH.search('朱棣');
check('检索"朱棣"命中皇帝', hits.some((h) => h.type === '皇帝' && h.title === '朱棣'));

hits = SEARCH.search('一条鞭法');
check('检索"一条鞭法"命中制度', hits.some((h) => h.type === '制度'));

hits = SEARCH.search('苏州');
check('检索"苏州"命中地名', hits.some((h) => h.type === '地名' && h.title === '苏州'));

hits = SEARCH.search('不存在的词xyz');
check('检索无命中返回空', hits.length === 0);

// 历史侦探线索生成
// 注意：当前设计里开放问题不再作为线索卡（由页面在标题下方小字展示），
// 因此这里只校验检索线索数量与出处。
const task = {
  queries: ['郑和下西洋', '郑和'],
  open: { question: '你觉得值吗？', viewpoints: ['A', 'B'] },
};
const clues = SEARCH.cluesFor(task);
check('检索线索≥2条', clues.length >= 2, `实际 ${clues.length}`);
check('检索线索带出处', clues[0].src.includes('出处：'));
check('开放问题不计入线索卡', !clues.some((c) => c.type === '开放问题'));

// 线索标题序号
check('线索标题含"线索一"', clues[0].title.includes('线索一'));

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail ? 1 : 0);