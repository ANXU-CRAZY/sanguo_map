# 三国演义历史时空分析系统

这是一个本地运行、原文可追溯的 GeoAI / Spatial Humanities 原型。文本输入限定为 `F:\history_sites\三国演义全文\三国演义_Markdown\章节` 中原 EPUB 拆分出的 **119 个章节文件**。系统不补写第 120 回，不调用付费模型，也不把叙事候选解释为已确认史实。

## 运行

本机直接复用冻结的 His-Geo Python 环境（Python 3.11，已含 NumPy、Shapely、PyProj、GeoPandas）：

```powershell
Set-Location F:\history_sites\sanguo_map
$py = 'F:\history_sites\hisgeo_reproduction\.venv-final\Scripts\python.exe'
& $py scripts\build_project.py
& $py scripts\validate_project.py
& $py -m pytest -q
& $py scripts\serve.py --host 127.0.0.1 --port 8765
```

浏览器打开 <http://127.0.0.1:8765/>。`build_project.py` 全程离线，会核验原文与 His-Geo 版本、生成结构化文本、确定性抽取、单独的 His-Geo 评价记录、SQLite、GeoJSON / GeoPackage 和分析汇总。它不会调用 LLM、外部地图瓦片或任何 API。

如 His-Geo 仓库路径改变，编辑 `configs/project.json` 的本地路径；代码会拒绝使用非预期的 His-Geo commit 或有改动的工作树。原文、His-Geo 及参考项目均不由本项目脚本写入。

## 数据解释

- `chapter_id` 保留源文件序号 001–119；`original_title` 保留 EPUB 原章名。第 65 个文件的原始标题重新从“第一章”编号，未与通行 120 回本自动映射。
- 段落、人物名、地名、时间词和事件均可回查源文件散列、章节与段落位置。自动抽取是可复现的表面词典/触发词流程，不是模型输出或人工校对结果。
- 地名只对当前扫描到的 CHGIS 名称/别名做精确词面匹配。His-Geo 仅评估频次最高的配置数量；`NOT_RUN_LIMIT` 与 `NO_MATCH` 分开。
- 只有唯一成功坐标进入空间层。Gazetteer 坐标仍需地名含义核验。CHGIS 历史坐标的源 datum 未确认，上游声明为 `ASSUMED_EPSG4326`。
- 人物行踪页按单个人物独立显示其同段地点候选：地图标注古地名、按小说章节顺序连线，点位可跳回原文；单地点人物仍显示证据点。共现轨迹不是实际行军路线，地名与位置仍需人工核验。核密度与缓冲统计针对小说候选记录。
- 人物行踪支持单人播放与最多 4 人同章动态对比：播放/暂停、进度拖动、0.5–4× 倍速、从头开始和视野跟随；亮环表示最近一条原文地点证据。地图上的古地名标签与地点圆点均可单击，打开包含文本统计、主流程/历史筛查坐标、MED 与原文片段的地点档案。
- “地图问答”提供本地检索与聚合分析，支持地名数据、人物地点集合、多人物共同地名、事件候选和叙事分布线索；回答附原文链接，并可联动动态轨迹。当前是规则驱动的离线助手，未接入大模型，不发送文本、不产生 API 费用，不虚构历史百科或因果。使用说明及边界见 [docs/TRACK_PLAYBACK_AND_ASSISTANT.md](docs/TRACK_PLAYBACK_AND_ASSISTANT.md)。
- 地图使用你本机提供的 2024 省/市/县三级行政界（随缩放切换），周边国家与水系使用 Natural Earth 离线矢量。现代行政界只作方位参照，不代表三国时期疆域。地图地点标注显示原文古地名词面；点位身份和坐标仍是待核候选。章节滑块、上一/下一章、逐章播放、事件/人物筛选、古地名标签开关与原文证据面板会联动更新。来源、范围、坐标系及哈希见 `docs/BASEMAP.md`。

## 重要产物

- `data/processed/chapters.json`、`paragraphs.jsonl`、`text_index.json`
- `data/extracted/`：人物称谓、地名、时间与事件段落候选、His-Geo trace
- `database/sanguo_spacetime.sqlite`
- `outputs/geojson/`、`data/spatial/sanguo_analysis.gpkg`
- `outputs/logs/build_manifest.json`、`validation.json`
- `docs/`：语料、算法、模式差异、数据质量及空间分析报告

项目使用的 Leaflet 代码随本项目在 `frontend/assets/vendor/` 本地提供，Leaflet BSD-2-Clause 许可和来源见 `frontend/assets/vendor/ASSET_ORIGIN.md` 与 `leaflet-LICENSE.txt`。所有底图数据也是本地文件；页面不请求在线瓦片。

## 致谢与学术来源

新版前端参考 [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) 的沉浸式地图与控制面板设计，独立实现全幅二维地图、两侧悬浮面板、底部章节控制舱、墨色/宣纸主题、人物/地名/章节快速检索及手机底部面板。按 `/` 或 `Ctrl+K` 检索，按 `F` 专注地图、`Esc` 退出。所有地图与检索仍使用现有本地数据；设计来源与实现边界见 [docs/FRONTEND_REFERENCE.md](docs/FRONTEND_REFERENCE.md)。

感谢 [wonton1984/sanguo-map](https://github.com/wonton1984/sanguo-map) 开源其《三国演义》交互地图。本项目借鉴其地图、时间轴、原文阅读与人物轨迹的交互组织方式；本项目的 119 章解析、候选记录、空间处理和界面代码独立实现。随用的 Leaflet 文件按其自身 BSD-2-Clause 许可另行保留来源和许可声明；参考项目中的人物、事件、图片、轨迹、坐标和行政区数据没有作为本项目数据导入。

本项目的历史地理编码研究方法参考 His-Geo 及其论文。感谢 Yuqi Chen、Wenyi Shang、Hongsu Wang、Sophia Zhang 与 Peter K. Bol 提供研究框架与公开实现：Chen, Y., Shang, W., Wang, H., Zhang, S., & Bol, P. K. (2026). “Geocoding the past world: unearthing coordinates of early China from texts using generative AI.” *International Journal of Geographical Information Science*, 40(3), 781–807. [https://doi.org/10.1080/13658816.2025.2491711](https://doi.org/10.1080/13658816.2025.2491711)。相关代码见 [yukiyuqichen/His-Geo](https://github.com/yukiyuqichen/His-Geo)。本项目将该方法用于《三国演义》文本的独立实验，不代表论文作者或参考项目作者认可本项目结论。

其他数据和软件许可按各自来源分别适用，见 `docs/BASEMAP.md` 与 `frontend/assets/vendor/ASSET_ORIGIN.md`。本仓库未将一个统一开源许可扩展到小说文本、行政区数据或第三方数据。
