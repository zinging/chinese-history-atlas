# MCP 客户端接入说明（本地 STDIO）

本站内置一个零依赖的本地 MCP Server：`web/tools/history-mcp-server.mjs`（当前 v1.2.0，15 个只读工具）。
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
