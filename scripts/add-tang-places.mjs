import fs from 'fs';

const replacements = [
  ['长安', '长安（今陕西西安）'],
  ['范阳', '范阳（今北京西南）'],
  ['灵武', '灵武（今宁夏灵武西南）'],
  ['江都', '江都（今江苏扬州）'],
];

const files = fs.readdirSync('data/tang/emperors').filter(f => f.endsWith('.json') && f !== 'index.json');
for (const file of files) {
  const p = 'data/tang/emperors/' + file;
  let text = fs.readFileSync(p, 'utf8');
  let changed = false;
  for (const [old, newStr] of replacements) {
    // 只替换第一次出现，且后面不是（今
    const re = new RegExp(old + '(?!（今)');
    if (re.test(text)) {
      text = text.replace(re, newStr);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(p, text);
    console.log('OK', file);
  }
}
