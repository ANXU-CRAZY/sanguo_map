# GIS 空间分析报告

## 离线背景底图

Natural Earth 本地矢量仅提供周边国家轮廓、河流和湖泊：countries, rivers, lakes。中国省/市/县界来自用户本地 2024 行政区数据，审图号 `GS（2024）0650号`，源坐标 `EPSG:4490`；地图随缩放在 42 省级、388 市级、2898 县级要素间切换。2024 现代界仅用于方位参照，不是三国疆域。原始/显示层哈希和几何修复记录见 `data/basemap/china_admin_2024/manifest.json`；许可与处理记录见 `docs/BASEMAP.md`。网页只请求本地 GeoJSON，不调用在线瓦片。

## 输入与覆盖

- 历史地名志独立筛查的唯一候选：39 个表面词形；现代地名志点不进入空间统计。
- 地名提及点：228 条；段落事件—地点共现点：149 条，其中战争触发候选 95 条。
- 人物—地名同段共现轨迹：18 条。
- 输出 GeoJSON：place_mentions_resolved.geojson, event_candidates_resolved.geojson, character_narrative_tracks.geojson, battlefield_buffers.geojson, war_candidate_kde.geojson；GeoPackage：`WRITTEN`，图层 `place_mentions_resolved, event_candidates_resolved, character_narrative_tracks, battlefield_buffers, war_candidate_kde`。

## 核密度

状态：`COMPUTED_UNVERIFIED_HISTORIC_GAZETTEER_CANDIDATES`。核函数 isotropic Gaussian, truncated at 3 bandwidths; event points equally weighted；带宽 120.0 km，像元 40.0 km；输入 95 条战争候选共现点（28 个不同坐标），输出 2408 个 GeoJSON 网格。仅纳入历史地名志筛查的唯一位置候选（`HISTORIC_PERIOD_UNKNOWN` 仍未核实），现代地名志结果排除。距离使用 `+proj=aea +lat_1=25 +lat_2=47 +lat_0=35 +lon_0=105 +datum=WGS84 +units=m +no_defs` 等面积 Albers 平面欧氏近似，等权、截断于 3 带宽。只用于文学叙事候选密度探索，不代表历史战争频率。

## 战场缓冲与轨迹

本项目的地名志年代筛查窗口为公元 184–280 年；39 个候选与窗口重叠、99 个候选在窗口之外。“窗口重叠”仅用于候选过滤，不等于段落事件日期，也不证明历史身份。赤壁、官渡、夷陵在本次历史地名志-only 筛查中均未得到唯一坐标，因此缓冲图层按规则回退到战争触发段落中共现频次最高的三个唯一历史地名志候选，明确作为替代候选：`{"阴平": {"status": "COMPUTED", "buffer_count": 3, "source_med_km": 0.0}, "白帝": {"status": "COMPUTED", "buffer_count": 3, "source_med_km": 0.0}, "安众": {"status": "COMPUTED", "buffer_count": 3, "source_med_km": 0.0}}`。它们不是对三处真实战场的定位。半径 10/30/50 km 在各候选地点局部 AEQD 米制投影中构造；范围内候选统计用 WGS84 椭球 `Geod.inv` 测地距离。半径是研究参数，不是史料证实的影响圈。地点 MED 保留为位置不确定性线索，不据此自动扩张统计半径。

人物轨迹按章节、段落顺序连接唯一坐标的同段共现地点。连接线明确是直线示意，不是古代道路或实际行军路线。系统没有输入历史道路网或三国时期行政边界。

## CRS 和限制

缓存输出经纬度按 EPSG:4326 读取；现代底图源未提供 CRS 元素，上游按经纬度解释；历史 CHGIS XY 的 datum 来源未注明，上游标记 `WGS84 lon/lat as supplied by the His-Geo adapter; historic CHGIS datum is upstream-marked ASSUMED_EPSG4326.`。所有空间对象继承此限制。GeoJSON 字段保留 coordinate source、原文章节/段落、源 SHA、MED、算法模式与人工复核状态。统计建立在未人工核验的小说词面匹配与事件候选之上。
