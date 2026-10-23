# 前端（web/）

纯原生 HTML / CSS / JS，零构建、零框架、零运行时依赖。地图库 Leaflet 本地化，字体走系统字体栈。

## 运行

```bash
node web/serve.mjs          # 默认 5173
# 浏览器打开 http://127.0.0.1:5173/web/
```

必须通过本地服务器打开（前端用 `fetch` 读 `data/`，双击 HTML 会被 CORS 拦截）。端口占用时 `node web/serve.mjs 8080`。

## 目录

```
web/
├── index.html        主站壳：侧栏 + 帝王谱系 inline 面板 + 四个 iframe 面板
├── app.js            帝王谱系全部逻辑（3429 行：数据加载、四页渲染、地图、侦探题库）
├── style.css         主站样式（1313 行）
├── search-core.js    检索核心（与 MCP Server 同规则）
├── serve.mjs         本地静态服务器 + LLM 配置/对话代理 API
├── modules.json      模块清单（唯一事实来源，见 MODULES.md）
├── guoxue/           四个 iframe 子站共用一份代码
│   ├── app.js        1479 行，靠 <body data-sect> 与 SECT_META 切换数据源
│   ├── style.css     1049 行
│   ├── index.html    思想源流（五流派 + 全部）
│   ├── shici.html    诗词鉴赏（锁定诗文，无流派切换条）
│   ├── gewu.html     格物致知（锁定格物）
│   ├── myth.html     神话异志（锁定神话）
│   └── smoke-map.mjs 子站地图数据层冒烟测试
├── tools/            MCP Server、缩略图生成、结构守卫、数据校验
└── vendor/           Leaflet 1.9.4 本地化
```

## 主站四个界面

| 界面 | 说明 |
|---|---|
| 帝王世系 | 七朝 77 帝卡片横向滑动，按朝代切换；点开是生平时间线、人物关系图、争议、趣闻 |
| 悬案疑案 | 36 件八段式档案，按朝代与分类筛选 |
| 舆图疆域 | Leaflet 底图 + 疆域 GeoJSON + 36 条路线动画 + 98 个事件点 + 古地名今址对照 |
| 探案问史 | 77 道史论选择题（论证判断 / 因果链两类）+ 侦探案卷 + AI 老师配置 |

## 子站四个界面

四个子站结构相同：典籍/诗人卡片条、公案/悬案、图鉴（器物或神兽）、地图、问典。差异只在数据源与有没有流派切换条。

- 思想源流有流派切换（儒 / 道 / 佛 / 诸子 / 理学心学 / 全部），地图是真实地理路线。
- 诗词、格物、神话三个页面锁定单一数据集，`SECT_META` 仍保留完整定义。
- 神话异志的地图是俯视工笔古舆图，不是 Leaflet 真实地图。

## 地图

- **帝王谱系**：Leaflet + 高德矢量底图（`web/vendor/`，无 CDN）。边界走 `data/boundaries/<朝>.geojson`，缺失回退 `FALLBACK_SHAPES` 手绘色块。明、清、唐、元有 GeoJSON（16/10/12/12 要素），宋无。
- **神话异志**：`data/portraits/myth-map/` 的俯视古舆图 + `index.json` 里按原著方位写死的热点坐标。
- `buildMapData()` 只算数据，`renderMap()` 只管画，两者分离让数据层可以脱离 Leaflet 测试。

## 模块清单

侧栏按钮、面板显隐、iframe 懒加载全由 `modules.json` 驱动。新增模块、停用模块、用户侧开关的完整说明见 [MODULES.md](MODULES.md)。

## 测试

```bash
node --check web/app.js                              # 语法
node web/search-core.test.mjs                        # 检索规则
node web/smoke.mjs                                   # 四页渲染 + 地图数据层
node web/smoke-geo.mjs                               # 边界两条路径 + renderMap 全链路
node web/smoke-dynasties.mjs                         # 各朝地图数据层
node web/guoxue/smoke-map.mjs                        # 子站地图数据层
node web/tools/history-mcp-server.mjs --selftest     # MCP 协议与数据链路
node tools/validate-data.mjs                         # 数据完整性
node web/tools/check-structure.mjs                   # HTML 结构守卫
```

## 图片懒加载

- 图鉴卡片走缩略图（`data/portraits/artifacts-thumb/`、`myth-map-thumb/`），点开才取原图，缺失自动回退。
- 人物像与器物图 `loading="lazy"`。
- JSON 按板块 + 分片加载，切到才 fetch；iframe 模块首次进入才设 `src`。