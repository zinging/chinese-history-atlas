# 🏮 Chinese History Atlas

> English | [中文](README.md)

A Chinese culture learning site that weaves together **three modules: Emperor Lineage · Thought Origins · Poetry Appreciation**.

It's not a textbook reader and not an encyclopedia. It does one thing: **connect scattered knowledge points into a thread**. What emperors decided, how thinkers responded, what poets wrote in that exact moment — three lines unfolding in parallel, so you build the full outline of an era yourself.

Built for history buffs who want a coherent thread, students of traditional culture who want an intellectual map, and learners moving from "memorizing dates" to "understanding cause and effect."

**🌐 Live demo**:
- GitHub Pages: https://zinging.github.io/chinese-history-atlas/web/
- Gitee Pages: https://chen_ye_code.gitee.io/chinese-history-atlas/web/

![Pure static](https://img.shields.io/badge/pure%20static-zero%20build-brightgreen)
![Leaflet](https://img.shields.io/badge/maps-Leaflet_1.9.4-247bc1)
![Three modules](https://img.shields.io/badge/modules-3-c0392b)
![Data](https://img.shields.io/badge/data-77%20emperors_6%20schools_22%20poets-e8c86a)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

---

## 🗺️ Three Modules

### 🏮 Emperor Lineage

77 emperors across seven dynasties (Sui → Qing) on a horizontal card rail. Open one for the life timeline, relationship graph, fun facts, and controversies. The Leaflet map overlays each dynasty's approximate borders, ancient place markers, and animated campaign/voyage routes. Famous cases are broken down from naming through sources — not one-liners. History Detective gives you sourced clues to form your own judgment.

![Emperor Lineage](docs/demo/module-emperors.png?v=2)

### 📚 Thought Origins

Confucianism (Kong-Meng), Daoism (Lao-Zhuang), Buddhism (Chan), the Hundred Schools (military/Legalist/Mohist), and Neo-Confucianism/Yangmingism (Zhu Xi/Wang Yangming) — the operating system of Chinese thought, from pre-Qin through Ming-Qing. Each school features classic texts read **against the author's historical situation**, not decontextualized. Critical multiple-choice questions train both evaluative judgment and causal reasoning.

![Thought Origins](docs/demo/module-thought.png?v=2)

### 🎋 Poetry Appreciation

From Qu Yuan to Nalan Xingde: 22 poets organized by dynasty. Not just memorization — **trace a poet's life journey on a map, then read what situation, mood, or story lies behind each verse**. Why did Li Bai write "a skiff has sailed past ten thousand mountains" at Jiangling? Because he'd just received the amnesty order. The poetry route map shows where they went and where they wrote their famous lines.

![Poetry Appreciation](docs/demo/module-poetry.png?v=2)

---

## ✨ What makes this project different

### Three parallel threads, not three isolated pages

What emperors decided in court, how thinkers responded in their studies, what poets wrote in exile — **three facets of the same era**. Traditional history sites only cover emperors. This one lets you see how power, thought, and aesthetics influenced each other.

### History on a map, not in text

A pan/zoom Leaflet basemap overlays each dynasty's approximate borders and ancient place pins. The Jingnan campaign, Zheng He's seven voyages, the Qing entry into Shanhai Pass — animated as timed sequences, not static images. Click any ancient place to see its modern equivalent.

### Deep-read case files, not encyclopedia entries

Famous mysteries are broken into eight sections: naming → background → people → course → outcome → impact → open debate → sources. You get the full reasoning chain, not "X happened in year Y."

### 380 critical questions, not true/false

Built-in **multiple-choice questions for all 77 emperors** in two types:
- **Evaluative judgment**: "How do you evaluate this policy of X?"
- **Causal chains**: "Why did this happen? What was the direct cause?"

Graded instantly with explanations. ~25% are open-ended and can be reviewed by an optional AI tutor.

### Traceable claims, fiction separated from history

Timeline entries and detective clues cite the *Old/New Book of Tang*, *History of Song*, *History of Ming*, etc. Fiction/lore is labeled separately as "popular tale, not in official histories" — so you don't confuse *Romance of the Three Kingdoms* with the actual record.

### Zero dependencies, open it and use it

Vanilla HTML/CSS/JS, no build, no framework, no backend. `data/` is all readable JSON — you can open it, edit it, add to it. No npm install, no database.

### Bring your own AI tutor, data stays on your machine

Built-in OpenAI-compatible endpoint (DeepSeek, OpenAI, …). Config lives only in `web/llm-config.json` (git-ignored). Your questions and answers never leave your machine.

---

## 🧭 How to learn with it

| Direction | What you can do |
| --- | --- |
| Build the big frame | Read the emperor rail across all seven dynasties to fix "Tang → Five Dynasties → Song" |
| Understand key figures | Open any emperor to see the relationship graph (ministers, consorts, rivals) |
| Follow major events | On the map, filter by era and watch a battle/coup unfold |
| Trace intellectual currents | From Kong-Meng to Zhu-Wang, see how Confucianism, Buddhism, and Daoism influenced each other |
| Read poetry in context | See a poet's life journey, then read the verse they wrote at that moment |
| Train historical thinking | Each question asks both "how do you evaluate this?" and "what's the causal chain?" |
| Ancient ↔ modern places | Click any ancient place pin to see where it is today |

---

## 🚀 Quick start

**Requirement:** Node.js 18+ (built-in `fetch`; no `npm install` needed).

```bash
git clone git@gitee.com:chen_ye_code/chinese-history-atlas.git
cd chinese-history-atlas
node web/serve.mjs
# Open http://127.0.0.1:5173/web/ in your browser
```

> Port in use? `node web/serve.mjs 8080`.
>
> Why a local server? The frontend reads `data/*.json` via `fetch`; opening with `file://` is blocked by CORS and the page will be blank.

**Optional · AI tutor:** on the History Detective page, scroll to "🤖 AI Tutor config", enter any OpenAI-compatible endpoint + API key + model (click ⬇ to fetch the model list). Config lives only in `web/llm-config.json` (git-ignored). A commented `web/llm-config.json.template` is included.

---

## 🏗️ Project structure

```
chinese-history-atlas/
├── data/                  # Knowledge layer (readable, editable JSON)
│   ├── sui/ tang/ wudai/ song/ yuan/ ming/ qing/   # Seven dynasties
│   │   ├── emperors/      # Emperor cards (life, timeline, people, fun facts)
│   │   ├── events/        # Major events
│   │   ├── cases/         # Case-file mysteries
│   │   ├── places/       # Ancient places (modern equivalents, lat/lng)
│   │   ├── routes/        # Campaign / voyage routes
│   │   ├── quiz.json      # Quiz question bank
│   │   └── people.json    # Key figure biographies
│   ├── boundaries/       # Dynasty territory GeoJSON
│   ├── portraits/        # Portraits (AI-generated gongbi style)
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
| --- | --- |
| Emperor Lineage | 7 dynasties, 77 emperors, 380 quiz questions, 545 timeline entries |
| Thought Origins | 6 schools (Confucian/Daoist/Buddhist/Hundred/Song-Ming Neo-Confucian), 27 classic texts |
| Poetry Appreciation | 22 poets organized by dynasty, poetry journey maps |

Territory outlines are simplified sketches based on Tan Qixiang's *Historical Atlas of China*. Portraits are AI-generated gongbi-style stylized images.

---

## 📖 Content guidelines

- **Sources first.** Only include what the historical record supports; mark gaps as "no reliable record"; label fiction/lore separately.
- **Plain language.** Short sentences; explain proper nouns on first mention.
- **Learner as director.** Open questions have no single answer — give room to think before presenting the scholarly consensus. Correct options are shuffled across positions.
- **Neutral stance.** Don't take sides; present multiple perspectives on controversial topics and let learners judge.

---

## 📄 License

[MIT License](LICENSE) © chen_ye_code

Content draws mainly from the official histories (*Book of Sui*, *Old/New Book of Tang*, *History of Song*, *History of Yuan*, *History of Ming*, *Draft History of Qing*, etc.). Territory outlines are hand-drawn simplified sketches, not precise boundaries. Portraits are AI-generated gongbi-style stylized images, not true historical likenesses. Map tiles © their respective providers; Leaflet © Leaflet Contributors.
