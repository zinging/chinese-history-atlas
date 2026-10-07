# data/boundaries · 各朝疆域边界

前端地图（Leaflet）的精确边界数据位。文件存在即自动使用真实边界渲染，不存在则回退手绘示意色块。当前各朝状态：明/唐/元/清各有一份手绘简化 `*.geojson`，宋无（回退示意）。

## 当前状态：渲染层就绪，数据为手绘简化

**已完成的**：
- `web/app.js` 的 `buildMapData()` 读取标准 GeoJSON（`FeatureCollection`，要素 `Polygon`/`MultiPolygon` + `properties.name`），经 Leaflet `L.geoJSON()` 叠加在 OSM 瓦片底图上；文件不存在则回退 `FALLBACK_SHAPES` 手绘示意色块。
- 双路径已验证：无 geojson 时回退手绘示意（`node web/smoke.mjs`）；有 geojson 时真实边界生效（`node web/smoke-geo.mjs`）；五朝数据层各自正确（`node web/smoke-dynasties.mjs`）。

**未能完成的**：获取真实明代省界 GeoJSON。本轮实测（2026-10-01）：
- 哈佛 CHGIS 官网 `chgis.fairbank.fas.harvard.edu` 域名解析失败；官方重定向目标 `gis.harvard.edu/china-historical-gis/` 返回 403（Akamai 拒绝无浏览器会话访问）。Zenodo 亦域名解析失败。
- web_search 工具 key 失效（HTTP 401，需你在 设置 → Web search 换 key/端点）。
- 开源替代 `aourednik/historical-basemaps`（含 world_1400/1500/1600.geojson，全球政体边界）**许可有争议**：源仓库 LICENSE 为 GPL-3.0，而派生项目 `void-space912/orbis-chronos` 的 THIRD-PARTY.md 声称边界数据为 CC BY-SA 4.0——两处声明矛盾。GPL 传染性与教育产品分发存在冲突风险，**不采用**。
- GitHub 其他明代数据：`orbis-chronos` 的 era 快照是全球政体色块（115 个势力、覆盖全世界），非明代行省边界；`cga-harvard/chgis.github.io` 仅为官网重定向壳，无数据文件。

**不编造数据**：为避免来源不明/版权存疑/精度失真的边界，`ming.geojson` 暂不提供。地图保持示意色块 + "非精确边界"标注（符合你定的儿童示意策略）。

## 接入方式（网络恢复后）

1. 获取 CHGIS 明代行省数据（哈佛 CHGIS v6/v7，或复旦大学历史地理研究中心合作版）。
2. 处理为单一 GeoJSON：`FeatureCollection`，每要素 `Polygon`/`MultiPolygon`（WGS84 经纬度），`properties.name` 填省名（如 山东、南直隶）。
3. 存放为 `data/boundaries/<朝代key>.geojson`（如 `ming.geojson`），可选 `meta` 字段：

```json
{
  "meta": {
    "source": "哈佛 CHGIS v7 · 明代行省",
    "license": "CHGIS 学术许可，仅限非商业教育用途",
    "note": "为儿童示意已简化，非精确行政边界"
  },
  "type": "FeatureCollection",
  "features": [ ... ]
}
```

前端自动启用，无需改代码。

## 数据源与许可（用户已定的策略）

| 数据源 | 状态 | 许可边界 |
|---|---|---|
| 哈佛 CHGIS | 待接入（官网 403/域名不通） | 学术/教育非商业用途；接入前需确认导出格式与许可条款 |
| 谭其骧《中国历史地图集》 | 仅作参考，不直接取图 | 版权归社科院，教育使用需注意授权边界 |
| 明尼苏达 Ming Gazetteer Images | 趣味图库（未接入） | 开放获取 |
| 芝加哥 Scrolling Painting Project | 画卷素材（未接入） | 开放浏览 |
| 郑和航海图数字化 | 航线校核（未接入） | 学术项目 |
| aourednik/historical-basemaps | 已评估，不采用 | 源仓库 GPL-3.0，与派生项目声称的 CC BY-SA 4.0 矛盾 |

## 校验

`node scripts/validate.mjs` 当前不含 GeoJSON 校验。可用 `node web/smoke-dynasties.mjs` 验证各朝边界是否按预期被读取（geojson/回退）。
