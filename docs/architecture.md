# 架构说明

本文件描述中华历史图谱的三层结构、模块化机制、数据基座与 AI 接入层的当前实现。文档反映代码现状，不含历史规划。

## 三层职责

**知识层**：`data/` 下的结构化数据，纯 JSON、无逻辑。五个板块各自独立目录，共 231 个 JSON 文件（含备份），前端按需 fetch。

**前端层**：`web/`，纯原生 HTML / CSS / JS，零构建、零框架、零运行时依赖。五个板块一个主站壳 + 四个 iframe 子站。

**AI 接入层**：`web/tools/history-mcp-server.mjs`，零依赖 MCP Server，15 个只读工具，把同一份 `data/` 包装成可被豆包 / Hermes / Cursor / Claude Desktop 接入的讲解员。

三层共享同一份数据，没有第二份副本。AI 层只读，不写入任何文件。

## 五个板块

| 板块 | 入口 | 形态 | 数据目录 |
|---|---|---|---|
| 帝王谱系 | `web/index.html` | inline（正文写在主站 HTML 内） | 六朝各一目录 + 明在顶层 |
| 思想源流 | `web/guoxue/index.html` | iframe | `rujia/ daojia/ foxue/ zhuzi/ lixue/` |
| 诗词鉴赏 | `web/guoxue/shici.html` | iframe | `shiwen/` |
| 格物致知 | `web/guoxue/gewu.html` | iframe | `gewu/` |
| 神话异志 | `web/guoxue/myth.html` | iframe | `myth/` |

帝王谱系的数据分布与其余四板块不同：隋、唐、五代、宋、元、清六个朝代各占一个顶层目录（`data/sui/` 等），明朝因是最初的数据原型，散落在 `data/emperors/`、`data/cases/`、`data/events/`、`data/people/`、`data/quiz/`、`data/routes/` 等顶层目录。这是历史遗留，不是设计选择。

四个 iframe 板块共用 `web/guoxue/app.js` 一份代码，通过 `<body data-sect="myth">` 与 `SECT_META` 里的 `data` 字段切换数据源。诗词、格物、神话三个页面本质上是同一套渲染逻辑锁定到不同数据集，页面上少了流派切换条。

## 模块化机制

`web/modules.json` 是模块清单的唯一事实来源。侧栏按钮、面板显隐、iframe 懒加载全部由它驱动。

```json
{
  "id": "myth",
  "name": "神话异志",
  "sub": "山海搜神",
  "kind": "iframe",
  "entry": "guoxue/myth.html",
  "enabled": true,
  "icon": "cloud"
}
```

`kind: "inline"` 的模块正文直接写在 `index.html` 的 `#mega-<id>` 面板里；`kind: "iframe"` 的模块首次进入时才设置 `src`，之后复用同一实例。`enabled: false` 的模块侧栏不显示、面板不创建、资源一字节不下载。

用户侧还能在「模块管理」里停用模块，选择记进 `localStorage`（键 `dsh-disabled-modules`），优先级高于清单的 `enabled`。

清单读取失败的兜底：`app.js` 内置一份五模块清单，站点仍可用。新增模块的完整步骤见 `web/MODULES.md`。

## 数据基座：清单 + 分片

数据不是单体大 JSON，也不是数据库，而是「清单 + 按需分片」：

- `data/<板块>/index.json` 只放书籍/人物卡片字段与各分区指针
- `data/<板块>/books/<id>.json` 单条详情，点开卡片时才加载
- `data/<板块>/artifacts.json` / `discourses.json` / `cases.json` 分区分片，切到对应 tab 时才加载

分区指针形如 `{ src, count, byGroup }`，`count` 与 `byGroup` 是预聚合计数，让前端在分片未加载时就能显示角标数字。

前端用 `ensureSection(name)` 与 `ensureBookDetail(book)` 实现惰性加载，两者同时兼容两种形态：`Array.isArray(v)` 视为已就绪内联数据，`{src}` 视为待加载指针。这样六流派的内联单体与格物、神话的分片可以走同一套渲染代码。

为什么不用数据库：站点部署在 GitHub Pages，纯静态托管没有后端。引入 SQLite 需要 wasm 运行时或服务端，会把「零依赖、fork 即部署、离线可用」三个核心特性全部赔进去。JSON 分片拿到了同样的按需加载收益，还保持了可读可改、可 diff、可被 AI 直接读取。

迁移脚本：`tools/split-gewu.mjs`、`tools/split-sect.mjs`（一次性，已执行）。校验脚本：`tools/validate-data.mjs`。

## 数据规模（2026-10 实测）

| 板块 | 规模 |
|---|---|
| 帝王谱系 | 7 朝 77 帝 · 562 条生平时间线 · 117 件大事 · 141 个舆图事件 · 114 位人物 · 36 件悬案 · 77 道史论题 · 36 条路线 |
| 思想源流 | 5 流派 27 部经典 · 15 件公案 · 13 道问典 · 24 条行迹路线 · 55 处古今地名 |
| 诗词鉴赏 | 22 位诗人 · 13 场公案 · 22 道问典 · 13 条诗路 |
| 格物致知 | 17 部典籍 · 59 件器物 · 12 件公案 · 14 道问典 |
| 神话异志 | 9 部经典 · 113 只神兽 · 5 条古舆图路线 |
| 共用 | 29 处古今地名 · 20 条史料出处 |

图片共 943 张（含缩略图）：

| 目录 | 张数 | 体积 | 内容 |
|---|---|---|---|
| `data/portraits/artifacts/` | 172 | 75.6MB | 格物 59 件器物 + 神话 113 只神兽，共用同一目录 |
| `data/portraits/artifacts-thumb/` | 172 | 5.5MB | 上者的缩略图 |
| `data/portraits/event-gongbi-thumb/` | 141 | 10.1MB | 舆图事件详情卡配图（文件名即 map-events 的 eventId，680px 单份，无原图） |
| `data/portraits/myth-map/` | 74 | 34.4MB | 古舆图底图 + 热点配图 |
| `data/portraits/myth-map-thumb/` | 69 | 7.4MB | 上者的缩略图 |
| `data/portraits/people/` | 163 | 2.6MB | 关系图人物 |
| `data/portraits/`（根） | 152 | 2.1MB | 皇帝与典籍作者 |

缩略图由 `web/tools/make-artifact-thumbs.mjs`、`make-mythmap-thumbs.mjs`、`make-event-thumbs.mjs` 生成，格物图鉴与神话舆图卡片用缩略图、点开取原图；事件配图例外，只有 680px 一份、不做点击放大。680 这个数的依据是实测：事件卡最宽 380px、图渲染宽 275–327px，680 宽在 2x 高分屏下占 0.81–0.96 的可用量，再大就是用不上的像素（量法见 `.sessions/gh-measure-fig.mjs`）。事件配图按约定路径 `event-gongbi-thumb/<eventId>.jpg` 直接取，不依赖数据字段；缺图时前端整块移除，不留破图。

## 地图

帝王谱系用 Leaflet 1.9.4（`web/vendor/`，本地化）+ 高德矢量底图，叠加疆域 GeoJSON、古今地名点、路线动画、事件标记。边界文件 `data/boundaries/<朝代号>.geojson` 存在即用真实边界，不存在回退 `FALLBACK_SHAPES` 手绘示意色块。当前明、清、唐、元各有一份手绘简化 GeoJSON（16/10/12/12 个要素），宋无。

神话异志**不用真实地图**，改为按原著文本方位逐点校对的俯视工笔古舆图，热点坐标写死在 `data/myth/index.json` 的 `routes` 里，背景图与热点配图在 `data/portraits/myth-map/`。

两套地图的分工是刻意的：真实历史用真实空间，想象世界用想象空间，不拿现代地图冒充《山海经》。

## AI 接入

`web/tools/history-mcp-server.mjs`，930 行，15 个只读工具：`session_start`、`list_modules`、`search`、`list_emperors`/`get_emperor`、`list_cases`/`get_case`、`list_books`/`get_book`、`list_creatures`、`list_artifacts`/`get_artifact`、`get_route`、`get_discourses`、`get_quiz`。

检索用内置单字/双字倒排索引，首次建索引约 230ms，之后每次 1-2ms。每个结果同时带 `url`（本地地址）与 `online_url`（GitHub Pages 地址）。自检 `npm run mcp:selftest`。

网页内另有 OpenAI 兼容接口的问答能力（`/api/llm/*`，由 `web/serve.mjs` 代理），配置存于本机 `web/llm-config.json`（已 gitignore），与 MCP 互补。

## 本地服务

`web/serve.mjs`，默认 5173 端口。除了静态文件服务，还提供三个 API：`GET/POST /api/llm-config`（配置读写）、`GET /api/llm/models`（模型列表代理，绕开浏览器 CORS）、`POST /api/llm/chat`（对话代理，附带儿童历史教育的系统提示词）。

带 `?v=` 版本号的资源走 `immutable` 长缓存，但本地开发时回 `no-store` 强制重新取（`DSH_DEV=0` 可关闭）。ETag 按 mtime+size 判定，避免每个请求全量读取图片算哈希。

## 内容约定

- 所有 JSON 为 UTF-8 无 BOM。
- 时间统一用 `YYYY` 或 `YYYY-MM`，无精确日期用 `approx` 说明。详见 [content-spec.md](content-spec.md)。
- 史实字段必须带 `sources`，引用 `data/sources/sources.json` 的 id。没有出处的字段不进入发布内容。
- 演义传说单独标注「小说演绎，正史不载」。
- 图片一律标注为工笔淡彩示意，不作为史料图像引用。

## 相关文档

- `web/MODULES.md`：新增/停用模块的完整步骤
- `docs/content-spec.md`：字段契约、时间格式、出处规范
- `docs/pedagogy.md`：三条教学法原则
- `data/portraits/README.md`：图片素材的目录、命名、尺寸要求
- `data/boundaries/README.md`：疆域数据来源与许可
- `docs/AI集成-本地MCP配置.md`：MCP 接入步骤与深链格式