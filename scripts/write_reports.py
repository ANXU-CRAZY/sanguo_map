from __future__ import annotations

import hashlib
import importlib.metadata
import json
import platform
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def sha(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_versions():
    result = {"python": platform.python_version(), "platform": platform.platform()}
    for name in ("numpy", "shapely", "pyproj", "geopandas", "pandas", "pyogrio", "pytest"):
        try:
            result[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result[name] = None
    return result


def main():
    corpus = read("data/processed/corpus_manifest.json")
    extraction = read("data/extracted/extraction_metrics.json")
    geocoding = read("data/extracted/geocoding_summary.json")
    analysis = read("outputs/analysis/analysis_summary.json")
    basemap = read("data/basemap/natural_earth/manifest.json")
    china_admin = read("data/basemap/china_admin_2024/manifest.json")
    database = read("outputs/logs/build_manifest.json")["database"]
    validation_path = ROOT / "outputs" / "logs" / "validation.json"
    validation = json.loads(validation_path.read_text(encoding="utf-8")) if validation_path.exists() else {"status": "NOT_RUN", "checks": {}}
    browser_path = ROOT / "outputs" / "logs" / "browser_acceptance.json"
    browser = json.loads(browser_path.read_text(encoding="utf-8")) if browser_path.exists() else {"status": "NOT_RUN"}

    files = []
    for folder in ("configs", "src", "scripts", "frontend", "tests", "docs"):
        for path in sorted((ROOT / folder).rglob("*")):
            if path.is_file() and path.name != "source_manifest.json":
                files.append({"path": path.relative_to(ROOT).as_posix(), "sha256": sha(path), "bytes": path.stat().st_size})
    artifact_files = []
    for folder in ("data/processed", "data/extracted", "data/basemap", "outputs/geojson", "outputs/analysis", "outputs/figures", "database", "data/spatial"):
        for path in sorted((ROOT / folder).rglob("*")):
            if path.is_file():
                artifact_files.append({"path": path.relative_to(ROOT).as_posix(), "sha256": sha(path), "bytes": path.stat().st_size})
    for relative in ("outputs/logs/build_manifest.json", "outputs/logs/browser_acceptance.json", "outputs/logs/pytest.txt", "outputs/logs/pytest.xml"):
        path = ROOT / relative
        if path.is_file():
            artifact_files.append({"path": path.relative_to(ROOT).as_posix(), "sha256": sha(path), "bytes": path.stat().st_size})
    manifest = {
        "schema_version": 1,
        "source_corpus": corpus["source_files"],
        "corpus_side_files": [
            {"path": file["source_path"], "sha256": file["sha256"]}
            for file in corpus["source_files"]
        ],
        "hisgeo": {
            "reproduction_commit": geocoding["hisgeo_commit"],
            "official_commit": geocoding["hisgeo_official_commit"],
            "working_tree_clean_before_run": geocoding["hisgeo_working_tree_clean_before_run"],
            "historic_tgaz_sha256": geocoding["historic_tgaz_source_sha256"],
            "gazetteer_source_hashes": geocoding["gazetteer_metadata"]["sources"],
        },
        "environment": package_versions(),
        "project_files": files,
        "generated_artifacts": artifact_files,
        "validation": validation,
        "browser_acceptance": browser,
    }
    (ROOT / "outputs" / "logs" / "source_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    audit = corpus["integrity_audit"]
    ch65 = read("data/processed/chapters.json")[64]
    (ROOT / "docs" / "CORPUS_AUDIT.md").write_text(f"""# 原文语料完整性审计

## 结论

本项目将指定的 EPUB 转换语料按原顺序解析为 **{corpus['chapter_count']} 章、{corpus['paragraph_count']} 段**。源文件前缀连续为 001–119。目录和整合全文标题序列匹配：{audit['chapter_heading_sequence_matches']}；整合全文正文在忽略空白及合并版独有的 `---` 分隔线后逐章匹配：**{audit['integrated_body_matches_119_source_files_after_whitespace_normalization']}/119**。解析严格 UTF-8，源文件保持只读。

第 65 个文件 ID 为 `{ch65['chapter_id']}`，源序号为 065，原始章名为“{ch65['original_title']}”；原书标题在此重新从“第一章”编号。本系统未将其重编号映射到通行 120 回本，映射字段保持 `{ch65['chapter_mapping_status']}`。

## 可复核性

- 每章有 SHA-256、源文件名、字节数和原始标题；段落 ID 由章节 ID 与该章原段序号构成。
- 每段保存源文件 UTF-8 字节起止偏移、字符偏移与源散列。验证程序逐段切片后与保存段落正文逐字节解码比较。
- 同一输入重跑时，ID 与顺序确定；修改任何源文件都会使文件哈希变化并可在 manifest 中发现。
- 标题对比文件：`目录.md`（SHA-256 `{audit['catalog_sha256']}`）；整合版：`三国演义_全文.md`（SHA-256 `{audit['integrated_sha256']}`）。

章节源目录：`{corpus['source_root']}`。逐文件 SHA-256 清单见 `data/processed/corpus_manifest.json` 与 `outputs/logs/source_manifest.json`。源 README 指出该文本来自 119 个 EPUB HTML 章节，可能有错字或缺字；本项目没有校勘或补写。
""", encoding="utf-8")

    status = geocoding["coordinate_status_counts"]
    screen = geocoding.get("historical_screen_period_status_counts", {})
    (ROOT / "docs" / "DATA_QUALITY_REPORT.md").write_text(f"""# 数据质量与抽取覆盖

全量扫描覆盖 **{extraction['chapter_count_processed']}/119 章、{extraction['paragraph_count_processed']} 段**。确定性抽取得到 {extraction['place_mention_count']} 条地名词面命中、{extraction['distinct_toponym_count']} 个不同词形、{extraction['character_mention_count']} 条人物种子词表提及、{extraction['character_seed_count']} 个实体种子、{extraction['time_expression_count']} 条时间表达及 {extraction['event_candidate_count']} 条事件段落候选（战争 {extraction['event_candidates_by_type'].get('war',0)}，移动 {extraction['event_candidates_by_type'].get('movement',0)}，政治 {extraction['event_candidates_by_type'].get('politics',0)}，结盟 {extraction['event_candidates_by_type'].get('alliance',0)}，任职 {extraction['event_candidates_by_type'].get('appointment',0)}，死亡 {extraction['event_candidates_by_type'].get('death',0)}）。用户指定的赤壁、官渡、夷陵只作为原文精确检索词，合计命中 {extraction['user_specified_place_seed_mentions']} 次；不因此赋予坐标。

## 地理编码覆盖

His-Geo 路径：`{geocoding['geocoder_mode']}`，commit `{geocoding['hisgeo_commit']}`。{extraction['distinct_toponym_count']} 个不同词形中运行 {geocoding['distinct_toponyms_evaluated']} 个，词频限额外明确保留 {geocoding['distinct_toponyms_not_run']} 个 `NOT_RUN_LIMIT`。已处理词形对应原文表面命中 {geocoding['source_occurrences_represented']}/{extraction['place_mention_count']} 条。

主路径状态按不同地名词形计：唯一坐标 {status.get('OK',0)}（现代地名志 {geocoding.get('coordinate_source_period_counts',{}).get('modern',0)}、历史地名志 {geocoding.get('coordinate_source_period_counts',{}).get('historic',0)}），多候选 {status.get('MULTIPLE_MATCHES',0)}，未匹配 {status.get('NO_MATCH',0)}，不支持空间关系 {status.get('UNSUPPORTED_RELATION',0)}，未运行 {status.get('NOT_RUN_LIMIT',0)}。唯一坐标仅表示算法结果可用，不是历史身份人工核验；多候选未强制择一。

单独的历史地名志筛查年代状态：`{json.dumps(screen, ensure_ascii=False)}`。该筛查调用同一 His-Geo paper Geocoder 但仅加载其历史 Gazetteer，未替代主路径结果；`HISTORIC_PERIOD_UNKNOWN` 不证明对应三国年代。

## 质量边界

本轮没有 LLM 调用，没有保存模型回答。人物表是项目自有的 20 个姓名/别名种子，不是全文人物全集；事件是段落级触发词候选，不是人工事件切分。时间词保留原表达，不转换为公元年。无人工金标准，本项目不报告准确率、召回率、F1 或“抽取正确率”。原文每条命中均保留章节、段落和源 SHA。
""", encoding="utf-8")

    (ROOT / "docs" / "GIS_ANALYSIS_REPORT.md").write_text(f"""# GIS 空间分析报告

## 离线背景底图

Natural Earth 本地矢量仅提供周边国家轮廓、河流和湖泊：{', '.join(name for name in basemap['included_layers'] if name != 'China admin-1 provinces')}。中国省/市/县界来自用户本地 2024 行政区数据，审图号 `{china_admin['approval_number']}`，源坐标 `{china_admin['source_crs']}`；地图随缩放在 {china_admin['layers']['province']['source_feature_count']} 省级、{china_admin['layers']['city']['source_feature_count']} 市级、{china_admin['layers']['county']['source_feature_count']} 县级要素间切换。2024 现代界仅用于方位参照，不是三国疆域。原始/显示层哈希和几何修复记录见 `data/basemap/china_admin_2024/manifest.json`；许可与处理记录见 `docs/BASEMAP.md`。网页只请求本地 GeoJSON，不调用在线瓦片。

## 输入与覆盖

- 历史地名志独立筛查的唯一候选：{analysis['geocoded_place_names']} 个表面词形；现代地名志点不进入空间统计。
- 地名提及点：{analysis['resolved_place_occurrence_features']} 条；段落事件—地点共现点：{analysis['event_candidate_point_features']} 条，其中战争触发候选 {analysis['war_candidate_point_features']} 条。
- 人物—地名同段共现轨迹：{analysis['character_narrative_track_count']} 条。
- 输出 GeoJSON：{', '.join(analysis['geojson_layers'])}；GeoPackage：`{analysis['geopackage'].get('status')}`，图层 `{', '.join(analysis['geopackage'].get('layers',[]))}`。

## 核密度

状态：`{analysis['kde']['status']}`。核函数 {analysis['kde'].get('kernel')}；带宽 {analysis['kde'].get('bandwidth_km')} km，像元 {analysis['kde'].get('cell_size_km')} km；输入 {analysis['kde'].get('point_count')} 条战争候选共现点（{analysis['kde'].get('unique_coordinate_count')} 个不同坐标），输出 {analysis['kde'].get('grid_cell_count')} 个 GeoJSON 网格。仅纳入历史地名志筛查的唯一位置候选（`HISTORIC_PERIOD_UNKNOWN` 仍未核实），现代地名志结果排除。距离使用 `{analysis['kde'].get('projection')}` 等面积 Albers 平面欧氏近似，等权、截断于 3 带宽。只用于文学叙事候选密度探索，不代表历史战争频率。

## 战场缓冲与轨迹

本项目的地名志年代筛查窗口为公元 184–280 年；39 个候选与窗口重叠、99 个候选在窗口之外。“窗口重叠”仅用于候选过滤，不等于段落事件日期，也不证明历史身份。赤壁、官渡、夷陵在本次历史地名志-only 筛查中均未得到唯一坐标，因此缓冲图层按规则回退到战争触发段落中共现频次最高的三个唯一历史地名志候选，明确作为替代候选：`{json.dumps(analysis['battlefield_buffers'], ensure_ascii=False)}`。它们不是对三处真实战场的定位。半径 10/30/50 km 在各候选地点局部 AEQD 米制投影中构造；范围内候选统计用 WGS84 椭球 `Geod.inv` 测地距离。半径是研究参数，不是史料证实的影响圈。地点 MED 保留为位置不确定性线索，不据此自动扩张统计半径。

人物轨迹按章节、段落顺序连接唯一坐标的同段共现地点。连接线明确是直线示意，不是古代道路或实际行军路线。系统没有输入历史道路网或三国时期行政边界。

## CRS 和限制

缓存输出经纬度按 EPSG:4326 读取；现代底图源未提供 CRS 元素，上游按经纬度解释；历史 CHGIS XY 的 datum 来源未注明，上游标记 `{analysis['crs_source']}`。所有空间对象继承此限制。GeoJSON 字段保留 coordinate source、原文章节/段落、源 SHA、MED、算法模式与人工复核状态。统计建立在未人工核验的小说词面匹配与事件候选之上。
""", encoding="utf-8")

    test_text = (ROOT / "outputs" / "logs" / "pytest.txt").read_text(encoding="utf-8") if (ROOT / "outputs" / "logs" / "pytest.txt").exists() else "尚未运行。"
    (ROOT / "docs" / "FINAL_PROJECT_REPORT.md").write_text(f"""# 三国演义历史时空分析系统：交付报告

## 交付状态

**本地离线 WebGIS 原型已构建；科学数据解释状态为探索性 / 需人工复核。** 本地启动地址 `http://127.0.0.1:8765/`，完整命令见 `README.md`。

- 原文：{corpus['chapter_count']} 章、{corpus['paragraph_count']} 段；整合版正文逐章比对 {audit['integrated_body_matches_119_source_files_after_whitespace_normalization']}/119 通过。
- 人物种子：{extraction['character_seed_count']}；人物词面提及：{extraction['character_mention_count']}。
- 地名：{extraction['distinct_toponym_count']} 个词形、{extraction['place_mention_count']} 次提及；主 His-Geo 路径运行 {geocoding['distinct_toponyms_evaluated']} 个词形，唯一匹配 {status.get('OK',0)}（现代库 {geocoding.get('coordinate_source_period_counts',{}).get('modern',0)}、历史库 {geocoding.get('coordinate_source_period_counts',{}).get('historic',0)}）、多候选 {status.get('MULTIPLE_MATCHES',0)}、未匹配 {status.get('NO_MATCH',0)}，另有 {geocoding['distinct_toponyms_not_run']} 个超限未运行。历史空间分析只取独立历史库筛查的点；年代范围未知仍标为候选。
- 事件/时间：{extraction['event_candidate_count']} 个段落候选，{extraction['time_expression_count']} 个时间表达。年字段不充分时保持空值。
- 底图：中国行政界改用本地 2024 省/市/县三级数据，随缩放切换；古地点标签显示原文地名词面，现代行政名只在对照字段出现。现代界仅作方位参照，不是三国疆域。周边国家及水系为 Natural Earth 本地矢量；离线无瓦片请求。
- GIS：核密度 `{analysis['kde']['status']}`，输入战争候选点 {analysis['war_candidate_point_features']}；战场局部米制缓冲 {json.dumps(analysis['battlefield_buffers'],ensure_ascii=False)}；人物叙事共现轨迹 {analysis['character_narrative_track_count']} 条；GeoJSON {len(analysis['geojson_layers'])} 层，GeoPackage `{analysis['geopackage'].get('status')}`。
- His-Geo：`{geocoding['geocoder_mode']}`，复现仓库 `{geocoding['hisgeo_commit']}`；官方只读子仓库 `{geocoding['hisgeo_official_commit']}`；付费 API 调用 {geocoding['paid_api_calls']}。

## 界面与验证

WebGIS 含逐章播放/上一章/下一章、按章节和人物筛事件、显示古地名标签、缩放切换 2024 行政区级别、原文阅读与全文检索、人物共现轨迹、战争 KDE 与缓冲、历史地名候选查询、共现知识网络和研究观察。实际浏览器状态：`{browser.get('status')}`；详细记录见 `outputs/logs/browser_acceptance.json`。自动结构和源证据校验：`{validation.get('status')}`；pytest 记录：

```text
{test_text.strip()}
```

哈希、运行环境、依赖版本、数据源 commit 和所有交付文件清单：`outputs/logs/source_manifest.json`。数据重建清单：`outputs/logs/build_manifest.json`。

## 已实现和限制

已实现全量原文解析、稳定段落证据、基于原文的别名/CHGIS 名称精确匹配、事件与时间规则候选、His-Geo 单模式接口、MED/trace、SQLite/GeoJSON/GeoPackage、核密度、局部 AEQD 缓冲、人物地名同段共现轨迹、离线前端及页面联动。

仍须人工审查人物别名身份、同名地点、空间关系、事件边界、时间换算和空间统计解释。当前短地名词典命中及段落触发规则是候选生成器；没有 LLM/人工标签评测，因此不可报告自动抽取准确率。CHGIS 源坐标 datum 为上游假设；无真实道路网、历史边界与已核史实地点。本次交付不宣称完成史实地理定位或历史战争热点发现。

**最优先的研究工作**：对频次高且进入 KDE/缓冲图层的战争地点与事件建立带双人复核状态的段落级审查样本，校准地名身份和事件切分后，再解释任何空间热点。
""", encoding="utf-8")

    # Refresh hashes after generated reports have been rewritten above.
    manifest["project_files"] = []
    for folder in ("configs", "src", "scripts", "frontend", "tests", "docs"):
        for path in sorted((ROOT / folder).rglob("*")):
            if path.is_file() and path.name != "source_manifest.json":
                manifest["project_files"].append({"path": path.relative_to(ROOT).as_posix(), "sha256": sha(path), "bytes": path.stat().st_size})
    manifest["generated_artifacts"] = []
    for folder in ("data/processed", "data/extracted", "data/basemap", "outputs/geojson", "outputs/analysis", "outputs/figures", "database", "data/spatial"):
        for path in sorted((ROOT / folder).rglob("*")):
            if path.is_file():
                manifest["generated_artifacts"].append({"path": path.relative_to(ROOT).as_posix(), "sha256": sha(path), "bytes": path.stat().st_size})
    for relative in ("outputs/logs/build_manifest.json", "outputs/logs/browser_acceptance.json", "outputs/logs/pytest.txt", "outputs/logs/pytest.xml"):
        path = ROOT / relative
        if path.is_file():
            manifest["generated_artifacts"].append({"path": path.relative_to(ROOT).as_posix(), "sha256": sha(path), "bytes": path.stat().st_size})
    (ROOT / "outputs" / "logs" / "source_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
