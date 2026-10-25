# 数据模型

主数据库：`database/sanguo_spacetime.sqlite`；空间交换格式：EPSG:4326 GeoJSON；批量多图层输出：GeoPackage（数据可用环境提供 GeoPandas 时生成）。原文文件留在外部只读源目录，数据库保存文本副本、稳定 ID、哈希与偏移，便于查询和比对。

| 表 | 主体与关键字段 | 关系与解释 |
|---|---|---|
| `chapters` | 119 章、原始标题、文件哈希、正文 | `chapter_id` 由 001–119 源文件序号形成；原书章次单独保存 |
| `paragraphs` | 段落正文、顺序、UTF-8 字节偏移、源 SHA | 引用章节；原文证据最小稳定单位 |
| `characters` / `character_aliases` | 20 个项目自有别名种子 | 身份仅为未核验实体候选；出生/死亡年为空 |
| `character_mentions` / `_entities` | 名称表面形式、偏移、别名命中身份 | 一段中的出现不自动证明参与事件 |
| `places` / `place_mentions` | 原文地名词形与每次出现 | 同名不同地理实体保留在 `gazetteer_candidates` 中 |
| `gazetteer_candidates` | His-Geo CHGIS 候选、层级、有效期、XY | 源坐标系 datum 未被上游建立；候选不等于身份确认 |
| `geocode_traces` | 模式、匹配状态、完整 trace 与来源 | `paper_faithful` 与 `official_compatible` 不合并；本轮只运行配置模式 |
| `time_expressions` | 原始纪年词、叙事顺序、空 Gregorian 年 | 未做无证据的公元年推算 |
| `events` | 触发词、事件类型候选、段落证据 | 仅规则筛选，须人工切分和核验 |
| `event_character_mentions` / `event_place_mentions` | 事件段落与名字共现 | 关系状态固定为 `SAME_PARAGRAPH_CO_MENTION_CANDIDATE` |
| `event_time_expressions` | 事件段落与同段时间表达 | `SAME_PARAGRAPH_TEMPORAL_EXPRESSION_CANDIDATE`，不将表达自动换算为年 |
| `historic_gazetteer_screens` | 历史地名志单独筛查的坐标、候选、MED、trace、候选有效期 | 与主路径 `geocode_traces` 分表；现代库坐标不混入历史筛查 |

所有自动实体和事件均保留人工审查状态。`event_id` 由对应段落 ID 构造，因此同段多个事件不会被伪装成已完成的事件级切分；后续人工拆分可另建事件实体并保留此候选记录。
