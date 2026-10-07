import fs from 'fs';

const emperors = {
  'gaozu.json': {
    id: 'tang-emp-gaozu', name: '李渊', templeName: '高祖',
    eraName: ['武德'], reign: { start: '618', end: '626' },
    people: [
      { name: '李世民', role: '秦王', note: '贞观天子，开国第二号人物' },
      { name: '裴寂', role: '宰相', note: '晋阳起兵老朋友' }
    ],
    majorEvents: ['晋阳起兵', '玄武门之变'],
    summary: '隋朝太原留守，趁隋末大乱起兵建唐，统一全国。晚年被儿子李世民逼宫退位。',
    portrait: 'tang-gaozu.jpg',
    intro: '被儿子推上台、又被儿子逼下台的开国皇帝',
    timeline: [
      { date: '566', title: '出生', description: '北周贵族出身，七岁袭唐国公。他妈妈是隋文帝独孤皇后的姐姐，所以隋炀帝是他表弟。' },
      { date: '617', title: '晋阳起兵', description: '任太原留守，被儿子李世民和裴寂灌醉，睡了隋炀帝晋阳宫的宫女，不得不起兵反隋。' },
      { date: '618', title: '称帝建唐', description: '隋炀帝在江都被宇文化及所杀，李渊在长安称帝，国号唐。' },
      { date: '618-624', title: '统一全国', description: '李世民先后平薛举、王世充、窦建德，刘黑闼等，到624年基本统一。' },
      { date: '626', title: '玄武门之变', description: '李世民在玄武门射杀太子李建成和齐王李元吉。李渊眼看皇位要被夺，三个月后禅位给李世民，自己当太上皇。' }
    ],
    funFacts: [
      { fact: '李渊起兵时已经五十二岁，是中国历史上开国时年纪最大的皇帝之一。' },
      { fact: '他当太上皇后又活了九年，李世民给他办的宴会他还发牢骚："我今天才知道自己被儿子架空了。"' }
    ],
    controversies: [
      { question: '晋阳起兵到底是李渊自己想反，还是被李世民逼的？', context: '《旧唐书》说李世民首谋，李渊是被动的；但现代学者认为李渊本人早有野心。',
        viewpoints: ['《旧唐书》说法：李世民设计逼老爸起兵。', '现代史学观点：李渊是主谋，李世民是执行者。'] }
    ]
  },
  'taizong.json': {
    id: 'tang-emp-taizong', name: '李世民', templeName: '太宗',
    eraName: ['贞观'], reign: { start: '626', end: '649' },
    people: [
      { name: '魏征', role: '谏议大夫', note: '以人为镜可以明得失' },
      { name: '房玄龄', role: '尚书左仆射', note: '贞观贤相' },
      { name: '杜如晦', role: '尚书右仆射', note: '房谋杜断' }
    ],
    majorEvents: ['贞观之治', '玄武门之变', '灭东突厥'],
    summary: '中国历史上最著名的明君。贞观之治是后世帝王的标杆。',
    portrait: 'tang-taizong.jpg',
    intro: '杀兄弟逼父亲上台，却成了千古明君',
    timeline: [
      { date: '598', title: '出生', description: '李渊次子。从小善骑射，十八岁随父起兵。' },
      { date: '618-624', title: '扫平群雄', description: '在虎牢关一战擒王世充、窦建德，是唐朝开国第一功臣。' },
      { date: '626', title: '玄武门之变', description: '在玄武门埋伏，亲手射杀哥哥太子李建成，尉迟敬德杀弟弟李元吉。李渊被迫立他为太子，两个月后禅位。' },
      { date: '627', title: '贞观之治开始', description: '改元贞观。他任用魏征、房玄龄、杜如晦，虚心纳谏，轻徭薄赋。' },
      { date: '630', title: '灭东突厥', description: '李靖夜袭阴山，生擒东突厥颉利可汗。四夷君长尊太宗为"天可汗"。' },
      { date: '643', title: '魏征去世', description: '魏征病死，太宗大哭："以铜为镜可以正衣冠，以古为镜可以知兴替，以人为镜可以明得失。魏征没，朕亡一镜矣！"' },
      { date: '649', title: '去世', description: '吃长生药中毒而死，年五十二。传位李治（高宗）。' }
    ],
    funFacts: [
      { fact: '魏征原是太子李建成的人，曾劝建成早点杀李世民。玄武门之变后太宗不杀他，反而重用。' },
      { fact: '太宗怕魏征。他一只鹞鹰玩得正高兴，看见魏征来了，赶紧把鹰藏怀里。魏征故意奏事很久，鹞鹰闷死在怀里。' },
      { fact: '他晚年亲征高句丽（今朝鲜半岛北部），没打赢，还说："魏征若在，不使我有是行也。"' }
    ],
    controversies: [
      { question: '太宗既然是明君，为什么要改史书？', context: '他要求看《起居注》（皇帝日常记录），史官不给，他硬要看。后人怀疑他修改了玄武门之变的记载，把自己写成受害者。',
        viewpoints: ['他是为了证明自己即位合法。', '他确实开创了贞观之治，功大于过。'] }
    ]
  },
  'gaozong.json': {
    id: 'tang-emp-gaozong', name: '李治', templeName: '高宗',
    eraName: ['永徽', '显庆', '麟德', '乾封', '总章', '咸亨', '上元', '仪凤', '调露', '永隆', '开耀', '永淳', '弘道'],
    reign: { start: '649', end: '683' },
    people: [
      { name: '武则天', role: '皇后', note: '后来的则天大圣皇帝' },
      { name: '长孙无忌', role: '太尉', note: '太宗大舅子，顾命大臣' }
    ],
    majorEvents: ['永徽之治', '灭西突厥', '灭百济高句丽'],
    summary: '懦弱的皇帝，大权逐渐落到皇后武则天手里。唐朝版图在他手里最大。',
    portrait: 'tang-gaozong.jpg',
    intro: '被老婆抢了江山的皇帝',
    timeline: [
      { date: '628', title: '出生', description: '李世民第九子，本来不是太子。太子李承乾被废后，因为舅舅长孙无忌支持，立为太子。' },
      { date: '649', title: '即位', description: '太宗去世，李治即位。初期有长孙无忌、褚遂良辅政，永徽之治有贞观遗风。' },
      { date: '651', title: '纳武则天入宫', description: '太宗才人的武则天在感业寺出家，高宗把她接回宫中。王皇后本想利用她斗萧淑妃，结果两人都被武则天干掉。' },
      { date: '655', title: '立武则天为皇后', description: '不顾长孙无忌、褚遂良反对，废王皇后，立武则天。长孙无忌后来被逼自杀。' },
      { date: '660', title: '武则天开始掌权', description: '高宗患风眩病（高血压），眼睛看不见，让武则天帮他处理朝政，史称"二圣"。' },
      { date: '668', title: '灭高句丽', description: '李勣率军灭高句丽（今朝鲜半岛北部），唐朝版图达到最大。' },
      { date: '683', title: '去世', description: '在位三十四年，病逝。传位李显（中宗），但实际大权已在武则天手里。' }
    ],
    funFacts: [
      { fact: '高宗在位时唐朝版图最大：东起朝鲜半岛，西到咸海，北贝加尔湖，南到越南河静。' },
      { fact: '他有八个儿子，四个被武则天害死，两个被废，最后两个（中宗、睿宗）都是傀儡。' }
    ]
  },
  'wuzeitian.json': {
    id: 'tang-emp-wu', name: '武曌', templeName: '则天大圣皇帝',
    eraName: ['光宅', '垂拱', '永昌', '载初', '天授', '如意', '长寿', '延载', '证圣', '天册万岁', '万岁登封', '万岁通天', '神功', '圣历', '久视', '大足', '长安'],
    reign: { start: '690', end: '705' },
    people: [
      { name: '狄仁杰', role: '宰相', note: '北斗以南一人而已' },
      { name: '来俊臣', role: '御史中丞', note: '酷吏，罗织罪名杀人' }
    ],
    majorEvents: ['建周称帝', '开创殿试', '重用酷吏'],
    summary: '中国历史上唯一的女皇帝。',
    portrait: 'tang-wu.jpg',
    intro: '中国唯一的女皇帝，从才人到皇帝走了五十年',
    timeline: [
      { date: '624', title: '出生', description: '武士彟之女，十四岁被唐太宗召入宫，封才人，赐号"武媚"。' },
      { date: '649', title: '入感业寺', description: '太宗去世，她作为没生育的嫔妃被送到感业寺出家。' },
      { date: '651', title: '被高宗接回', description: '王皇后想利用她斗萧淑妃，结果她步步为营，655年当上皇后。' },
      { date: '683', title: '临朝称制', description: '高宗去世，中宗李显即位，两个月就被她废掉，立睿宗李旦当傀儡。' },
      { date: '690', title: '称帝建周', description: '六十七岁的武曌正式称帝，改国号为周，定都洛阳。' },
      { date: '690-705', title: '武周时期', description: '开创殿试和武举，提拔狄仁杰、张柬之。但也重用酷吏来俊臣、周兴，大兴告密之风。' },
      { date: '705', title: '神龙政变', description: '张柬之等大臣发动政变，逼迫她还政给中宗。同年去世，年八十二。遗制去帝号，称"则天大圣皇后"。' }
    ],
    funFacts: [
      { fact: '她造了一个字给自己名字：曌（zhào），意思是"日月当空"。' },
      { fact: '她选男宠（张易之、张昌宗兄弟），大臣们上书劝谏，她说这是皇帝的私事。' },
      { fact: '乾陵（她和高宗合葬墓）前立了一块"无字碑"，一字不写，功过留后人评说。' }
    ],
    controversies: [
      { question: '武则天是好皇帝还是坏女人？', context: '她杀唐朝宗室、用酷吏，但也开创殿试、提拔寒门、打击门阀。',
        viewpoints: ['她是出色的政治家：开元盛世的基础是她打的。', '她为了称帝杀了太多人，手段残忍。'] }
    ]
  },
  'xuanzong.json': {
    id: 'tang-emp-xuanzong', name: '李隆基', templeName: '玄宗',
    eraName: ['先天', '开元', '天宝'],
    reign: { start: '712', end: '756' },
    people: [
      { name: '姚崇', role: '宰相', note: '救时宰相' },
      { name: '宋璟', role: '宰相', note: '有脚阳春' },
      { name: '杨国忠', role: '宰相', note: '杨贵妃堂兄' },
      { name: '安禄山', role: '范阳节度使', note: '胡人，安史之乱发动者' }
    ],
    majorEvents: ['开元盛世', '安史之乱', '马嵬驿之变'],
    summary: '前半生明君开创开元盛世，后半生昏君酿成安史之乱。唐朝由盛转衰。',
    portrait: 'tang-xuanzong.jpg',
    intro: '前半生是唐玄宗，后半生是唐明皇',
    timeline: [
      { date: '685', title: '出生', description: '睿宗李旦第三子。武则天是他奶奶。' },
      { date: '710', title: '唐隆政变', description: '联合姑姑太平公主，杀掉韦皇后和安乐公主，扶父亲睿宗复位。' },
      { date: '712', title: '即位', description: '睿宗禅位。713年赐死太平公主，开始亲政。' },
      { date: '713-741', title: '开元盛世', description: '用姚崇、宋璟、张说、张九龄为相，整顿吏治，发展生产。唐朝达到极盛。' },
      { date: '744', title: '纳杨贵妃', description: '儿子李瑁的王妃杨氏被他要过来，出家为女道士，然后入宫，封贵妃。"一骑红尘妃子笑，无人知是荔枝来。"' },
      { date: '752', title: '杨国忠为相', description: '张九龄等贤相被排挤，杨贵妃堂兄杨国忠当宰相，朝政败坏。' },
      { date: '755', title: '安史之乱爆发', description: '安禄山以"清君侧"讨杨国忠为名，在范阳（今北京）起兵，十五万叛军南下。' },
      { date: '756', title: '马嵬驿之变', description: '玄宗逃到蜀地，在马嵬驿（今陕西兴平）士兵哗变，杀杨国忠，逼玄宗缢死杨贵妃。玄宗继续逃到成都，太子李亨在灵武即位（肃宗），他被尊为太上皇。' },
      { date: '762', title: '去世', description: '回到长安后被宦官李辅国软禁，郁闷而死，年七十八。' }
    ],
    funFacts: [
      { fact: '他精通音乐，在梨园教乐工演戏，后世戏班奉他为"梨园祖师爷"。' },
      { fact: '安禄山体重三百三十斤，在玄宗面前跳胡旋舞却转得飞快。' },
      { fact: '安史之乱前唐朝有五千万人口，乱后只剩一千七百万——八年战乱死了一半多人。' }
    ],
    controversies: [
      { question: '杨贵妃真的是安史之乱的罪魁祸首吗？', context: '传统叙事说"女人祸水"，但实际上杨国忠和安禄山的矛盾才是直接原因。',
        viewpoints: ['传统观点：杨贵妃受宠导致杨国忠专权。', '现代观点：是玄宗晚年怠政、节度使制度失控，杨贵妃只是替罪羊。'] }
    ]
  },
  'suzong.json': {
    id: 'tang-emp-suzong', name: '李亨', templeName: '肃宗',
    eraName: ['至德', '乾元', '上元'],
    reign: { start: '756', end: '762' },
    people: [
      { name: '郭子仪', role: '朔方节度使', note: '再造唐朝的大将' },
      { name: '李光弼', role: '河东节度使', note: '与郭子仪齐名' }
    ],
    majorEvents: ['安史之乱平叛', '借回纥兵'],
    summary: '在灵武草草即位，依靠郭子仪、李光弼平定安史之乱，但唐朝藩镇割据从此开始。',
    portrait: 'tang-suzong.jpg',
    intro: '在战乱中即位的皇帝，靠大将和回纥兵收复两京',
    timeline: [
      { date: '711', title: '出生', description: '玄宗第三子。' },
      { date: '756', title: '灵武即位', description: '马嵬驿兵变后，与玄宗分道，北上灵武（今宁夏灵武），在大臣拥戴下即位，遥尊玄宗为太上皇。' },
      { date: '757', title: '收复长安、洛阳', description: '用郭子仪、李光弼，并借回纥（今维吾尔）精兵，收复两京。' },
      { date: '763', title: '安史之乱平定', description: '他去世前一年，史朝义自缢，安史之乱结束。但降将田承嗣、李怀仙等仍割据河北，藩镇割据开始。' },
      { date: '762', title: '去世', description: '在位六年，病逝。' }
    ],
    funFacts: [
      { fact: '为了借回纥兵，他答应"克城之日，土地、士庶归唐，金帛、子女皆归回纥"——洛阳收复后被回纥抢了三天。' }
    ]
  },
  'xianzong.json': {
    id: 'tang-emp-xianzong', name: '李纯', templeName: '宪宗',
    eraName: ['元和'],
    reign: { start: '805', end: '820' },
    people: [
      { name: '裴度', role: '宰相', note: '力主削藩' },
      { name: '李愬', role: '唐邓节度使', note: '雪夜入蔡州' }
    ],
    majorEvents: ['元和中兴', '雪夜入蔡州'],
    summary: '安史之乱后最有作为的唐朝皇帝，暂时压服藩镇。',
    portrait: 'tang-xianzong.jpg',
    intro: '晚唐最有作为的皇帝，暂时压服了藩镇',
    timeline: [
      { date: '778', title: '出生', description: '代宗孙，顺宗子。' },
      { date: '805', title: '即位', description: '顺宗中风，宦官俱文珍逼他禅位，李纯即位。' },
      { date: '817', title: '李愬雪夜入蔡州', description: '李愬雪夜奇袭蔡州（今河南汝南），生擒割据淮西的吴元济。河北藩镇震惊，纷纷归顺。' },
      { date: '819', title: '藩镇暂时臣服', description: '淄青李师道被部下所杀，藩镇割据局面暂时结束，史称"元和中兴"。' },
      { date: '820', title: '被宦官毒死', description: '他吃长生药脾气暴躁，被宦官陈志弘等毒死，年四十三。此后唐朝皇帝废立都由宦官决定。' }
    ],
    funFacts: [
      { fact: '李愬雪夜入蔡州那天大雪，叛军完全没防备，天亮就城破了。' }
    ]
  },
  'xuizong.json': {
    id: 'tang-emp-xuizong', name: '李儇', templeName: '僖宗',
    eraName: ['乾符', '广明', '中和', '光启', '文德'],
    reign: { start: '873', end: '888' },
    people: [
      { name: '黄巢', role: '农民起义领袖', note: '满城尽带黄金甲' },
      { name: '田令孜', role: '神策军中尉', note: '宦官，皇帝呼为阿父' }
    ],
    majorEvents: ['黄巢起义', '广明之乱'],
    summary: '被黄巢赶出长安的皇帝，唐朝名存实亡。',
    portrait: 'tang-xuizong.jpg',
    intro: '被黄巢赶出长安的皇帝，唐朝从此名存实亡',
    timeline: [
      { date: '862', title: '出生', description: '懿宗第五子，十二岁即位，宦官田令孜专权。' },
      { date: '875', title: '王仙芝、黄巢起义', description: '黄巢在曹州（今山东菏泽）起兵，"冲天香阵透长安，满城尽带黄金甲"。' },
      { date: '880', title: '黄巢入长安', description: '黄巢攻陷长安，僖宗逃往成都（和当年玄宗一样）。黄巢在长安称帝，国号大齐。' },
      { date: '884', title: '黄巢败死', description: '借李克用沙陀兵收复长安，黄巢在泰山狼虎谷自杀。但藩镇割据已经遍布全国，唐廷号令不出长安。' },
      { date: '885', title: '回到长安又被赶跑', description: '回到长安后，田令孜与藩镇争盐池，又被李克用赶出长安。' },
      { date: '888', title: '去世', description: '年二十七，病逝。传位弟弟李晔（昭宗）。' }
    ],
    funFacts: [
      { fact: '黄巢原是盐贩子，几次科举没考上，才造反。' },
      { fact: '他在成都流亡五年，回来时长安已经被烧得残破不堪。' }
    ]
  }
};

// 次要皇帝简表
const minor = {
  'zhongzong.json': {
    id: 'tang-emp-zhongzong', name: '李显', templeName: '中宗',
    eraName: ['嗣圣', '神龙', '景龙'], reign: { start: '683', end: '710' },
    people: [{ name: '韦后', role: '皇后', note: '想学武则天' }],
    majorEvents: ['神龙政变'], summary: '两次即位，被老婆韦后和女儿安乐公主毒死。',
    portrait: 'tang-zhongzong.jpg',
    intro: '被妈妈废、被老婆毒的窝囊皇帝',
    timeline: [
      { date: '656', title: '出生', description: '高宗第七子。' },
      { date: '683', title: '第一次即位', description: '高宗去世即位，两个月就被妈妈武则天废掉，贬为庐陵王。' },
      { date: '705', title: '神龙政变复位', description: '张柬之等逼武则天还政，中宗复位。' },
      { date: '710', title: '被韦后毒死', description: '韦皇后想学武则天当皇帝，和女儿安乐公主一起把他毒死。' }
    ],
    funFacts: [{ fact: '他被流放时每次听说朝廷派使者来，就吓得要自杀。韦后劝他别怕，说"祸福何常，何必如是"。' }]
  },
  'ruizong.json': {
    id: 'tang-emp-ruizong', name: '李旦', templeName: '睿宗',
    eraName: ['文明', '景云', '太极', '延和'], reign: { start: '684', end: '712' },
    people: [{ name: '太平公主', role: '镇国太平公主', note: '武则天爱女' }],
    majorEvents: ['唐隆政变'], summary: '两次即位都是傀儡，最后禅位给儿子玄宗。',
    portrait: 'tang-ruizong.jpg',
    intro: '两次当傀儡皇帝，最后禅位给李隆基',
    timeline: [
      { date: '662', title: '出生', description: '高宗第八子。' },
      { date: '684', title: '第一次即位', description: '武则天废掉中宗，立他为傀儡皇帝。690年武则天称帝，他被降为皇嗣。' },
      { date: '710', title: '唐隆政变复位', description: '儿子李隆基和妹妹太平公主杀韦后，扶他复位。' },
      { date: '712', title: '禅位玄宗', description: '禅位给李隆基，自己当太上皇。' }
    ]
  },
  'daizong.json': {
    id: 'tang-emp-daizong', name: '李豫', templeName: '代宗',
    eraName: ['宝应', '广德', '永泰', '大历'], reign: { start: '762', end: '779' },
    people: [{ name: '郭子仪', role: '关内副元帅', note: '平叛大将' }],
    majorEvents: ['安史之乱结束'], summary: '平安史之乱，但藩镇割据成定局。',
    portrait: 'tang-daizong.jpg',
    intro: '安史之乱在他手里结束，但藩镇割据已经无法收拾',
    timeline: [
      { date: '726', title: '出生', description: '肃宗长子。' },
      { date: '763', title: '安史之乱结束', description: '史朝义自缢，安史之乱平。但河北降将仍割据。' },
      { date: '763', title: '吐蕃入长安', description: '吐蕃趁机攻入长安，他又逃到陕州。郭子仪用疑兵收复。' },
      { date: '779', title: '去世', description: '在位十七年。' }
    ]
  },
  'deizong.json': {
    id: 'tang-emp-deizong', name: '李适', templeName: '德宗',
    eraName: ['建中', '兴元', '贞元'], reign: { start: '779', end: '805' },
    people: [{ name: '杨炎', role: '宰相', note: '两税法创立者' }],
    majorEvents: ['两税法', '泾原兵变'],
    summary: '想削藩反而被藩镇赶出长安，从此对藩镇姑息。',
    portrait: 'tang-deizong.jpg',
    intro: '想削藩却反被赶出长安的皇帝',
    timeline: [
      { date: '742', title: '出生', description: '代宗长子。' },
      { date: '780', title: '两税法', description: '用杨炎为相，推行两税法（按财产征税，每年夏秋两季收），是中国税制史上的大改革。' },
      { date: '783', title: '泾原兵变', description: '削藩激起藩镇反抗，泾原兵在长安哗变，拥立朱泚。德宗逃到奉天（今陕西乾县）。' },
      { date: '805', title: '去世', description: '在位二十六年，死后由顺宗即位。' }
    ]
  },
  'wuzong.json': {
    id: 'tang-emp-wuzong', name: '李炎', templeName: '武宗',
    eraName: ['会昌'], reign: { start: '840', end: '846' },
    people: [{ name: '李德裕', role: '宰相', note: '会昌中兴' }],
    majorEvents: ['会昌灭佛'],
    summary: '会昌灭佛没收寺庙财产，短暂中兴。',
    portrait: 'tang-wuzong.jpg',
    intro: '下令拆寺庙、让和尚尼姑还俗的皇帝',
    timeline: [
      { date: '814', title: '出生', description: '穆宗第五子。' },
      { date: '845', title: '会昌灭佛', description: '下令拆天下寺庙四千六百余所，僧尼还俗二十六万人，没收寺院良田数千万顷。史称"会昌灭佛"（三武一宗之祸之一）。' },
      { date: '846', title: '去世', description: '吃长生药中毒而死，年三十三。' }
    ]
  },
  'xuizong2.json': {
    id: 'tang-emp-xuizong2', name: '李忱', templeName: '宣宗',
    eraName: ['大中'], reign: { start: '846', end: '859' },
    people: [{ name: '令狐绹', role: '宰相', note: '大中年间宰相' }],
    majorEvents: ['大中之治'],
    summary: '被称为"小太宗"，晚唐最后一次回光返照。',
    portrait: 'tang-xuizong2.jpg',
    intro: '被称为"小太宗"的晚唐皇帝',
    timeline: [
      { date: '810', title: '出生', description: '宪宗第十三子，武宗的叔叔。他装痴卖傻多年，被宦官迎立。' },
      { date: '846', title: '即位', description: '武宗去世，宦官马元贽立他为帝。他一改武宗弊政，恢复佛教。' },
      { date: '851', title: '收复河湟', description: '吐蕃内乱，秦州、原州、安乐州三州七关归唐，是安史之乱后唐朝对吐蕃唯一的外交胜利。' },
      { date: '859', title: '去世', description: '吃长生药中毒而死，年五十。史称"大中之治"，百姓称他"小太宗"。' }
    ]
  }
};

Object.entries(emperors).forEach(([file, data]) => {
  fs.writeFileSync('data/tang/emperors/' + file, JSON.stringify(data, null, 2));
  console.log('OK', file, data.name);
});
Object.entries(minor).forEach(([file, data]) => {
  fs.writeFileSync('data/tang/emperors/' + file, JSON.stringify(data, null, 2));
  console.log('OK', file, data.name);
});

// 写index.json
const index = {
  meta: { title: '唐朝皇帝库', updated: '2026-10-02' },
  emperors: [
    { id: 'tang-emp-gaozu', name: '李渊', templeName: '高祖', file: 'gaozu.jpg', era: '武德', reign: '618-626', portrait: 'tang-gaozu.jpg' },
    { id: 'tang-emp-taizong', name: '李世民', templeName: '太宗', file: 'taizong.json', era: '贞观', reign: '626-649', portrait: 'tang-taizong.jpg' },
    { id: 'tang-emp-gaozong', name: '李治', templeName: '高宗', file: 'gaozong.json', era: '永徽等', reign: '649-683', portrait: 'tang-gaozong.jpg' },
    { id: 'tang-emp-wu', name: '武曌', templeName: '则天大圣皇帝', file: 'wuzeitian.json', era: '天授等', reign: '690-705', portrait: 'tang-wu.jpg' },
    { id: 'tang-emp-zhongzong', name: '李显', templeName: '中宗', file: 'zhongzong.json', era: '嗣圣', reign: '683-710', portrait: 'tang-zhongzong.jpg' },
    { id: 'tang-emp-ruizong', name: '李旦', templeName: '睿宗', file: 'ruizong.json', era: '文明', reign: '684-712', portrait: 'tang-ruizong.jpg' },
    { id: 'tang-emp-xuanzong', name: '李隆基', templeName: '玄宗', file: 'xuanzong.json', era: '开元/天宝', reign: '712-756', portrait: 'tang-xuanzong.jpg' },
    { id: 'tang-emp-suzong', name: '李亨', templeName: '肃宗', file: 'suzong.json', era: '至德', reign: '756-762', portrait: 'tang-suzong.jpg' },
    { id: 'tang-emp-daizong', name: '李豫', templeName: '代宗', file: 'daizong.json', era: '广德', reign: '762-779', portrait: 'tang-daizong.jpg' },
    { id: 'tang-emp-deizong', name: '李适', templeName: '德宗', file: 'deizong.json', era: '建中', reign: '779-805', portrait: 'tang-deizong.jpg' },
    { id: 'tang-emp-xianzong', name: '李纯', templeName: '宪宗', file: 'xianzong.json', era: '元和', reign: '805-820', portrait: 'tang-xianzong.jpg' },
    { id: 'tang-emp-wuzong', name: '李炎', templeName: '武宗', file: 'wuzong.json', era: '会昌', reign: '840-846', portrait: 'tang-wuzong.jpg' },
    { id: 'tang-emp-xuizong2', name: '李忱', templeName: '宣宗', file: 'xuizong2.json', era: '大中', reign: '846-859', portrait: 'tang-xuizong2.jpg' },
    { id: 'tang-emp-xuizong', name: '李儇', templeName: '僖宗', file: 'xuizong.json', era: '乾符', reign: '873-888', portrait: 'tang-xuizong.jpg' }
  ]
};
// 修正gaozu的file
index.emperors[0].file = 'gaozu.json';
fs.writeFileSync('data/tang/emperors/index.json', JSON.stringify(index, null, 2));
console.log('index.json written,', index.emperors.length, 'emperors');
