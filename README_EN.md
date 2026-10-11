<div align="center">

# 🏮 Chinese History Atlas

### Emperor Lineage · Thought Origins · Poetry Appreciation — connecting scattered facts into a single thread

[![Pure static](https://img.shields.io/badge/pure%20static-zero%20build-brightgreen)]()
[![Leaflet](https://img.shields.io/badge/maps-Leaflet_1.9.4-247bc1)]()
[![Modules](https://img.shields.io/badge/modules-3-c0392b)]()
[![Data](https://img.shields.io/badge/data-77%20emperors_·_6%20schools_·_22%20poets-e8c86a)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)]()

**🌐 Live demo** ｜
[GitHub Pages](https://zinging.github.io/chinese-history-atlas/web/) ·
[Gitee Pages](https://chen_ye_code.gitee.io/chinese-history-atlas/web/)

</div>

---

This is neither a textbook reader nor an encyclopedia. It does one thing: **connect scattered knowledge points into a thread**.

What emperors decided in court, how thinkers responded in their studies, what poets wrote at a given moment — three lines unfold in parallel, and you assemble the full outline of an era yourself. Built for history buffs who want a coherent thread, students of traditional culture who want an intellectual map, and learners moving from "memorizing dates" to "understanding cause and effect."

---

## 🗺️ Three Modules — Emperor Lineage, Thought Origins, Poetry Appreciation

### 🏮 Emperor Lineage

**77 emperors** across seven dynasties (Sui → Qing) on a single horizontal card rail. Open one for the life timeline, relationship graph, fun facts, and controversies. The map overlays each dynasty's approximate borders, ancient place markers, and animated campaign/voyage routes. Famous cases are broken down from naming through open debate, while History Detective hands you sourced clues and lets you reach your own verdict.

![Emperor Lineage](docs/demo/module-emperors.png?v=2)

### 📚 Thought Origins

Confucianism (Kong-Meng), Daoism (Lao-Zhuang), Buddhism (Chan), the Hundred Schools (military / Legalist / Mohist), and Neo-Confucianism / Yangmingism (Zhu Xi / Wang Yangming) — the operating system of Chinese thought, from the pre-Qin through Ming-Qing. Each school offers core classics read **against the author's historical situation**, rather than memorized in a vacuum; critical multiple-choice questions then train reasoning, testing both "how do you judge this?" and "what is the causal chain?"

![Thought Origins](docs/demo/module-thought.png?v=2)

### 🎋 Poetry Appreciation

From Qu Yuan to Nalan Xingde, **22 poets** organized by dynasty. This is not rote memorization — **first trace a poet's life journey on a map, then read the situation, mood, and story behind each verse**. Why did Li Bai write "a light skiff has sailed past ten thousand mountains" at Jiangling? Because he had just received the amnesty order. The poetry route map shows where they traveled and where they wrote their famous lines.

![Poetry Appreciation](docs/demo/module-poetry.png?v=2)

---

## ✨ What makes this project different

**🗡️ Three parallel threads, not three isolated pages**
An emperor's decision, a thinker's response, a poet's line written in exile — three facets of the same era. Traditional history sites cover only emperors; this one lets you see how power, thought, and aesthetics shaped one another.

**🗺️ History on a map, not in text**
A zoomable Leaflet basemap overlays borders and ancient places. The Jingnan campaign, Zheng He's seven voyages, and the Qing entry into Shanhai Pass unfold as timed animations rather than a static image; click any ancient place for its modern equivalent (e.g. Muzhou ≈ modern Jiande, Zhejiang).

**📂 Deep-read case files, not encyclopedia entries**
Famous mysteries are broken into eight sections: naming → background → people → course → outcome → impact → open debate → sources — a complete chain of reasoning, not a one-line "X happened in year Y."

**📝 380 critical questions, not true/false**
380 multiple-choice questions across 77 emperors in two modes — **evaluative judgment** ("How do you assess this policy?") and **causal chains** ("Why did this happen? What was the direct cause?"). Answers are graded instantly with explanations; roughly a quarter are open-ended and can be reviewed by an optional AI tutor.

**🔍 Traceable claims, fiction separated from history**
Timeline entries and detective clues cite the *Old/New Book of Tang*, *History of Song*, *History of Ming*, and more; fiction and lore are labeled separately as "popular tale, not in official histories," so you never mistake *Romance of the Three Kingdoms* for the record.

**⚡ Zero dependencies, open and use**
Pure vanilla HTML / CSS / JS — no build, no framework, no backend. Everything under `data/` is readable, editable JSON; no `npm install`, no database.

**🤖 Bring your own AI tutor, data stays local**
A built-in OpenAI-compatible endpoint (DeepSeek / OpenAI / etc.) stores config only in `web/llm-config.json` (git-ignored); your questions and answers never leave your machine.

---

## 🧭 How to learn with it

| Direction | What you can do |
| :--- | :--- |
| Build the big frame | Read the emperor rail across seven dynasties to fix "Tang → Five Dynasties → Song" |
| Understand key figures | Open any emperor for the relationship graph (ministers, consorts, rivals) |
| Follow major events | Filter the map by era and watch a battle or coup unfold from start to finish |
| Trace intellectual currents | From Kong-Meng to Zhu-Wang, see how Confucianism, Buddhism, and Daoism interacted |
| Read poetry in context | See a poet's life journey, then read the verse written at that exact moment |
| Train critical thinking | Each question tests both "how do you judge this?" and "what is the causal chain?" |
| Ancient ↔ modern places | Click an ancient place to see its modern location (e.g. Muzhou ≈ Jiande, Zhejiang) |

---

## 🚀 Quick start

**Requirement:** Node.js 18+ (built-in `fetch`; no `npm install` needed).

```bash
git clone git@gitee.com:chen_ye_code/chinese-history-atlas.git
cd chinese-history-atlas
node web/serve.mjs
# Open http://127.0.0.1:5173/web/ in your browser
```

> **Port in use:** run `node web/serve.mjs 8080` to switch ports.
>
> **Why a local server?** The frontend reads `data/*.json` via `fetch`; opening the HTML directly with `file://` is blocked by the browser's CORS policy and leaves the page blank.

**Optional · AI tutor:** open "🤖 AI Tutor config" at the bottom of the History Detective page and enter an OpenAI-compatible endpoint, key, and model (click ⬇ to fetch the model list automatically). Config lives only in `web/llm-config.json` (git-ignored); a commented `web/llm-config.json.template` is included — copy it to `llm-config.json` and fill it in.

---

## 🏗️ Project structure

```text
chinese-history-atlas/
├── data/                  # Knowledge layer (readable, editable JSON)
│   ├── sui/ tang/ wudai/ song/ yuan/ ming/ qing/   # Seven dynasties
│   │   ├── emperors/      # Emperor cards (life, timeline, people, fun facts)
│   │   ├── events/        # Major events
│   │   ├── cases/         # Case-file mysteries
│   │   ├── places/        # Ancient places (modern equivalents, lat/lng)
│   │   ├── routes/        # Campaign / voyage routes
│   │   ├── quiz.json      # Quiz question bank
│   │   └── people.json    # Key figure biographies
│   ├── boundaries/        # Dynasty territory GeoJSON
│   ├── portraits/         # Portraits (AI-generated gongbi style)
│   └── schema/ sources/   # Data schema and source citations
├── web/                   # Frontend: vanilla HTML/CSS/JS
│   ├── index.html         # Emperor Lineage main page
│   ├── guoxue/            # Thought Origins + Poetry Appreciation
│   ├── tools/             # Quiz generation and validation scripts
│   └── vendor/            # Leaflet vendored locally, no CDN
├── scripts/               # Validators and maintenance scripts
└── docs/                  # Architecture / content guidelines / demos
```

---

## 📊 Data scale

| Module | Content |
| :--- | :--- |
| 🏮 Emperor Lineage | 7 dynasties · 77 emperors · 380 quiz questions · 545 timeline entries |
| 📚 Thought Origins | 6 schools (Confucian / Daoist / Buddhist / Hundred / Song-Ming Neo-Confucian) · 27 classic texts |
| 🎋 Poetry Appreciation | 22 poets · organized by dynasty · poetry journey maps |

> Territory outlines are simplified sketches based on Tan Qixiang's *Historical Atlas of China*; portraits are AI-generated gongbi-style images.

---

## 📖 Content guidelines

- **Sources first:** include only what the record supports; mark gaps as "no reliable record"; label fiction and lore as "popular tale, not in official histories."
- **Plain language:** short sentences; explain proper nouns on first mention (e.g. "the Sixteen Prefectures, roughly modern Beijing, Tianjin, and northern Hebei/Shanxi").
- **Learner in charge:** open questions have no single answer — leave room to think before presenting the consensus; correct options are shuffled to prevent positional guessing.
- **Neutral stance:** take no sides and romanticize nothing; present multiple perspectives on controversies and let learners judge.

---

## 📄 License

[MIT License](LICENSE) © chen_ye_code

Content draws mainly from the official histories (*Book of Sui*, *Old/New Book of Tang*, *History of Song*, *History of Yuan*, *History of Ming*, *Draft History of Qing*, etc.). Territory outlines are hand-drawn simplified sketches, not precise boundaries. Portraits are AI-generated gongbi-style stylized images, not true historical likenesses. Map tiles © their respective providers; Leaflet © Leaflet Contributors.
