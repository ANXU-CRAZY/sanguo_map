from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-c", f"safe.directory={root.as_posix()}", "-C", str(root), *args],
        check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_runtime(project_root: Path, hisgeo_root: Path, expected_commit: str):
    head = _git(hisgeo_root, "rev-parse", "HEAD")
    if head != expected_commit:
        raise RuntimeError(f"His-Geo commit mismatch: expected {expected_commit}, found {head}")
    dirty = _git(hisgeo_root, "status", "--porcelain")
    if dirty:
        raise RuntimeError("His-Geo working tree is not clean; refusing to use a mutable algorithm snapshot")
    official_root = hisgeo_root / "external" / "official_hisgeo"
    official_commit = _git(official_root, "rev-parse", "HEAD")
    historic_source = official_root / "his_geo" / "data" / "Historic" / "tgaz_chgis.csv"
    historic_sha = _sha(historic_source)

    # Do not write __pycache__ into the read-only external project.
    sys.dont_write_bytecode = True
    sys.path[:0] = [str(hisgeo_root / "src"), str(hisgeo_root)]
    from hisgeo.runtime.geocoding import RuntimeGeocoder

    cache_dir = project_root / "data" / "gazetteers" / "cache"
    runtime = RuntimeGeocoder(hisgeo_root, cache_dir)
    return runtime, {"hisgeo_commit": head, "hisgeo_official_commit": official_commit,
                     "historic_tgaz_source_sha256": historic_sha,
                     "historic_crs_statement": runtime.metadata.get("historic", {}).get("crs")}


def geocode_places(project_root: Path, places: list[dict], mode: str, max_records: int, hisgeo_root: Path, expected_commit: str, runtime=None, runtime_manifest=None, historical_analysis_period=(184, 280), priority_names=()) -> dict:
    if runtime is None:
        runtime, runtime_manifest = prepare_runtime(project_root, hisgeo_root, expected_commit)
    runtime_manifest = runtime_manifest or {}
    head = runtime_manifest.get("hisgeo_commit") or _git(hisgeo_root, "rev-parse", "HEAD")
    official_commit = runtime_manifest.get("hisgeo_official_commit") or _git(hisgeo_root / "external" / "official_hisgeo", "rev-parse", "HEAD")
    historic_sha = runtime_manifest.get("historic_tgaz_source_sha256")
    ordered = sorted(places, key=lambda row: (-row["mention_count"], row["historical_toponym"]))
    by_name = {row["historical_toponym"]: row for row in ordered}
    priority = [by_name[name] for name in priority_names if name in by_name]
    selected = list(dict.fromkeys(row["place_id"] for row in priority))
    selected_rows = {row["place_id"]: row for row in [*priority, *ordered]}
    selected_ids = selected[:max_records]
    selected_ids.extend(row["place_id"] for row in ordered if row["place_id"] not in selected_ids and len(selected_ids) < max_records)
    selected = [selected_rows[place_id] for place_id in selected_ids]
    omitted = [row for row in ordered if row["place_id"] not in set(selected_ids)]
    inputs = [{
        "historical_toponym": row["historical_toponym"],
        "location_reference": row["historical_toponym"],
        "raw_extraction_output": json.dumps({
            "method": "exact historical-gazetteer surface hit in supplied novel text",
            "place_id": row["place_id"],
            "source_occurrence_count": row["mention_count"],
            "paragraph_evidence_count": row["paragraph_count"],
        }, ensure_ascii=False, sort_keys=True),
        "reference_year": None,
        "project_place_id": row["place_id"],
        "project_source_occurrence_count": row["mention_count"],
        "project_paragraph_count": row["paragraph_count"],
    } for row in selected]
    rows = runtime.geocode_rows(inputs, mode)
    from hisgeo.models import ToponymReference
    historic_geocoder = runtime._paper_geocoders["historic"]
    historic_records = {str(record.id): record for record in runtime.historic.records}
    period_start, period_end = historical_analysis_period
    for row in rows:
        row["historical_meaning_review"] = "UNREVIEWED"
        row["coordinate_datum_note"] = "CHGIS historic source X/Y is marked ASSUMED_EPSG4326 by the upstream His-Geo loader; source datum is not established in its table."
        row["coordinate_interpretation"] = "gazetteer coordinate, not independent historical verification of this novel mention"
        reference = ToponymReference(row.get("historical_toponym") or "", row.get("historical_toponym") or "", row.get("raw_extraction_output"))
        historical = historic_geocoder.geocode(reference, neighbors=runtime.neighbors)
        candidate_records = [historic_records[str(identifier)] for identifier in historical.matched_references if str(identifier) in historic_records]
        intervals = [(record.valid_from, record.valid_to) for record in candidate_records]
        if not candidate_records:
            period_status = "NO_HISTORIC_GAZETTEER_MATCH"
        elif len(candidate_records) > 1:
            period_status = "MULTIPLE_HISTORIC_CANDIDATES"
        else:
            valid_from, valid_to = intervals[0]
            if valid_from is None and valid_to is None:
                period_status = "HISTORIC_PERIOD_UNKNOWN"
            elif (valid_from is None or valid_from <= period_end) and (valid_to is None or valid_to >= period_start):
                period_status = "OVERLAPS_PROJECT_ANALYSIS_WINDOW"
            else:
                period_status = "OUTSIDE_PROJECT_ANALYSIS_WINDOW"
        row.update({
            "historical_screen_status": historical.status,
            "historical_screen_period_status": period_status,
            "historical_screen_window": [period_start, period_end],
            "historical_screen_longitude": historical.longitude,
            "historical_screen_latitude": historical.latitude,
            "historical_screen_med_km": historical.max_error_distance_km,
            "historical_screen_candidates": list(historical.matched_references),
            "historical_screen_candidate_periods": [{"gazetteer_id": record.id, "valid_from": record.valid_from, "valid_to": record.valid_to, "level": record.level} for record in candidate_records],
            "historical_screen_trace": historical.trace,
            "historical_screen_method": "His-Geo paper Geocoder invoked against historic gazetteer only; separate screening result, not substituted for the configured end-to-end mode.",
        })
    for row in omitted:
        rows.append({
            "project_place_id": row["place_id"],
            "historical_toponym": row["historical_toponym"],
            "project_source_occurrence_count": row["mention_count"],
            "location_reference": row["historical_toponym"],
            "match_status": "NOT_RUN_LIMIT",
            "geocode_status": "NOT_RUN_LIMIT",
            "longitude": None, "latitude": None, "maximum_error_distance_km": None,
            "matched_gazetteer": [], "trace": {"reason": f"Configured limit {max_records} unique surface forms; this record remains unprocessed."},
            "algorithm_mode": mode,
            "historical_meaning_review": "UNREVIEWED",
            "historical_screen_status": "NOT_RUN_LIMIT",
            "historical_screen_period_status": "NOT_RUN_LIMIT",
            "historical_screen_candidates": [],
        })

    output_dir = project_root / "data" / "extracted"
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "geocoding_results.jsonl").open("w", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":"), default=str) + "\n")
    statuses = Counter(row.get("geocode_status", "UNKNOWN") for row in rows)
    summary = {
        "hisgeo_commit": head,
        "hisgeo_official_commit": official_commit,
        "hisgeo_working_tree_clean_before_run": True,
        "geocoder_mode": mode,
        "distinct_toponyms_total": len(places),
        "distinct_toponyms_evaluated": min(len(places), max_records),
        "distinct_toponyms_not_run": len(omitted),
        "source_occurrences_represented": sum(int(row["mention_count"]) for row in selected),
        "coordinate_status_counts": dict(sorted(statuses.items())),
        "coordinate_source_period_counts": dict(sorted(Counter(row.get("matched_period", "UNKNOWN") for row in rows if row.get("geocode_status") == "OK").items())),
        "historical_screen_status_counts": dict(sorted(Counter(row.get("historical_screen_status", "UNKNOWN") for row in rows).items())),
        "historical_screen_period_status_counts": dict(sorted(Counter(row.get("historical_screen_period_status", "UNKNOWN") for row in rows).items())),
        "historical_analysis_window": [period_start, period_end],
        "priority_names": list(priority_names),
        "historic_tgaz_source_sha256": historic_sha,
        "historic_crs_statement": runtime_manifest.get("historic_crs_statement", runtime.metadata.get("historic", {}).get("crs")),
        "gazetteer_metadata": runtime.metadata,
        "paid_api_calls": 0,
        "method": "RuntimeGeocoder.geocode_rows on exact-name references derived from corpus occurrences; no model/API call; names with non-unique results remain unresolved.",
    }
    (output_dir / "geocoding_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if _git(hisgeo_root, "rev-parse", "HEAD") != expected_commit or _git(hisgeo_root, "status", "--porcelain"):
        raise RuntimeError("His-Geo changed during the read-only adapter run")
    return {"rows": rows, "summary": summary}
