# data/portraits · 人物与器物图片素材

图片资源目录。前端通过 `<img src="../data/portraits/…">` 或 SVG `<image href>` 直接按文件名引用，无构建步骤、无集中清单。

## 目录结构

| 目录 | 文件数 | 内容 | 引用方式 |
|---|---|---|---|
| `data/portraits/`（根） | 144 | 各朝代皇帝（61）+ 名臣、学者、典籍类人物（83） | `../data/portraits/<文件名>` |
| `data/portraits/people/` | 163 | 关系图中出现但复用不到根目录像的人物 | `../data/portraits/people/<文件名>` |
| `data/portraits/artifacts/` | 61 | 格物致知「器物图谱」器物图 | 由 `data/gewu/index.json` 的 `image` 字段给出路径 |

三个目录的划分规则：能单独成卡的主体（皇帝、名著作者）放根目录；只在他人关系图里出现的小人物放 `people/`；器物单独成图放 `artifacts/`。

## 命名约定

| 类别 | 规则 | 样例 |
|---|---|---|
| 皇帝 | 朝代号 + 拼音，其中唐宋元明清五代用朝代前缀，明与通用名不加前缀 | `tang-taizong.jpg`、`qing-kangxi`（见 `qing-*.jpg`）、`yongle.jpg` |
| 通用人物 | 拼音全小写、不加前缀 | `dufu.jpg`、`kongzi.jpg`、`wangyangming.jpg` |
| 器物 | 拼音或拼音缩写，需能对应到词条名 | `jianyi.jpg`（简仪）、`guanyunfeng.jpg`（冠云峰） |

同一人物在不同朝代出现但形象不同（如五代 `wudai-zhuwen.jpg` 与明 `zhuzhong.jpg`），用朝代前缀区分；形象相同则复用同一文件。

## 尺寸与构图要求

| 项 | 要求 |
|---|---|
| 人物图 | **方形 1:1**，建议 ≥512×512，实际存 2048×2048 |
| 人物构图 | 头像为主，头部居中，肩部以上入画 |
| 裁剪安全性 | 前端卡片位 84px 圆框、详情位 110px 圆框、关系图 72px 圆框，均用 `object-fit: cover` + 圆形 `clip-path`，头部偏离中心会被裁掉 |
| 器物图 | 方形 1:1，器物居中，背景素净（当前为宣纸米色） |
| 格式 | JPG（当前全部 JPG，无 PNG）；浏览器通用即可 |
| 编码 | 页面已统一标注「AI 生成工笔风格，仅供示意」 |

人物图当前为同一套模板批量产出：米色宣纸底、淡墨设色、同一视角与光源。整体风格统一，但同屏多张时观感重复，重新生成时可换角度或换背景层次。

## 数据侧如何接

- 皇帝：`data/<朝代>/emperors/*.json`（明为 `data/emperors/*.json`）的 `portrait` 字段填文件名，当前 61 帝 + 明 16 帝共 77 条**全部已填且文件到位**。字段为空时前端回退 emoji 占位。
- 关系图人物：不走数据字段，由 `web/app.js` 的 `PERSON_PORTRAITS` 映射表按人名查文件；查不到则画文字节点，不显示图片。
- 器物：`data/gewu/index.json` 每条 `image` 字段直接给相对路径（`../../data/portraits/artifacts/xxx.jpg`），由前端渲染。

## 已知缺口

`PERSON_PORTRAITS` 里三个人名指向 `people/` 下不存在的文件，关系图上会退化成文字节点：

| 人名 | 指向的文件 | 文件实际所在 |
|---|---|---|
| 李克用 | `people/wudai-licunxu.jpg` | 根目录 `wudai-licunxu.jpg` |
| 刘知远 | `people/wudai-liuzhiyuan.jpg` | 根目录 `wudai-liuzhiyuan.jpg` |
| 石敬瑭 | `people/wudai-shijingtang.jpg` | 根目录 `wudai-shijingtang.jpg` |

根因是 `personPortrait()` 里那份「这几个名字走根目录」的白名单没列全；重新生成图片时顺手把这三条改对。

器物图谱里「郭守敬简仪」与「元大都四海测验」共用 `artifacts/jianyi.jpg`，前者是仪器、后者是地理测量事件，后者本应另配一张测量点位或舆图。重出图时一并补。

## 重新生成素材时的注意事项

1. 先定尺寸：人物 2048×2048 出图（前端小尺寸显示，留裁剪余量）；器物同样 1:1。
2. 头部居中偏上，肩线以下不要超出安全区——圆框裁切会切掉过低的服饰细节。
3. 人物沿用工笔淡彩风格即可，不必强行贴合史实面貌：南薰殿御像带程式美化，AI 生成同样只能示意。
4. 新增人物按上表命名规则落盘，然后更新 `PERSON_PORTRAITS` 或 `portrait` 字段，二者缺一前端就取不到图。
5. 换图后不用改前端：`data/portraits/artifacts/` 与根目录文件名保持稳定即可；若批量改名，需同步改 `data/gewu/index.json` 的 `image` 与 `web/app.js` 的 `PERSON_PORTRAITS`。

## 版权

- 现存 368 张全部为 AI 生成，不含第三方图库素材。
- 页面统一标注「AI 生成，仅供示意」，不得作为史料图片引用。
- 若后续改用馆藏图（如台北故宫《明成祖坐像轴》《本草纲目》金陵本），需单独确认许可：非商业教育展示通常可用，须保留出处，且不建议裁剪后商用。

## 相关文档

- `prompts.md`：明十六帝外貌考证与写实提示词（含两条已核验的《明史》本纪原文）。
- `写实版提示词清单.txt`：写实风格通用尾缀与逐条提示词。
- `web/guoxue/app.js`：`PERSON_PORTRAITS` 映射表与 `personPortrait()` 目录选择逻辑。