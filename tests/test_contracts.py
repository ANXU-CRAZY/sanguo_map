import hashlib
import json
import sqlite3
from pathlib import Path

from shapely.geometry import shape

from src.extraction.automaton import AhoCorasick
from src.corpus.ingest import read_jsonl


ROOT = Path(__file__).resolve().parents[1]


def test_exact_match_automaton_returns_each_surface_span():
    matcher = AhoCorasick({"赤壁": 1, "长江": 2, "江": 3})
    hits = list(matcher.finditer("赤壁鏖兵长江"))
    assert [(start, end, term) for start, end, term, _ in hits] == [
        (0, 2, "赤壁"), (4, 6, "长江"), (5, 6, "江")
    ]


def test_full_corpus_title_sequence_and_integrated_bodies():
    manifest = json.loads((ROOT / "data/processed/corpus_manifest.json").read_text(encoding="utf-8"))
    chapters = json.loads((ROOT / "data/processed/chapters.json").read_text(encoding="utf-8"))
    assert manifest["chapter_count"] == 119
    assert manifest["integrity_audit"]["integrated_body_matches_119_source_files_after_whitespace_normalization"] == 119
    assert [row["chapter_id"] for row in chapters] == [f"ch_{i:03d}" for i in range(1, 120)]
    assert chapters[64]["source_ordinal"] == 65
    assert chapters[64]["original_title"].startswith("第一章")
    assert chapters[64]["chapter_mapping_120_edition"] is None


def test_paragraph_ids_and_byte_spans_round_trip_to_read_only_sources():
    manifest = json.loads((ROOT / "data/processed/corpus_manifest.json").read_text(encoding="utf-8"))
    rows = read_jsonl(ROOT / "data/processed/paragraphs.jsonl")
    source_root = Path(manifest["source_root"]) / "章节"
    cache = {}
    assert len({row["paragraph_id"] for row in rows}) == len(rows)
    for row in rows[::max(1, len(rows)//100)]:
        raw = cache.setdefault(row["source_file"], None)
        if raw is None:
            raw = (source_root / row["source_file"]).read_bytes()
            cache[row["source_file"]] = raw
        assert hashlib.sha256(raw).hexdigest() == row["source_sha256"]
        assert raw[row["source_byte_start"]:row["source_byte_end"]].decode("utf-8") == row["text"]


def test_geocoder_keeps_primary_and_historic_only_screens_separate():
    rows = read_jsonl(ROOT / "data/extracted/geocoding_results.jsonl")
    summary = json.loads((ROOT / "data/extracted/geocoding_summary.json").read_text(encoding="utf-8"))
    assert len(rows) == summary["distinct_toponyms_total"]
    assert summary["hisgeo_commit"] == "bb99915ff4323669fe3535fad17de67e95f2870b"
    assert summary["paid_api_calls"] == 0
    assert summary["coordinate_status_counts"]["OK"] > 0
    assert summary["coordinate_status_counts"]["MULTIPLE_MATCHES"] > 0
    assert summary["coordinate_status_counts"]["NOT_RUN_LIMIT"] == summary["distinct_toponyms_not_run"]
    evaluated = [row for row in rows if row.get("project_place_id")]
    assert all("historical_screen_status" in row for row in evaluated)
    assert any(row.get("matched_period") == "modern" and row.get("geocode_status") == "OK" for row in evaluated)
    assert all(row.get("historical_screen_period_status") in {"OVERLAPS_PROJECT_ANALYSIS_WINDOW", "HISTORIC_PERIOD_UNKNOWN", "OUTSIDE_PROJECT_ANALYSIS_WINDOW", "NO_HISTORIC_GAZETTEER_MATCH", "MULTIPLE_HISTORIC_CANDIDATES", "NOT_RUN_LIMIT"} for row in evaluated)


def test_database_foreign_keys_and_explicit_co_mention_relations():
    with sqlite3.connect(ROOT / "database/sanguo_spacetime.sqlite") as con:
        assert con.execute("PRAGMA foreign_key_check").fetchall() == []
        assert con.execute("SELECT COUNT(*) FROM chapters").fetchone()[0] == 119
        expected_geocode_count = len(read_jsonl(ROOT / "data/extracted/geocoding_results.jsonl"))
        assert con.execute("SELECT COUNT(*) FROM historic_gazetteer_screens").fetchone()[0] == expected_geocode_count
        assert con.execute("SELECT COUNT(*) FROM event_time_expressions").fetchone()[0] > 0
        states = {row[0] for row in con.execute("SELECT DISTINCT relation_status FROM event_place_mentions")}
        assert states <= {"SAME_PARAGRAPH_CO_MENTION_CANDIDATE"}
        assert states


def test_spatial_layers_are_valid_and_exclude_modern_only_coordinates():
    event_path = ROOT / "outputs/geojson/event_candidates_resolved.geojson"
    events = json.loads(event_path.read_text(encoding="utf-8"))["features"]
    for feature in events:
        props = feature["properties"]
        assert props["coordinate_source"] == "His-Geo historical CHGIS gazetteer-only screening; exact-text mention is not a historical identity validation"
        ids = json.loads(props["matched_gazetteer_ids"])
        assert ids and all(value.startswith("historic:") for value in ids)
        assert shape(feature["geometry"]).is_valid
    summary = json.loads((ROOT / "outputs/analysis/analysis_summary.json").read_text(encoding="utf-8"))
    assert summary["kde"]["point_count"] == summary["war_candidate_point_features"]
    assert summary["kde"]["cell_size_km"] > 0
    assert summary["geopackage"]["status"] == "WRITTEN"


def test_local_basemap_has_provenanced_natural_earth_layers_and_no_tile_dependency():
    manifest = json.loads((ROOT / "data/basemap/natural_earth/manifest.json").read_text(encoding="utf-8"))
    assert manifest["dataset"] == "Natural Earth 1:10m vector basemap"
    assert manifest["extent_wgs84"] == [72.0, 15.0, 135.0, 55.0]
    assert set(manifest["layers"]) == {"countries", "provinces", "rivers", "lakes"}
    for name, layer in manifest["layers"].items():
        source_path = ROOT / "data/basemap/natural_earth/source" / layer["source_archive"]
        output_path = ROOT / layer["output_path"]
        assert source_path.is_file() and output_path.is_file()
        assert hashlib.sha256(source_path.read_bytes()).hexdigest() == layer["source_sha256"]
        assert hashlib.sha256(output_path.read_bytes()).hexdigest() == layer["output_sha256"]
        collection = json.loads(output_path.read_text(encoding="utf-8"))
        assert len(collection["features"]) == layer["output_feature_count"] > 0
    provinces = json.loads((ROOT / "frontend/data/basemap/provinces.geojson").read_text(encoding="utf-8"))["features"]
    assert len(provinces) >= 30
    assert all(feature["properties"].get("admin") == "China" for feature in provinces)
    assert "L.tileLayer" not in (ROOT / "frontend/app.js").read_text(encoding="utf-8")


def test_user_2024_admin_boundaries_keep_source_hashes_and_valid_display_geometry():
    manifest_path = ROOT / "data/basemap/china_admin_2024/manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["approval_number"] == "GS（2024）0650号"
    assert manifest["source_crs"] == "EPSG:4490"
    assert "is not mislabeled as the project gazetteer's EPSG:4326" in manifest["coordinate_handling"]
    expected_counts = {"province": 42, "city": 388, "county": 2898}
    assert set(manifest["layers"]) == set(expected_counts)
    for layer_name, expected_count in expected_counts.items():
        item = manifest["layers"][layer_name]
        source_path = ROOT / "data/basemap/china_admin_2024/source" / item["source_file"]
        output_path = ROOT / item["output_file"]
        assert source_path.is_file() and output_path.is_file()
        assert hashlib.sha256(source_path.read_bytes()).hexdigest() == item["source_sha256"]
        assert hashlib.sha256(output_path.read_bytes()).hexdigest() == item["output_sha256"]
        source = json.loads(source_path.read_text(encoding="utf-8"))
        output = json.loads(output_path.read_text(encoding="utf-8"))
        assert len(source["features"]) == len(output["features"]) == expected_count
        assert output["crs"]["properties"]["name"] == "urn:ogc:def:crs:EPSG::4490"
        assert all(shape(feature["geometry"]).is_valid for feature in output["features"])
    app = (ROOT / "frontend/app.js").read_text(encoding="utf-8")
    html = (ROOT / "frontend/index.html").read_text(encoding="utf-8")
    assert "GS（2024）0650号" in app
    assert "historical_toponym" in app and "permanent:true" in app
    assert all(f"/frontend/data/basemap/china_admin_2024/{level}.geojson" in app for level in expected_counts)
    assert all(control in html for control in ("chapter-play", "chapter-prev", "chapter-next", "place-label-toggle"))
