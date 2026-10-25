# His-Geo 集成记录

本项目将 `F:\history_sites\hisgeo_reproduction` 作为外部只读算法依赖，要求 Git HEAD `bb99915ff4323669fe3535fad17de67e95f2870b` 且工作树干净。其嵌套官方仓库 commit 与实际 CHGIS 文件 SHA 记录在 `data/extracted/geocoding_summary.json` 和 `outputs/logs/build_manifest.json`。

`src/geocoding/hisgeo_adapter.py` 通过 `hisgeo.runtime.geocoding.RuntimeGeocoder.geocode_rows` 调用现成实现。默认只使用 `paper_faithful`；可经构建命令显式选择 `official_compatible`，单次输出仍只有一个算法路径。运行时只向本项目 `data/gazetteers/cache/` 写入标准化缓存，并在开始/结束核验上游仓库没有被修改。

候选位置来自本地 119 章对 CHGIS 历史地名志名称/别名的精确词面匹配。对每个词形，将词形本身作为一条简短 `location_reference` 输入；这是验证几何编码器真实小说地名命中的最小桥接，不是对整段空间关系的充分解析。没有 LLM 抽取、上下文指代消解或自动纪年推算。配置最多运行 500 个不同词形，其余为 `NOT_RUN_LIMIT`。

坐标成功只表示所选 Gazetteer 路径返回唯一可用几何，并附带 MED 和 trace。它不证明这个原文词形指向该条历史记录。CHGIS TGAZ 源表的 X/Y datum 没有被确定；His-Geo loader 将其标注为 `ASSUMED_EPSG4326`，本项目沿用此标记，不另行消除不确定性。
