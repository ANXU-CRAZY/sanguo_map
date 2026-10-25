from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.corpus.ingest import ingest_corpus
from src.extraction.extract import extract_all
from src.geocoding.hisgeo_adapter import geocode_places, prepare_runtime
from src.knowledge.database import build_database
from src.spatial_analysis.analysis import run_spatial_analysis


def main():
    parser = argparse.ArgumentParser(description="Build the source-grounded 119-chapter Sanguo Spacetime dataset without any model/API calls")
    parser.add_argument("--mode", choices=["paper_faithful", "official_compatible"], help="One His-Geo path only; defaults to configs/project.json")
    parser.add_argument("--max-toponyms", type=int, help="Limit distinct exact toponyms sent to the local His-Geo geocoder")
    args = parser.parse_args()
    settings = json.loads((ROOT / "configs" / "project.json").read_text(encoding="utf-8"))
    corpus_root = Path(settings["corpus_root"])
    hisgeo_root = Path(settings["hisgeo_root"])
    mode = args.mode or settings["geocoder_mode"]
    maximum = args.max_toponyms or int(settings["maximum_distinct_toponyms"])

    corpus = ingest_corpus(corpus_root, ROOT / "data" / "processed")
    print(json.dumps({"step": "corpus", "chapters": len(corpus["chapters"]), "paragraphs": len(corpus["paragraphs"]), "body_match": corpus["manifest"]["integrity_audit"]["integrated_body_matches_119_source_files_after_whitespace_normalization"]}, ensure_ascii=False), flush=True)

    runtime, runtime_manifest = prepare_runtime(ROOT, hisgeo_root, settings["expected_hisgeo_commit"])
    extracted = extract_all(
        ROOT,
        ROOT / "data" / "processed" / "paragraphs.jsonl",
        ROOT / "data" / "gazetteers" / "cache" / "historic.gazetteer.geojson",
        ROOT / "data" / "extracted" / "person_alias_seeds.json",
        ROOT / "data" / "extracted" / "place_name_seed_terms.json",
    )
    print(json.dumps({"step": "deterministic_extraction", **extracted["summary"]}, ensure_ascii=False), flush=True)

    geocoded = geocode_places(
        ROOT, json.loads((ROOT / "data" / "extracted" / "places.json").read_text(encoding="utf-8")),
        mode, maximum, hisgeo_root, settings["expected_hisgeo_commit"], runtime, runtime_manifest,
        historical_analysis_period=settings.get("historical_analysis_period", [184, 280]),
        priority_names=["赤壁", "官渡", "夷陵"],
    )
    print(json.dumps({"step": "hisgeo", "status_counts": geocoded["summary"]["coordinate_status_counts"], "period_counts": geocoded["summary"]["coordinate_source_period_counts"], "historic_only_screen_counts": geocoded["summary"]["historical_screen_status_counts"], "period_screen_counts": geocoded["summary"]["historical_screen_period_status_counts"], "not_run": geocoded["summary"]["distinct_toponyms_not_run"]}, ensure_ascii=False), flush=True)

    database = build_database(ROOT)
    spatial_settings = {
        **settings,
        "focus_battlefields": ["赤壁", "官渡", "夷陵"],
    }
    analysis = run_spatial_analysis(ROOT, spatial_settings)
    report = {
        "project": "Sanguo Spacetime",
        "build_status": "SOURCE_GROUNDED_OFFLINE_BUILD_COMPLETED",
        "corpus": corpus["manifest"],
        "extraction": extracted["summary"],
        "geocoding": geocoded["summary"],
        "database": database,
        "spatial_analysis": analysis,
        "models_or_paid_api": {"called": False, "reason": "No explicit text-model inference was authorized for this task; deterministic extraction is used."},
    }
    target = ROOT / "outputs" / "logs" / "build_manifest.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps({"step": "complete", "database": database["counts"], "spatial": {key: analysis.get(key) for key in ("event_candidate_point_features", "war_candidate_point_features", "character_narrative_track_count", "kde", "geopackage")}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
