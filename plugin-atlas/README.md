# 中华历史图谱 · AI 讲解员（DSH 插件 / MCP 连接器）

把「[中华历史图谱](https://github.com/zinging/chinese-history-atlas)」——隋至清 77 位皇帝、五宗思想、22 位诗人、17 部科技典籍、9 部神话典籍——做成 AI 可检索的站内知识库。**只读、不联网**，回答带深链与配图。

```bash
npm i @chenye123/chinese-history-atlas
# 或作为 DSH 插件：在插件市场搜「中华历史图谱」，装好后新开会话即可提问
```

## 它做什么

- **15 个只读工具**（`mcp__atlas__*`）：检索 emperors / thought / shiwen / gewu / myth 五大板块，读皇帝生平、案件八段、典籍章节、路线站点、舆图事件、问典题目；
- **回答带深链**：讲到靖难之役就给 `#map&event=…` 链接，打开就是那张卡片，还能按句讲解（`#s=0`）；
- **带配图**：单对象结果附一张工笔图的 image 内容块（皇帝画像、器物、神兽、舆图事件）——图片来自 clone 下来的站点，站点就绪前只有文字与链接；
- **自带数据副本**：文本检索不依赖站点；首次提问时自动 `git clone` 完整站点到 `~/chinese-history-atlas` 并拉起本地网页服务（约 150MB，一次性）。

## 安装后自检

新开会话能看到 15 个 `mcp__atlas__*` 工具，且启动日志没有 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

- **实测环境**：DSH Desktop Beta 2.0.22-beta.1 · 内核 0.2.2-rc.x，`engines.dsh` 为 `>=0.2.0-rc.2 <0.2.2-beta.1`；
- 该字段**不会被安装流程校验**：超窗不一定报错，更常见的是**静默不生效**（插件在、工具不在）；
- 若插件层不生效，直接用通用 MCP 接入（与插件功能完全一致）：clone 仓库后 `npm run mcp:install`。

## 需要

- **Node.js 18+**（自带 `fetch`，无需 `npm install`）；
- **git 在 PATH 中**（自动拉站点用 `git clone`）；
- 站点可离线运行，图片全部本地读取。

## 许可

MIT。站点数据与代码同源：[github.com/zinging/chinese-history-atlas](https://github.com/zinging/chinese-history-atlas)。
