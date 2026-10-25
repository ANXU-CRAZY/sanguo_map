from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from src.corpus.ingest import read_jsonl


SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS chapters (
 chapter_id TEXT PRIMARY KEY, source_ordinal INTEGER NOT NULL UNIQUE,
 original_title TEXT NOT NULL, source_filename TEXT NOT NULL,
 source_sha256 TEXT NOT NULL, body TEXT NOT NULL, chapter_mapping_status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paragraphs (
 paragraph_id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(chapter_id),
 paragraph_order INTEGER NOT NULL, source_byte_start INTEGER NOT NULL, source_byte_end INTEGER NOT NULL,
 source_sha256 TEXT NOT NULL, text TEXT NOT NULL, UNIQUE(chapter_id, paragraph_order)
);
CREATE TABLE IF NOT EXISTS characters (
 character_id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL, faction_seed TEXT,
 identity_status TEXT NOT NULL, birth_year INTEGER, death_year INTEGER
);
CREATE TABLE IF NOT EXISTS character_aliases (
 character_id TEXT NOT NULL REFERENCES characters(character_id), alias TEXT NOT NULL,
 PRIMARY KEY(character_id, alias)
);
CREATE TABLE IF NOT EXISTS character_mentions (
 mention_id TEXT PRIMARY KEY, paragraph_id TEXT NOT NULL REFERENCES paragraphs(paragraph_id),
 surface_form TEXT NOT NULL, source_char_start INTEGER NOT NULL, source_char_end INTEGER NOT NULL,
 identity_status TEXT NOT NULL, canonical_names_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS character_mention_entities (
 mention_id TEXT NOT NULL REFERENCES character_mentions(mention_id),
 character_id TEXT NOT NULL REFERENCES characters(character_id),
 PRIMARY KEY(mention_id, character_id)
);
CREATE TABLE IF NOT EXISTS places (
 place_id TEXT PRIMARY KEY, historical_toponym TEXT NOT NULL UNIQUE,
 geocode_status TEXT NOT NULL, longitude REAL, latitude REAL,
 med_km REAL, historical_meaning_review TEXT NOT NULL,
 matched_period TEXT, algorithm_mode TEXT
);
CREATE TABLE IF NOT EXISTS place_mentions (
 mention_id TEXT PRIMARY KEY, place_id TEXT NOT NULL REFERENCES places(place_id),
 paragraph_id TEXT NOT NULL REFERENCES paragraphs(paragraph_id),
 source_char_start INTEGER NOT NULL, source_char_end INTEGER NOT NULL,
 source_byte_start INTEGER NOT NULL, source_byte_end INTEGER NOT NULL,
 extractor TEXT NOT NULL, candidate_ids_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gazetteer_candidates (
 place_id TEXT NOT NULL REFERENCES places(place_id), gazetteer_id TEXT NOT NULL,
 level TEXT, valid_from INTEGER, valid_to INTEGER, longitude REAL, latitude REAL,
 source TEXT NOT NULL, PRIMARY KEY(place_id, gazetteer_id)
);
CREATE TABLE IF NOT EXISTS time_expressions (
 time_id TEXT PRIMARY KEY, paragraph_id TEXT NOT NULL REFERENCES paragraphs(paragraph_id),
 original_expression TEXT NOT NULL, year_start INTEGER, year_end INTEGER,
 narrative_order INTEGER NOT NULL, time_source TEXT NOT NULL, confidence TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 event_id TEXT PRIMARY KEY, paragraph_id TEXT NOT NULL REFERENCES paragraphs(paragraph_id),
 candidate_type TEXT NOT NULL, narrative_order INTEGER NOT NULL, trigger_surface TEXT,
 summary TEXT NOT NULL, review_status TEXT NOT NULL, historical_status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event_character_mentions (
 event_id TEXT NOT NULL REFERENCES events(event_id), mention_id TEXT NOT NULL REFERENCES character_mentions(mention_id),
 relation_status TEXT NOT NULL, PRIMARY KEY(event_id, mention_id)
);
CREATE TABLE IF NOT EXISTS event_place_mentions (
 event_id TEXT NOT NULL REFERENCES events(event_id), mention_id TEXT NOT NULL REFERENCES place_mentions(mention_id),
 relation_status TEXT NOT NULL, PRIMARY KEY(event_id, mention_id)
);
CREATE TABLE IF NOT EXISTS event_time_expressions (
 event_id TEXT NOT NULL REFERENCES events(event_id), time_id TEXT NOT NULL REFERENCES time_expressions(time_id),
 relation_status TEXT NOT NULL, PRIMARY KEY(event_id,time_id)
);
CREATE TABLE IF NOT EXISTS geocode_traces (
 place_id TEXT PRIMARY KEY REFERENCES places(place_id), algorithm_mode TEXT NOT NULL,
 match_status TEXT NOT NULL, geocode_status TEXT NOT NULL,
 trace_json TEXT NOT NULL, source_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS historic_gazetteer_screens (
 place_id TEXT PRIMARY KEY REFERENCES places(place_id),
 screen_status TEXT NOT NULL, period_status TEXT NOT NULL,
 longitude REAL, latitude REAL, med_km REAL,
 candidates_json TEXT NOT NULL, candidate_periods_json TEXT NOT NULL,
 trace_json TEXT NOT NULL, analysis_window_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paragraph_chapter ON paragraphs(chapter_id, paragraph_order);
CREATE INDEX IF NOT EXISTS idx_event_order ON events(narrative_order);
CREATE INDEX IF NOT EXISTS idx_place_mention_place ON place_mentions(place_id);
CREATE INDEX IF NOT EXISTS idx_character_mention_entity ON character_mention_entities(character_id);
"""


def build_database(project_root: Path) -> dict:
    processed = project_root / "data" / "processed"
    extracted = project_root / "data" / "extracted"
    chapters = json.loads((processed / "chapters.json").read_text(encoding="utf-8"))
    paragraphs = read_jsonl(processed / "paragraphs.jsonl")
    characters = json.loads((extracted / "characters.json").read_text(encoding="utf-8"))
    places = json.loads((extracted / "places.json").read_text(encoding="utf-8"))
    people_mentions = read_jsonl(extracted / "character_mentions.jsonl")
    place_mentions = read_jsonl(extracted / "place_mentions.jsonl")
    times = read_jsonl(extracted / "time_expressions.jsonl")
    events = read_jsonl(extracted / "event_candidates.jsonl")
    geocodes = read_jsonl(extracted / "geocoding_results.jsonl") if (extracted / "geocoding_results.jsonl").exists() else []
    geo_by_id = {row.get("project_place_id"): row for row in geocodes}
    for place in places:
        result = geo_by_id.get(place["place_id"])
        if result:
            place.update({key: result.get(key) for key in ("geocode_status", "longitude", "latitude", "maximum_error_distance_km", "match_status", "matched_period", "algorithm_mode")})

    db_path = project_root / "database" / "sanguo_spacetime.sqlite"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as con:
        con.executescript(SCHEMA)
        place_columns = {row[1] for row in con.execute("PRAGMA table_info(places)")}
        if "matched_period" not in place_columns:
            con.execute("ALTER TABLE places ADD COLUMN matched_period TEXT")
        if "algorithm_mode" not in place_columns:
            con.execute("ALTER TABLE places ADD COLUMN algorithm_mode TEXT")
        for table in ("event_place_mentions", "event_character_mentions", "event_time_expressions", "historic_gazetteer_screens", "geocode_traces", "time_expressions", "events", "gazetteer_candidates", "place_mentions", "places", "character_mention_entities", "character_mentions", "character_aliases", "characters", "paragraphs", "chapters"):
            con.execute(f"DELETE FROM {table}")
        con.executemany("INSERT INTO chapters VALUES (?,?,?,?,?,?,?)", [(
            row["chapter_id"], row["source_ordinal"], row["original_title"], row["source_filename"],
            row["source_sha256"], row["body"], row["chapter_mapping_status"]) for row in chapters])
        con.executemany("INSERT INTO paragraphs VALUES (?,?,?,?,?,?,?)", [(
            row["paragraph_id"], row["chapter_id"], row["paragraph_order"], row["source_byte_start"],
            row["source_byte_end"], row["source_sha256"], row["text"]) for row in paragraphs])
        con.executemany("INSERT INTO characters VALUES (?,?,?,?,?,?)", [(
            row["character_id"], row["canonical_name"], row.get("faction_seed"), row["identity_status"], row.get("birth_year"), row.get("death_year")) for row in characters])
        con.executemany("INSERT INTO character_aliases VALUES (?,?)", [(row["character_id"], alias) for row in characters for alias in row["aliases"]])
        con.executemany("INSERT INTO character_mentions VALUES (?,?,?,?,?,?,?)", [(
            row["mention_id"], row["paragraph_id"], row["surface_form"], row["source_char_start"], row["source_char_end"], row["identity_status"], json.dumps(row["canonical_names"], ensure_ascii=False)) for row in people_mentions])
        con.executemany("INSERT INTO character_mention_entities VALUES (?,?)", [(row["mention_id"], ident) for row in people_mentions for ident in row["character_ids"]])
        con.executemany("INSERT INTO places (place_id,historical_toponym,geocode_status,longitude,latitude,med_km,historical_meaning_review,matched_period,algorithm_mode) VALUES (?,?,?,?,?,?,?,?,?)", [(
            row["place_id"], row["historical_toponym"], row.get("geocode_status", "NOT_RUN"), row.get("longitude"), row.get("latitude"), row.get("maximum_error_distance_km"), row.get("historical_meaning_review", "UNREVIEWED"), row.get("matched_period"), row.get("algorithm_mode")) for row in places])
        con.executemany("INSERT INTO place_mentions VALUES (?,?,?,?,?,?,?,?,?)", [(
            row["mention_id"], row["place_id"], row["paragraph_id"], row["source_char_start"], row["source_char_end"], row["source_byte_start"], row["source_byte_end"], row["extractor"], json.dumps(row["gazetteer_candidate_ids"])) for row in place_mentions])
        con.executemany("INSERT OR IGNORE INTO gazetteer_candidates VALUES (?,?,?,?,?,?,?,?)", [(
            place["place_id"], candidate["gazetteer_id"], candidate.get("level"), candidate.get("valid_from"), candidate.get("valid_to"), candidate.get("longitude"), candidate.get("latitude"), candidate["source"]) for place in places for candidate in place["gazetteer_candidates"]])
        con.executemany("INSERT INTO time_expressions VALUES (?,?,?,?,?,?,?,?)", [(
            row["time_id"], row["paragraph_id"], row["original_temporal_expression"], row.get("year_start"), row.get("year_end"), row["narrative_order"], row["time_source"], row["temporal_confidence"]) for row in times])
        con.executemany("INSERT INTO events VALUES (?,?,?,?,?,?,?,?)", [(
            row["event_id"], row["paragraph_id"], row["event_type_candidate"], row["narrative_order"], row.get("trigger_surface"), row["candidate_summary"], row["event_review_status"], row["historical_status"]) for row in events])
        con.executemany("INSERT INTO event_time_expressions VALUES (?,?,?)", [
            (event["event_id"], time_id, "SAME_PARAGRAPH_TEMPORAL_EXPRESSION_CANDIDATE")
            for event in events for time_id in event.get("candidate_time_ids", [])])
        person_by_paragraph = {}
        for row in people_mentions:
            person_by_paragraph.setdefault(row["paragraph_id"], []).append(row)
        place_by_paragraph = {}
        for row in place_mentions:
            place_by_paragraph.setdefault(row["paragraph_id"], []).append(row)
        con.executemany("INSERT INTO event_character_mentions VALUES (?,?,?)", [
            (event["event_id"], mention["mention_id"], "SAME_PARAGRAPH_CO_MENTION_CANDIDATE")
            for event in events for mention in person_by_paragraph.get(event["paragraph_id"], [])])
        con.executemany("INSERT INTO event_place_mentions VALUES (?,?,?)", [
            (event["event_id"], mention["mention_id"], "SAME_PARAGRAPH_CO_MENTION_CANDIDATE")
            for event in events for mention in place_by_paragraph.get(event["paragraph_id"], [])])
        con.executemany("INSERT INTO geocode_traces VALUES (?,?,?,?,?,?)", [(
            row["project_place_id"], row.get("algorithm_mode", "unknown"), row.get("match_status", "unknown"), row.get("geocode_status", "unknown"), json.dumps(row.get("trace", {}), ensure_ascii=False), json.dumps({key: row.get(key) for key in ("historical_toponym", "location_reference", "matched_gazetteer", "matched_administrative_level", "matched_period", "maximum_error_distance_km", "coordinate_datum_note")}, ensure_ascii=False)) for row in geocodes if row.get("project_place_id")])
        con.executemany("INSERT INTO historic_gazetteer_screens VALUES (?,?,?,?,?,?,?,?,?,?)", [(
            row["project_place_id"], row.get("historical_screen_status", "UNKNOWN"), row.get("historical_screen_period_status", "UNKNOWN"), row.get("historical_screen_longitude"), row.get("historical_screen_latitude"), row.get("historical_screen_med_km"), json.dumps(row.get("historical_screen_candidates", []), ensure_ascii=False), json.dumps(row.get("historical_screen_candidate_periods", []), ensure_ascii=False), json.dumps(row.get("historical_screen_trace", {}), ensure_ascii=False), json.dumps(row.get("historical_screen_window"), ensure_ascii=False)) for row in geocodes if row.get("project_place_id")])
        con.commit()
        counts = {table: con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in ("chapters", "paragraphs", "characters", "character_mentions", "places", "place_mentions", "time_expressions", "events", "event_time_expressions", "geocode_traces", "historic_gazetteer_screens")}
    return {"database": str(db_path), "counts": counts}
