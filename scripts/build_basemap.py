from __future__ import annotations

import hashlib
import json
import tempfile
import zipfile
from datetime import date
from pathlib import Path, PurePosixPath

import geopandas as gpd
import pyogrio
from shapely.geometry import box, mapping


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "basemap" / "natural_earth" / "source"
OUTPUT = ROOT / "frontend" / "data" / "basemap"
MANIFEST = ROOT / "data" / "basemap" / "natural_earth" / "manifest.json"
BBOX = (72.0, 15.0, 135.0, 55.0)
CLIP = box(*BBOX)
DATASETS = {
    "countries": ("ne_10m_admin_0_countries.zip", "ne_10m_admin_0_countries.shp", 0.025),
    "provinces": ("ne_10m_admin_1_states_provinces.zip", "ne_10m_admin_1_states_provinces.shp", 0.018),
    "rivers": ("ne_10m_rivers_lake_centerlines.zip", "ne_10m_rivers_lake_centerlines.shp", 0.012),
    "lakes": ("ne_10m_lakes.zip", "ne_10m_lakes.shp", 0.012),
}
SOURCE_URLS = {
    "ne_10m_admin_0_countries.zip": "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_countries.zip",
    "ne_10m_admin_1_states_provinces.zip": "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip",
    "ne_10m_rivers_lake_centerlines.zip": "https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_rivers_lake_centerlines.zip",
    "ne_10m_lakes.zip": "https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_lakes.zip",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract_layer(archive_path: Path, layer_filename: str, target: Path) -> Path:
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        stem = Path(layer_filename).stem
        matching = [name for name in names if Path(name).stem == stem]
        if not any(name.endswith(".shp") for name in matching):
            raise FileNotFoundError(f"{layer_filename} not found in {archive_path.name}")
        for member in matching:
            posix = PurePosixPath(member)
            if posix.is_absolute() or ".." in posix.parts:
                raise ValueError(f"Unsafe archive path: {member}")
            archive.extract(member, target)
    candidates = list(target.rglob(layer_filename))
    if len(candidates) != 1:
        raise RuntimeError(f"Expected one extracted {layer_filename}, found {len(candidates)}")
    return candidates[0]


def pick_columns(frame: gpd.GeoDataFrame, columns: tuple[str, ...]) -> gpd.GeoDataFrame:
    available = {str(column).casefold(): str(column) for column in frame.columns}
    selected = [available[column.casefold()] for column in columns if column.casefold() in available]
    frame = frame[selected + ["geometry"]].copy()
    return frame.rename(columns={column: column.casefold() for column in selected})


def crop_and_simplify(frame: gpd.GeoDataFrame, tolerance: float) -> gpd.GeoDataFrame:
    if frame.crs is None:
        raise ValueError("Natural Earth layer has no CRS")
    frame = frame.to_crs("EPSG:4326")
    frame = frame[frame.geometry.notna() & ~frame.geometry.is_empty]
    frame = frame[frame.geometry.intersects(CLIP)].copy()
    frame["geometry"] = frame.geometry.intersection(CLIP).simplify(tolerance, preserve_topology=True)
    frame = frame[frame.geometry.notna() & ~frame.geometry.is_empty].copy()
    frame = frame[frame.geometry.is_valid].copy()
    return frame


def records(frame: gpd.GeoDataFrame) -> dict:
    features = []
    for row in frame.itertuples(index=False):
        props = {}
        for column in frame.columns:
            if column == "geometry":
                continue
            value = getattr(row, column)
            if value is None:
                continue
            try:
                if value != value:  # NaN
                    continue
            except (TypeError, ValueError):
                pass
            if hasattr(value, "item"):
                value = value.item()
            if isinstance(value, (str, int, float, bool)):
                props[column.lower()] = value
            else:
                props[column.lower()] = str(value)
        features.append({"type": "Feature", "properties": props, "geometry": mapping(row.geometry)})
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    baseline = {}
    for name, (archive_name, shapefile_name, tolerance) in DATASETS.items():
        archive_path = SOURCE / archive_name
        if not archive_path.is_file():
            raise FileNotFoundError(f"Missing source archive: {archive_path}")
        with tempfile.TemporaryDirectory(prefix="sanguo-basemap-") as temporary:
            shapefile = safe_extract_layer(archive_path, shapefile_name, Path(temporary))
            source_frame = pyogrio.read_dataframe(shapefile, bbox=BBOX)
        if source_frame.crs is None:
            raise ValueError(f"No CRS on Natural Earth layer {name}")
        source_crs = str(source_frame.crs)
        source_columns = list(source_frame.columns)

        if name == "provinces":
            admin_column = next((column for column in source_frame.columns if column.lower() in {"admin", "admin_0"}), None)
            if admin_column is None:
                raise KeyError(f"Cannot identify country field in provinces layer: {source_columns}")
            source_frame = source_frame[source_frame[admin_column].astype(str).str.casefold() == "china"].copy()
            if source_frame.empty:
                raise ValueError(f"No China admin-1 features found; country field was {admin_column}")
            available = set(source_frame.columns)
            properties = tuple(column for column in ("name", "name_zh", "admin", "type", "postal", "iso_3166_2", "latitude", "longitude", "labelrank") if column in available)
        elif name == "countries":
            properties = ("admin", "name", "name_zh", "type", "region_un")
        elif name == "rivers":
            properties = ("name", "name_zh", "featurecla", "scalerank")
        else:
            properties = ("name", "name_zh", "featurecla", "scalerank", "lake_type")

        frame = crop_and_simplify(source_frame, tolerance)
        frame = pick_columns(frame, properties)
        output_path = OUTPUT / f"{name}.geojson"
        payload = records(frame)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        baseline[name] = {
            "source_archive": archive_name,
            "source_url": SOURCE_URLS[archive_name],
            "source_sha256": sha256(archive_path),
            "source_crs": source_crs,
            "source_feature_count_in_bbox": int(len(source_frame)),
            "output_feature_count": len(payload["features"]),
            "simplification_tolerance_degrees": tolerance,
            "output_path": output_path.relative_to(ROOT).as_posix(),
            "output_sha256": sha256(output_path),
            "output_bytes": output_path.stat().st_size,
            "source_fields": source_columns,
        }

    manifest = {
        "dataset": "Natural Earth 1:10m vector basemap",
        "dataset_version": {"admin_0": "5.1.1", "admin_1": "5.1.1", "rivers": "5.0.0", "lakes": "5.0.0"},
        "retrieved_date": date.today().isoformat(),
        "license": "Public domain per Natural Earth Terms of Use",
        "license_url": "https://www.naturalearthdata.com/about/terms-of-use/",
        "citation": "Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.",
        "source_page": "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/",
        "physical_source_page": "https://www.naturalearthdata.com/downloads/10m-physical-vectors/",
        "extent_wgs84": list(BBOX),
        "included_layers": ["countries", "China admin-1 provinces", "rivers", "lakes"],
        "historical_warning": "Natural Earth country and province borders are modern orientation context, not Three Kingdoms period boundaries or historical event locations.",
        "offline_policy": "All browser-visible basemap features are served from local project GeoJSON; no tile server is used.",
        "layers": baseline,
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "layers": {key: value["output_feature_count"] for key, value in baseline.items()}, "manifest": MANIFEST.relative_to(ROOT).as_posix()}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
