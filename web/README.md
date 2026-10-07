# 儿童交互层（Phase 2，web/）

面向小学生的明朝历史学习前端，消费知识层 `data/` 数据。纯原生 HTML/CSS/JS，零构建依赖（地图底图使用本地化的 Leaflet + 在线 OpenStreetMap 瓦片）。

## 运行

```bash
node web/serve.mjs          # 默认 5173
# 浏览器打开 http://127.0.0.1:5173/web/
```

必须通过本地服务器打开（`fetch` 读取 `../data`，直接双击 HTML 会被浏览器 CORS 拦截）。

## 四个界面

| 界面 | 说明 |
|---|---|
| 时间线首页 | 1368-1644 十六帝卡片横向滑动，点击展开详情 |
| 皇帝详情页 | 画像位（Q 版 emoji）＋生平时间线＋趣味冷知识/争议话题/动手做三入口 |
| 地图探索页 | Leaflet 底图（可缩放/平移）＋疆域边界（geojson 优先，回退手绘色块）＋城市点古今对照弹窗＋动画路线＋事件点 |
| 历史侦探页 | 每周任务＋线索由知识库动态检索生成（带出处）＋孩子自主追问框＋创作保存 |

## 历史侦探：线索动态检索

线索不再硬编码。每个任务配置检索词（`queries`）与一个开放问题（`open`），由 `search-core.js` 在知识库实时检索生成，每条带出处。孩子还能在"追问框"里自己输入问题，实时查知识库（与 DSH 插件 `ming_search` 同规则）。检索模块单测：`node web/search-core.test.mjs`。

## 地图策略（Leaflet 重绘，2026-10-05）

- **底图：Leaflet + OpenStreetMap 瓦片**。`vendor/leaflet.js`（1.9.4，本地化，无 CDN 依赖）渲染真实海岸线/河流/城市名，支持滚轮缩放、拖动平移；历史图层叠加其上。需联网加载瓦片，离线时显示"地图组件未加载"提示（页面其余功能不受影响）。
- **疆域边界**：`data/boundaries/<key>.geojson`（明/唐/元/清有，宋无）经 `L.geoJSON()` 渲染；文件不存在则该朝回退 `FALLBACK_SHAPES` 手绘示意色块。数据来源与许可见 [data/boundaries/README.md](../data/boundaries/README.md)。
- **城市点古今对照**：应天（今南京）等 22 个点，点击弹窗显示故事。
- **动画路线**：靖难之役南下、迁都北京等 9 条画在主图，郑和航线（国内段＋远洋段）单独按钮，点击动态绘制并展示途经点详情。
- **事件点**：选中具体年号时显示该朝事件标记，点击弹事件详情。
- 说明：历史疆域叠加现代底图必然有偏差，儿童示意策略不变。

## 文件

- `index.html` 四页骨架
- `style.css` 儿童向样式（大字体/圆角/暖色）
- `app.js` 数据加载 + 渲染 + 交互（含 `window.__mingTest` 测试钩子；`buildMapData()` 为纯数据层，可脱离 Leaflet 测试）
- `search-core.js` 检索核心（与插件 `ming_search` 同规则，历史侦探/追问框用）
- `vendor/leaflet.js` + `vendor/leaflet.css` Leaflet 1.9.4（本地化）
- `serve.mjs` 本地静态服务器
- `smoke.mjs` 冒烟测试（mock DOM：四页渲染 + buildMapData 数据层）
- `smoke-geo.mjs` 冒烟测试（GeoJSON 存在/缺失两条路径 + renderMap 全链路 L 桩）
- `smoke-dynasties.mjs` 冒烟测试（五朝地图数据层各自正确）
- `search-core.test.mjs` 检索核心单元测试

## 测试

```bash
node --check web/app.js
node web/search-core.test.mjs   # 检索规则单测（与插件一致）
node web/smoke.mjs              # 四页渲染 + 地图数据层（明）
node web/smoke-geo.mjs          # 真实边界/回退两条路径 + renderMap 全链路
node web/smoke-dynasties.mjs    # 五朝地图数据层
node web/serve.mjs              # 起服务后浏览器人工验收
```
