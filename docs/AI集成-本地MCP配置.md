# MCP 客户端接入说明（本地 STDIO）

本站内置一个零依赖的本地 MCP Server：`web/tools/history-mcp-server.mjs`（当前 v1.3.0，15 个只读工具）。
豆包、DSH（DeepSeek Harness）、Cursor、Claude Desktop 等支持 STDIO MCP 的客户端都能接入。

接入后，AI 助手可以直接检索站点的全部结构化数据（77 帝、76 案、典籍、器物、神兽、舆图热点、诗路、选择题等），
并在回答中给出**可点击的深链**，一键跳转到站内对应页面（皇帝卡、悬案、地图事件、典籍、神兽、舆图热点等）。

> 架构理念：**前端是展厅，AI 是讲解员**。AI 只读站内数据、不联网；讲解在对话框，图鉴、古舆图、时间线等可视化仍在网页里打开。

## 一、前置条件

1. 已安装 Node.js（18 及以上，命令行 `node -v` 可用）。
2. **本地服务零命令启动**：MCP 提供 `session_start` 开场工具，AI 新会话开场调用它即可——工具会自己探活 `http://127.0.0.1:5173/web/`，
   若未运行则**由 MCP 进程自己在后台拉起** `node web/serve.mjs`（脱离 MCP 进程独立存活，实测探活约 0.8 秒）。
   端口被别的程序占用时，工具会返回 `port_taken` 并给出换端口办法——AI 不需要、也不应该自己查端口、查进程。
3. 人工备用：双击项目根目录 `服务管理.bat`（前台运行、关闭窗口即停服务，便于看日志），或执行 `npm start`（即 `node web/serve.mjs`）。

## 二、一键生成连接器配置（推荐，跨机器/跨平台）

项目已按「开箱即用」封装，所有路径都按脚本位置自动解析，**不需要手写绝对路径**：

- **Windows（PowerShell）**：在项目根目录执行 `npm run mcp:install`（或直接运行 `web/tools/install-mcp.ps1`），
  脚本会把完整的 MCP 配置 JSON 自动复制到剪贴板。
- **macOS / Linux（shell）**：执行 `bash web/tools/install-mcp.sh`，自动生成 JSON 并尝试复制到剪贴板（pbcopy / xclip）。

生成的 JSON 形如（路径为本机绝对路径，自动生成）：

```json
{
  "mcpServers": {
    "chinese-history-atlas": {
      "command": "node",
      "args": ["D:/你的路径/chinese-history-atlas/web/tools/history-mcp-server.mjs"],
      "env": { "CHAT_BASE_URL": "http://127.0.0.1:5173/web/" }
    }
  }
}
```

模板见 `web/tools/mcp-config.example.json`；项目根 `package.json` 已声明 `bin`（`chinese-history-atlas-mcp`）
与 `mcp` / `mcp:selftest` / `mcp:install` 脚本，`npm install` 后也可用 `npm run mcp` 直接启动 STDIO 服务。

### 豆包桌面客户端（图形界面）

1. 「插件 · 技能 · 伙伴」→「添加」→「新建自定义连接器」，传输类型选 **STDIO**。
2. 运行命令填 `node`；参数填安装脚本输出的绝对路径（`.../web/tools/history-mcp-server.mjs`），模式选「仅本地电脑」。
3. 保存后从连接器详情页点「在对话中试用」进入挂载会话；工具列表应出现 15 个只读工具。

### Hermes / Cursor / Claude Desktop 等（JSON 配置）

- 方式一：直接粘贴安装脚本复制的 JSON（绝对路径）到对应的 MCP 配置文件。
- 方式二：Cursor / Zed 等支持项目级 MCP 的客户端，仓库根目录已自带 **`.mcp.json`**（相对路径，随项目一起分发），打开项目文件夹时会提示启用，无需任何手工配置。

## 三、新会话的标准开场（无需用户提示，正常路径零命令行）

AI 进入会话后自动执行一次：

1. 调用 `session_start`。探活、按需启动、端口占用判定全部在 MCP 进程内完成，工具直接返回结论（`status`、`ready`、`home_url`、`status_note`）；
2. `ready=true` 时，把 `home_url` 作为**可点击链接**发给用户，并说一句「站点已就绪，可以开始提问」；
3. `ready=false` 时，把 `status_note` 与 `fix` 如实转述给用户，等用户处理后再复检一次。

模型**不执行任何命令行**。`session_start` 的返回里不含任何探活或启动命令——这是刻意的设计，把确定性步骤收进工具内部，避免模型自由发挥。

三种状态：

| status | 含义 | 模型该做什么 |
|---|---|---|
| `running` | 服务已在运行，且响应头确认是本站 | 给链接，待命 |
| `started_by_mcp` | 原本未运行，本工具已后台拉起并通过探活 | 给链接，待命 |
| `port_taken` | 端口被别的程序占用（响应头没有本站标记 `X-DSH-Atlas`） | 转述占用情况与换端口办法 |
| `start_failed` | 拉起后仍不通 | 转述 `fix` 里那一条命令，让用户自己执行 |

> 关于「每个人项目路径不同」：路径由 MCP 进程按自身文件位置自动解析（`project_root`），跨机器、跨工作目录均不依赖任何硬编码。

## 三之二、DSH（DeepSeek Harness）接入

DSH 的 MCP 配置写在 profile 的 `cordis.patch.yml` 里，不走 `.mcp.json`。安装器直接写入该文件，无需手工粘贴：

```bash
node web/tools/install-dsh.mjs              # 安装（幂等：已存在则更新路径）
node web/tools/install-dsh.mjs --check      # 只检查，不写入
node web/tools/install-dsh.mjs --uninstall  # 移除本项目的条目
node web/tools/install-dsh.mjs --port 8080  # 换端口
```

写入位置 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（默认 profile 为 `desktop`，默认端口 5173）。安装器会：

- 写前自动备份为 `cordis.patch.yml.bak-before-atlas-<时间戳>`；
- 只增删本项目 `id: chinese-history-atlas` 那一条，不碰其它配置；
- 写入后复核「条目恰好一份、transport/serverName/路径正确、文件未被截断」，任一不通过立即从备份还原并报错。

装完重启 DSH，新建会话即可。工具以 `mcp__atlas__session_start` 这样的名字出现。

### 关于「AI 自动打开右侧浏览器」

当前 DSH 的右侧浏览器（`dsh-client-ui-sidebar-browser`）**不向模型注册任何工具**——它是用户侧呈现状态。所以模型无法自己把页面推到右侧窗口，本连接器的做法是：

- 模型给出可点击的深链（`http://127.0.0.1:5173/web/index.html?page=...`），用户点一下即在右侧打开并定位；
- 页面内的深链路由（`web/app.js` 与 `web/guoxue/app.js` 的 `applyDeepLink()`）负责切朝代、展开皇帝卡、弹出案件、定位地图事件。

已验证的深链行为：皇帝深链会切到对应朝代并展开该帝详情；地图事件深链会定位地图、弹出事件卡并展开对应路线。 

## 四、工具清单（15 个，只读）

| 工具 | 用途 |
|---|---|
| session_start | 开场自动探活、由 MCP 自启动本地服务，返回首页地址与打开指引（零命令行） |
| list_modules | 五大模块总览与数据规模 |
| search | 全站全文检索（预构建单字/双字倒排索引，毫秒级；含皇帝、悬案、地图事件、典籍、公案、器物、神兽、舆图热点、路线、问典） |
| list_emperors / get_emperor | 皇帝列表与详情 |
| list_cases / get_case | 八段式悬案列表与详情 |
| list_books / get_book | 典籍/诗人列表与详情（含名篇精读、金句） |
| list_creatures | 神话神兽图鉴 |
| list_artifacts / get_artifact | 器物/神兽图鉴（含缩略图+原图） |
| get_route | 帝王舆图路线事件、神话五路线热点、诗路行迹 |
| get_discourses | 思想流派问答 |
| get_quiz | 各板块选择题/思辨题 |

## 五、返回字段约定（v1.1.0 起）

- 每个实体都带：
  - `url`：**完整的本地地址字符串**（形如 `http://127.0.0.1:5173/web/index.html?page=...`），可直接在浏览器导航；
  - `online_url`：对应的 GitHub Pages 在线地址，仅在用户明确要分享链接时使用。
- 图片对象同样为 `{url, online_url}`；缩略图为 `{thumb:{url, online_url}, full:{url, online_url}}`。
- 检索结果按相关度打分排序（标题精确命中优先，地图事件/皇帝/悬案/热点等加权），并带 `score` 字段。

### 深链格式速查

| 目标 | 链接示例 |
|---|---|
| 皇帝卡 | `index.html?page=timeline&dynasty=ming&emperor=ming-emperor-taizu` |
| 悬案 | `index.html?page=cases&dynasty=ming&case=ming-case-kongyin` |
| 地图事件 | `index.html?page=map&dynasty=ming&event=ming-event-tumu` |
| 探案问史 | `index.html?page=detective&dynasty=ming` |
| 思想流派 | `guoxue/index.html?sect=rujia` |
| 典籍/诗人 | `guoxue/shici.html?tab=books&book=libai` |
| 器物灯箱 | `guoxue/gewu.html?tab=artifacts&name=商代后母戊鼎` |
| 神话舆图热点 | `guoxue/myth.html?tab=map&route=1&hotspot=高老庄` |
| 诗路路线 | `guoxue/shici.html?tab=map&route=1` |

本地前缀 `http://127.0.0.1:5173/web/`；线上前缀 `https://zinging.github.io/chinese-history-atlas/web/`。
本地基址可用环境变量 `CHAT_BASE_URL` 覆盖。

## 六、模型不自律时的强制开场（重开连接器 + 一键开场）

**修改 Server 代码后必须让连接器重新加载**：旧进程不会自动重启。做法是关闭连接器开关再开启，或重新从连接器详情页点「在对话中试用」（新会话一定是新进程）。
判断是否加载了新版：新会话开场如果还出现 `deep_link.local`、翻硬盘找项目等行为，说明挂的仍是旧进程。

服务端已提供三道程序化约束（客户端均支持时无需任何手工操作）：

1. `server/discover` 与 `initialize` 握手均返回完整开场指令；
2. 连接器的 **提示词模板（prompts）** 里有两个可点击模板：
   - 「开场：打开中华历史图谱」——新会话点一下，模型必走 `session_start` → 给出首页链接 → 待命；
   - 「按站内内容讲解」——填入话题（如「土木堡之变」），自动锁定「只检索站内、给深链、再讲解」。
3. 若模型在 `session_start` 之前调用任何其他工具，结果会自动前置开场提醒。

若所用客户端不渲染提示词模板、模型仍先翻硬盘，把下面这段作为**新会话的第一句话**发给它（一次性、确定性约束）：

```text
使用 Chinese History Atlas 连接器：第一步只调用 session_start，不要执行任何命令行、不要搜索文件或查 hosts；
然后在右侧内置浏览器打开返回的 home_url，回复「站点已就绪」。之后我的问题只用连接器数据回答，禁止联网。
```

## 七、自检

```bash
# 协议与数据自测
npm run mcp:selftest          # 等价于 node web/tools/history-mcp-server.mjs --selftest

# 真实 STDIO 管道模拟（握手 + 工具调用 + prompts）
node .sessions/mcp-client-test.mjs

# 冷启动全链路审计（开场 SOP、15 工具、字段形态、深链 HTTP 200、未收录安全返回）
node .sessions/mcp-coldstart-audit.mjs
```

## 八、边界说明

- 插件只读：不写任何外部文件，实时读取 `data/` 目录。
- 图片只给缩略图 URL（对话内引用）与原图 URL（点开看大图），不输出 base64。
- 涉及演义文本（《三国演义》《西游记》《封神演义》《聊斋志异》等）内容会标注出处，不与正史混淆。
- 右下角「AI 老师配置」（llm-config.json，OpenAI 兼容）是网页内的问答能力，与本 MCP 插件互补，保留不删。
- 扣子（coze.cn）仅支持 Streamable HTTP/SSE 类型的 MCP；当前 Server 为 STDIO，扣子侧边栏接入需后续增加 HTTP transport。

---

# 九、零引导安装 + AI 讲解员落地方案

> 目标：一个**从未接触过本项目的新用户**，从 GitHub/Gitee 拿到项目包后，只对 AI 说一句「帮我安装」，
> 就能自动完成部署、服务拉起与连接器注册；随后 AI 以「专业讲解员」身份，**依托豆包/Hermes 自身的对话与语音能力**，
> 配合右侧浏览器里真实打开的网页，按时间、按路线逐站讲解（如靖难之役）。
>
> 语音策略（v1.4.0 修订）：**默认不做任何 TTS**，页面是纯静态网页。朗读改为用户在侧栏「导览设置」里自愿开启的可选项——开启后用浏览器原生 `speechSynthesis`（零依赖、离线可用）逐句朗读，以语音念完为该句推进信号；也可只开「文本推进」不出声。两个开关都关闭时，不建控制条、不排计时、不动 DOM，回到原始静态状态。
> 网页只负责「看」——时间线、古地图、动态 SVG 路线、事件弹窗、图鉴。两者用**深链**同步。

> **实施状态（v1.3.0）：本章是设计文档，尚未全部落地。**
> 已实现：AI 讲解员「锚点表」机制——MCP 的 `guide.anchors`（每项含 scene/role/text/sources/url）供 AI 自行组织导读与在关键处挂链接；`web/guide-highlight.js` 负责按 `#s=N` 定位高亮，**不做自动播放**（页面呈现为主，节奏由读者与 AI 讲解控制）。
> 未实现：`web/tools/bootstrap.mjs`、仓库根 `AGENTS.md`、`npm run setup` 脚本、`session_start` 增强、MCP prompt 模板（见 9.4 / 9.5 / 9.6.5）。
> 下面 9.4、9.5、9.6.5 属规划内容，请勿当作现有行为。

## 9.1 目标用户旅程（验收口径）

### 旅程 A：从零安装（用户只说一句话）

```
用户：（在豆包/Hermes 任意会话，可挂着项目文件夹）帮我安装
  AI：环境检测 → 连接器注册 → 服务探活 → 输出完成引导
AI：✅ 中华历史图谱已部署完成，网站已在本地运行（http://127.0.0.1:5173/web/）。
    现在你可以直接对我说，比如：
      · 「介绍一下靖难之役」
      · 「带我走一遍郑和下西洋」
      · 「山海经里的昆仑之丘是什么」
    我会一边打开网页一边给你讲解。
```

### 旅程 B：讲解员讲解（以「介绍一下靖难之役」为例）

```
用户：介绍一下靖难之役
AI ：【先讲人物】打开明成祖朱棣的皇帝卡（深链），简介其人、封王背景、与建文帝的矛盾。
AI ：【再讲背景】打开地图事件「靖难之役」（深链 event=ming-event-jingnan）——
     页面自动飞到南京、弹出事件卡，并在地图上动态画出「北平→白沟河→济南→扬州→南京」整条路线。
AI ：【逐站讲解·第 1 站】北平起兵，1399 年七月……请看地图最北端绿色起点。
用户：继续
AI ：【第 2 站】白沟河大捷，1400 年四月……（地图视角跟随到该站）
用户：继续
… 直到第 5 站 金川门登基 …
AI ：【结局与影响】四年战争如何改变明初政治格局；可引一道史论选择题（get_quiz）收尾。
```

- **声音**：由豆包客户端自带的语音朗读负责，AI 不输出任何音频。
- **节奏**：AI 每站只发一条短消息（建议 100–200 字），用户说「继续 / 下一站」推进；
  也可在用户授权「一次讲完」时连续播报，但每站之间仍按站分段，便于语音与视觉对齐。
- **页面同步**：AI 每一段讲解都以深链为锚点（人物卡 / 事件卡 / 路线 / 站点），右侧浏览器点链接即定位。

## 9.2 现状盘点（已具备 vs 缺口）

### 已具备，无需重做

| 能力 | 载体 | 状态 |
|---|---|---|
| 服务自动拉起 | `session_start` 工具：MCP 进程内探活，未运行则后台 `node web/serve.mjs`，返回 running/started_by_mcp/port_taken/start_failed | ✅ 已实现 |
| 路径自解析 | MCP 按自身文件位置推导 `project_root`，不依赖硬编码绝对路径 | ✅ |
| DSH 连接器自动注册 | `web/tools/install-dsh.mjs`（备份+幂等+五项复核），`npm run mcp:install:dsh` | ✅ |
| Cursor / Zed 等 | 仓库根 `.mcp.json`（相对路径，随包分发） | ✅ |
| 豆包桌面客户端 / 其他 | `install-mcp.ps1` / `install-mcp.sh` 生成配置 JSON（需 GUI 粘贴） | ✅（半自动） |
| 人物深链 | `?page=timeline&dynasty=ming&emperor=...` 自动切朝、展开皇帝卡 | ✅ |
| 事件深链 | `?page=map&dynasty=ming&event=...` 自动飞行、弹窗、**动态绘制关联路线**（`EVENT_ROUTE_MAP` + `showEventRoute`）、展开路线详情 | ✅ |
| 悬案 / 典籍 / 神兽 / 舆图热点深链 | 各页面 `applyDeepLink()` 均已支持 | ✅ |
| 路线数据 | `data/routes/routes.json`：10 条明朝路线，每站含 `name/modern/lat/lng/note` | ✅ |
| MCP 取路线 | `get_route(module=emperors, route=<id/名称>)` 返回有序途经点 | ✅（v1.3.0） |
| 开场约束 | 握手 `instructions`、MCP prompts 模板、未开场工具拦截 | ✅ |

### 缺口（代码阶段需要补齐，本次仅设计）

1. **安装阶段无统一入口**：新用户说「帮我安装」时，连接器还没装上（先有鸡还是先有蛋），
   目前没有一个「不管什么客户端都能一把梭」的 bootstrap 脚本，也没有给普通 LLM 看的安装行动指南。
2. **豆包桌面客户端连接器只能 GUI 注册**：`install-mcp.ps1` 只能生成 JSON 到剪贴板，
   最后一步「新建自定义连接器 → 选 STDIO → 粘贴 → 保存」必须人工在图形界面完成（LLM 可用 computer-use 代操作，但非默认）。
3. **`route=` 深链前端不识别**：`get_route` 单条路线返回的 `?page=map&dynasty=ming&route=<id>` 目前会被前端忽略
   （语音导览回退后 `applyDeepLink` 不再处理 route 参数），落到裸地图页。这是回退后遗留的断链，需补回**无 TTS 的静态版**：
   识别 `route` 后自动展开路线详情面板（`showRouteDetail`）即可，不恢复 autoplay/muted。
4. **逐站聚焦能力（可选增强）**：阶段一整条路线会一次性画出，AI 逐站讲解时地图视角不跟随。
   可补一个**纯静态**的 `route=<id>&stop=N` 深链：地图居中到第 N 站、高亮该站标记，**不做 TTS、不做自动播放**。
5. **讲解剧本未固化**：SERVER_INSTRUCTIONS 目前只规定「检索 → 给深链 → 讲解」，没有「人物 → 背景 → 事件 → 逐站 → 影响」的讲解顺序与分幕节奏。
6. **首次引导话术缺失**：`session_start` 返回里没有「建议用户问的第一句话」，新用户装完不知道能问什么。

## 9.3 总体架构（两阶段、两角色）

```
阶段 0  安装（Bootstrap，普通 LLM 会话执行，连接器还没装）
  用户：帮我安装
   ├─ 跑 web/tools/bootstrap.mjs（新增，零依赖 Node 脚本）
  │    1. 检测 Node 版本（≥18）
  │    2. 定位客户端类型：DSH(Hermes) / 豆包桌面 / Cursor系 / Claude Desktop
  │    3. 能自动写的自动写：DSH→install-dsh.mjs；.mcp.json 系→无需动作；Claude→写配置文件
  │    4. 豆包桌面客户端：生成 JSON 并输出 GUI 三步指引（可选由 LLM 用 computer-use 代填）
  │    5. 跑 mcp:selftest 自检
  │    6. 拉起一次服务并探活（node web/serve.mjs）
  │    7. 输出「安装完成话术 + 3 个引导问题」
  └─ 仓库根新增 AGENTS.md（或 docs/安装引导-LLM行动手册.md）：
     任何 LLM 读到「帮我安装」「部署」「安装连接器」都照此执行，禁止自己翻硬盘猜路径。

阶段 1  运行（连接器已装，新会话开场）
  session_start 自动探活/拉起 → 返回 home_url + suggested_questions（新增字段）
  → AI 回复固定引导话术 → 待命。

阶段 2  讲解（用户提问，AI 按「讲解员剧本」执行）
  只用 15 个只读工具 + 深链；网页负责可视化，AI 负责讲述与节奏；
  语音默认关闭，由用户在侧栏「导览设置」自愿开启；只用浏览器原生 `speechSynthesis`，不引入任何外部 TTS 依赖或音频文件。
```

## 9.4 阶段 0：一键安装 Bootstrap 设计

### 9.4.1 新增脚本 `web/tools/bootstrap.mjs`（零依赖，`npm run setup`）

职责与输出（幂等，可重复执行）：

1. **环境检测**：`node -v` ≥18，否则给出安装链接；无需 `npm install`（项目零运行时依赖）。
2. **客户端探测**（按优先级）：
   - DSH/Hermes：存在 `~/.dsh-beta`（或 `$DSH_HOME`）→ 直接调用 `install-dsh.mjs` 完成全自动注册；
   - Cursor / Zed / 其他识别 `.mcp.json` 的客户端：仓库已自带，提示「用『打开文件夹』方式打开本项目即自动提示启用」；
   - Claude Desktop：存在其配置目录 → 生成/合并 `claude_desktop_config.json`（先备份、只增本条目）；
   - 豆包桌面客户端（Windows 主场景）：无法纯脚本写入，输出「**GUI 三步 + 配置 JSON**」，
     JSON 由脚本按自身绝对路径生成，用户只需复制粘贴（或授权 LLM 用 computer-use 代点）。
3. **自检**：内部调用 `history-mcp-server.mjs --selftest`，全过才报成功。
4. **服务探活与拉起**：直接复用 `ensureLocalServer` 同款逻辑（或要求随后新会话用 `session_start` 拉起）。
5. **标准输出**（JSON + 人话双格式，供 LLM 转述）：

```json
{
  "installed": ["dsh"],
  "manual_required": ["doubao-desktop"],
  "manual_steps": ["插件·技能·伙伴 → 添加 → 新建自定义连接器 → STDIO",
                   "命令 node，参数粘贴 <绝对路径>/web/tools/history-mcp-server.mjs",
                   "保存 → 在对话中试用"],
  "config_json": { "...": "..." },
  "self_test": "passed",
  "home_url": "http://127.0.0.1:5173/web/",
  "next_session_hint": "连接器装好后请新建会话（或在连接器详情页点『在对话中试用』），新会话会自动开场。"
}
```

### 9.4.2 仓库根新增 `AGENTS.md`（面向 LLM 的行动手册）

内容要点（给任何 AI harness 读，避免「不断找路径」）：

- 项目根判定：**以用户当前打开的文件夹/仓库为根**，不搜索硬盘；若用户只给了项目名，先问一句项目位置，不要全盘扫描。
- 安装动作唯一入口：`npm run setup`（即 `node web/tools/bootstrap.mjs`），不要手写配置、不要猜端口。
- 服务生命周期：网站服务由 MCP 的 `session_start` 在新会话里自动拉起；**安装阶段** bootstrap 可临时拉起一次做探活，
  不要让用户去找 .bat、不要另开系统浏览器抢焦点。
- 完成后必须输出固定话术（见 9.4.3）并引导用户**新建会话**，因为连接器只在新会话生效。
- 明确「网页无语音、讲解靠 AI」的定位，禁止在安装阶段去网站里找 TTS 功能。

### 9.4.3 安装完成标准话术（bootstrap 输出，AI 原样转述）

```
✅ 中华历史图谱部署完成，本地网站已可访问：http://127.0.0.1:5173/web/
连接器已注册（豆包桌面客户端需按上面 3 步粘贴一次配置）。
👉 请新建一个会话（或点连接器的「在对话中试用」），我会自动开场并打开网站。
你可以直接对我说：
  · 介绍一下靖难之役（人物 + 地图路线逐站讲）
  · 带我走一遍郑和下西洋
  · 山海经的昆仑之丘是怎样的地方
  · 李白的一生走过哪些地方
```

## 9.5 阶段 1：新会话开场与首次引导

### `session_start` 返回增强（新增字段，向后兼容）

在现有 `ready/status/home_url/next_action/rules` 基础上增加：

```json
{
  "ready": true,
  "home_url": "http://127.0.0.1:5173/web/",
  "suggested_questions": [
    {"q": "介绍一下靖难之役", "kind": "事件·路线讲解"},
    {"q": "带我走一遍郑和下西洋", "kind": "路线逐站讲解"},
    {"q": "明成祖朱棣是个怎样的皇帝", "kind": "人物"},
    {"q": "山海经的昆仑之丘", "kind": "神话舆图"},
    {"q": "李白的一生走过哪些地方", "kind": "诗路"}
  ],
  "greeting": "站点已就绪。你可以直接问我任何历史与国学话题，我会一边打开网页一边讲解。"
}
```

握手 `instructions` 与 OPENING_PROMPT 同步要求：开场把 `home_url` 给用户后，**从 suggested_questions 里挑 2–3 条念给用户**，降低首次使用门槛。

## 9.6 阶段 2：AI 讲解员剧本（核心，固化进 SERVER_INSTRUCTIONS）

### 9.6.1 通用纪律

1. **先取数据、再开口**：所有事实来自工具返回，禁止联网、禁止脑补；未收录就说「站点暂未收录」。
   - 时间、兵力、地名、人物对话等硬细节，**工具返回里没有就不能说**。站点数据缺年份时，只能说顺序
     （「起兵后南下的第二站」），禁止自行编出「1400 年四月」这类年月。
2. **总—分—总结构**：开口先用一句话讲清「谁、为什么、打了几年、结果如何」（总纲，取自事件 summary 与路线 desc），
   再分幕展开；结尾再回到地图终点做收束。零基础用户需要先有全局，再跟细节。
3. **每一幕都配一条深链**：先发深链（右侧浏览器点击即定位），再开口讲这一幕。
4. **分段播报、用户控速**：每站/每幕一条消息，单条 100–200 字；每条结尾提示「回复『继续』讲下一站」。
5. **画面与口播严格对齐**：
   - 只能让用户看「当前视野里确实存在」的东西：路线整体（前提是地图已按 9.7 改为 fitBounds 框住整条路线）、
     路线详情面板里的站点列表、或 stop 深链聚焦后的高亮站；
   - 禁止工程语言（「折线段」「图层」），用「第一个红点」「往下走第二站」这类大白话；
   - 看不到的站（在视野外）不要让用户「请看」。
6. **人物卡只讲与主题相关的时段**：打开皇帝卡是为了定格人物，不按卡片生平从头念到尾
   （如讲靖难时口播停在 1402 年，迁都、下西洋等身后事留到结局幕按需引用，避免开场剧透冲淡主题）。
7. **对立双方都要出场**：战争类主题不能只挂胜利方人物卡，背景幕必须把另一方（如建文帝）也带到。
8. **绝不生成网页音频**：不调用任何 TTS 接口、不往页面注入 audio；声音由客户端语音朗读承担。

### 9.6.2 剧本一：事件 + 路线类（靖难之役 / 土木堡 / 郑和 / 黄巢……）

固定五幕（总纲并入第一幕），工具调用顺序：

| 幕 | 工具 / 动作 | 深链 | 讲述内容与数据边界 |
|---|---|---|---|
| ① 总纲 + 人物定格 | `search` 定位事件 → `get_emperor` 取**双方**人物（朱棣 + 建文帝） | 朱棣卡 `?page=timeline&dynasty=ming&emperor=ming-emperor-chengzu`、建文帝卡 `?page=timeline&dynasty=ming&emperor=ming-emperor-huidi` | 先用事件 summary/路线 desc 给一句话总纲（谁打谁、1399–1402 四年、终点南京）；再定格双方人物：朱棣（封燕王、守北平、姚广孝辅佐）、建文帝（年轻即位、要削叔叔兵权）；解释「藩王」是什么。口播只讲战前，不念永乐朝生平 |
| ② 背景起因 | 复用两份 `get_emperor` 的 timeline 与 `get_case`（如有悬案） | 悬案卡（可选） | 三句话讲清三个概念：藩王分封 → 建文帝削藩 → 朱棣以「清君侧」为名起兵。只使用档案中有的记载 |
| ③ 打开舞台·地理总览 | `get_route(module=emperors, route=jingnan-south)` 取有序站点；发**地图事件深链** | `?page=map&dynasty=ming&event=ming-event-jingnan` | 页面弹事件卡、动态画出整条路线；**依赖 9.7 的 fitBounds 改造**（视野必须框住北平→南京全程，不能只落在终点）。AI 做读图指引：绿色起点=北平、红色终点=南京、共 5 站、箭头即四年战争走向；最后给仪式感起点：「准备好了吗？我们从北平出发，回复『继续』」 |
| ④ 逐站讲解 | 逐站引用 `get_route` 返回的 points（仅 name/modern/lat/lng/note，**当前无 year**） | P1 上线前：无新链接，引导用户看「路线详情」面板第 N 站；P1 上线后：每站发 `route=<id>&stop=N` 自动居中高亮 | 每站一条，固定结构：**第 N 站｜古名（今地）→ 一句史实（严格取自该站 note，不补未收录情节）→ 看哪里 → 「继续」**。年份规则：数据有 year 才报，没有就只说先后顺序（见下方两种话术示例） |
| ⑤ 收束与影响 | `get_emperor` 的 majorEvents/controversies + `get_quiz` 一道选择题 | 可再发相关悬案/皇帝卡 | 地图正停在南京，呼应总纲：「四年战争的终点，就是永乐朝的起点」；再讲影响（建文帝失踪之谜、永乐政局）；用选择题或开放问题收尾，引导再探索（如「接下来可以走一遍郑和下西洋」） |

> 事件→路线的对应关系前端已有 `EVENT_ROUTE_MAP`（靖难→jingnan-south、土木堡→yexian-nanxia、
> 郑和起锚→zhenghe-west、山海关→清军入关 等 30 余条），MCP 侧也应在 `get_route` 单条路线返回里
> 反向带上 `event_id` 与事件深链，保证 AI 第 ③ 幕一定能拿到「会自动画路线」的那条链接，而不是发裸 route 深链。

**逐站话术示例（第 2 站·白沟河）——两个版本，区别只在于数据是否补齐**：

当前数据下（该站只有 note「最惨烈的决战之一」，无年份，严格照数据说）：

```
第 2 站｜白沟河（今河北保定一带）
这里是整条路线上最惨烈的决战之一。请看地图下方「路线详情」里的第 2 站。
回复「继续」，我们到济南城下。
```

9.7 的 P0 数据补齐后（站点补了 year 与史实句，且 stop 深链已上线，地图自动居中）：

```
第 2 站｜白沟河（今河北保定一带）
起兵第二年，朱棣在这里与朝廷大军决战，以少胜多，此战之后攻守易势。
地图已为你聚焦到第 2 站。回复「继续」，我们到济南城下。
```

> 注意：站点「今地」一律以数据中的 `modern` 字段为准（白沟河是「河北保定一带」，不是「雄安」）；
> 兵力数字、月份、战役细节等，除非补进了路线数据，否则一律不得出现在话术中。

### 9.6.3 剧本二：纯人物类（「明成祖朱棣是个怎样的皇帝」）

1. `get_emperor` → 发皇帝卡深链，讲生平主线；
2. 引导分叉：「他一生有两件事值得在地图上重走一遍：靖难南下、五征漠北/郑和下西洋，要走哪条？」
3. 用户选定后进入剧本一的 ③④⑤。

### 9.6.4 剧本三：典籍 / 诗词 / 神话 / 器物

- 典籍/诗人：`get_book` → 发 `guoxue/shici.html?tab=books&book=...` 深链，讲名篇精读与金句；
  诗路类追加 `get_route(module=shiwen)` 走「诗路舆图」深链（`guoxue/shici.html?tab=map&route=N`）。
- 神话舆图：`get_route(module=myth, route=0..4)` → 逐热点讲，深链 `guoxue/myth.html?tab=map&route=N&hotspot=<名>`，
  页面热点与口播一一对应；同样遵守「一个热点一条消息」。
- 器物/神兽：`get_artifact` → 发灯箱深链，先出缩略图（thumb）再讲解，提示「点链接可看原图」。
- 每类剧本结尾都给一个「下一步可问」的引导（关联人物/路线/选择题），形成连续学习路径。

### 9.6.5 新增 MCP prompt 模板（建议）

- 「带我走一遍：___」（参数：事件/路线名）→ 直接进入剧本一的 ③④⑤；
- 「新用户导览」→ 开场 + 推荐 5 个主题，代替干巴巴的「站点已就绪」。

## 9.7 前端 / MCP 改动清单（后续代码阶段，按优先级）

| 优先级 | 位置 | 改动 | 说明 |
|---|---|---|---|
| P0 | `web/tools/bootstrap.mjs`（新增）+ `package.json` 加 `setup` | 一键安装引导脚本 | 见 9.4.1 |
| P0 | 仓库根 `AGENTS.md`（新增） | LLM 安装行动手册 | 见 9.4.2 |
| P0 | `web/app.js` 的 `applyDeepLink()` | **恢复 `route` 参数的静态处理**：命中后切朝+切地图页+`showRouteDetail(r)`，不恢复 TTS/autoplay | 修复 get_route 单条路线深链断链；无任何音频逻辑 |
| P0 | `web/app.js` 的 `showSingleEvent()` | 事件关联路线时，先 `fitBounds` 框住整条路线（首尾都在视野）再播放绘制动画，而不是只飞到终点（靖难事件点在南京，直接 zoom 8 会把起点北平移出视野） | 无音频、无定时器，仅改变初始视角；这是③④幕「按走向讲解」的前提 |
| P0 | `data/routes/routes.json` 及各朝路线数据 | 给每个途经点补 `year`（如能考定）和一句史实（在现有 note 基础上，注明出处）；这是**史实内容建设**，不是 TTS 功能 | 逐站口播的时间/细节必须有数据来源；补完后再放开「报年份」的话术 |
| P0 | `history-mcp-server.mjs` | SERVER_INSTRUCTIONS 写入 9.6 讲解员剧本；`session_start` 增加 `suggested_questions/greeting`；PROMPTS 增加「带我走一遍」 | 纯文本增强，不动数据 |
| P1 | `history-mcp-server.mjs` `get_route` 帝王分支 | 单条路线返回补 `event_id` + 事件深链（可自动画路线的那条）；逐站给出 `stop` 序号 | 让 AI 第③幕拿到的链接与前端 `EVENT_ROUTE_MAP` 对齐 |
| P1 | `web/app.js` | （可选）`route=<id>&stop=N` 静态深链：地图居中并高亮第 N 站脉冲点 | **只做视觉跟随，不做 TTS、不做自动播放**；是旧导览器的无音频最小子集 |
| P2 | `history-mcp-server.mjs` | 新增 HTTP transport（Streamable HTTP/SSE） | 供扣子侧边栏接入；不影响 STDIO |
| P2 | 豆包桌面客户端 | 探索连接器配置文件直写或 computer-use 代填 | 目标是把 GUI 三步也自动化 |

### 明确不做（防止再次走偏）

- ❌ 网页内 TTS / Web Speech / autoplay / 静音开关（语音归客户端）；
- ❌ 自动逐站定时器（节奏由用户「继续」控制，或由 AI 连续播报驱动）；
- ❌ 让 AI 去搜索网页、维基百科补内容（讲解员只讲站内数据）；
- ❌ 让 AI 自由执行命令行启动服务（统一由 `session_start` / bootstrap 承担）。

## 9.8 验收清单（落地后逐项实测）

1. **干净机器**：只装 Node、拿到项目包 → 对 AI 说「帮我安装」→ 不翻硬盘、不手写配置，
   DSH 自动注册；豆包桌面客户端出现明确的 3 步指引且 JSON 路径正确；自检全过。
2. **新会话开场**：自动 `session_start`，服务未运行时被自动拉起；回复含首页链接 + 至少 3 个引导问题。
3. **靖难全链路**：说「介绍一下靖难之役」→ 先出现一句话总纲 → 朱棣与建文帝两张皇帝卡（口播只讲战前）→ 三句话背景 → 靖难地图事件（**视野框住北平→南京全程**、弹窗、路线动画、地理总览）→ 5 站逐站讲解（每条严格只含数据内事实、有地图指引、「继续」门控）→ 结局收束 + 一道选择题；全程无网页语音、无联网搜索、无数据外年月/数字。
4. **断链修复**：直接访问 `?page=map&dynasty=ming&route=jingnan-south` 会自动展开路线详情（不再是裸地图）；事件深链打开后整路线在视野内。
5. **可控性**：每站讲解后停住等「继续」；说「一次讲完」能连续走完。
6. **史实边界**：对未补 year 的站点，AI 只说顺序不报年月；任一站的今地、情节与 `routes.json` 一致。
7. **回归**：`mcp:selftest`、冷启动审计、其余四个板块深链全部不受影响。

## 9.9 风险与边界

- **豆包桌面客户端 GUI 注册**是当前唯一无法纯命令行消除的人工步骤，bootstrap 只能做到「配置一键生成 + 指引/代填」，
  需在话术中诚实说明，不能假装已装好。
- **STDIO 本地服务**要求用户机器上 Node 在线、本机端口可用；公网分享场景仍走 GitHub Pages（只读在线版，无 MCP）。
- 讲解员质量依赖模型对「五幕剧本」的遵从度；剧本放在握手 `instructions` + 工具结果提醒两层，
  必要时用 prompt 模板做硬触发（与当前开场 SOP 同一套机制）。
- 逐站视觉跟随（P1 的 `stop` 深链）是体验增强；但 **fitBounds 整路线框定（P0）是必须项**——
  否则事件深链落在终点、起点在视野外，「按走向逐步讲解」的第一站就无法与画面对齐。
- 逐站史实的详略受站点数据约束：当前每站仅一句 note，讲解只能简短；P0 数据补齐后才能讲出具体年月与战役细节，
  严禁在数据补齐前用模型自带知识「丰富」讲解（会破坏全站可追溯原则）。
