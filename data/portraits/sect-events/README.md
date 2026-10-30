# data/portraits/sect-events · 思想大事配图

思想源流「智慧舆图」事件卡的配图目录。**文件名必须与事件的 `id` 完全一致**，
扩展名为 `.jpg`。前端按

    data/portraits/sect-events/<id>.jpg

直接取图；文件不存在时整块图区自动移除，不会出现破图或空框，所以可以先上内容、后补图。

**当前状态：38 / 38 已就位。**

## 规格

- 尺寸：**800 × 600**（4:3）。卡片内图片渲染宽约 342px，2x 屏够用。
- 质量：JPEG q82 左右，单张控制在 120KB 以内。
- 风格：工笔淡彩示意，不追求写实肖像，不出现现代元素与多余文字。
- 页面统一标注「AI 生成，仅供示意」，不得作为史料图像引用。

## 出图流程

1. 出图模型把原始大图（约 2364×1773、单张约 800KB）放进 `data/portraits/.sect-raw/`，
   文件名用事件的 `id`。该目录已 gitignore，是临时暂存区。
2. 跑 `node web/tools/make-sect-thumbs.mjs`，把它缩到 800px 宽写进本目录。
3. 原始大图可自行删除。

## 清单（共 38 张）

| # | 文件名 | 事件 | 年代 | 地点 | 状态 | 体积 |
|---|---|---|---|---|---|---|
| 1 | `rujia-xingtan.jpg` | 孔子杏坛讲学 | 前522 | 曲阜 | 已就位 | 118KB |
| 2 | `rujia-chencai.jpg` | 陈蔡绝粮 | 前489 | 陈蔡之间 | 已就位 | 101KB |
| 3 | `rujia-mengzi-lianghui.jpg` | 孟子见梁惠王 | 前320 | 大梁 | 已就位 | 95KB |
| 4 | `rujia-dongzhongshu.jpg` | 董仲舒天人三策 | 前134 | 长安 | 已就位 | 97KB |
| 5 | `rujia-shiqu.jpg` | 石渠阁会议 | 前51 | 长安 | 已就位 | 103KB |
| 6 | `rujia-baihuguan.jpg` | 白虎观会议 | 79 | 洛阳 | 已就位 | 100KB |
| 7 | `rujia-fogu.jpg` | 韩愈谏迎佛骨·道统重光 | 819 | 长安 | 已就位 | 94KB |
| 8 | `daojia-shoucang.jpg` | 老子为周守藏室之史 | 前6世纪 | 洛阳 | 已就位 | 102KB |
| 9 | `daojia-hangu.jpg` | 老子西出函谷关著《道德经》 | 前5世纪 | 函谷关 | 已就位 | 98KB |
| 10 | `daojia-haoliang.jpg` | 庄周濠梁之辩 | 前4世纪 | 濠水 | 已就位 | 106KB |
| 11 | `daojia-huanglao.jpg` | 黄老之治·文景之世 | 前180 | 长安 | 已就位 | 100KB |
| 12 | `daojia-huainan.jpg` | 《淮南子》成书 | 前139 | 寿春 | 已就位 | 98KB |
| 13 | `daojia-tianshi.jpg` | 张道陵创五斗米道 | 142 | 鹤鸣山 | 已就位 | 116KB |
| 14 | `daojia-wangbi.jpg` | 王弼注《老》《易》 | 240 | 洛阳 | 已就位 | 85KB |
| 15 | `foxue-baima.jpg` | 白马寺译经·佛教东传 | 68 | 洛阳 | 已就位 | 98KB |
| 16 | `foxue-zhushixing.jpg` | 朱士行西行求法 | 260 | 于阗 | 已就位 | 96KB |
| 17 | `foxue-kumarajiva.jpg` | 鸠摩罗什长安译经 | 401 | 长安 | 已就位 | 94KB |
| 18 | `foxue-faxian.jpg` | 法显归国译经 | 412 | 建康 | 已就位 | 104KB |
| 19 | `foxue-damo.jpg` | 达摩面壁少林 | 527 | 少林寺 | 已就位 | 113KB |
| 20 | `foxue-xuanzang.jpg` | 玄奘西行取经 | 645 | 长安 | 已就位 | 83KB |
| 21 | `foxue-huineng.jpg` | 慧能曹溪顿悟 | 676 | 曹溪·南华寺 | 已就位 | 119KB |
| 22 | `foxue-jianzhen.jpg` | 鉴真六次东渡 | 753 | 奈良 | 已就位 | 95KB |
| 23 | `foxue-huichang.jpg` | 会昌毁佛 | 845 | 长安 | 已就位 | 109KB |
| 24 | `zhuzi-jixia.jpg` | 稷下学宫·百家争鸣 | 前374 | 临淄 | 已就位 | 115KB |
| 25 | `zhuzi-sunwu.jpg` | 孙武吴宫教战 | 前512 | 吴都·姑苏 | 已就位 | 107KB |
| 26 | `zhuzi-mozi.jpg` | 墨子止楚攻宋 | 前440 | 楚都·郢 | 已就位 | 94KB |
| 27 | `zhuzi-shangyang.jpg` | 商鞅变法·徙木立信 | 前356 | 栎阳 | 已就位 | 100KB |
| 28 | `zhuzi-suqin.jpg` | 苏秦合纵六国 | 前333 | 洹水 | 已就位 | 103KB |
| 29 | `zhuzi-hanfei.jpg` | 韩非入秦 | 前233 | 咸阳 | 已就位 | 105KB |
| 30 | `lixue-taiji.jpg` | 周敦颐《太极图说》 | 1060 | 庐山·濂溪书堂 | 已就位 | 89KB |
| 31 | `lixue-chengmen.jpg` | 程门立雪 | 1082 | 洛阳 | 已就位 | 89KB |
| 32 | `lixue-ehu.jpg` | 鹅湖之会 | 1175 | 鹅湖寺 | 已就位 | 99KB |
| 33 | `lixue-bailudong.jpg` | 朱熹白鹿洞书院讲学 | 1179 | 白鹿洞书院 | 已就位 | 115KB |
| 34 | `lixue-sishu.jpg` | 朱熹《四书章句集注》 | 1190 | 建阳 | 已就位 | 87KB |
| 35 | `lixue-xiangshan.jpg` | 陆九渊象山讲学 | 1187 | 象山 | 已就位 | 111KB |
| 36 | `lixue-longchang.jpg` | 王阳明龙场悟道 | 1508 | 龙场 | 已就位 | 111KB |
| 37 | `lixue-ningwang.jpg` | 王阳明平定宁王之乱 | 1519 | 南昌 | 已就位 | 105KB |
| 38 | `lixue-donglin.jpg` | 东林书院讲学 | 1604 | 无锡 | 已就位 | 113KB |

## 按流派分组

### 儒 · 孔孟（7/7 已就位）

- ✓ `rujia-xingtan.jpg` — 孔子杏坛讲学（前522·曲阜）：首创私学，有教无类
- ✓ `rujia-chencai.jpg` — 陈蔡绝粮（前489·陈蔡之间）：绝粮七日而弦歌不辍，君子固穷
- ✓ `rujia-mengzi-lianghui.jpg` — 孟子见梁惠王（前320·大梁）：义利之辨：王何必曰利
- ✓ `rujia-dongzhongshu.jpg` — 董仲舒天人三策（前134·长安）：罢黜百家、表章六经，儒学成为官学
- ✓ `rujia-shiqu.jpg` — 石渠阁会议（前51·长安）：皇帝亲裁五经异同，经学官方化
- ✓ `rujia-baihuguan.jpg` — 白虎观会议（79·洛阳）：集成《白虎通义》，三纲六纪成文
- ✓ `rujia-fogu.jpg` — 韩愈谏迎佛骨·道统重光（819·长安）：以「道统」对抗佛老，宋明理学的先声

### 道 · 老庄（7/7 已就位）

- ✓ `daojia-shoucang.jpg` — 老子为周守藏室之史（前6世纪·洛阳）：掌典籍、观成败，道家之源
- ✓ `daojia-hangu.jpg` — 老子西出函谷关著《道德经》（前5世纪·函谷关）：五千言立道家根本
- ✓ `daojia-haoliang.jpg` — 庄周濠梁之辩（前4世纪·濠水）：「子非鱼，安知鱼之乐」
- ✓ `daojia-huanglao.jpg` — 黄老之治·文景之世（前180·长安）：清静无为，与民休息
- ✓ `daojia-huainan.jpg` — 《淮南子》成书（前139·寿春）：牢笼天地，博极古今
- ✓ `daojia-tianshi.jpg` — 张道陵创五斗米道（142·鹤鸣山）：道教由方术变为制度性宗教
- ✓ `daojia-wangbi.jpg` — 王弼注《老》《易》（240·洛阳）：以无为本，玄学兴起

### 佛 · 禅（9/9 已就位）

- ✓ `foxue-baima.jpg` — 白马寺译经·佛教东传（68·洛阳）：汉地第一部汉译佛经
- ✓ `foxue-zhushixing.jpg` — 朱士行西行求法（260·于阗）：汉地第一个西行求法的僧人
- ✓ `foxue-kumarajiva.jpg` — 鸠摩罗什长安译经（401·长安）：译经体确立，汉传佛教的通用文本
- ✓ `foxue-faxian.jpg` — 法显归国译经（412·建康）：十四年西行，携经归国
- ✓ `foxue-damo.jpg` — 达摩面壁少林（527·少林寺）：直指人心，见性成佛
- ✓ `foxue-xuanzang.jpg` — 玄奘西行取经（645·长安）：十七年五万里，取经归国译经
- ✓ `foxue-huineng.jpg` — 慧能曹溪顿悟（676·曹溪·南华寺）：顿悟成佛，《坛经》传世
- ✓ `foxue-jianzhen.jpg` — 鉴真六次东渡（753·奈良）：六次东渡，双目失明而不改
- ✓ `foxue-huichang.jpg` — 会昌毁佛（845·长安）：四千六百寺被毁，宗派格局重塑

### 诸子（6/6 已就位）

- ✓ `zhuzi-jixia.jpg` — 稷下学宫·百家争鸣（前374·临淄）：中国第一所官办高等学府
- ✓ `zhuzi-sunwu.jpg` — 孙武吴宫教战（前512·吴都·姑苏）：《孙子兵法》十三篇的实战检验
- ✓ `zhuzi-mozi.jpg` — 墨子止楚攻宋（前440·楚都·郢）：以守御之术止战，兼爱非攻的实践
- ✓ `zhuzi-shangyang.jpg` — 商鞅变法·徙木立信（前356·栎阳）：法家治国的第一次全面实验
- ✓ `zhuzi-suqin.jpg` — 苏秦合纵六国（前333·洹水）：一人佩六国相印，秦兵不敢窥函谷十五年
- ✓ `zhuzi-hanfei.jpg` — 韩非入秦（前233·咸阳）：法家思想的集成与被弃

### 理学 · 心学（9/9 已就位）

- ✓ `lixue-taiji.jpg` — 周敦颐《太极图说》（1060·庐山·濂溪书堂）：以「无极而太极」重建儒家宇宙论
- ✓ `lixue-chengmen.jpg` — 程门立雪（1082·洛阳）：师道之严与道统之传
- ✓ `lixue-ehu.jpg` — 鹅湖之会（1175·鹅湖寺）：朱陆之辩，理学与心学的分野
- ✓ `lixue-bailudong.jpg` — 朱熹白鹿洞书院讲学（1179·白鹿洞书院）：《白鹿洞书院揭示》成为后世学规范本
- ✓ `lixue-sishu.jpg` — 朱熹《四书章句集注》（1190·建阳）：《四书》取代《五经》成为科举核心
- ✓ `lixue-xiangshan.jpg` — 陆九渊象山讲学（1187·象山）：「宇宙便是吾心，吾心即是宇宙」
- ✓ `lixue-longchang.jpg` — 王阳明龙场悟道（1508·龙场）：「圣人之道，吾性自足」
- ✓ `lixue-ningwang.jpg` — 王阳明平定宁王之乱（1519·南昌）：三十五日平叛，知行合一的实证
- ✓ `lixue-donglin.jpg` — 东林书院讲学（1604·无锡）：风声雨声读书声，家事国事天下事
