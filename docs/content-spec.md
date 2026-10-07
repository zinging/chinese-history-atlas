# 内容规范（Content Spec）

内容层的字段契约、时间格式、出处规范与审核流程。所有新增内容必须满足本规范，校验器 `scripts/validate.mjs` 强制其中可机检的部分。

## 1. 核心原则

- **每条史实都带出处**。`sources` 数组引用 `data/sources/sources.json` 中的 `id`。没有出处的字段不允许进入发布内容。
- **写给小学生，不写给成年人**。句子短、用孩子见过的词、避免专有名词堆砌。参考朱棣样板 `data/emperors/yongle.json` 的"一句话简介"。
- **历史判断尽量保持多元**。有争议的内容进 `controversies` 字段，不硬下结论；开放问题属于设计，不是缺陷。

## 2. 时间格式

| 精度 | 写法 | 示例 |
|---|---|---|
| 年 | `"YYYY"` | `"1402"` |
| 年月 | `"YYYY-MM"` | `"1405-07"` |
| 无精确日期 | `"approx"` + 说明 | `{ "date": "1405", "approx": "七月前后" }` |
| 无年份 | 不写 `date`，用 `approx` 描述 | `{ "approx": "洪武年间" }` |

`timeline` 数组元素必须按 `date` 升序排列；校验器强制。

## 3. 实体字段（各库契约见 `data/schema/`）

- **皇帝条目**（`data/emperors/*.json`）：字段契约见 `emperor.schema.json`。`id` 为 `ming-emperor-<庙号拼音>`。
- **事件条目**（`data/events/events.json`）：契约见 `event.schema.json`。`id` 为 `ming-event-<关键词>`。每条含展开叙述 `narrative`、影响、参与方、≥1 个开放讨论题（双视角）、冷知识。
- **人物条目**（`data/people/people.json`）：契约见 `person.schema.json`。`id` 为 `ming-person-<拼音>`。皇帝本人不入人物库（指向皇帝库）。
- **制度条目**（`data/institutions/institutions.json`）：契约见 `institution.schema.json`。`id` 为 `ming-institution-<拼音>`。每条含 `howItWorks`（怎么运转）与 `childAngle`（给孩子看的类比）。
- **地名对照**（`data/places/places.json`）：明代地名 → 今地名，带经纬度，供地图热区。

字段要点（以皇帝条目为例）：`id`/`name`（本名）/`templeName`（庙号）/`eraName`（年号，可多个）/`reign`（起止年份）/`intro`（一句话简介，小学生能懂，≤40 字）/`timeline`（关键事件，按 `date` 升序）/`majorEvents`（重大事件）/`people`（关键人物）/`controversies`（开放讨论题）/`funFacts`（趣味冷知识）/`places`（古今地名对照）/`sources`（史料出处汇总）。

## 4. 出处规范

- `sources` 数组元素必须是 `data/sources/sources.json` 中存在的 `id`。
- 出处按可信度分三层：

| 层 | 类型 | 例子 |
|---|---|---|
| 一级 | 正史、官修实录 | 《明史》《明实录》 |
| 二级 | 权威科普、学术专著 | 《明朝那些事儿》（标注"科普"）、白寿彝《中国通史》 |
| 三级 | 网络科普、课程材料 | 央视纪录片、中学教材（标注"科普/教育"） |

- 引用写法：`{ "id": "mingshi", "volume": "成祖本纪", "note": "卷五本纪第五" }`。
- 审核时，一级出处优先；二级/三级出处必须与一级出处交叉验证后才能进入发布内容。

## 5. 审核流程（人审）

1. **事实核对**：每条史实与一级出处比对，不一致则标 `needsReview`。
2. **语言审核**：是否符合"小学生能懂"，句子是否超过 25 字。
3. **价值观审核**：不美化暴力、不灌输单一历史观、争议话题必须有 ≥2 个视角。
4. **出处审核**：`sources` 引用是否有效，二级/三级出处是否与一级交叉验证。

## 6. 字段命名与编码

- 文件名：`data/emperors/<庙号拼音>.json`，全小写。
- JSON 全部 UTF-8 无 BOM；字符串不得含制表符（校验器检查）。
- 枚举字段（如 `eraName`、`reign` 的格式）按 schema 校验。
