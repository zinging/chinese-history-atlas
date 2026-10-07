import fs from 'fs';

// 需要加注释的古地名（只在第一次出现时加，且附近没有(今）
const replacements = [
  ['燕云十六州', '燕云十六州（今北京、天津及河北、山西北部）'],
  ['陈家谷', '陈家谷（今山西朔州南）'],
  ['岐沟关', '岐沟关（今河北涿州西南）'],
  ['高梁河', '高梁河（今北京西直门外）'],
  ['蔡州', '蔡州（今河南汝南）'],
  ['朱仙镇', '朱仙镇（今河南开封西南）'],
  ['郾城', '郾城（今河南漯河）'],
  ['黄天荡', '黄天荡（今江苏南京东北）'],
  ['五国城', '五国城（今黑龙江依兰）'],
  ['五坡岭', '五坡岭（今广东海丰北）'],
  ['白沟河', '白沟河（今河北雄县白沟镇）'],
  ['大散关', '大散关（今陕西宝鸡西南）'],
];

// 需要处理的文件
const files = [];
const empDir = 'data/song/emperors/';
fs.readdirSync(empDir).filter(f => f.endsWith('.json') && f !== 'index.json').forEach(f => files.push(empDir + f));
['data/song/events.json', 'data/song/cases.json', 'data/song/people.json'].forEach(f => files.push(f));

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
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
    fs.writeFileSync(file, text);
    console.log('OK', file);
  }
}
