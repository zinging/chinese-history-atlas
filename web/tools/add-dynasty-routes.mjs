#!/usr/bin/env node
/* 为唐/元/清/隋/五代 建立 routes.json（史实行军/流动路线，明/宋已有）
 * 每条：id/name/year/color/desc/points[{name,modern,lat,lng,note}] */
import { writeFileSync } from 'node:fs';

const routes = {
  tang: {
    meta: { title: '唐朝关键路线', description: '有史实行军/流动记载的重要事迹路线（示意，非精确路径）', updated: '2026-10-06' },
    routes: [
      { id: 'tang-jinyang-changan', name: '李渊晋阳起兵·攻入长安', year: 617, color: '#c0392b',
        desc: '617年，李渊从太原晋阳起兵，沿汾河谷南下，渡过黄河攻入长安。',
        points: [
          { name: '晋阳', modern: '山西太原', lat: 37.87, lng: 112.55, note: '李渊起兵之地' },
          { name: '霍邑', modern: '山西霍州', lat: 36.57, lng: 111.72, note: '大败隋将宋老生' },
          { name: '河东', modern: '山西永济', lat: 34.87, lng: 110.44, note: '渡黄河前据点' },
          { name: '长安', modern: '陕西西安', lat: 34.27, lng: 108.95, note: '攻入隋都，次年建唐' },
        ] },
      { id: 'tang-mie-dongtujue', name: '唐灭东突厥·出塞远征', year: 630, color: '#2e7d32',
        desc: '630年，李靖率军出塞夜袭阴山，生擒颉利可汗，东突厥灭亡。',
        points: [
          { name: '长安', modern: '陕西西安', lat: 34.27, lng: 108.95, note: '唐军出发地' },
          { name: '朔州', modern: '山西朔州', lat: 39.33, lng: 112.43, note: '唐军集结地' },
          { name: '白道', modern: '内蒙古呼和浩特北', lat: 40.85, lng: 111.6, note: '李靖夜袭阴山要道' },
          { name: '阴山', modern: '内蒙古阴山', lat: 41.0, lng: 112.0, note: '大破突厥，俘颉利可汗' },
        ] },
      { id: 'tang-zheng-gaogouli', name: '唐太宗亲征高句丽', year: 645, color: '#2471a3',
        desc: '645年，唐太宗亲率大军东征高句丽，攻安市城不下而班师。',
        points: [
          { name: '长安', modern: '陕西西安', lat: 34.27, lng: 108.95, note: '御驾亲征出发' },
          { name: '幽州', modern: '北京', lat: 39.9, lng: 116.4, note: '东征大军集结' },
          { name: '辽东城', modern: '辽宁辽阳', lat: 41.27, lng: 123.17, note: '攻克辽东城' },
          { name: '安市城', modern: '辽宁海城南', lat: 40.85, lng: 122.7, note: '久攻不克，班师' },
        ] },
      { id: 'tang-anshi', name: '安史之乱·范阳起兵到长安', year: 755, color: '#d35400',
        desc: '755年，安禄山从范阳起兵，一路攻陷洛阳、长安，唐玄宗西逃。',
        points: [
          { name: '范阳', modern: '北京', lat: 39.74, lng: 116.0, note: '安禄山起兵地' },
          { name: '荥阳', modern: '河南荥阳', lat: 34.79, lng: 113.38, note: '叛军南下关口' },
          { name: '洛阳', modern: '河南洛阳', lat: 34.62, lng: 112.45, note: '安禄山称帝处' },
          { name: '潼关', modern: '陕西潼关', lat: 34.56, lng: 110.28, note: '守将哥舒翰战败' },
          { name: '长安', modern: '陕西西安', lat: 34.27, lng: 108.95, note: '叛军攻入长安' },
        ] },
      { id: 'tang-caizhou', name: '李愬雪夜入蔡州', year: 817, color: '#7d3c98',
        desc: '817年冬，李愬雪夜奇袭蔡州，生擒叛将吴元济，平定淮西。',
        points: [
          { name: '唐州', modern: '河南泌阳', lat: 32.72, lng: 113.33, note: '李愬驻军地' },
          { name: '文城栅', modern: '河南遂平西', lat: 33.15, lng: 113.9, note: '奇袭出发哨所' },
          { name: '蔡州', modern: '河南汝南', lat: 33.0, lng: 114.4, note: '雪夜破城擒吴元济' },
        ] },
      { id: 'tang-huangchao', name: '黄巢起义·横扫南北', year: 875, color: '#b03a2e',
        desc: '875-884年，黄巢从山东起义，转战南北，攻入长安称帝，后败死。',
        points: [
          { name: '冤句', modern: '山东菏泽', lat: 35.23, lng: 115.47, note: '黄巢起兵地' },
          { name: '广州', modern: '广东广州', lat: 23.13, lng: 113.26, note: '878年攻占岭南' },
          { name: '长安', modern: '陕西西安', lat: 34.27, lng: 108.95, note: '880年攻入称帝' },
          { name: '狼虎谷', modern: '山东莱芜西南', lat: 36.2, lng: 117.7, note: '884年兵败被杀' },
        ] },
    ],
  },
  yuan: {
    meta: { title: '元朝关键路线', description: '有史实行军/流动记载的重要事迹路线（示意，非精确路径）', updated: '2026-10-06' },
    routes: [
      { id: 'yuan-miejin', name: '蒙古灭金·三路攻汴', year: 1234, color: '#c0392b',
        desc: '1233-1234年，蒙古与宋联军攻破金都汴京，金哀宗逃蔡州后自杀。',
        points: [
          { name: '和林', modern: '蒙古哈尔和林', lat: 47.2, lng: 102.85, note: '蒙古大本营' },
          { name: '大同', modern: '山西大同', lat: 40.1, lng: 113.3, note: '蒙古南侵要道' },
          { name: '汴京', modern: '河南开封', lat: 34.8, lng: 114.3, note: '金都，1233年破' },
          { name: '蔡州', modern: '河南汝南', lat: 33.0, lng: 114.4, note: '金哀宗自杀，金亡' },
        ] },
      { id: 'yuan-miesong', name: '忽必烈灭南宋·襄阳到崖山', year: 1276, color: '#247bc1',
        desc: '1273年破襄阳后，元军沿长江东下，1276年临安出降，1279年崖山灭宋。',
        points: [
          { name: '襄阳', modern: '湖北襄阳', lat: 32.01, lng: 112.12, note: '1273年城破，宋门失守' },
          { name: '鄂州', modern: '湖北武汉', lat: 30.59, lng: 114.31, note: '元军渡江处' },
          { name: '建康', modern: '江苏南京', lat: 32.06, lng: 118.8, note: '1275年占领' },
          { name: '临安', modern: '浙江杭州', lat: 30.27, lng: 120.15, note: '1276年宋恭帝出降' },
          { name: '崖山', modern: '广东江门新会', lat: 22.2, lng: 113.1, note: '1279年宋军覆灭' },
        ] },
      { id: 'yuan-hongjin', name: '红巾军起义·刘福通北伐', year: 1351, color: '#e67e22',
        desc: '1351年刘福通在颍州起义，红巾军分路北伐，动摇元朝统治。',
        points: [
          { name: '颍州', modern: '安徽阜阳', lat: 32.89, lng: 115.81, note: '刘福通起兵地' },
          { name: '亳州', modern: '安徽亳州', lat: 33.85, lng: 115.78, note: '韩林儿称小明王处' },
          { name: '汴梁', modern: '河南开封', lat: 34.8, lng: 114.3, note: '红巾军定都' },
          { name: '大都', modern: '北京', lat: 39.9, lng: 116.4, note: '北伐逼近大都' },
        ] },
      { id: 'yuan-beiyuan', name: '元顺帝北逃·大都到上都', year: 1368, color: '#566573',
        desc: '1368年徐达攻破大都，元顺帝北逃开平（上都），元朝在中原统治结束。',
        points: [
          { name: '大都', modern: '北京', lat: 39.9, lng: 116.4, note: '明军破城前夜出逃' },
          { name: '开平', modern: '内蒙古正蓝旗', lat: 42.4, lng: 116.1, note: '上都，北元都城' },
          { name: '应昌', modern: '内蒙古克什克腾旗', lat: 43.1, lng: 116.3, note: '1370年顺帝病逝处' },
        ] },
      { id: 'yuan-makeluo', name: '马可·波罗来华·威尼斯到大都', year: 1275, color: '#16a085',
        desc: '1271-1275年，马可·波罗沿丝绸之路从威尼斯抵达元大都，游记闻名欧洲。',
        points: [
          { name: '威尼斯', modern: '意大利威尼斯', lat: 45.44, lng: 12.32, note: '出发地' },
          { name: '霍尔木兹', modern: '伊朗霍尔木兹', lat: 27.06, lng: 56.45, note: '波斯湾港口' },
          { name: '喀什', modern: '新疆喀什', lat: 39.47, lng: 75.99, note: '进入西域' },
          { name: '上都', modern: '内蒙古正蓝旗', lat: 42.4, lng: 116.1, note: '1275年觐见忽必烈' },
          { name: '大都', modern: '北京', lat: 39.9, lng: 116.4, note: '元朝都城' },
        ] },
    ],
  },
  qing: {
    meta: { title: '清朝关键路线', description: '有史实行军/流动记载的重要事迹路线（示意，非精确路径）', updated: '2026-10-06' },
    routes: [
      { id: 'qing-ruguan-beijing', name: '清军入关·沈阳到北京', year: 1644, color: '#c0392b',
        desc: '1644年吴三桂引清兵入关，多尔衮率军从沈阳经山海关直取北京。',
        points: [
          { name: '盛京', modern: '辽宁沈阳', lat: 41.8, lng: 123.43, note: '清军旧都出发' },
          { name: '山海关', modern: '河北秦皇岛山海关', lat: 40.0, lng: 119.8, note: '吴三桂开关，大破李自成' },
          { name: '北京', modern: '北京', lat: 39.9, lng: 116.4, note: '1644年十月顺治迁都' },
        ] },
      { id: 'qing-pingding-sanfan', name: '平定三藩·吴三桂起兵', year: 1674, color: '#d35400',
        desc: '1673年吴三桂在昆明起兵，三藩之乱遍及南方，康熙历时八年平定。',
        points: [
          { name: '昆明', modern: '云南昆明', lat: 25.04, lng: 102.71, note: '吴三桂起兵' },
          { name: '衡州', modern: '湖南衡阳', lat: 26.89, lng: 112.61, note: '吴三桂称帝处' },
          { name: '岳州', modern: '湖南岳阳', lat: 29.36, lng: 113.13, note: '南北拉锯要地' },
          { name: '长沙', modern: '湖南长沙', lat: 28.23, lng: 112.94, note: '清军与叛军决战' },
        ] },
      { id: 'qing-taiwan', name: '施琅统一台湾·福建到澎湖', year: 1683, color: '#2471a3',
        desc: '1683年施琅率水师从福建渡海，先取澎湖，后迫郑克塽降，统一台湾。',
        points: [
          { name: '铜山', modern: '福建东山', lat: 23.7, lng: 117.42, note: '施琅水师出发' },
          { name: '澎湖', modern: '台湾澎湖', lat: 23.57, lng: 119.57, note: '1683年海战大胜' },
          { name: '台湾', modern: '台湾台南', lat: 23.0, lng: 120.2, note: '郑克塽投降' },
        ] },
      { id: 'qing-san-zheng-gaerdan', name: '康熙三征噶尔丹·亲征漠北', year: 1696, color: '#2e7d32',
        desc: '1690-1697年康熙三次亲征准噶尔部噶尔丹，昭莫多大捷，漠北归清。',
        points: [
          { name: '北京', modern: '北京', lat: 39.9, lng: 116.4, note: '康熙亲征出发' },
          { name: '归化', modern: '内蒙古呼和浩特', lat: 40.85, lng: 111.6, note: '大军集结地' },
          { name: '昭莫多', modern: '蒙古乌兰巴托东南', lat: 47.0, lng: 105.0, note: '1696年击溃噶尔丹主力' },
          { name: '狼居胥山', modern: '蒙古肯特山', lat: 48.5, lng: 108.0, note: '追击至漠北腹地' },
        ] },
      { id: 'qing-taiping', name: '太平天国·金田到南京', year: 1851, color: '#b03a2e',
        desc: '1851年洪秀全在金田起义，转战北上，1853年定都南京（天京）。',
        points: [
          { name: '金田', modern: '广西桂平', lat: 23.4, lng: 110.2, note: '1851年起义' },
          { name: '永安', modern: '广西蒙山', lat: 24.2, lng: 110.53, note: '1851年封王建制' },
          { name: '武昌', modern: '湖北武汉', lat: 30.59, lng: 114.31, note: '1852年攻克' },
          { name: '南京', modern: '江苏南京', lat: 32.06, lng: 118.8, note: '1853年定都天京' },
        ] },
      { id: 'qing-baguo', name: '八国联军侵华·天津到北京', year: 1900, color: '#7d3c98',
        desc: '1900年八国联军从大沽登陆，经天津攻入北京，慈禧西逃。',
        points: [
          { name: '大沽', modern: '天津滨海新区', lat: 38.97, lng: 117.7, note: '联军登陆' },
          { name: '天津', modern: '天津', lat: 39.08, lng: 117.2, note: '1900年7月陷落' },
          { name: '北京', modern: '北京', lat: 39.9, lng: 116.4, note: '1900年8月攻陷' },
          { name: '西安', modern: '陕西西安', lat: 34.27, lng: 108.95, note: '慈禧西逃终点' },
        ] },
    ],
  },
  sui: {
    meta: { title: '隋朝关键路线', description: '有史实行军/流动记载的重要事迹路线（示意，非精确路径）', updated: '2026-10-06' },
    routes: [
      { id: 'sui-pingchen', name: '隋灭陈·统一南北', year: 589, color: '#c0392b',
        desc: '589年杨广率五十万大军分八路南下，攻入建康灭陈，结束三百年分裂。',
        points: [
          { name: '长安', modern: '陕西西安', lat: 34.27, lng: 108.95, note: '隋军出发' },
          { name: '汉口', modern: '湖北武汉', lat: 30.59, lng: 114.31, note: '西路大军渡江' },
          { name: '采石', modern: '安徽马鞍山', lat: 31.6, lng: 118.5, note: '主力渡江处' },
          { name: '建康', modern: '江苏南京', lat: 32.06, lng: 118.8, note: '攻入陈都，俘陈后主' },
        ] },
      { id: 'sui-zheng-gaogouli', name: '隋炀帝三征高句丽', year: 612, color: '#2471a3',
        desc: '612-614年隋炀帝三次征高句丽，大军从涿郡出发渡辽水，皆失利。',
        points: [
          { name: '涿郡', modern: '北京', lat: 39.9, lng: 116.4, note: '百万大军集结地' },
          { name: '辽水', modern: '辽宁辽河', lat: 41.3, lng: 123.0, note: '渡辽水攻辽东' },
          { name: '辽东城', modern: '辽宁辽阳', lat: 41.27, lng: 123.17, note: '久攻不下' },
          { name: '萨水', modern: '朝鲜清川江', lat: 39.5, lng: 125.5, note: '大败于萨水' },
        ] },
      { id: 'sui-jiangdu', name: '隋炀帝下江都', year: 616, color: '#8e44ad',
        desc: '616年炀帝第三次南巡江都（扬州），618年在此被宇文化及缢杀。',
        points: [
          { name: '洛阳', modern: '河南洛阳', lat: 34.62, lng: 112.45, note: '炀帝离京南下' },
          { name: '通济渠', modern: '河南至江苏运河', lat: 34.3, lng: 115.0, note: '沿大运河南下' },
          { name: '江都', modern: '江苏扬州', lat: 32.4, lng: 119.4, note: '618年宫变被杀' },
        ] },
    ],
  },
  wudai: {
    meta: { title: '五代关键路线', description: '有史实行军/流动记载的重要事迹路线（示意，非精确路径）', updated: '2026-10-06' },
    routes: [
      { id: 'wudai-houtang-mie-liang', name: '李存勖灭梁·太原到开封', year: 923, color: '#c0392b',
        desc: '923年李存勖从太原出兵，奇袭开封灭后梁，建后唐定都洛阳。',
        points: [
          { name: '太原', modern: '山西太原', lat: 37.87, lng: 112.55, note: '李存勖基地（晋阳）' },
          { name: '魏州', modern: '河北大名', lat: 36.29, lng: 115.15, note: '923年称帝处' },
          { name: '开封', modern: '河南开封', lat: 34.8, lng: 114.3, note: '奇袭后梁都城' },
          { name: '洛阳', modern: '河南洛阳', lat: 34.62, lng: 112.45, note: '定都洛阳' },
        ] },
      { id: 'wudai-chairong-beifa', name: '周世宗柴荣北伐', year: 959, color: '#2e7d32',
        desc: '959年柴荣北伐契丹，连克益津关、瓦桥关，准备取幽州时病逝。',
        points: [
          { name: '开封', modern: '河南开封', lat: 34.8, lng: 114.3, note: '后周都城出发' },
          { name: '沧州', modern: '河北沧州', lat: 38.3, lng: 116.8, note: '北伐大军北上' },
          { name: '益津关', modern: '河北霸州', lat: 39.1, lng: 116.4, note: '攻占瓦桥关一带' },
          { name: '幽州', modern: '北京', lat: 39.9, lng: 116.4, note: '兵临幽州，柴荣病逝班师' },
        ] },
    ],
  },
};

for (const [d, data] of Object.entries(routes)) {
  writeFileSync(`data/${d}/routes.json`, JSON.stringify(data, null, 2) + '\n');
  console.log(`✅ data/${d}/routes.json 已写入（${data.routes.length} 条路线）`);
}
console.log('\n完成：唐6 / 元5 / 清6 / 隋3 / 五代2 共 22 条新路线');
