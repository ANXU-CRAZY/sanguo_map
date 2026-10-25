# 三国演义历史时空分析系统：交付报告

## 交付状态

**本地离线 WebGIS 原型已构建；科学数据解释状态为探索性 / 需人工复核。** 本地启动地址 `http://127.0.0.1:8765/`，完整命令见 `README.md`。

- 原文：119 章、4773 段；整合版正文逐章比对 119/119 通过。
- 人物种子：20；人物词面提及：9843。
- 地名：762 个词形、5538 次提及；主 His-Geo 路径运行 500 个词形，唯一匹配 326（现代库 215、历史库 111）、多候选 169、未匹配 0，另有 262 个超限未运行。历史空间分析只取独立历史库筛查的点；年代范围未知仍标为候选。
- 事件/时间：1836 个段落候选，511 个时间表达。年字段不充分时保持空值。
- 底图：中国行政界改用本地 2024 省/市/县三级数据，随缩放切换；古地点标签显示原文地名词面，现代行政名只在对照字段出现。现代界仅作方位参照，不是三国疆域。周边国家及水系为 Natural Earth 本地矢量；离线无瓦片请求。
- GIS：核密度 `COMPUTED_UNVERIFIED_HISTORIC_GAZETTEER_CANDIDATES`，输入战争候选点 95；战场局部米制缓冲 {"阴平": {"status": "COMPUTED", "buffer_count": 3, "source_med_km": 0.0}, "白帝": {"status": "COMPUTED", "buffer_count": 3, "source_med_km": 0.0}, "安众": {"status": "COMPUTED", "buffer_count": 3, "source_med_km": 0.0}}；人物叙事共现轨迹 18 条；GeoJSON 5 层，GeoPackage `WRITTEN`。
- His-Geo：`paper_faithful`，复现仓库 `bb99915ff4323669fe3535fad17de67e95f2870b`；官方只读子仓库 `714b4308b33bdf958d8c6efcdac031e18a2f85d5`；付费 API 调用 0。

## 界面与验证

WebGIS 含逐章播放/上一章/下一章、按章节和人物筛事件、显示古地名标签、缩放切换 2024 行政区级别、原文阅读与全文检索、人物共现轨迹、战争 KDE 与缓冲、历史地名候选查询、共现知识网络和研究观察。实际浏览器状态：`PASS`；详细记录见 `outputs/logs/browser_acceptance.json`。自动结构和源证据校验：`PASS`；pytest 记录：

```text
........                                                                 [100%]
--- generated xml file: F:\history_sites\sanguo_map\outputs\logs\pytest.xml ---
8 passed in 2.04s
```

哈希、运行环境、依赖版本、数据源 commit 和所有交付文件清单：`outputs/logs/source_manifest.json`。数据重建清单：`outputs/logs/build_manifest.json`。

## 已实现和限制

已实现全量原文解析、稳定段落证据、基于原文的别名/CHGIS 名称精确匹配、事件与时间规则候选、His-Geo 单模式接口、MED/trace、SQLite/GeoJSON/GeoPackage、核密度、局部 AEQD 缓冲、人物地名同段共现轨迹、离线前端及页面联动。

仍须人工审查人物别名身份、同名地点、空间关系、事件边界、时间换算和空间统计解释。当前短地名词典命中及段落触发规则是候选生成器；没有 LLM/人工标签评测，因此不可报告自动抽取准确率。CHGIS 源坐标 datum 为上游假设；无真实道路网、历史边界与已核史实地点。本次交付不宣称完成史实地理定位或历史战争热点发现。

**最优先的研究工作**：对频次高且进入 KDE/缓冲图层的战争地点与事件建立带双人复核状态的段落级审查样本，校准地名身份和事件切分后，再解释任何空间热点。
