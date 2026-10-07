import fs from 'fs';
let s = fs.readFileSync('data/tang/cases.json', 'utf8');
const fixes = [
  ['叫"玄武门之变"', '叫「玄武门之变」'],
  ['入宫"保卫"皇帝', '入宫「保卫」皇帝'],
  ['冲进来"护驾"', '冲进来「护驾」'],
  ['说"秦王因为太子、齐王作乱，已经出兵平乱，派我来保卫陛下"', '说「秦王因为太子、齐王作乱，已经出兵平乱，派我来保卫陛下」'],
  ['说"你为什么要离间我们兄弟？"魏征说"太子要是早听我的话，就不会有今天了"', '说「你为什么要离间我们兄弟？」魏征说「太子要是早听我的话，就不会有今天了」'],
  ['开创了"贞观之治"', '开创了「贞观之治」'],
  ['命令史官"照实写"', '命令史官「照实写」'],
];
for (const [a, b] of fixes) s = s.split(a).join(b);
fs.writeFileSync('data/tang/cases.json', s);
JSON.parse(s);
console.log('OK');
