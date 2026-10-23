# 模块化架构

主站的五个板块由清单驱动，不是写死在 HTML 里。加模块只改一处清单，加资源；停用改一个开关。

## 清单文件

`web/modules.json` 是唯一的事实来源：

```json
{
  "modules": [
    {
      "id": "history",              // 唯一 id，对应面板 #mega-<id>
      "name": "帝王谱系",            // 侧栏主标题
      "sub": "历代皇帝",             // 侧栏副标题
      "kind": "inline",            // inline = 正文写在 index.html；iframe = 独立页面
      "entry": null,               // iframe 必填：入口 HTML（相对 web/）
      "enabled": true,             // false = 停用（侧栏不显示、不加载资源）
      "icon": "crown"              // 图标名，见 app.js 的 MODULE_ICONS
    }
  ]
}
```

当前五模块：`history`（inline）、`guoxue` / `shici` / `gewu` / `myth`（iframe）。

## 新增一个模块

1. **放资源**。独立页面就放 `web/<目录>/index.html`，数据放 `data/<目录>/`（子页面里用 `../../data/` 取数据，不要写 `/data/`——GitHub Pages 部署在子目录下，绝对路径会 404）。
2. **加一条清单**。在 `modules.json` 的 `modules` 数组里追加：

   ```json
   {
     "id": "mydomain",
     "name": "我的板块",
     "sub": "副标题",
     "kind": "iframe",
     "entry": "mydomain/index.html",
     "enabled": true,
     "icon": "scroll"
   }
   ```

3. **加图标**（可选）。在 `web/app.js` 的 `MODULE_ICONS` 里加一条 SVG，键名与清单的 `icon` 对应；不写则回落到卷轴图标。
4. **验证**：`node --check web/app.js`，起服务确认侧栏出现新按钮、点进去内容正常。

正文需要直接写在主站 HTML 里时（`kind: "inline"`），在 `index.html` 里加 `<div class="mega-area hidden" id="mega-<id>">…</div>`，清单对应写 `"kind": "inline"`。

### 复用 guoxue 子站骨架

新板块若要复用典籍 + 公案 + 图鉴 + 地图 + 问典这套结构，不需要新写前端：

1. 在 `web/guoxue/app.js` 的 `SECT_META` 里加一条（`name`、`intro`、`data`）。
2. 复制一个现有子站 HTML（如 `gewu.html`），改 `<title>`、`<body data-sect>`、四个 tab 文案、面板 id。
3. 数据放 `data/<新目录>/`，`index.json` 按「清单 + 分区指针」形态写（见 `tools/split-gewu.mjs` 的产物结构）。
4. 清单里加一条 `kind: "iframe"` 指向新的 HTML。

这套复用的前提是 `ensureSection()` / `ensureBookDetail()` 能同时处理内联数组和 `{src}` 指针，两者都兼容。

## 停用与恢复

- **改清单**：`enabled: false`。这是仓库级的默认开关，适合决定不提供某个模块。
- **用户侧停用**：侧栏底部「模块管理」里勾掉。选择记进 `localStorage`（键 `dsh-disabled-modules`），**优先于清单的 `enabled`**，刷新、关掉浏览器都还在。
- **恢复**：模块面板里的「恢复全部模块」按钮清空该记录并刷新；或手动删掉 `localStorage` 里那一项。

停用的模块：侧栏不显示、面板不创建、`entry` 一个字节都不会下载。这是纯静态站点的关键收益——用户只装 3 个模块，不会为另外 7 个模块的资源买单。

## 运行机制（`web/app.js` 末尾）

| 函数 | 职责 |
|---|---|
| `initModules()` | 读清单 → 合并用户停用 → 渲染侧栏 → 恢复上次停留的模块 |
| `renderModuleList(modules)` | 按清单生成按钮；补建缺失的 iframe 面板；移除已停用模块的面板 |
| `activateModule(id)` | 切换面板显隐；iframe 模块首次进入时才设 `src`，之后复用实例 |
| `renderModuleManager()` | 模块管理面板里的勾选列表 |

清单读取失败时回退到 `app.js` 内置的五模块清单，站点仍可用。

## 约束

- 必须是**静态托管**（GitHub Pages 等）。`file://` 打开会被 CORS 挡住，`fetch` 读不到 `modules.json`（会走内置清单兜底，但数据页读不到）。
- 新增模块的资源必须**随仓库一起部署**，这是静态站点的性质决定的。
- 目前不做运行时动态注册（模块自己调 API 注册）。纯静态下没有后端，那样等于自建一套注册中心，与本项目定位不符。