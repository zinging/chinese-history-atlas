# 🏮 Historical Adventure · An Interactive Chinese History Learning Site

> **Language:** English | [中文](README.md)

A visual, timeline-driven Chinese history learning site covering **seven dynasties: Sui · Tang · Five Dynasties · Song · Yuan · Ming · Qing**. Following each emperor as the thread, it weaves together events, people, maps, historical cases, and puzzles — so you build the cause-and-effect story of "who did what, when, why, and what came of it" instead of memorizing dates. Useful for students starting out, and for adults who want to revisit Chinese history in one coherent thread.

![Pure static, zero build](https://img.shields.io/badge/pure%20static-zero%20build-brightgreen)
![Leaflet](https://img.shields.io/badge/maps-Leaflet_1.9.4-247bc1)
![7 dynasties](https://img.shields.io/badge/dynasties-7-c0392b)
![Data](https://img.shields.io/badge/data-76%20emperors_545%20timeline%20entries-e8c86a)

---

## ✨ Highlights

* **One timeline per dynasty.** A horizontal card rail of emperors; open one for the life timeline, relationship graph, fun facts, and controversies.
* **History on a map.** A pan/zoom Leaflet basemap overlays each dynasty's approximate borders and ancient place pins, with animated campaign and voyage routes (Zheng He's seven voyages, the Jingnan campaign, the Qing entry into Shanhai Pass, …).
* **Deep-read case files.** Famous mysteries (Jingnan, Lan Yu, Crow Terrace Poetry, Tumu Crisis, Battle of Yamen…) are broken into naming, background, people, course, outcome, impact, open debate, and sources.
* **Traceable claims.** Timeline entries and detective clues cite the *Old/New Book of Tang*, *History of Song*, *History of Ming*, etc.; fiction is labeled separately.
* **Zero dependencies, self-hostable.** Vanilla HTML/CSS/JS, no build, no framework, no backend; `data/` is plain readable JSON you can repurpose.
* **Bring your own AI tutor.** Any OpenAI-compatible endpoint (DeepSeek, OpenAI, …) can answer questions and comment on your answers; the config stays on your machine.

---

## 🧭 How to learn with it

| Direction | What you can do |
| --- | --- |
| **Build the big frame** | Read the timeline rail across all seven dynasties to fix the order "Tang → Five Dynasties → Song" in your head. |
| **Understand key figures** | Open any emperor to see the relationship graph (ministers, consorts, rivals) and life timeline. |
| **Follow major events** | On the map, filter by era and watch a battle/coup unfold from start to finish. |
| **Weigh historical debates** | Read case files and the "open question" blocks, e.g. "Would Chai Rong have recovered the Sixteen Prefectures?" |
| **Practice source thinking** | In History Detective, you first get sourced clues and then form your own judgment — no answer handed to you. |
| **Ancient ↔ modern places** | Click any ancient place pin to see where it is today (e.g. Muzhou = around modern Jiande, Zhejiang). |

---

## 🎬 Preview

**Emperor timeline** — a horizontal card rail; open one for the life timeline, relationship graph, and fun facts
![Emperor timeline](docs/demo/timeline.gif)

**Map explorer** — dynasty borders + ancient place markers + animated march / voyage routes
![Map explorer](docs/demo/map.gif)

**Historical cases** — famous cases broken down: origin, course, outcome, impact, and sources
![Historical cases](docs/demo/cases.gif)

**History detective** — puzzle-style clue investigation with sourced leads, then write your own answer
![History detective](docs/demo/detective.gif)

---

## ✨ Features

| Module | What it does |
|---|---|
| 🕰️ **Timeline home** | A horizontal card stream of emperors. Click a card to open that ruler's life timeline, relationship graph, fun facts, controversies, and a hands-on activity. |
| 📋 **Case files** | Famous historical mysteries (Jingnan Campaign, Lan Yu Case, Crow Terrace Poetry Trial…): naming, background, people, course, outcome, impact, open questions, and source citations. |
| 🗺️ **Map explorer** | Pan/zoom Leaflet basemap with each dynasty's approximate territory and administration, ancient place-name pins, and animated campaign / voyage routes (Zheng He's voyages, Qing entering the Shanhai Pass, etc.). |
| 🕵️ **History Detective** | Mystery-solving tasks: clues are dynamically retrieved from the built-in knowledge base (each with a source), plus open-ended follow-up questions and a creation space. |
| 🤖 **AI Tutor** *(experimental)* | On the detective page, configure any OpenAI-compatible endpoint (DeepSeek, SiliconFlow, OpenAI, …) and let an AI answer questions and comment on creations, using a "history-rigorous, learner-friendly" system prompt. |

---

## 🚀 Quick start

**Requirement:** Node.js 18+ (built-in `fetch`; no `npm install` needed).

```bash
# 1. Clone the repo and enter the project root
cd dsh_his

# 2. Start the local static server (default port 5173)
node web/serve.mjs

# 3. Open in your browser
#    http://127.0.0.1:5173/web/
```

> Port in use? Pick another: `node web/serve.mjs 8080`, then open `http://127.0.0.1:8080/web/`.

**Why a local server instead of double-clicking the HTML?** The frontend reads `../data/*.json` via `fetch`; opening it with `file://` is blocked by the browser's CORS policy and the page will be blank.

**Optional · AI tutor:** open the History Detective page → scroll to "🤖 AI Tutor config" → enter any OpenAI-compatible endpoint (DeepSeek, SiliconFlow, OpenAI, …) + API key + model (click ⬇ to fetch the model list, then pick from the dropdown) → save. The config lives only in `web/llm-config.json`, which is **git-ignored and never committed**. A commented `web/llm-config.json.template` is included — copy it to `llm-config.json` and fill it in.

---

## 🏗️ Architecture

```
project root
├── data/            # Knowledge layer: content for all seven dynasties
│   ├── emperors/    #   Ming's 16 emperors (one file each) + index.json
│   ├── events/      #   Ming events + map-event points
│   ├── cases/      #   Ming case files
│   ├── places/      #   ancient↔modern place-name mapping
│   ├── routes/      #   Ming campaign / voyage routes
│   ├── boundaries/  #   dynasty territory GeoJSON (Ming/Tang/Yuan/Qing)
│   ├── song/ tang/ yuan/ qing/ sui/ wudai/
│   │                #   per-dynasty folders (events/people/cases/emperors/routes/map-events)
│   ├── schema/      #   JSON Schema for each collection
│   ├── sources/     #   historical bibliography
│   └── portraits/   #   emperor / figure portraits (224 images, compressed to 10 MB)
├── web/             # Interaction layer: vanilla HTML/CSS/JS
│   ├── index.html   #   four-page skeleton
│   ├── app.js       #   data loading + rendering + interaction (test hooks)
│   ├── search-core.js # retrieval core (same rules as the ming_search plugin)
│   ├── serve.mjs    #   local static server + LLM proxy API
│   ├── vendor/      #   Leaflet 1.9.4 (vendored, no CDN dependency)
│   └── tools/       #   data scripts (portrait compression, route/place backfill)
├── plugin-final/    # Optional DSH plugin: conversational Q&A over the same data/
├── scripts/         # data-maintenance scripts + validator
└── docs/            # architecture / content guidelines / pedagogy docs
```

### Three-layer design

- **Knowledge layer** `data/`: pure content (JSON), one folder per dynasty, fields constrained by Schema.
- **Interaction layer** `web/`: vanilla JS (ESM), zero build, zero framework dependencies.
- **Dialog layer** `plugin-final/` (optional): a DSH plugin that answers AI questions grounded in the knowledge base.

> The website **runs standalone without DSH**; the plugin is just an extra conversational entry point.

---

## 📊 Data scale

| Dynasty | Emperors | Map events | Routes |
|---|---|---|---|
| Sui | 3 | 8 | 3 |
| Tang | 14 | 28 | 6 |
| Five Dynasties | 5 (central plains) + Ten Kingdoms Gantt chart | 12 | 2 |
| Song | 18 | 14 | 4 |
| Yuan | 8 | 14 | 5 |
| Ming | 16 | 43 | 10 |
| Qing | 12 | 22 | 6 |

- **545 timeline entries**, each rewritten in plain language (with a clear subject, cause-and-effect, and parenthetical glosses for jargon).
- Territory outlines are simplified, hand-drawn sketches based on Tan Qixiang's *Historical Atlas of China* — schematic, not precise boundaries.
- 224 portraits compressed to 512×512 (337 MB → 10 MB).

---

## 🧪 Tests & validation

```bash
node scripts/validate.mjs        # data validator (baseline: 0 errors / 168 warnings)
node web/smoke.mjs               # four-page render + map data layer (mock DOM)
node web/smoke-geo.mjs           # territory geojson/fallback paths + route animation
node web/smoke-dynasties.mjs     # seven-dynasty map data layer
node web/search-core.test.mjs    # retrieval-core unit tests
node plugin-final/selftest.mjs   # plugin self-test
```

---

## 📖 Content guidelines (important)

This content is written for learners, and follows three principles (see [`docs/pedagogy.md`](docs/pedagogy.md)):

- **History first**: only content backed by historical sources; when uncertain, say "no definitive record"; novels and legends are explicitly labeled "fiction, not recorded in the official histories".
- **Plain expression**: short spoken sentences, jargon glossed in parentheses on first use, abstract numbers turned into something a reader can feel.
- **The learner as director**: open questions have no single answer — affirm the reasoning first, then add the historical facts.

---

## 📄 License & disclaimers

- Content draws mainly from the official histories (*Book of Sui*, *Old/New Book of Tang*, *History of Song*, *History of Yuan*, *History of Ming*, *Draft History of Qing*, etc.).
- Territory outlines are **hand-drawn simplified sketches**, not precise boundaries, and are not used for any real-world claim.
- Emperor portraits are AI-generated, gongbi-style stylized images — not true historical likenesses.
- Map tiles © the respective tile provider (loaded online); Leaflet © Leaflet Contributors.
- This project is intended as an **educational example**. Before any public release, please review content compliance and licenses yourself.

---

## 🧭 Roadmap

- [x] Add screenshots / animated demos to the README (`docs/demo/*.gif`)
- [ ] Deploy to GitHub Pages / Vercel (adapt for subpaths)
- [ ] Clear the 168 content-layer validator warnings (expand people/events collections)
- [ ] Multi-turn conversation memory in the AI Tutor
