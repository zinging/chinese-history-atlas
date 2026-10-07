import fs from 'fs';

const addData = {
  'yingzong.json': {
    intro: '在位四年的短命皇帝，因为生父名分和大臣吵了一年半',
    timeline: [
      {date:'1032', title:'出生', description:'太宗曾孙，濮王赵允让第十三子。仁宗无子，被接入宫抚养。'},
      {date:'1063', title:'即位', description:'仁宗驾崩，赵曙即位，是为宋英宗。即位后立刻生病，由曹太后垂帘听政。'},
      {date:'1063-1066', title:'濮议之争', description:'想追尊亲生父亲濮王为皇考，司马光、吕诲等台谏官反对，韩琦、欧阳修支持。争吵十八个月。'},
      {date:'1066', title:'亲政', description:'曹太后撤帘，英宗亲政。但他本身体弱。'},
      {date:'1067', title:'去世', description:'在位仅四年，年仅三十五岁。'}
    ],
    funFacts: [
      {fact:'英宗是北宋第一位以宗室身份入继大统的皇帝，他不是仁宗的儿子，而是侄子。'},
      {fact:'他在位四年，真正亲政不到一年，大部分时间在和大臣吵"濮议"。'}
    ]
  },
  'shezong.json': {
    intro: '幼年即位的小皇帝，奶奶听政用旧党，亲政后又翻脸用新党',
    timeline: [
      {date:'1077', title:'出生', description:'神宗第六子。'},
      {date:'1085', title:'即位', description:'神宗去世，年仅九岁。太皇太后高氏（英宗皇后）垂帘听政。'},
      {date:'1086-1093', title:'元祐更化', description:'高太后用司马光为相，尽废王安石新法，史称"元祐更化"。苏轼、苏辙等旧党回朝。'},
      {date:'1093', title:'高太后去世，亲政', description:'十八岁的哲宗亲政，立刻改元绍圣，意思是"继承"父亲神宗的新政。'},
      {date:'1094-1100', title:'绍圣绍述', description:'用章惇为相，恢复新法，贬旧党。司马光被追贬，苏轼被远贬惠州、儋州（海南）。'},
      {date:'1100', title:'去世', description:'二十四岁病逝，无子嗣，传位给弟弟端王赵佶（徽宗）。'}
    ],
    funFacts: [
      {fact:'哲宗亲政后，把高太后听政时期定的旧党全部贬到岭南，苏轼一路被贬到海南——那是宋朝最南边的贬所。'},
      {fact:'他在位十五年，前七年听奶奶的，后八年听自己的，政策翻来覆去，新旧党争从此结下深仇。'}
    ]
  },
  'qinzong.json': {
    intro: '临危受命的亡国之君，即位才一年多就被金兵掳走',
    timeline: [
      {date:'1100', title:'出生', description:'徽宗长子。'},
      {date:'1125', title:'即位', description:'金兵南下，徽宗吓得禅位给他。他临危即位，改元靖康。'},
      {date:'1126', title:'东京保卫战', description:'起用李纲主持东京防务，击退金兵。但他摇摆不定，一会儿主战一会儿求和。'},
      {date:'1126-1127', title:'迷信六甲神兵', description:'金兵二次围开封，钦宗相信骗子郭京的"六甲神兵"，开城门出战，被击溃。'},
      {date:'1127', title:'靖康之变', description:'城破，与徽宗同被掳北上，封"重昏侯"。1156年在金国病死。'}
    ],
    funFacts: [
      {fact:'钦宗即位时大赦天下，想挽回人心，但金兵已经兵临城下，什么都来不及了。'},
      {fact:'他被掳到北方后，金主让他和徽宗参加"牵羊礼"——披着羊皮，跪在金太祖庙前。这是极大的侮辱。'}
    ]
  },
  'guangzong.json': {
    intro: '怕老婆怕到不敢给老爹发丧的皇帝，被太皇太后废掉',
    timeline: [
      {date:'1147', title:'出生', description:'孝宗第三子。'},
      {date:'1189', title:'即位', description:'孝宗禅位，光宗即位。皇后李凤娘是个妒妇。'},
      {date:'1191', title:'李皇后干政', description:'光宗宠爱的黄贵妃被李皇后害死，光宗受刺激发病，从此不上朝。'},
      {date:'1194', title:'孝宗驾崩，不出丧', description:'孝宗去世，光宗因与父亲有隔阂，拒绝主持丧礼。朝野哗然。'},
      {date:'1194', title:'绍熙内禅', description:'太皇太后吴氏（高宗皇后）在韩侂胄、赵汝愚请求下出面，光宗被迫禅位给儿子赵扩（宁宗）。他搬出宫，三年后病死。'}
    ],
    funFacts: [
      {fact:'李皇后趁光宗离宫，把他喜欢的黄贵妃杀死，说"暴薨"。光宗知道是她干的，但不敢发作。'},
      {fact:'光宗在位五年，真正上朝的时间不到一半，大臣们连皇帝面都见不到。'}
    ]
  },
  'ningzong.json': {
    intro: '被权臣和皇后包围的皇帝，庆元党禁和开禧北伐都在他朝',
    timeline: [
      {date:'1168', title:'出生', description:'光宗第二子。'},
      {date:'1194', title:'即位', description:'绍熙内禅后即位，韩侂胄、赵汝愚辅政。'},
      {date:'1195-1196', title:'庆元党禁', description:'韩侂胄把赵汝愚贬死，把朱熹道学定为"伪学"，五十九人入"逆党籍"。'},
      {date:'1206', title:'开禧北伐', description:'韩侂胄贸然北伐金朝，初胜后败。'},
      {date:'1207', title:'韩侂胄被杀', description:'史弥远与杨皇后合谋，在韩侂胄上朝时击杀。首级送金求和。'},
      {date:'1207-1224', title:'史弥远专政', description:'此后十七年，史弥远独相，宁宗形同傀儡。'},
      {date:'1224', title:'去世', description:'在位三十年。'}
    ],
    funFacts: [
      {fact:'宁宗是个不太聪明的皇帝，史书说他"木讷"，大臣上奏他常常点头但听不懂。'},
      {fact:'韩侂胄被杀后，金人觉得他还算个人物，把他葬在金人祖坟旁边，谥号"忠缪"——忠谋国、缪谋身。'}
    ]
  },
  'lizong.json': {
    intro: '被史弥远拥立的皇帝，联蒙灭金却贸然端平入洛',
    timeline: [
      {date:'1205', title:'出生', description:'太祖十世孙，本意是个远房宗室。'},
      {date:'1224', title:'即位', description:'史弥远废太子赵竑，立赵昀为帝。前九年史弥远专政。'},
      {date:'1233', title:'史弥远去世，亲政', description:'开始亲政，年号端平。'},
      {date:'1234', title:'联蒙灭金', description:'与蒙古合围蔡州，金哀宗自缢，金亡。'},
      {date:'1234', title:'端平入洛', description:'贸然出兵收复洛阳，被蒙古伏击，大败。蒙古从此开始侵宋。'},
      {date:'1264', title:'去世', description:'在位四十年，南宋在他手里从相持走向灭亡。'}
    ],
    funFacts: [
      {fact:'孟珙在蔡州找到金哀宗残骸，分了一半给蒙古，一半带回临安献太庙——北宋百年之仇算是报了。'},
      {fact:'端平入洛之败，宋军七万人进去，回来不到一万。南宋的精锐部队从此损失大半。'}
    ]
  },
  'duzong.json': {
    intro: '智商不高的皇帝，把朝政全交给"蟋蟀宰相"贾似道',
    timeline: [
      {date:'1240', title:'出生', description:'理宗侄子。理宗的儿子都早死，选他为继承人。'},
      {date:'1264', title:'即位', description:'史弥远死后，贾似道专权。度宗称贾似道为"师臣"。'},
      {date:'1267-1273', title:'襄樊之战', description:'蒙古军围襄阳六年，贾似道隐瞒军情，不派援兵。1273年樊城破、襄阳降。'},
      {date:'1274', title:'去世', description:'三十六岁去世。他死后一年，临安就陷落了。'}
    ],
    funFacts: [
      {fact:'贾似道喜欢斗蟋蟀，著有《促织经》，人称"蟋蟀宰相"。他上朝时身边都带着蟋蟀。'},
      {fact:'度宗智商不高，史书说他"弱甚"，国家大事全靠贾似道。'}
    ]
  },
  'gongdi.json': {
    intro: '四岁即位的幼帝，在位不到两年就亡国',
    timeline: [
      {date:'1271', title:'出生', description:'度宗嫡子。'},
      {date:'1274', title:'即位', description:'度宗去世，四岁的赵㬎即位，谢太皇太后（理宗皇后）临朝听政。'},
      {date:'1275', title:'贾似道丁家洲大败', description:'贾似道亲率十三万大军在丁家洲（今安徽铜陵）与元军决战，一触即溃。'},
      {date:'1276', title:'临安陷落', description:'元军兵临临安，谢太皇太后携五岁的小皇帝出降。南宋实质灭亡。'},
      {date:'1276后', title:'被掳北上', description:'恭帝被带到大都，后被派去吐蕃学佛，活了五十多岁。'}
    ],
    funFacts: [
      {fact:'恭帝后来在西藏出家，成为高僧，翻译了《百法明门论》等佛经。他是中国历史上唯一出家为僧的亡国皇帝。'},
      {fact:'他出降时，南宋官员跑了一大半，上朝的只有六个文官。'}
    ]
  },
  'duanzong.json': {
    intro: '流亡小朝廷的第一个皇帝，在海上度过最后两年',
    timeline: [
      {date:'1269', title:'出生', description:'度宗庶长子，封益王。'},
      {date:'1276', title:'福州即位', description:'临安陷落前，他和弟弟赵昺被陆秀夫、张世杰护送南逃。五月在福州即位，改元景炎。'},
      {date:'1276-1278', title:'海上流亡', description:'元军追击，小朝廷从福州逃到泉州、潮州，最后逃到海上。'},
      {date:'1278', title:'病逝', description:'在碙洲（今广东湛江）病逝，年九岁。'}
    ],
    funFacts: [
      {fact:'端宗的小朝廷有船千余艘、官员军民二十万，但一路被元军追着跑，从福州一直逃到广东海上。'},
      {fact:'他年幼晕船，每次看到海浪就哭。陆秀夫每天给他讲圣人忠孝的故事。'}
    ]
  },
  'bing.json': {
    intro: '八岁投海的末代皇帝，宋朝最后一位皇帝',
    timeline: [
      {date:'1272', title:'出生', description:'度宗幼子，封卫王。'},
      {date:'1278', title:'即位', description:'端宗病逝后，陆秀夫、张世杰在碙洲立他为帝，年八岁，改元祥兴。'},
      {date:'1279', title:'崖山海战', description:'元将张弘范追到崖山。张世杰把千余艘战船连成长城，被元军火攻、封锁海口。'},
      {date:'1279', title:'陆秀夫负帝投海', description:'二月初六，宋军大溃。陆秀夫先赶妻子投海，然后穿朝服，背起八岁的幼帝投海。十万军民相继赴水，宋亡。'}
    ],
    funFacts: [
      {fact:'陆秀夫对幼帝说："陛下当为国死。德祐皇帝（恭帝）已辱，陛下不可再辱！"然后背起他投海。'},
      {fact:'七日之后，海上浮尸十余万。张世杰突围后遇飓风覆舟，也溺死了。'}
    ]
  }
};

for (const [file, data] of Object.entries(addData)) {
  const p = 'data/song/emperors/' + file;
  const e = JSON.parse(fs.readFileSync(p, 'utf8'));
  Object.assign(e, data);
  fs.writeFileSync(p, JSON.stringify(e, null, 2));
  console.log('OK', file, e.name);
}
