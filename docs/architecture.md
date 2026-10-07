# 架构说明：三层与 DSH 能力映射

本文件记录教学编排层（DSH 插件）与儿童交互层（独立前端）的边界，以及内容层如何被编排层消费。

## 三层职责

**知识层（已完成，含二层）**：`data/` 下的结构化数据，纯数据、无逻辑。皇帝、事件、人物、制度、地名、出处、路线七类实体。任何 UI 或 Agent 不得绕过知识层写死史实。

| 库 | 文件 | 规模 |
|---|---|---|
| 皇帝库 | `data/emperors/*.json`（16 帝 + 索引） | 16 条全字段/基础档案 |
| 事件库 | `data/events/events.json` | 37 条展开大事 |
| 人物库 | `data/people/people.json` | 33 条关键人物 |
| 制度库 | `data/institutions/institutions.json` | 11 条制度 |
| 地名库 | `data/places/places.json` | 29 处古今对照（含海外点） |
| 路线库 | `data/routes/routes.json` | 3 条动画路线 |
| 史料库 | `data/sources/sources.json` | 14 条书目（三级可信度） |

**教学编排层（DSH 插件，Phase 1）**：六个 Agent，各自消费知识层并输出教学素材。

| Agent | 输入 | 输出 | 知识层依赖 |
|---|---|---|---|
| 分龄讲解 | 皇帝/事件 + 年龄段 | 分段讲解稿（含开放问题） | emperors, events |
| RAG 检索 | 孩子的问题 | 检索到的史料片段 + 出处 | 全部 |
| 测验生成 | 章节范围 | 无标准答案的讨论题 / 决策场景 | events, controversies |
| 可视化 | 时间线/地图/卡片数据 | 渲染所需的 JSON 结构 | emperors, places |
| 角色扮演 | 历史人物 + 场景 | 角色剧本与分支 | people, events |
| 家长报告 | 会话记录 | 孩子提出了什么问题、做了什么决定 | 无（读会话） |

**儿童交互层（独立前端，Phase 2，`web/`）**：时间线首页、皇帝详情页、示意地图探索页、历史侦探任务页。当前直接读 `data/`（MVP），后续可切换为消费编排层 API。地图为示意而非精确 GIS 边界，符合儿童认知与版权边界。

## DSH 插件的技术落点（Phase 1 设计）

基于当前 profile（`desktop`，位于 `C:\Users\10972\.dsh-beta\profiles\desktop`）的能力探测：

- **知识层挂载**：插件用 `storage` + `storageDomain` 服务，把 `data/` 的 JSON 以只读域的形式加载（Schema 由 `data/schema/` 提供）。皇帝条目、事件、地名均可按 id 查询、按年份切片。
- **RAG 检索 Agent**：用 `web` 服务的 search/fetch 做史料补充检索，用 `storageDomain` 做本地史料库检索；两者结果都带出处。
- **分龄讲解 / 测验生成 / 角色扮演**：通过 LLM 接口（`llm` 服务族）把知识层数据 + 教学法提示词（`docs/pedagogy.md`）合成教学内容。
- **子代理编排**：六个 Agent 可作为 `agents`/`subagents` 服务的子代理运行；家长报告 Agent 读会话记录。
- **可视化数据**：`data/` 的 JSON 已为时间线（`timeline` 数组）、人物卡片（`people` 数组）、地图（`places` 数组带经纬度）、路线（`routes` 数组）预留字段，前端只需渲染。

**地图数据源规划**：示意阶段用自带 `places.json`（经纬度点）+ `routes.json`（路线）+ 手工色块；精确阶段引入哈佛 CHGIS 行政边界（需确认导出与许可），谭其骧《中国历史地图集》仅作边界参考不直接取图（版权归社科院），古地图（明尼苏达 Gazetteer/芝加哥手卷/郑和航海图数字化）作趣味素材。

## 数据消费约定

- 内容层所有 JSON 均为 UTF-8，无 BOM。
- 皇帝条目的 `id` 采用 `ming-emperor-<庙号拼音>`，事件 `id` 采用 `ming-event-<关键词>`，地名 `id` 采用 `ming-place-<拼音>`。
- 时间统一用 `YYYY` 或 `YYYY-MM`（无精确日期的用 `YYYY-MM`，无月份的用 `YYYY`，无年份的标 `null` 并给 `approx` 说明）。参见 [docs/content-spec.md](docs/content-spec.md)。
- 任何史实字段必须带 `sources`（出处数组）。没有出处的字段不允许出现在发布内容里。

## 阶段边界

- 本轮只交付知识层。
- Phase 1 之前不写插件代码，但 `docs/` 记录了上述 DSH 能力探测结论，插件开发时直接照此落点。
- Phase 2 前端不在此仓库，另立独立前端仓库。
