from __future__ import annotations

import hashlib
import json
from pathlib import Path

from shapely import make_valid
from shapely.geometry import mapping, shape


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "basemap" / "china_admin_2024" / "source"
OUTPUT = ROOT / "frontend" / "data" / "basemap" / "china_admin_2024"
MANIFEST = ROOT / "data" / "basemap" / "china_admin_2024" / "manifest.json"
LAYERS = {
    "province": ("provinces.geojson", 0.008),
    "city": ("cities.geojson", 0.008),
    "county": ("counties.geojson", 0.01),
}
CRS = "EPSG:4490"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        "dataset": "User-provided 2024 China provincial, prefectural, and county administrative boundaries",
        "approval_number": "GS（2024）0650号",
        "source_directory_as_provided": "D:\\202405更新_2024年省市县三级行政区划数据（审图号：GS（2024）0650号）\\geojson格式的原数据",
        "source_crs": CRS,
        "coordinate_handling": "Source longitude/latitude values retained; Leaflet displays angular coordinates. EPSG:4490 (CGCS2000) is not mislabeled as the project gazetteer's EPSG:4326; no datum transformation is applied.",
        "processing": "Per-feature topology-preserving Shapely simplification for browser display; original source GeoJSON files copied unchanged under source/.",
        "historical_warning": "These are 2024 current administrative boundaries, for modern geographic orientation only; they do not represent Three Kingdoms period boundaries.",
        "layers": {},
    }
    for layer_name, (source_name, tolerance) in LAYERS.items():
        source_path = SOURCE / source_name
        source = json.loads(source_path.read_text(encoding="utf-8"))
        features = []
        repaired_features = []
        for index, feature in enumerate(source.get("features", [])):
            geometry = shape(feature["geometry"])
            if geometry.is_empty:
                raise ValueError(f"Empty {layer_name} geometry at feature {index}")
            if not geometry.is_valid:
                geometry = make_valid(geometry)
                repaired_features.append({
                    "feature_index": index,
                    "name": feature.get("properties", {}).get("name"),
                    "method": "shapely.make_valid on invalid source ring; raw source preserved unchanged",
                })
            simplified = geometry.simplify(tolerance, preserve_topology=True)
            if simplified.is_empty or not simplified.is_valid:
                raise ValueError(f"Simplification produced invalid {layer_name} geometry at feature {index}")
            features.append({
                "type": "Feature",
                "id": feature.get("id", feature.get("properties", {}).get("gb")),
                "properties": {
                    "name": feature.get("properties", {}).get("name"),
                    "gb": feature.get("properties", {}).get("gb"),
                },
                "geometry": mapping(simplified),
            })
        collection = {
            "type": "FeatureCollection",
            "name": f"China 2024 {layer_name} administrative boundaries",
            "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{CRS.split(':')[1]}"}},
            "features": features,
        }
        output_path = OUTPUT / f"{layer_name}.geojson"
        output_path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        manifest["layers"][layer_name] = {
            "source_file": source_name,
            "source_sha256": sha256(source_path),
            "source_feature_count": len(source.get("features", [])),
            "output_file": output_path.relative_to(ROOT).as_posix(),
            "output_sha256": sha256(output_path),
            "output_feature_count": len(features),
            "simplification_tolerance_degrees": tolerance,
            "source_invalid_geometries_repaired_for_display": repaired_features,
        }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "manifest": str(MANIFEST), "layers": manifest["layers"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
