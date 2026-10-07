# 🏮 Historical Adventure · An Interactive Chinese History Learning Site

> English | [中文](README.md)

A visual, timeline-driven Chinese history learning site covering **seven dynasties: Sui · Tang · Five Dynasties · Song · Yuan · Ming · Qing**. Follow each emperor as the thread and events, people, maps, cases, and puzzles weave themselves together — you build the cause-and-effect story of *who did what, when, why, and what came of it*, instead of memorizing dates.

Great for students starting out, and for adults who want to revisit Chinese history in one coherent thread.

![Pure static](https://img.shields.io/badge/pure%20static-zero%20build-brightgreen)
![Leaflet](https://img.shields.io/badge/maps-Leaflet_1.9.4-247bc1)
![Seven dynasties](https://img.shields.io/badge/dynasties-7-c0392b)
![Data](https://img.shields.io/badge/data-76%20emperors_545%20timeline%20entries-e8c86a)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

---

## 🎬 Preview

**Emperor timeline** — a horizontal card rail; open one for the life timeline, relationship graph, and fun facts

![Emperor timeline](docs/demo/timeline.gif)

**Map explorer** — dynasty borders + ancient place markers + animated march / voyage routes

![Map explorer](docs/demo/map.gif)

**Case files** — famous cases broken down: origin, course, outcome, impact, and sources

![Case files](docs/demo/cases.gif)

**History detective** — puzzle-style clue investigation with sourced leads, then write your own answer

![History detective](docs/demo/detective.gif)

---

## ✨ Highlights

- **One timeline per dynasty.** A horizontal card rail of emperors; open one for the life timeline, relationship graph, fun facts, and controversies.
- **History on a map.** A pan/zoom Leaflet basemap overlays each dynasty's approximate borders and ancient place pins, with animated campaign and voyage routes (Zheng He's seven voyages, the Jingnan campaign, the Qing entry into Shanhai Pass, …).
- **Deep-read case files.** Famous mysteries (Jingnan, Lan Yu, Crow Terrace Poetry, Tumu Crisis, Battle of Yamen…) are broken into naming, background, people, course, outcome, impact, open debate, and sources.
- **Traceable claims.** Timeline entries and detective clues cite the *Old/New Book of Tang*, *History of Song*, *History of Ming*, etc.; fiction is labeled separately.
- **Zero dependencies, self-hostable.** Vanilla HTML/CSS/JS, no build, no framework, no backend; `data/` is plain readable JSON.
- **Bring your own AI tutor.** Any OpenAI-compatible endpoint (DeepSeek, OpenAI, …) can answer questions and comment on your answers; the config stays on your machine.

---

## 🧭 How to learn with it

| Direction | What you can do |
| --- | --- |
| Build the big frame | Read the timeline rail across all seven dynasties to fix "Tang → Five Dynasties → Song" in your head |
| Understand key figures | Open any emperor to see the relationship graph (ministers, consorts, rivals) |
| Follow major events | On the map, filter by era and watch a battle/coup unfold from start to finish |
| Weigh historical debates | Read case files and open questions ("Would Chai Rong have recovered the Sixteen Prefectures?") |
| Practice source thinking | In History Detective, you get sourced clues first, then form your own judgment |
| Ancient ↔ modern places | Click any ancient place pin to see where it is today (e.g. Muzhou = around modern Jiande, Zhejiang) |

---

## 🚀 Quick start

**Requirement:** Node.js 18+ (built-in `fetch`; no `npm install` needed).

```bash
git clone git@gitee.com:chen_ye_code/chinese-history-atlas.git
cd dsh_his
node web/serve.mjs
# Open http://127.0.0.1:5173/web/ in your browser
```

> Port in use? `node web/serve.mjs 8080`, then open `http://127.0.0.1:8080/web/`.
>
> Why a local server? The frontend reads `../data/*.json` via `fetch`; opening it with `file://` is blocked by the browser's CORS policy and the page will be blank.

**Optional · AI tutor:** on the History Detective page, scroll to "🤖 AI Tutor config", enter any OpenAI-compatible endpoint + API key + model (click ⬇ to fetch the model list). The config lives only in `web/llm-config.json` (git-ignored). A commented `web/llm-config.json.template` is included — copy it to `llm-config.json` and fill it in.

---

## 🏗️ Project structure

```
dsh_his/
├── data/                  # Knowledge layer: seven dynasties of content (JSON)
│   ├── emperors/ events/ cases/ places/ routes/
│   ├── boundaries/        # Dynasty territory GeoJSON
│   ├── song/ tang/ yuan/ qing/ sui/ wudai/   # per-dynasty folders
│   ├── schema/ sources/ portraits/
├── web/                   # Frontend: vanilla HTML/CSS/JS
│   ├── index.html app.js search-core.js serve.mjs
│   └── vendor/            # Leaflet vendored locally, no CDN
├── scripts/               # Validators and maintenance scripts
└── docs/                  # Architecture / content guidelines / pedagogy / demos
```

---

## 📊 Data scale

| Dynasty | Emperors | Map events | Routes |
| --- | --- | --- | --- |
| Sui | 3 | 8 | 3 |
| Tang | 14 | 28 | 6 |
| Five Dynasties + Ten Kingdoms | 5 (central plains) + Ten Kingdoms Gantt chart | 12 | 2 |
| Song | 18 | 14 | 4 |
| Yuan | 8 | 14 | 5 |
| Ming | 16 | 43 | 10 |
| Qing | 12 | 22 | 6 |

**545 timeline entries**, each rewritten in plain language; territory outlines are simplified sketches based on Tan Qixiang's *Historical Atlas of China*; 224 portraits compressed to 512×512.

---

## 🧪 Self-tests

```bash
node scripts/validate.mjs        # data validator
node web/smoke.mjs               # four-page render
node web/smoke-geo.mjs           # territory and route animation
node web/smoke-dynasties.mjs     # seven-dynasty map data layer
```

---

## 📄 License

[MIT License](LICENSE) © chen_ye_code

Content draws mainly from the official histories (*Book of Sui*, *Old/New Book of Tang*, *History of Song*, *History of Yuan*, *History of Ming*, *Draft History of Qing*, etc.). Territory outlines are hand-drawn simplified sketches, not precise boundaries. Portraits are AI-generated gongbi-style stylized images, not true historical likenesses. Map tiles © their respective providers; Leaflet © Leaflet Contributors.
