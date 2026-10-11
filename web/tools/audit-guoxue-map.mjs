// 统计国学各流派的地图数据现状
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const D = join(process.cwd(), 'data');
const sects = ['rujia', 'daojia', 'foxue', 'zhuzi', 'lixue', 'shiwen'];
const total = { places: 0, routes: 0, books: 0, cases: 0, quiz: 0 };
console.log('流派      books  cases  places  routes  quiz   地名字段示例');
for (const s of sects) {
  const j = JSON.parse(readFileSync(join(D, s, 'index.json'), 'utf8'));
  const p = j.places || [], r = j.routes || [];
  total.places += p.length; total.routes += r.length;
  total.books += (j.books || []).length; total.cases += (j.cases || []).length;
  total.quiz += (j.quiz || []).length;
  const sample = p[0] ? `${p[0].name}(${Object.keys(p[0]).join('/')})` : '—';
  console.log(`${s.padEnd(9)} ${String(j.books?.length ?? 0).padStart(4)}  ${String(j.cases?.length ?? 0).padStart(5)}  ${String(p.length).padStart(6)}  ${String(r.length).padStart(6)}  ${String(j.quiz?.length ?? 0).padStart(4)}   ${sample}`);
}
console.log('\n合计:', JSON.stringify(total));
// places 的字段一致性：地图弹窗要靠这些字段
const pj = JSON.parse(readFileSync(join(D, 'shiwen', 'index.json'), 'utf8'));
const keys = new Set();
for (const s of sects) {
  const j = JSON.parse(readFileSync(join(D, s, 'index.json'), 'utf8'));
  for (const p of j.places || []) Object.keys(p).forEach((k) => keys.add(k));
}
console.log('places 全部字段:', [...keys].join(', '));
const rkeys = new Set();
for (const s of sects) {
  const j = JSON.parse(readFileSync(join(D, s, 'index.json'), 'utf8'));
  for (const r of j.routes || []) { Object.keys(r).forEach((k) => rkeys.add(k)); (r.points || []).forEach((pt) => Object.keys(pt).forEach((k) => rkeys.add('point.' + k))); }
}
console.log('routes 全部字段:', [...rkeys].join(', '));
// 检查 guoxue 图层依赖的历史资源（GeoJSON / 河流 / 边界）
console.log('\nguoxue/vendor 内容:', readdirSync(join(process.cwd(), 'web', 'guoxue', 'vendor')));