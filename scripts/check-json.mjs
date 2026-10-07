import fs from 'fs';
import path from 'path';
const dirs = ['data/tang', 'data/song', 'data/cases', 'data/yuan'];
for (const d of dirs) {
  const files = fs.readdirSync(d).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const p = path.join(d, f);
    try {
      JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      console.log('FAIL', p, e.message);
    }
  }
}
// emperors subdir
for (const dyn of ['tang', 'song', 'yuan']) {
  const d = `data/${dyn}/emperors`;
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter(f => f.endsWith('.json'))) {
    const p = path.join(d, f);
    try { JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.log('FAIL', p, e.message); }
  }
}
console.log('done');
