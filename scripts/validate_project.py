from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
from pathlib import Path
import pyogrio
from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.corpus.ingest import parse_chapter, read_jsonl


def main():
    checks = {}
    def sha256_file(path):
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    source_manifest_path = ROOT / "outputs" / "logs" / "source_manifest.json"
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    project_hash_results = [
        (ROOT / item["path"]).is_file() and sha256_file(ROOT / item["path"]) == item["sha256"]
        for item in source_manifest["project_files"]
    ]
    artifact_hash_results = [
        (ROOT / item["path"]).is_file() and sha256_file(ROOT / item["path"]) == item["sha256"]
        for item in source_manifest["generated_artifacts"]
    ]
    checks["project_source_hash_manifest"] = bool(project_hash_results) and all(project_hash_results)
    checks["generated_artifact_hash_manifest"] = bool(artifact_hash_results) and all(artifact_hash_results)
    basemap_manifest_path = ROOT / "data" / "basemap" / "natural_earth" / "manifest.json"
    basemap_manifest = json.loads(basemap_manifest_path.read_text(encoding="utf-8"))
    basemap_bbox = box(*basemap_manifest["extent_wgs84"])
    basemap_hashes_valid = True
    basemap_geometries_valid = True
    for layer_name, item in basemap_manifest["layers"].items():
        source_path = ROOT / "data" / "basemap" / "natural_earth" / "source" / item["source_archive"]
        output_path = ROOT / item["output_path"]
        if not source_path.is_file() or sha256_file(source_path) != item["source_sha256"]:
            basemap_hashes_valid = False
        if not output_path.is_file() or sha256_file(output_path) != item["output_sha256"]:
            basemap_hashes_valid = False
            continue
        collection = json.loads(output_path.read_text(encoding="utf-8"))
        if len(collection.get("features", [])) != item["output_feature_count"] or not collection.get("features"):
            basemap_geometries_valid = False
        for feature in collection.get("features", []):
            try:
                geometry = shape(feature["geometry"])
                if geometry.is_empty or not geometry.is_valid or not geometry.intersects(basemap_bbox):
                    basemap_geometries_valid = False
            except (KeyError, TypeError, ValueError):
                basemap_geometries_valid = False
    checks["natural_earth_basemap_source_and_output_hashes"] = basemap_hashes_valid
    checks["natural_earth_basemap_geometry_and_extent"] = basemap_geometries_valid
    china_admin_path = ROOT / "data" / "basemap" / "china_admin_2024" / "manifest.json"
    china_admin = json.loads(china_admin_path.read_text(encoding="utf-8"))
    expected_admin_counts = {"province": 42, "city": 388, "county": 2898}
    admin_hashes_and_geometry_valid = china_admin.get("approval_number") == "GS（2024）0650号" and china_admin.get("source_crs") == "EPSG:4490"
    for level, expected_count in expected_admin_counts.items():
        item = china_admin.get("layers", {}).get(level, {})
        source_path = ROOT / "data" / "basemap" / "china_admin_2024" / "source" / item.get("source_file", "missing")
        output_path = ROOT / item.get("output_file", "missing")
        try:
            collection = json.loads(output_path.read_text(encoding="utf-8"))
            features = collection.get("features", [])
            layer_valid = (
                source_path.is_file()
                and sha256_file(source_path) == item.get("source_sha256")
                and output_path.is_file()
                and sha256_file(output_path) == item.get("output_sha256")
                and len(features) == expected_count == item.get("output_feature_count")
                and collection.get("crs", {}).get("properties", {}).get("name") == "urn:ogc:def:crs:EPSG::4490"
                and all(shape(feature["geometry"]).is_valid for feature in features)
            )
        except (OSError, ValueError, KeyError, TypeError):
            layer_valid = False
        admin_hashes_and_geometry_valid = admin_hashes_and_geometry_valid and layer_valid
    checks["user_2024_admin_source_hashes_geometry_and_counts"] = admin_hashes_and_geometry_valid
    app_source = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    checks["basemap_is_local_vector_not_remote_tiles"] = "L.tileLayer" not in app_source and all(
        f"/frontend/data/basemap/{name}.geojson" in app_source for name in ("countries", "rivers", "lakes")
    ) and all(
        f"/frontend/data/basemap/china_admin_2024/{name}.geojson" in app_source for name in ("province", "city", "county")
    )
    browser_path = ROOT / "outputs" / "logs" / "browser_acceptance.json"
    browser = json.loads(browser_path.read_text(encoding="utf-8"))
    checks["browser_acceptance_passed_without_network_or_errors"] = (
        browser.get("status") == "PASS"
        and browser.get("dynamicOK") is True
        and browser.get("peopleSinglePersonOK") is True
        and browser.get("peopleSinglePointOK") is True
        and browser.get("has2024Layers") is True
        and browser.get("provinceLevel") == "province"
        and browser.get("countyLevel") == "county"
        and not browser.get("externalRequests")
        and not browser.get("httpErrors")
        and not browser.get("pageErrors")
    )
    manifest_path = ROOT / "data" / "processed" / "corpus_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    checks["chapter_count_119"] = manifest["chapter_count"] == 119
    checks["paragraphs_match_integrated_file"] = not manifest["integrity_audit"]["integrated_body_mismatch_ordinals"]
    checks["catalog_is_001_119"] = manifest["integrity_audit"]["catalog_has_119_contiguous_ordinals"]
    chapters = json.loads((ROOT / "data" / "processed" / "chapters.json").read_text(encoding="utf-8"))
    paragraphs = read_jsonl(ROOT / "data" / "processed" / "paragraphs.jsonl")
    checks["chapter_ids_unique"] = len({row["chapter_id"] for row in chapters}) == 119
    checks["paragraph_ids_unique"] = len({row["paragraph_id"] for row in paragraphs}) == len(paragraphs)
    source_dir = Path(manifest["source_root"]) / "章节"
    byte_spans_ok = True
    source_cache = {}
    for row in paragraphs:
        if row["source_file"] not in source_cache:
            source_cache[row["source_file"]] = (source_dir / row["source_file"]).read_bytes()
        raw = source_cache[row["source_file"]]
        actual = raw[row["source_byte_start"]:row["source_byte_end"]].decode("utf-8")
        if actual != row["text"] or hashlib.sha256(raw).hexdigest() != row["source_sha256"]:
            byte_spans_ok = False
            break
    checks["source_hashes_and_byte_spans"] = byte_spans_ok
    build_path = ROOT / "outputs" / "logs" / "build_manifest.json"
    build = json.loads(build_path.read_text(encoding="utf-8"))
    checks["hisgeo_expected_commit"] = build["geocoding"]["hisgeo_commit"] == "bb99915ff4323669fe3535fad17de67e95f2870b"
    checks["paid_api_calls_zero"] = build["geocoding"]["paid_api_calls"] == 0
    extracted = ROOT / "data" / "extracted"
    place_mentions = read_jsonl(extracted / "place_mentions.jsonl")
    person_mentions = read_jsonl(extracted / "character_mentions.jsonl")
    events = read_jsonl(extracted / "event_candidates.jsonl")
    checks["extraction_has_real_source_evidence"] = bool(place_mentions and person_mentions and events)
    geocodes = read_jsonl(extracted / "geocoding_results.jsonl")
    checks["geocoder_results_have_historic_only_screen"] = all("historical_screen_status" in row for row in geocodes if row.get("project_place_id"))
    db_path = ROOT / "database" / "sanguo_spacetime.sqlite"
    with sqlite3.connect(db_path) as con:
        checks["sqlite_foreign_key_integrity"] = con.execute("PRAGMA foreign_key_check").fetchall() == []
        checks["all_chapters_in_database"] = con.execute("SELECT COUNT(*) FROM chapters").fetchone()[0] == 119
        checks["all_paragraphs_in_database"] = con.execute("SELECT COUNT(*) FROM paragraphs").fetchone()[0] == len(paragraphs)
    for filename in build["spatial_analysis"]["geojson_layers"]:
        payload = json.loads((ROOT / "outputs" / "geojson" / filename).read_text(encoding="utf-8"))
        checks[f"geojson_valid_{filename}"] = payload.get("type") == "FeatureCollection" and isinstance(payload.get("features"), list)
        for feature in payload.get("features", []):
            geom = feature.get("geometry") or {}
            if geom and geom.get("type") != "GeometryCollection":
                coords = geom.get("coordinates")
                if coords is None:
                    checks[f"geojson_valid_{filename}"] = False
                    break
        if filename == "event_candidates_resolved.geojson":
            checks["spatial_events_exclude_modern_only_matches"] = all(
                all(str(ident).startswith("historic:") for ident in json.loads(feature["properties"].get("matched_gazetteer_ids", "[]")))
                for feature in payload.get("features", [])
            )
    gpkg_path = ROOT / "data" / "spatial" / "sanguo_analysis.gpkg"
    gpkg_layers = pyogrio.list_layers(gpkg_path)
    expected_layers = build["spatial_analysis"]["geopackage"]["layers"]
    layer_rows_valid = [row[0] for row in gpkg_layers.tolist()] == expected_layers
    for layer_name, _geometry_type in gpkg_layers.tolist():
        frame = pyogrio.read_dataframe(gpkg_path, layer=layer_name)
        source_name = f"{layer_name}.geojson"
        source_path = ROOT / "outputs" / "geojson" / source_name
        source_count = len(json.loads(source_path.read_text(encoding="utf-8"))["features"])
        layer_rows_valid = layer_rows_valid and len(frame) == source_count
        layer_rows_valid = layer_rows_valid and str(frame.crs).upper() == "EPSG:4326"
        layer_rows_valid = layer_rows_valid and not frame.geometry.isna().any() and not frame.geometry.is_empty.any()
        layer_rows_valid = layer_rows_valid and bool(frame.geometry.is_valid.all())
    checks["geopackage_layers_readback_and_geojson_parity"] = bool(gpkg_layers.size) and layer_rows_valid
    checks["frontend_exists"] = (ROOT / "frontend" / "index.html").is_file()
    result = {"status": "PASS" if all(checks.values()) else "FAIL", "checks": checks, "failed": [key for key, value in checks.items() if not value]}
    out = ROOT / "outputs" / "logs" / "validation.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
