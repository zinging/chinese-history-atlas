# data/boundaries · 各朝疆域边界

前端地图（Leaflet）的边界数据目录。文件存在即自动使用边界数据渲染，不存在则回退手绘示意色块。

## 当前状态

明、清、唐、元各有一份手绘简化 GeoJSON，宋无（回退 `FALLBACK_SHAPES` 示意）。

| 文件 | 要素数 | 覆盖 |
|---|---|---|
| `ming.geojson` | 16 | 两京十三布政使司 + 辽东都司 |
| `qing.geojson` | 10 | 盛京·吉林·黑龙江、内外蒙古、直隶·山西·山东·河南、陕甘新疆、西藏、四川湖广、江浙闽、两广云贵、台湾 |
| `tang.geojson` | 12 | 十道 + 西域都护府、北方都护府 |
| `yuan.geojson` | 12 | 岭北、辽阳、中书省腹里、陕西、甘肃、四川、河南江北、湖广、江浙、江西、云南等行省 |

全部为**手绘简化多边形**，不是精确行政边界。每个文件的 `meta` 字段写明来源、许可与简化说明。目的是让读者看清大致格局（两京十三司、十道、行省制），不是还原真实边界线。

## 渲染机制

`web/app.js` 的 `loadBoundaries()` 按当前朝代 key 请求 `data/boundaries/<key>.geojson`，结果缓存在 `MAP_GEO`，切回该朝不重发请求。

- 文件存在：`L.geoJSON()` 叠加，`properties.name` 对应 `REGION_NOTES` 里的白话解释（点色块弹出"这是什么地方"）。
- 文件不存在：回退 `FALLBACK_SHAPES` 手绘示意色块。

双路径已有测试覆盖：`node web/smoke.mjs`（无 geojson 回退）、`node web/smoke-geo.mjs`（有 geojson 生效 + 图层真实增减）、`node web/smoke-dynasties.mjs`（各朝数据层）。

## 为什么不用真实历史边界

本轮实测（2026-10-01）过真实数据源，结论是不接入：

- 哈佛 CHGIS 官网域名解析失败；重定向目标 `gis.harvard.edu/china-historical-gis/` 返回 403（Akamai 拒绝无浏览器会话访问）。Zenodo 域名解析失败。
- 开源替代 `aourednik/historical-basemaps`（含 world_1400/1500/1600.geojson）**许可有争议**：源仓库 LICENSE 为 GPL-3.0，而派生项目 `void-space912/orbis-chronos` 的 THIRD-PARTY.md 声称边界数据为 CC BY-SA 4.0，两处声明矛盾。GPL 传染性与教育产品分发存在冲突风险，不采用。
- GitHub 其他明代数据：`orbis-chronos` 的 era 快照是全球政体色块（115 个势力、覆盖全世界），非明代行省边界；`cga-harvard/chgis.github.io` 仅为官网重定向壳，无数据文件。

**不编造数据**：为避免来源不明、版权存疑、精度失真的边界，宁可保留手绘示意 + "非精确边界"标注。这符合面向大众教育场景的示意策略。

## 接入真实数据的方式

1. 获取 CHGIS 明代行省数据（哈佛 CHGIS v6/v7，或复旦大学历史地理研究中心合作版）。
2. 处理为单一 GeoJSON：`FeatureCollection`，每要素 `Polygon`/`MultiPolygon`（WGS84 经纬度），`properties.name` 填省名。
3. 存放为 `data/boundaries/<朝代key>.geojson`，可选 `meta` 字段：

```json
{
  "meta": {
    "source": "哈佛 CHGIS v7 · 明代行省",
    "license": "CHGIS 学术许可，仅限非商业教育用途",
    "note": "为教育展示已简化，非精确行政边界"
  },
  "type": "FeatureCollection",
  "features": [ ... ]
}
```

前端自动启用，无需改代码。同时需要在 `web/app.js` 的 `REGION_NOTES` 里补上新的省名，否则点色块没有白话解释。

## 数据源与许可

| 数据源 | 状态 | 许可边界 |
|---|---|---|
| 哈佛 CHGIS | 待接入（官网 403/域名不通） | 学术/教育非商业用途；接入前需确认导出格式与许可条款 |
| 谭其骧《中国历史地图集》 | 仅作参考，不直接取图 | 版权归社科院，教育使用需注意授权边界 |
| 明尼苏达 Ming Gazetteer Images | 趣味图库（未接入） | 开放获取 |
| 芝加哥 Scrolling Painting Project | 画卷素材（未接入） | 开放浏览 |
| 郑和航海图数字化 | 航线校核（未接入） | 学术项目 |
| aourednik/historical-basemaps | 已评估，不采用 | 源仓库 GPL-3.0，与派生项目声称的 CC BY-SA 4.0 矛盾 |

当前四份手绘 GeoJSON 的 `meta.source` 标注为「据谭其骧《中国历史地图集》轮郭手绘简化」——即以该图为**参考**重新绘制，不复制原图。许可边界同上表第二行。

## 校验

`tools/validate-data.mjs` 当前不校验 GeoJSON。用 `node web/smoke-dynasties.mjs` 验证各朝边界是否按预期被读取（geojson / 回退两条路径）。