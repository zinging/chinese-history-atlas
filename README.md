# 🏮 历史大冒险 · 中国历史可视化学习网站

> 中文 | [English](README_EN.md)

一个以皇帝为线索、把 **隋 · 唐 · 五代十国 · 宋 · 元 · 明 · 清** 七个朝代串成可视化时间线的历史学习网站。不用死记年代——顺着卡片、地图、案件和解谜任务，自己把「谁在什么时候、做了什么、为什么、留下什么后果」连成一条线。

适合学生入门，也适合想把中国历史重新理一遍的成年人。

![纯静态](https://img.shields.io/badge/纯静态-零构建-brightgreen)
![Leaflet](https://img.shields.io/badge/地图-Leaflet_1.9.4-247bc1)
![七朝](https://img.shields.io/badge/朝代-7个-c0392b)
![数据](https://img.shields.io/badge/数据-76帝_545时间线-e8c86a)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

---

## 🎬 效果预览

**皇帝时间线** —— 横向卡片流，点开看生平时间线、人物关系图、趣味冷知识

![皇帝时间线](docs/demo/timeline.gif)

**地图探索** —— 各朝疆域轮廓 + 事件古地名点 + 行军 / 航海路线动画

![地图探索](docs/demo/map.gif)

**案件卡** —— 著名历史疑案拆解（名称由来、经过、结果、影响、史料出处）

![案件卡](docs/demo/cases.gif)

**历史侦探** —— 解谜式查证，线索逐条带来源，再写下你的回答

![历史侦探](docs/demo/detective.gif)

---

## ✨ 项目亮点

- **一条线看懂一个朝代**：横向皇帝卡片流，点开即见生平时间线、人物关系图、冷知识与争议话题。
- **历史落地在地图上**：Leaflet 可缩放底图叠各朝疆域轮廓与古地名点，行军/航海路线按时间分段动画（靖难南下、郑和七下西洋、清军入关……）。
- **案件式深读**：著名疑案拆成「名称由来—背景—人物—经过—结果—影响—开放讨论—史料出处」八段。
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
| 辨析历史争议 | 读案件卡与开放问题（「柴荣不死能否收复燕云」「崇祯为何亡国」） |
| 训练史料思维 | 历史侦探：先给带出处的线索，再让你自己下判断 |
| 古今地名对照 | 点古地名看今址（如「睦州」= 今浙江建德一带） |

---

## 🚀 快速开始

环境要求：**Node.js 18+**（自带 `fetch`，无需 `npm install`）。

```bash
git clone git@gitee.com:chen_ye_code/chinese-history-atlas.git
cd dsh_his
node web/serve.mjs
# 浏览器打开 http://127.0.0.1:5173/web/
```

> 端口被占用就换：`node web/serve.mjs 8080`。
>
> 为什么必须起本地服务器？前端通过 `fetch` 读 `../data/*.json`，直接双击 HTML 会被浏览器 CORS 拦截、页面空白。

**可选 · 接入 AI 老师**：历史侦探页底部「🤖 AI老师配置」→ 填 OpenAI 兼容接口 + Key + 模型（点 ⬇ 自动拉取列表）。配置只存本机 `web/llm-config.json`（已 gitignore），仓库附了带注释的 `web/llm-config.json.template`，复制改名即可填写。

---

## 🏗️ 项目结构

```
dsh_his/
├── data/                  # 知识层：七朝内容（JSON）
│   ├── emperors/ events/ cases/ places/ routes/
│   ├── boundaries/        # 各朝疆域 GeoJSON
│   ├── song/ tang/ yuan/ qing/ sui/ wudai/   # 各朝独立目录
│   ├── schema/ sources/ portraits/
├── web/                   # 前端：纯原生 HTML/CSS/JS
│   ├── index.html app.js search-core.js serve.mjs
│   └── vendor/            # Leaflet 本地化，无 CDN
├── scripts/                # 数据校验与维护脚本
└── docs/                  # 架构 / 内容规范 / 教学法 / 演示动图
```

---

## 📊 数据规模

| 朝代 | 皇帝 | 地图事件 | 路线 |
| --- | --- | --- | --- |
| 隋 | 3 | 8 | 3 |
| 唐 | 14 | 28 | 6 |
| 五代十国 | 5（中原）+ 十国甘特图 | 12 | 2 |
| 宋 | 18 | 14 | 4 |
| 元 | 8 | 14 | 5 |
| 明 | 16 | 43 | 10 |
| 清 | 12 | 22 | 6 |

共 **545 条时间线**，已逐条通俗化改写；疆域据谭其骧《中国历史地图集》手绘简化示意；画像 224 张已压缩至 512×512。

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
- **通俗表达**：短句口语、专有名词首现时括号解释。
- **学习者当导演**：开放问题没有标准答案，先给思考空间再补史实。

---

## 📄 许可

[MIT License](LICENSE) © chen_ye_code

内容以正史为主要依据（《隋书》《旧唐书》《新唐书》《宋史》《元史》《明史》《清史稿》等）；疆域轮廓为手绘简化示意，非精确边界；画像为 AI 生成工笔风格示意，非历史真实画像；地图底图 © 各瓦片服务商，Leaflet © Leaflet Contributors。
