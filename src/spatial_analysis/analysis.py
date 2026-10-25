from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from pyproj import CRS, Geod, Transformer
from shapely.geometry import Point, mapping, shape

from src.corpus.ingest import read_jsonl


WGS84 = Geod(ellps="WGS84")
KDE_CRS = "+proj=aea +lat_1=25 +lat_2=47 +lat_0=35 +lon_0=105 +datum=WGS84 +units=m +no_defs"
FOCUS_BATTLEFIELDS = ["赤壁", "官渡", "夷陵"]


def _write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _feature_collection(features):
    return {"type": "FeatureCollection", "name": "sanguo_spacetime", "crs": {"type": "name", "properties": {"name": "EPSG:4326"}}, "features": features}


def _feature(geometry, properties):
    return {"type": "Feature", "geometry": mapping(geometry), "properties": properties}


def _safe_name(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)


def _local_aeqd(lon: float, lat: float):
    crs = CRS.from_proj4(f"+proj=aeqd +lat_0={lat:.10f} +lon_0={lon:.10f} +datum=WGS84 +units=m +no_defs")
    return Transformer.from_crs("EPSG:4326", crs, always_xy=True), Transformer.from_crs(crs, "EPSG:4326", always_xy=True)


def _make_kde(points: list[dict], bandwidth_km: float, cell_km: float):
    if not points:
        return [], {"status": "NO_RESOLVED_BATTLE_EVENT_POINTS", "point_count": 0}
    import numpy as np
    to_metric = Transformer.from_crs("EPSG:4326", KDE_CRS, always_xy=True)
    xs, ys = to_metric.transform([row["longitude"] for row in points], [row["latitude"] for row in points])
    xs, ys = np.asarray(xs), np.asarray(ys)
    bw, step = bandwidth_km * 1000.0, cell_km * 1000.0
    pad = 3 * bw
    x0, x1 = math.floor((float(xs.min()) - pad) / step) * step, math.ceil((float(xs.max()) + pad) / step) * step
    y0, y1 = math.floor((float(ys.min()) - pad) / step) * step, math.ceil((float(ys.max()) + pad) / step) * step
    grid_x = np.arange(x0 + step / 2, x1, step)
    grid_y = np.arange(y0 + step / 2, y1, step)
    cell_features = []
    from shapely.geometry import Polygon
    back = Transformer.from_crs(KDE_CRS, "EPSG:4326", always_xy=True)
    for cy in grid_y:
        for cx in grid_x:
            distances = np.hypot(xs - cx, ys - cy)
            nearby = distances <= 3 * bw
            if not nearby.any():
                continue
            density = float(np.exp(-0.5 * (distances[nearby] / bw) ** 2).sum())
            geom = Polygon([(cx-step/2,cy-step/2),(cx+step/2,cy-step/2),(cx+step/2,cy+step/2),(cx-step/2,cy+step/2),(cx-step/2,cy-step/2)])
            from shapely.ops import transform
            geom_wgs = transform(back.transform, geom)
            cell_features.append(_feature(geom_wgs, {
                "density": density,
                "events_within_3_bandwidth": int(nearby.sum()),
                "bandwidth_km": bandwidth_km,
                "cell_size_km": cell_km,
                "distance_model": "Euclidean distance in WGS84 Albers equal-area projection (descriptive approximation)",
                "narrative_event_point_count": len(points),
            }))
    return cell_features, {
        "status": "COMPUTED_UNVERIFIED_HISTORIC_GAZETTEER_CANDIDATES_LOW_N" if len(points) < 10 else "COMPUTED_UNVERIFIED_HISTORIC_GAZETTEER_CANDIDATES",
        "point_count": len(points),
        "unique_coordinate_count": len({(round(row["longitude"], 6), round(row["latitude"], 6)) for row in points}),
        "kernel": "isotropic Gaussian, truncated at 3 bandwidths; event points equally weighted",
        "bandwidth_km": bandwidth_km,
        "cell_size_km": cell_km,
        "projection": KDE_CRS,
        "area_note": "Albers equal-area grid supports comparable cell areas; projected Euclidean distances remain an approximation and are not a route or historical battlefield extent.",
        "grid_cell_count": len(cell_features),
    }


def run_spatial_analysis(project_root: Path, settings: dict) -> dict:
    ext = project_root / "data" / "extracted"
    out = project_root / "outputs" / "geojson"
    places = json.loads((ext / "places.json").read_text(encoding="utf-8"))
    mentions = read_jsonl(ext / "place_mentions.jsonl")
    people = read_jsonl(ext / "character_mentions.jsonl")
    events = read_jsonl(ext / "event_candidates.jsonl")
    geocodes = read_jsonl(ext / "geocoding_results.jsonl")
    by_place = {row.get("project_place_id"): row for row in geocodes if row.get("project_place_id")}
    place_by_name = {row["historical_toponym"]: row for row in places}
    resolved = {}
    for place in places:
        result = by_place.get(place["place_id"])
        eligible_screen = result and result.get("historical_screen_status") == "OK" and result.get("historical_screen_longitude") is not None and result.get("historical_screen_latitude") is not None and result.get("historical_screen_period_status") in {"OVERLAPS_PROJECT_ANALYSIS_WINDOW", "HISTORIC_PERIOD_UNKNOWN"}
        if eligible_screen:
            resolved[place["historical_toponym"]] = {**place, **result,
                "longitude": result["historical_screen_longitude"],
                "latitude": result["historical_screen_latitude"],
                "maximum_error_distance_km": result.get("historical_screen_med_km"),
                "matched_gazetteer": result.get("historical_screen_candidates", []),
                "matched_period": "historic",
            }

    place_features = []
    for mention in mentions:
        result = resolved.get(mention["historical_toponym"])
        if not result:
            continue
        place_features.append(_feature(Point(result["longitude"], result["latitude"]), {
            "mention_id": mention["mention_id"], "place_id": mention["place_id"],
            "historical_toponym": mention["historical_toponym"], "chapter_id": mention["chapter_id"],
            "paragraph_id": mention["paragraph_id"], "source_file": mention["source_file"],
            "source_sha256": mention["source_sha256"], "coordinate_source": "His-Geo historical CHGIS gazetteer-only screening; exact-text mention is not a historical identity validation",
            "matched_gazetteer_ids": json.dumps(result.get("historical_screen_candidates", []), ensure_ascii=False),
            "med_km": result.get("maximum_error_distance_km"), "match_status": result.get("match_status"),
            "geocoder_mode": result.get("algorithm_mode"), "historical_meaning_review": "UNREVIEWED",
            "gazetteer_period_status": result.get("historical_screen_period_status"),
            "gazetteer_candidate_periods": json.dumps(result.get("historical_screen_candidate_periods", []), ensure_ascii=False),
            "historical_screen_window": json.dumps(result.get("historical_screen_window"), ensure_ascii=False),
            "time_validity": json.dumps(result.get("historical_screen_candidate_periods", []), ensure_ascii=False),
        }))
    (out / "place_mentions_resolved.geojson").write_text(json.dumps(_feature_collection(place_features), ensure_ascii=False), encoding="utf-8")

    place_mentions_by_para = defaultdict(list)
    for mention in mentions:
        place_mentions_by_para[mention["paragraph_id"]].append(mention)
    person_mentions_by_para = defaultdict(list)
    for mention in people:
        person_mentions_by_para[mention["paragraph_id"]].append(mention)
    event_features, battle_points = [], []
    for event in events:
        for mention in place_mentions_by_para.get(event["paragraph_id"], []):
            result = resolved.get(mention["historical_toponym"])
            if not result:
                continue
            props = {
                "event_id": event["event_id"], "event_type_candidate": event["event_type_candidate"],
                "candidate_label": event["candidate_label"], "historical_toponym": mention["historical_toponym"],
                "paragraph_id": event["paragraph_id"], "chapter_id": event["chapter_id"],
                "chapter_order": event["chapter_order"], "narrative_order": event["narrative_order"],
                "source_file": event["source_file"], "source_sha256": event["source_sha256"],
                "source_excerpt": event["source_excerpt"][:400],
                "candidate_person_ids": json.dumps(event["candidate_person_ids"], ensure_ascii=False),
                "med_km": result.get("maximum_error_distance_km"), "geocoder_mode": result.get("algorithm_mode"),
                "historical_review": "UNREVIEWED_NARRATIVE_EVENT_CANDIDATE",
                "gazetteer_period_status": result.get("historical_screen_period_status"),
                "gazetteer_candidate_periods": json.dumps(result.get("historical_screen_candidate_periods", []), ensure_ascii=False),
                "historical_screen_window": json.dumps(result.get("historical_screen_window"), ensure_ascii=False),
                "matched_gazetteer_ids": json.dumps(result.get("historical_screen_candidates", []), ensure_ascii=False),
                "coordinate_source": "His-Geo historical CHGIS gazetteer-only screening; exact-text mention is not a historical identity validation",
            }
            feature = _feature(Point(result["longitude"], result["latitude"]), props)
            event_features.append(feature)
            if event["event_type_candidate"] == "war":
                battle_points.append({"longitude": result["longitude"], "latitude": result["latitude"], **props})
    (out / "event_candidates_resolved.geojson").write_text(json.dumps(_feature_collection(event_features), ensure_ascii=False), encoding="utf-8")

    # Character/place co-mentions form narrative-order activity traces, not travel itineraries.
    track_rows = defaultdict(list)
    for mention in mentions:
        result = resolved.get(mention["historical_toponym"])
        if not result:
            continue
        for person in person_mentions_by_para.get(mention["paragraph_id"], []):
            for character_id, canonical in zip(person["character_ids"], person["canonical_names"]):
                track_rows[(character_id, canonical)].append((mention["chapter_order"], mention["paragraph_order"], Point(result["longitude"], result["latitude"]), mention, person, result))
    track_features = []
    for (character_id, canonical), rows in track_rows.items():
        rows.sort(key=lambda row: (row[0], row[1], row[3]["source_char_start"]))
        compact = []
        properties = []
        for _, _, point, mention, person, result in rows:
            pair = (point.x, point.y)
            if compact and compact[-1] == pair:
                continue
            compact.append(pair)
            properties.append({"chapter_id": mention["chapter_id"], "paragraph_id": mention["paragraph_id"], "place": mention["historical_toponym"], "source_sha256": mention["source_sha256"], "med_km": result.get("maximum_error_distance_km")})
        if len(compact) >= 2:
            from shapely.geometry import LineString
            track_features.append(_feature(LineString(compact), {
                "character_id": character_id, "character": canonical,
                "node_count": len(compact), "line_semantics": "straight segments connect source co-mentions in narrative order; not historical roads or a confirmed route",
                "nodes": json.dumps(properties, ensure_ascii=False),
                "coordinate_source": "His-Geo CHGIS; each node requires separate human meaning review",
            }))
    (out / "character_narrative_tracks.geojson").write_text(json.dumps(_feature_collection(track_features), ensure_ascii=False), encoding="utf-8")

    buffers = []
    buffer_counts = {}
    focus_names = [name for name in settings.get("focus_battlefields", FOCUS_BATTLEFIELDS) if name in resolved]
    if len(focus_names) < 3:
        counts = Counter(row["historical_toponym"] for event in events if event["event_type_candidate"] == "war" for row in place_mentions_by_para.get(event["paragraph_id"], []) if row["historical_toponym"] in resolved)
        for name, _ in counts.most_common(10):
            if name not in focus_names:
                focus_names.append(name)
            if len(focus_names) >= 3:
                break
    for name in focus_names:
        site = resolved.get(name)
        if not site:
            buffer_counts[name] = {"status": "NO_UNAMBIGUOUS_GEOCODE"}
            continue
        forward, reverse = _local_aeqd(float(site["longitude"]), float(site["latitude"]))
        center_x, center_y = forward.transform(float(site["longitude"]), float(site["latitude"]))
        for radius in settings.get("battle_buffer_radii_km", [10, 30, 50]):
            from shapely.ops import transform
            polygon = transform(reverse.transform, Point(center_x, center_y).buffer(radius * 1000, quad_segs=64))
            included = []
            for row in event_features:
                lon, lat = row["geometry"]["coordinates"]
                _, _, distance_m = WGS84.inv(float(site["longitude"]), float(site["latitude"]), lon, lat)
                if distance_m <= radius * 1000:
                    included.append(row["properties"]["event_id"])
            buffers.append(_feature(polygon, {
                "battlefield_name": name, "buffer_km": radius,
                "projection": f"local AEQD centred at {site['longitude']:.6f},{site['latitude']:.6f}; metric metres",
                "event_candidate_count_geodesic": len(set(included)),
                "event_candidates": json.dumps(sorted(set(included)), ensure_ascii=False),
                "origin_med_km": site.get("maximum_error_distance_km"),
                "interpretation": "analytical radius parameter; not a sourced historical area of influence",
                "site_identity_review": "UNREVIEWED",
            }))
        buffer_counts[name] = {"status": "COMPUTED", "buffer_count": 3, "source_med_km": site.get("maximum_error_distance_km")}
    (out / "battlefield_buffers.geojson").write_text(json.dumps(_feature_collection(buffers), ensure_ascii=False), encoding="utf-8")

    kde_features, kde_summary = _make_kde(
        battle_points,
        float(settings.get("battle_kde_bandwidth_km", 120)),
        float(settings.get("battle_kde_cell_km", 40)),
    )
    (out / "war_candidate_kde.geojson").write_text(json.dumps(_feature_collection(kde_features), ensure_ascii=False), encoding="utf-8")
    period_status_counts = Counter(
        result.get("historical_screen_period_status", "UNKNOWN")
        for result in geocodes if result.get("historical_screen_status") == "OK"
    )
    summary = {
        "method": "All analyses consume exact-name outputs and paragraph-level event candidates from the supplied novel; only unique successful coordinates enter mapped features.",
        "crs_source": "WGS84 lon/lat as supplied by the His-Geo adapter; historic CHGIS datum is upstream-marked ASSUMED_EPSG4326.",
        "geocoded_place_names": len(resolved),
        "historical_screened_place_names": len(resolved),
        "historical_screen_period_status_counts": dict(period_status_counts),
        "resolved_place_occurrence_features": len(place_features),
        "event_candidate_point_features": len(event_features),
        "war_candidate_point_features": len(battle_points),
        "character_narrative_track_count": len(track_features),
        "track_semantics": "source co-mention order and straight-line display only; no historical road network was supplied.",
        "battlefield_buffers": buffer_counts,
        "buffer_site_selection": "Use specified Red Cliffs/Guandu/Yiling names only when exact historic-gazetteer-only screening yields a unique coordinate; otherwise use the three most frequently co-mentioned unique historic-gazetteer candidates in war-trigger paragraphs and record them as fallback candidates.",
        "kde": kde_summary,
        "spatial_join_method_for_buffers": "WGS84 ellipsoidal Geod.inv distances to event candidate points; buffer polygon generated in local AEQD metres.",
        "historical_interpretation": "All mapped results are literary-text candidates. The layers do not establish real battle locations or historical event frequencies.",
        "geojson_layers": ["place_mentions_resolved.geojson", "event_candidates_resolved.geojson", "character_narrative_tracks.geojson", "battlefield_buffers.geojson", "war_candidate_kde.geojson"],
    }
    summary["geopackage"] = _write_geopackage(project_root, summary["geojson_layers"])
    _write_json(project_root / "outputs" / "analysis" / "analysis_summary.json", summary)
    return summary


def _write_geopackage(project_root: Path, filenames: list[str]):
    try:
        import geopandas as gpd
    except ImportError:
        return {"status": "NOT_AVAILABLE", "reason": "geopandas is not installed"}
    target = project_root / "data" / "spatial" / "sanguo_analysis.gpkg"
    if target.exists():
        target.unlink()
    written = []
    for filename in filenames:
        source = project_root / "outputs" / "geojson" / filename
        try:
            gdf = gpd.read_file(source)
            if gdf.crs is None:
                gdf = gdf.set_crs("EPSG:4326")
            layer = filename.removesuffix(".geojson")
            gdf.to_file(target, layer=layer, driver="GPKG", mode="w" if not written else "a")
            written.append(layer)
        except Exception as exc:
            return {"status": "PARTIAL", "written_layers": written, "failed_file": filename, "error": f"{type(exc).__name__}: {exc}"}
    return {"status": "WRITTEN", "path": str(target), "layers": written}
