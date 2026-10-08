# 🏮 中国历史图谱 · Chinese History Atlas

> 中文 | [English](README_EN.md)

一个以皇帝为线索、把 **隋 · 唐 · 五代十国 · 宋 · 元 · 明 · 清** 七个朝代串成可视化时间线的历史学习网站。不用死记年代——顺着卡片、地图、案件和思考题，自己把「谁在什么时候、做了什么、为什么、留下什么后果」连成一条线。

适合历史爱好者系统梳理朝代脉络，也适合学生入门建立时间坐标。

**🌐 在线演示**：
- GitHub Pages：https://zinging.github.io/chinese-history-atlas/web/
- Gitee Pages：https://chen_ye_code.gitee.io/chinese-history-atlas/web/

![纯静态](https://img.shields.io/badge/纯静态-零构建-brightgreen)
![Leaflet](https://img.shields.io/badge/地图-Leaflet_1.9.4-247bc1)
![七朝](https://img.shields.io/badge/朝代-7个-c0392b)
![数据](https://img.shields.io/badge/数据-77帝_380道史论题-e8c86a)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

---

## 🎬 效果预览

**帝王世系** —— 横向卡片流，点开看生平时间线、人物关系图、趣味冷知识

![帝王世系](docs/demo/timeline.gif)

**舆图疆域** —— 各朝疆域轮廓 + 事件古地名点 + 行军 / 航海路线动画

![舆图疆域](docs/demo/map.gif)

**悬案疑案** —— 著名历史疑案拆解（名称由来、经过、结果、影响、史料出处）

![悬案疑案](docs/demo/cases.gif)

**探案问史** —— 解谜式查证，线索逐条带来源，再写下你的判断

![探案问史](docs/demo/detective.gif)

---

## ✨ 项目亮点

- **一条线看懂一个朝代**：横向皇帝卡片流，点开即见生平时间线、人物关系图、冷知识与争议话题。
- **历史落地在地图上**：Leaflet 可缩放底图叠各朝疆域轮廓与古地名点，行军/航海路线按时间分段动画（靖难南下、郑和七下西洋、清军入关……）。
- **案件式深读**：著名疑案拆成「名称由来—背景—人物—经过—结果—影响—开放讨论—史料出处」八段。
- **史论工坊选择题**：内置 **77 位皇帝共 380 道辩证选择题**（论证判断 + 因果链两类题型），提交后即时批改并附史实解析；约四分之一为开放题，可选接入 AI 老师点评角度。
- **线索可溯源**：时间线与侦探线索标注《旧唐书》《宋史》《明史》等出处，演义与正史分开标注。
- **零依赖可自托管**：纯原生 HTML/CSS/JS，无构建、无框架；`data/` 全是可读 JSON。
- **可接 AI 私教**：内置 OpenAI 兼容接口（DeepSeek / OpenAI 等），配置只存本机。

---

## 🧭 可以怎么学

| 方向 | 你可以做什么 |
| --- | --- |
| 建立朝代框架 | 通读七朝皇帝顺序，先有「唐→五代→宋」的大坐标 |
| 理解关键人物 | 点进任一皇帝，看人物关系图（君臣、后妃、对手） |
| 看懂重大事件 | 在地图上按年号筛选，看一场战役从哪开始、打到哪 |
| 训练思辨 | 史论工坊做选择题：一道题同时考「怎么评价」和「因果链」 |
| 辨析历史争议 | 读案件卡与开放问题（「柴荣不死能否收复燕云」「崇祯为何亡国」） |
| 训练史料思维 | 探案问史：先给带出处的线索，再让你自己下判断 |
| 古今地名对照 | 点古地名看今址（如「睦州」= 今浙江建德一带） |

---

## 🚀 快速开始

环境要求：**Node.js 18+**（自带 `fetch`，无需 `npm install`）。

```bash
git clone git@gitee.com:chen_ye_code/chinese-history-atlas.git
cd chinese-history-atlas
node web/serve.mjs
# 浏览器打开 http://127.0.0.1:5173/web/
```

> 端口被占用就换：`node web/serve.mjs 8080`。
>
> 为什么必须起本地服务器？前端通过 `fetch` 读 `../data/*.json`，直接双击 HTML 会被浏览器 CORS 拦截、页面空白。

**可选 · 接入 AI 老师**：探案问史页底部「🤖 AI 老师配置」→ 填 OpenAI 兼容接口 + Key + 模型（点 ⬇ 自动拉取列表）。配置只存本机 `web/llm-config.json`（已 gitignore），仓库附了带注释的 `web/llm-config.json.template`，复制改名即可填写。

---

## 🏗️ 项目结构

```
chinese-history-atlas/
├── data/                  # 知识层：七朝内容（JSON）
│   ├── sui/ tang/ wudai/ song/ yuan/ ming/ qing/   # 各朝独立目录
│   │   ├── emperors/      # 皇帝卡片（生平、时间线、人物、冷知识）
│   │   ├── events/        # 该朝大事
│   │   ├── cases/         # 悬案疑案档案
│   │   ├── places/        # 古地名（含今地名对照、经纬度）
│   │   ├── routes/        # 行军/航海路线
│   │   ├── quiz.json      # 史论工坊选择题题库
│   │   └── people.json    # 关键人物小传
│   ├── boundaries/        # 各朝疆域 GeoJSON
│   ├── portraits/         # 人物头像（AI 生成工笔风，512×512）
│   ├── schema/ sources/   # 数据结构与史料出处
├── web/                   # 前端：纯原生 HTML/CSS/JS
│   ├── index.html app.js search-core.js serve.mjs
│   ├── tools/             # 题库生成与校验脚本（quiz-lib.mjs 等）
│   └── vendor/            # Leaflet 本地化，无 CDN
├── scripts/               # 数据校验与维护脚本
└── docs/                  # 架构 / 内容规范 / 演示动图
```

---

## 📊 数据规模

| 朝代 | 皇帝 | 地图事件 | 路线 | 史论题 |
| --- | --- | --- | --- | --- |
| 隋（581–618） | 3 | 8 | 3 | 17 |
| 唐（618–907） | 14 | 28 | 6 | 71 |
| 五代十国（907–960） | 6（中原核心）+ 十国甘特图 | 12 | 2 | 30 |
| 宋（960–1279） | 18 | 14 | 4 | 91 |
| 元（1271–1368） | 8 | 14 | 5 | 33 |
| 明（1368–1644） | 16 | 43 | 10 | 78 |
| 清（1616–1912） | 12 | 22 | 6 | 60 |

共 **77 位皇帝、380 道史论题、545 条时间线**，已逐条通俗化改写；疆域据谭其骧《中国历史地图集》手绘简化示意；画像 224 张已压缩至 512×512。

---

## 🧪 自测

```bash
node scripts/validate.mjs        # 数据校验
node web/smoke.mjs               # 四页渲染
node web/smoke-geo.mjs           # 疆域与路线动画
node web/smoke-dynasties.mjs     # 七朝地图数据
```

---

## 📖 内容规范

- **史实优先**：只讲有史料依据的内容；拿不准明说「没有确切记载」；演义/传说标注「小说演绎，正史不载」。
- **通俗表达**：短句口语、专有名词首现时括号解释（如「幽云十六州（今北京、天津及山西、河北北部一带）」）。
- **学习者当导演**：开放问题没有标准答案，先给思考空间再补史实；选择题的正确项打散位置，避免靠位置猜答案。

---

## 📄 许可

[MIT License](LICENSE) © chen_ye_code

内容以正史为主要依据（《隋书》《旧唐书》《新唐书》《宋史》《元史》《明史》《清史稿》等）；疆域轮廓为手绘简化示意，非精确边界；画像为 AI 生成工笔风格示意，非历史真实画像；地图底图 © 各瓦片服务商，Leaflet © Leaflet Contributors。
