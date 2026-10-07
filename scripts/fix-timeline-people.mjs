import fs from 'fs';

// 需要修改的文件和具体修改：找到对应时间线条目，把人物事迹织进去
const edits = {
  // 赵匡胤：陈桥兵变和杯酒释兵权要提到赵普
  'taizu.json': [
    {find: '夜宿陈桥驿。次日一早，部下把黄袍披在他身上',
     replace: '夜宿陈桥驿。幕僚赵普和弟弟赵光义密谋部署，次日一早，部下把黄袍披在他身上'},
    {find: '宴请石守信等老将，用一场酒席和平收回兵权',
     replace: '在宰相赵普建议下，宴请石守信等老将，用一场酒席和平收回兵权'}
  ],
  // 赵光义：要提到赵普（赵普在太宗朝复相）
  'taizong.json': [
    {find: '即位后改元太平兴国',
     replace: '即位后召赵普回朝复相，赵普献上"金匮之盟"的说法，为太宗即位合法性背书'}
  ],
  // 赵恒：毕士安是澶渊之盟时的宰相
  'zhenzong.json': [
    {find: '宰相寇准硬把他推到前线澶州督战',
     replace: '宰相寇准和毕士安硬把他推到前线澶州（今河南濮阳）督战'}
  ],
  // 赵祯：欧阳修是仁宗朝文坛领袖
  'renzong.json': [
    {find: '范仲淹、包拯等名臣都在这一朝',
     replace: '范仲淹、包拯、欧阳修等名臣都在这一朝，欧阳修主持科举，录取了苏轼、苏辙'}
  ],
  // 赵昀：孟珙是联蒙灭金的主将
  'lizong.json': [
    {find: '与蒙古合围蔡州，金哀宗自缢，金亡',
     replace: '大将孟珙率军与蒙古合围蔡州（今河南汝南），金哀宗自缢，金亡'}
  ],
  // 赵惇：留正是两朝宰相
  'guangzong.json': [
    {find: '光宗因与父亲有隔阂，拒绝主持丧礼。朝野哗然',
     replace: '光宗因与父亲有隔阂，拒绝主持丧礼。宰相留正率百官请高宗吴太后垂帘，留正本人也辞官出京，朝野哗然'}
  ],
  // 赵昚：陆游是孝宗朝诗人
  'xiaozong.json': [
    {find: '1163年（隆兴元年）用张浚为枢密使',
     replace: '1163年（隆兴元年）用张浚为枢密使，诗人陆游也在这几年被召入临安，力主北伐'}
  ],
  // 赵㬎：文天祥
  'gongdi.json': [
    {find: '元军兵临临安，谢太皇太后携五岁的小皇帝出降',
     replace: '元军兵临临安，右丞相文天祥出使元营被扣留，谢太皇太后携五岁的小皇帝出降'}
  ]
};

for (const [file, changes] of Object.entries(edits)) {
  const p = 'data/song/emperors/' + file;
  let d = JSON.parse(fs.readFileSync(p, 'utf8'));
  let text = JSON.stringify(d, null, 2);
  for (const c of changes) {
    if (!text.includes(c.find)) {
      console.log('WARN not found in', file, ':', c.find.slice(0, 30));
      continue;
    }
    text = text.replace(c.find, c.replace);
  }
  fs.writeFileSync(p, text);
  console.log('OK', file, d.name);
}
