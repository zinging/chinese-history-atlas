# 教学编排层（Phase 1，DSH 插件）

包名 `@ming/journey`，安装到当前 profile（desktop），row id `ming-journey`。

## 六个 Agent（模型可调用工具形态）

| 工具 | Agent | 说明 |
|---|---|---|
| `ming_explain` | 分龄讲解 | 按孩子年龄讲一个皇帝/事件，输出分段讲解稿 + 开放问题 + 视觉数据 + 出处 |
| `ming_search` | RAG 检索 | 在知识库检索孩子的问题，返回带出处的史料片段 |
| `ming_quiz` | 测验生成 | 生成无标准答案的讨论题 / 决策场景 |
| `ming_visualize` | 可视化 | 输出时间线 / 地图热区 / 人物卡片 JSON，供前端渲染 |
| `ming_roleplay` | 角色扮演 | 角色扮演剧本 + 分支选择（孩子当导演） |
| `ming_report` | 家长报告 | 汇总孩子的提问与选择，生成给家长的成长报告 |

所有工具走 `../data` 知识层数据（不硬编码史实），零 LLM 依赖。配置 `llmProvider`/`llmModel` 后，分龄讲解会叠加 LLM 草稿。

## 开发

```bash
# 语法 + 自测（mock ctx，跑通六个工具）
node --check index.js
node selftest.mjs
```

自测用 mock 上下文验证工具注册与执行，不依赖 DSH 运行时。

## 数据目录

`cordis.patch.yml` 的 `config.dataDir` 指定内容层路径（默认插件上级 `../data`）。插件激活时把 `data/` 读入内存只读缓存。

## 安装

```bash
plugin_manager install_bundle <插件目录绝对路径>
```

重要：修改 `index.js` 后，同包名重装不会刷新运行中的模块代（DSH 的 Host ESM 缓存按模块 URL 记录）。要让改动生效，要么重启 DSH，要么以**全新包名**重新安装。
