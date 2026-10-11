# 国学图谱 · 典籍长河前端（web/guoxue/）

「中国历史图谱」的第二个大模块，由左侧大模块栏切进，以 iframe 嵌入主站。纯原生 HTML/CSS/JS，与帝王谱系同一套视觉与交互约定。

## 运行

```bash
node web/serve.mjs              # 默认 5173
# 打开 http://127.0.0.1:5173/web/ 后点左侧「典籍长河」
# 也可单独打开 http://127.0.0.1:5173/web/guoxue/index.html
```

## 四个模块

| 模块 | 说明 |
|---|---|
| 典籍长廊 | 按流派横向卡片流，点击展开典籍详情（名句、篇章境遇、人生时间线、冷知识） |
| 公案疑案 | 悬案分类 + 案件卡（名字由来/背景/关键人物/经过/结果/影响/开放讨论） |
| 智慧舆图 | Leaflet 底图 + 圣贤故里与书院寺观两色地名点 + 路线动画与途经点详情 |
| 探问问典 | 选择题即时批改 + 解析 |

## 样式约定（与帝王谱系强制对齐）

`style.css` 复刻主站 `web/style.css` 的同一套 CSS 变量（`--bg/--card/--ink/--muted/--primary/--accent/--gold/--border/--radius`）与组件观感：顶部流派条对应主站朝代条，右侧竖排胶囊对应主站 `tabs`（碑刻质感），详情页/案件卡/答题卡分别复用主站的 `emperor-detail`/`case-card`/`qq` 视觉。

**改动样式时的两条硬约束**：

1. 不要在基础 `.tabs-v` 规则之前写同名覆盖规则。同优先级下后写的胜出，早先那版就在文件开头写了 `@media (max-width:720px){ .tabs-v{ position:static !important } }`，只有带 `!important` 的 `position` 生效、`flex-direction` 被后面的基础规则压掉，结果胶囊被拉进正文流盖住右上角「支持」。要做窄屏兜底就整块写在同一处，别拆两半。
2. 右侧竖排胶囊是 `position: fixed`，在 iframe 内**只能相对 iframe 视口定位，逃不到窗口页边距**。所以主站切到本模块时会解除 `#app` 限宽（`body.mega-guoxue-on`），让 iframe 铺满侧栏右侧整个区域；否则 iframe 被压窄，胶囊只能挤在窄视口里吃掉正文宽度（实测正文会比帝王谱系窄 277px）。

## 地图：数据与图层

数据在 `data/<流派>/index.json` 的 `places` 与 `routes` 字段：

- `places[]`：`{ name, lat, lng, note }`，`note` 是今地名与典故，点击弹窗显示。
- `routes[]`：`{ name, points: [{ name, lat, lng }] }`，`points` 是途经点，用于展开「途经点详情」。

约定：

- 地名圆点按名称自动分两类——含「寺/观/庵/祠/院/书院/精舍/草堂/禅/庙/宫」判为书院寺观（金黄色），其余为圣贤故里（朱红），与图例两项对应。
- 视野优先按路线外接框 `fitBounds`，无路线时按地名外接框，都没有才回落到默认中国视野。
- `bookData` 按流派缓存（`SECT_CACHE`），切回已看过的流派不重发请求；切流派时 `clearMapLayers()` 只清本模块添加的图层，不动底图瓦片。

## 测试

```bash
node --check web/guoxue/app.js
node web/guoxue/smoke-map.mjs 5199   # 智慧舆图（真实浏览器 + CDP，需本机 Chrome）
node web/tools/audit-guoxue-map.mjs  # 各流派 places/routes 数据体检
```

`smoke-map.mjs` 会逐个流派校验图层数量、路线按钮文案、展开/收起交互、切流派不叠加图层，并**捕获页面未处理异常**——这条很关键：曾出现 `mapLayers.routes` 混入 tooltip、对 tooltip 调 `setStyle()` 抛异常导致整张地图空白的情况，而只数图层对象的断言完全察觉不到。新增地图交互时请保持这条断言有效。
