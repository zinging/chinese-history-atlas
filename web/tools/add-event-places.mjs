#!/usr/bin/env node
/* 为 map-events.json 的每个事件补充 place 字段（古地名+今地名+一句话说明），
 * 供地图"该朝事件"汇总与事件地名标记使用。
 * 用法：node web/tools/add-event-places.mjs
 * 数据：每个事件的 place = { name: 古地名, modern: 今地名, note: 该地名与事件的一句话关联 }
 */
import { readFileSync, writeFileSync } from 'node:fs';

const PLACES = {
  // ===== 明朝（data/events/map-events.json）=====
  'ming-event-poyang':            { name: '鄱阳湖', modern: '江西鄱阳湖', note: '朱元璋在此火攻大败陈友谅，奠定建国基础。' },
  'ming-event-hongwu-yimin':      { name: '洪洞大槐树', modern: '山西洪洞县', note: '明初大移民的集合出发地，很多北方人祖籍都写这里。' },
  'ming-event-jingnan':           { name: '南京', modern: '江苏南京', note: '朱棣从北平打到南京，攻入皇宫登基。' },
  'ming-event-pingding-hanwang':  { name: '乐安', modern: '山东惠民县一带', note: '宣德帝亲征乐安，擒获造反的汉王朱高煦。' },
  'ming-event-tumu':              { name: '土木堡', modern: '河北怀来县土木堡一带', note: '英宗亲征在此被瓦剌包围俘虏。' },
  'ming-event-beijing-fangwei':   { name: '北京', modern: '北京', note: '于谦率军民死守北京城，打退瓦剌。' },
  'ming-event-duomen':            { name: '南宫', modern: '北京', note: '英宗被软禁的南宫，夺门之变后复辟。' },
  'ming-event-chenghua-liting':   { name: '建州', modern: '辽宁东部新宾一带', note: '成化年间明军犁平建州女真，史称成化犁庭。' },
  'ming-event-yingzhou-dajie':    { name: '应州', modern: '山西应县', note: '武宗自称大将军亲征，在此击退蒙古骑兵。' },
  'ming-event-gengxu':            { name: '北京', modern: '北京', note: '俺答汗兵临北京城下，明廷求和，史称庚戌之变。' },
  'ming-event-taizhou':           { name: '台州', modern: '浙江台州', note: '戚继光率戚家军在台州九战九捷抗倭。' },
  'ming-event-zhangjuzheng':      { name: '北京', modern: '北京', note: '张居正任首辅推行一条鞭法等改革，十年新政。' },
  'ming-event-kangwo-yuanchao':   { name: '平壤', modern: '朝鲜平壤', note: '万历援朝抗倭，李如松收复平壤。' },
  'ming-event-saerhu':            { name: '萨尔浒', modern: '辽宁抚顺东', note: '努尔哈赤在萨尔浒大破明军四路，明金兴亡之战。' },
  'ming-event-wei-zhongxian':     { name: '北京', modern: '北京', note: '魏忠贤把持朝政，阉党乱政的中心。' },
  'ming-event-ningyuan':          { name: '宁远', modern: '辽宁兴城', note: '袁崇焕坚守宁远孤城，炮伤努尔哈赤。' },
  'ming-event-shanhaiguan':       { name: '山海关', modern: '河北秦皇岛山海关', note: '吴三桂引清军入关的关口，明亡清兴。' },
  'ming-event-chongzhen-ziyi':    { name: '煤山', modern: '北京景山', note: '李自成破北京，崇祯帝在此自缢，明朝灭亡。' },
  'ming-event-fengyang-qibing':   { name: '濠州', modern: '安徽凤阳', note: '朱元璋在濠州投红巾军，从此起兵。' },
  'ming-event-ke-dadu':           { name: '大都', modern: '北京', note: '徐达攻克元大都，元顺帝北逃，元朝灭亡。' },
  'ming-event-buyuerhai':         { name: '捕鱼儿海', modern: '内蒙古贝尔湖一带', note: '蓝玉在此扫灭北元王庭。' },
  'ming-event-hu-weiyong':        { name: '南京', modern: '江苏南京', note: '胡惟庸案爆发，朱元璋废丞相，株连数万人。' },
  'ming-event-longchang':         { name: '龙场', modern: '贵州修文县', note: '王阳明被贬龙场驿，悟出知行合一。' },
  'ming-event-ningwang':          { name: '南昌', modern: '江西南昌', note: '宁王朱宸濠从南昌起兵，王阳明43天平叛。' },
  'ming-event-daliyi':            { name: '左顺门', modern: '北京故宫午门外', note: '大礼议之争，官员在左顺门哭谏被廷杖。' },
  'ming-event-renyin':            { name: '乾清宫', modern: '北京故宫', note: '壬寅宫变，宫女们夜里想勒死嘉靖帝。' },
  'ming-event-zhenggong':         { name: '宁波', modern: '浙江宁波', note: '日本两拨使节在宁波为争贡互斗，引发争贡之役。' },
  'ming-event-ningxia-zhi':       { name: '宁夏', modern: '宁夏银川', note: '宁夏之役，万历派兵平定哱拜叛乱。' },
  'ming-event-bozhou-zhi':        { name: '播州', modern: '贵州遵义一带', note: '播州之役，万历平定杨应龙之乱。' },
  'ming-event-hetuala':           { name: '赫图阿拉', modern: '辽宁新宾', note: '努尔哈赤在赫图阿拉建后金称汗。' },
  'ming-event-jisi':              { name: '北京', modern: '北京', note: '己巳之变，皇太极绕道入关兵临北京城下。' },
  'ming-event-wuqiao':            { name: '吴桥', modern: '河北吴桥县', note: '吴桥兵变，孔有德叛明降清，带去火炮。' },
  'ming-event-zhangxianzhong':    { name: '成都', modern: '四川成都', note: '张献忠在成都称帝，建立大西政权。' },
  'ming-event-yangzhou':          { name: '扬州', modern: '江苏扬州', note: '清军攻扬州十日屠城，史可法殉国。' },
  'ming-event-jiangyin':          { name: '江阴', modern: '江苏江阴', note: '江阴百姓坚守八十一日抗清，宁死不降。' },
  'ming-event-longqing-kaiguan':  { name: '月港', modern: '福建漳州海澄', note: '隆庆开关，开放月港为唯一对外通商口岸。' },
  'ming-event-yongle-dadian':     { name: '南京', modern: '江苏南京', note: '永乐大典在此编成，世界最大百科全书。' },
  'ming-event-tangsair':          { name: '蒲台', modern: '山东滨州蒲台县', note: '唐赛儿在山东蒲台起义，明初女起义领袖。' },
  'ming-event-nuergan':           { name: '奴儿干', modern: '黑龙江下游特林', note: '明设奴儿干都司管辖黑龙江流域。' },
  'ming-event-zhenghe-qihang':    { name: '刘家港', modern: '江苏太仓', note: '郑和船队从刘家港起锚，七下西洋。' },
  'ming-event-caoshi':            { name: '北京', modern: '北京', note: '曹吉祥、石亨在京城发动叛乱，被平定。' },
  'ming-event-hongzhi-zhongxing': { name: '北京', modern: '北京', note: '明孝宗在京城刷新庶政，史称弘治中兴。' },
  'ming-event-liudaxia-he':       { name: '黄陵冈', modern: '河南兰考县一带', note: '刘大夏在此主持治理黄河水患。' },
  // ===== 宋朝（data/song/map-events.json）=====
  'song-event-chenqiao':          { name: '陈桥驿', modern: '河南封丘县陈桥镇', note: '赵匡胤在陈桥驿被部下黄袍加身，回师开封建宋。' },
  'song-event-yongxi':            { name: '陈家谷', modern: '山西朔州一带', note: '杨业在陈家谷战败被俘，绝食殉国。' },
  'song-event-chanyuan':          { name: '澶州', modern: '河南濮阳', note: '宋真宗亲征澶州，与辽订澶渊之盟。' },
  'song-event-wanganshi':         { name: '开封', modern: '河南开封', note: '王安石在汴京推行变法。' },
  'song-event-jiakang':           { name: '东京', modern: '河南开封', note: '金兵攻破东京开封，北宋灭亡，靖康之变。' },
  'song-event-nandu':             { name: '临安', modern: '浙江杭州', note: '宋高宗南渡定都临安，史称建炎南渡。' },
  'song-event-yuefei':            { name: '郾城', modern: '河南漯河郾城区', note: '岳飞在郾城大破金军铁浮屠。' },
  'song-event-shaoxing-heyi':     { name: '风波亭', modern: '浙江杭州', note: '岳飞被以莫须有罪名害死在风波亭。' },
  'song-event-longxing':          { name: '符离', modern: '安徽宿州符离集', note: '隆兴北伐，宋军符离之溃。' },
  'song-event-kaixi':             { name: '宿州', modern: '安徽宿州', note: '开禧北伐，宋军兵溃宿州。' },
  'song-event-duanping':          { name: '洛阳', modern: '河南洛阳', note: '端平入洛，宋军收复洛阳旋即失败。' },
  'song-event-xiangfan':          { name: '襄樊', modern: '湖北襄阳樊城', note: '襄阳保卫战坚守六年，城破南宋门户失守。' },
  'song-event-yashan':            { name: '崖山', modern: '广东江门新会', note: '崖山海战宋军覆没，陆秀夫负帝蹈海，南宋亡。' },
  'song-event-wentianxiang':      { name: '大都', modern: '北京', note: '文天祥被俘押到大都，宁死不降，就义于此。' },
};

function patch(file, events) {
  const g = JSON.parse(readFileSync(file, 'utf8'));
  let added = 0;
  for (const e of (g.events || [])) {
    const p = PLACES[e.eventId];
    if (p) { e.place = p; added++; }
    else console.log('  ⚠ 缺 place:', e.eventId, e.name);
  }
  writeFileSync(file, JSON.stringify(g, null, 2) + '\n');
  return added;
}

const ming = patch('data/events/map-events.json');
const song = patch('data/song/map-events.json');
console.log(`\n完成：明朝补 ${ming} 个，宋朝补 ${song} 个。`);
