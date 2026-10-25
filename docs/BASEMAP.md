# 离线地图底图与古地名标注

网页不调用在线瓦片。中国省、市、县行政界来自用户本机数据目录 `D:\202405更新_2024年省市县三级行政区划数据（审图号：GS（2024）0650号）`，原始三个 GeoJSON 已逐字节复制到 `data/basemap/china_admin_2024/source/`，可独立核对 SHA-256。网页按缩放级别显示省界（小于 5 级）、市界（5–6 级）或县界（7 级及以上），不会把 Natural Earth 的简化省界当作中国行政界。周边国家轮廓、河流与湖泊仍使用本地 Natural Earth 矢量数据。

2024 行政区数据包含 42 个省级、388 个市级和 2,898 个县级要素，源坐标系标注为 CGCS2000 / EPSG:4490。浏览器使用经纬度显示，坐标值没有被重投影或伪称为 EPSG:4326。网页简化层以保拓扑方式生成，容差及输入/输出哈希见 `data/basemap/china_admin_2024/manifest.json`；原始输入保持不变。源数据各有一处无效环：黑龙江省、铁门关市（市与县层各一次）；仅展示副本用 `shapely.make_valid` 修复，修复记录在 manifest 中。

这些是 2024 年现代行政界，只用于地理方位参照，绝不代表三国时期疆域或州郡县界。地图上的地点标签取自原文地名词面（如“赤壁”“洛阳”），不是现代行政区名称；视野较小时只显示高频古地名，放大或平移后显示该视野中的更多标签。点位坐标仍是 Gazetteer 候选，古地名与坐标之间的历史身份尚未核验；点击点位可以查看其来源时期与候选状态。

## 来源与许可

- 中国边界：用户提供的 2024 省市县三级数据，审图号 `GS（2024）0650号`。该数据按原样保留来源与哈希；其提供者和许可边界独立于本项目代码。发布或镜像仓库前应核实数据来源的再分发条款。
- 周边国界、水系：Natural Earth 1:10m，项目内源包、许可链接、版本和校验值见 `data/basemap/natural_earth/manifest.json`。Natural Earth 将其数据声明为 public domain，许可说明见 <https://www.naturalearthdata.com/about/terms-of-use/>。
- 网页资源：`frontend/data/basemap/`。浏览器验收会检查六个本地图层请求，无远程底图请求。

## 重建与检查

```powershell
python scripts\build_china_admin_2024.py
python scripts\browser_acceptance.mjs
python -m pytest
python scripts\validate_project.py
```
