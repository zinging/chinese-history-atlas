import fs from 'fs';

// 修：李世民重复的贞观之治条目合并
{
  const p = 'data/tang/emperors/taizong.json';
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.timeline = d.timeline.filter(t => t.date !== '628');
  // 替换627条目为更详细版本
  const t = d.timeline.find(t => t.date === '627');
  if (t) t.description = '改元贞观。他任用魏征（谏臣，敢当面批评皇帝）、房玄龄、杜如晦（贤相组合，史称"房谋杜断"），虚心纳谏，轻徭薄赋。他把中央官员从两千多人精简到六百多员，史称"贞观之治"。';
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
  console.log('OK taizong: 合并重复条目');
}

// 修：武曌 660 条目文言化
{
  const p = 'data/tang/emperors/wuzeitian.json';
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.timeline.find(t => t.date === '660');
  if (t) t.description = '高宗患风眩病（高血压引起头晕目眩），眼睛看不清奏章。百官奏事，高宗就让武后帮着批阅。武后聪明，又读过书，处理得很合皇帝心意，从此朝廷大权逐渐转移到武后手里。高宗上朝时，武后坐帘子后面听政，天下人称"二圣"（两个皇帝）。';
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
  console.log('OK wu: 660条目改写通俗');
}

// 修：李隆基 713-741 开元盛世 太简略
{
  const p = 'data/tang/emperors/xuanzong.json';
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.timeline.find(t => t.date === '713-741');
  if (t) t.description = '前期用姚崇、宋璟、张说、张九龄四位贤相。姚崇提"十事要说"（十条施政纲领），宋璟执法不阿，张九龄敢直言。这几十年户口增长、米价便宜、路不拾遗，唐朝国力达到顶峰，史称"开元盛世"。这也是李白、杜甫活跃的时代。';
  const t2 = d.timeline.find(t => t.date === '736');
  if (t2) t2.description = '张九龄因为反对重用朔方节度使牛仙客、弹劾李林甫，被罢相。从此宰相变成李林甫（口蜜腹剑这个成语就是说他）、牛仙客、杨国忠。李林甫当宰相十九年，排斥忠良，朝政日坏。';
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
  console.log('OK xuanzong: 开元盛世、张九龄罢相扩写');
}

// 修：李豫（代宗）几条过短
{
  const p = 'data/tang/emperors/daizong.json';
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t1 = d.timeline.find(t => t.date === '763');
  if (t1) t1.description = '史朝义（史思明之子）在穷途末路上自缢，历时八年的安史之乱结束。但朝廷为了尽快平乱，对投降的河北叛将就地封官——田承嗣、李宝臣、李怀仙都成了节度使，河北三镇从此割据，不听朝廷号令，为唐朝灭亡埋下祸根。';
  const t2 = d.timeline.find(t => t.date === '763' && t.title.includes('吐蕃'));
  if (t2) t2.description = '吐蕃趁唐朝内乱，二十万大军东进，长安（今陕西西安）守军溃散，代宗仓皇逃到陕州（今河南三门峡）。郭子仪临时凑了几千兵，在长安城外白天击鼓、晚上点火，吐蕃以为唐大军回来了，不战而退。这是长安在唐朝第二次被外族攻陷。';
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
  console.log('OK daizong: 安史之乱结束、吐蕃入长安扩写');
}

// 修：李纯 805 即位、814 讨淮西
{
  const p = 'data/tang/emperors/xianzong.json';
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.timeline.find(t => t.date === '805');
  if (t) t.description = '顺宗中风不能说话，宦官俱文珍等人逼着顺宗禅位给太子李纯。李纯即位时二十七岁，他立志恢复太宗、玄宗的盛世，一上台就决心解决安史之乱以来的藩镇割据问题。';
  const t2 = d.timeline.find(t => t.date === '814');
  if (t2) t2.description = '淮西节度使吴少阳死，他儿子吴元济不向朝廷报丧，自己接班，还发兵四出抢掠。宪宗决意讨伐，从全国各地调了十六道兵马，打了三年。中间朝廷动摇过几次，但宪宗咬牙坚持，最终用李愬雪夜入蔡州一战解决。';
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
  console.log('OK xianzong: 即位、讨淮西扩写');
}

// 修：李儇 885 条目
{
  const p = 'data/tang/emperors/xuizong.json';
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.timeline.find(t => t.date === '885');
  if (t) t.description = '黄巢平定后，僖宗回到长安。但宦官田令孜和河中节度使王重荣为了争安邑、解县两个盐池的税收闹翻，田令孜发兵攻打王重荣。王重荣请来山西沙陀族酋长李克用帮忙，沙陀铁骑直逼长安，田令孜连夜带着僖宗又逃到凤翔（今陕西宝鸡凤翔区）。皇帝第二次被赶出长安。';
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
  console.log('OK xuizong: 885条目扩写');
}

console.log('全部修完');
