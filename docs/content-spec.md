# 内容规范（Content Spec）

内容层的字段契约、时间格式、出处规范与校验机制。可机检的部分由 `tools/validate-data.mjs` 与各板块的 smoke 测试强制。

## 1. 核心原则

- **每条史实都带出处**。`sources` 数组引用 `data/sources/sources.json` 中的 `id`。没有出处的字段不允许进入发布内容。
- **写给普通读者，从小学高年级起步**。句子短、用读者见过的词、避免专有名词堆砌。参考 `data/emperors/yongle.json` 的一句话简介。
- **历史判断尽量保持多元**。有争议的内容进 `controversies` 字段，不硬下结论；开放问题属于设计，不是缺陷。
- **演义与正史分开**。小说内容单独标注「小说演绎，正史不载」，不与正史混淆。

## 2. 时间格式

| 精度 | 写法 | 示例 |
|---|---|---|
| 年 | `"YYYY"` | `"1402"` |
| 年月 | `"YYYY-MM"` | `"1405-07"` |
| 无精确日期 | `"approx"` + 说明 | `{ "date": "1405", "approx": "七月前后" }` |
| 无年份 | 不写 `date`，用 `approx` 描述 | `{ "approx": "洪武年间" }` |

`timeline` 数组元素按 `date` 升序排列。

## 3. 板块数据契约

各板块的 `index.json` 已统一为「清单 + 分区指针」形态，字段如下。

### 通用字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一 id |
| `name` | string | 名称 |
| `meta` | string | 一句话副标题 |
| `src` | string | 详情分片指针（相对 `data/<板块>/`），如 `books/kaogongji.json` |
| `portrait` | string | 配图文件名（放在 `data/portraits/` 下） |

### 分区指针

`artifacts` / `discourses` / `cases` 三个分区统一形如：

```json
{
  "src": "artifacts.json",
  "count": 59,
  "byGroup": { "工艺营造": 16, "医药本草": 13 }
}
```

`count` 与 `byGroup` 必须与实际分片文件一致。这是 `tools/validate-data.mjs` 的硬检查项——不同步会让前端角标数字与列表长度不符。

### 条目字段（以器物为例）

`name`（必填）、`era`（朝代）、`cat`（分类）、`from`（出处书名，必须存在于 `index.json` 的 `books` 里，否则分组会排到末尾）、`note`（说明）、`image`（配图相对路径）。

## 4. 出处规范

- `sources` 数组元素必须是 `data/sources/sources.json` 中存在的 `id`。
- 出处按可信度分三层：

| 层 | 类型 | 例子 |
|---|---|---|
| 一级 | 正史、官修实录 | 《隋书》《旧唐书》《新唐书》《宋史》《元史》《明史》《清史稿》 |
| 二级 | 权威科普、学术专著 | 《明朝那些事儿》（标注"科普"）、白寿彝《中国通史》 |
| 三级 | 网络科普、课程材料 | 央视纪录片、中学教材（标注"科普/教育"） |

- 引用写法：`{ "id": "mingshi", "volume": "成祖本纪", "note": "卷五本纪第五" }`。
- 一级出处优先；二级/三级出处必须与一级出处交叉验证后才能进入发布内容。

## 5. 命名与编码

- 文件名全小写，典籍用拼音 id（如 `kaogongji`、`shiji`）。
- JSON 全部 UTF-8 无 BOM；字符串不得含制表符。
- 图片文件名与数据字段对应，规则见 [portraits/README.md](../data/portraits/README.md)。

## 6. 校验机制

三层，从提交前到运行时：

**数据校验**（`node tools/validate-data.mjs`）

检查：八板块 `index.json` 可解析、书籍卡片必填字段、分片文件存在且 id 与清单一致、分区 `count`/`byGroup` 与实际一致、器物图片存在且不重复复用、`from` 指向真实书名、每本书至少 3 件器物、公案 `category` 在分类表内。

当前状态：2 个错误，均在格物致知 `artifacts` 清单（`count=62` 与 `地理博物 9` 滞后于实际 59 与 6）。修正方法是重跑分区计数，不是改内容。

**冒烟测试**（`web/` 下四套）

| 脚本 | 覆盖 |
|---|---|
| `node web/search-core.test.mjs` | 检索规则单测（与 MCP 同规则） |
| `node web/smoke.mjs` | 帝王四页渲染 + 地图数据层 |
| `node web/smoke-geo.mjs` | GeoJSON 存在/缺失两条路径 + renderMap 全链路 |
| `node web/smoke-dynasties.mjs` | 各朝地图数据层 |
| `node web/tools/history-mcp-server.mjs --selftest` | MCP 协议与数据链路 |

**结构守卫**（`node web/tools/check-structure.mjs`）

检查主站 HTML 标签配平、关键容器父子关系、水墨装饰不得落在正文容器内。

## 7. 审核流程（人审）

1. **事实核对**：每条史实与一级出处比对，不一致则标 `needsReview`。
2. **语言审核**：是否符合「读者能懂」，句子是否过长。
3. **价值观审核**：不美化暴力、不灌输单一历史观、争议话题必须有 ≥2 个视角。
4. **出处审核**：`sources` 引用是否有效，二级/三级出处是否与一级交叉验证。

## 8. 视觉统一

- 全站统一宣纸米黄底、朱红印章、工笔淡彩插画风。
- 器物、神兽、人物、古舆图全部同一画风生成，不混用图库素材。
- 图片规格与命名见 [portraits/README.md](../data/portraits/README.md)。