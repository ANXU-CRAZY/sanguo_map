from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from .automaton import AhoCorasick
from src.corpus.ingest import read_jsonl


TIME_RE = re.compile(
    r"(?:建宁|光和|中平|熹平|初平|兴平|建安|延康|黄初|太和|青龙|景初|正始|嘉平|正元|甘露|景元|咸熙|章武|建兴|延熙|景耀|炎兴|永安|赤乌|黄武|嘉禾|太元|天纪|咸宁|太康|永元)(?:元年|[一二三四五六七八九十百两〇零]{1,3}年)?|[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]年|(?:次日|翌日|明日|数日后|不日|当年|次年)"
)
EVENT_PATTERNS = [
    ("war", re.compile(r"交战|鏖兵|大战|战于|迎战|战败|兵败|围城|攻取|攻打|进兵|破敌|破城|杀败|擒获|伏兵|交锋|出战|退兵|兵至|兵来|军马|引兵|水淹|火烧")),
    ("alliance", re.compile(r"结盟|联盟|合兵|联兵|约为|结亲|和亲|讲和|相约|盟誓|共拒")),
    ("appointment", re.compile(r"封为|拜为|任命|授.*太守|即位|称帝|登基|改元|进位|受禅")),
    ("politics", re.compile(r"下诏|上表|奏曰|诏曰|朝见|议立|商议|迁都|献城|投降|归降|废帝|篡位")),
    ("death", re.compile(r"病故|病死|自刎|身死|殒命|被斩|处斩|斩之|卒于|死于|临终|气绝|而卒")),
    ("movement", re.compile(r"移师|渡江|渡河|迁往|退至|奔往|投奔|屯兵|扎营|行至|进驻|出征|回军|班师|入城|出城")),
]
GENERIC_PLACE_NAMES = {"江东", "天下", "中原", "四方", "朝廷", "大军", "军中", "山中", "河边", "境内", "本地", "途中", "城中", "阵前", "阵中", "帐中", "营中"}


def _write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _stable(prefix: str, value: str) -> str:
    return f"{prefix}_{hashlib.sha256(value.encode('utf-8')).hexdigest()[:12]}"


def load_gazetteer(path: Path) -> dict[str, list[dict]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    names: dict[str, list[dict]] = defaultdict(list)
    for feature in payload.get("features", []):
        properties = feature.get("properties", {})
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates")
        if geometry.get("type") != "Point" or not coords or len(coords) < 2:
            continue
        record = {
            "gazetteer_id": str(properties.get("id")),
            "name": properties.get("name"),
            "level": properties.get("level"),
            "parent_id": properties.get("parent_id"),
            "aliases": properties.get("aliases") or [],
            "valid_from": properties.get("valid_from"),
            "valid_to": properties.get("valid_to"),
            "longitude": coords[0],
            "latitude": coords[1],
            "source": "His-Geo pinned CHGIS historic gazetteer cache; CRS marked ASSUMED_EPSG4326 by upstream loader",
        }
        for name in {record["name"], *record["aliases"]}:
            if isinstance(name, str) and len(name.strip()) >= 2:
                names[name.strip()].append(record)
    return dict(names)


def extract_all(project_root: Path, paragraphs_path: Path, gazetteer_path: Path, seeds_path: Path, place_seeds_path: Path) -> dict:
    paragraphs = read_jsonl(paragraphs_path)
    gazetteer_names = load_gazetteer(gazetteer_path)
    place_term_provenance = {name: "HISGEO_HISTORIC_GAZETTEER_EXACT_SURFACE" for name in gazetteer_names if name not in GENERIC_PLACE_NAMES}
    place_seed_data = json.loads(place_seeds_path.read_text(encoding="utf-8"))
    for name in place_seed_data.get("terms", []):
        place_term_provenance.setdefault(name, "USER_SPECIFIED_NARRATIVE_PLACE_SEED_EXACT_SURFACE")
    place_terms = {name: name for name in place_term_provenance}
    place_matcher = AhoCorasick(place_terms)

    seeds = json.loads(seeds_path.read_text(encoding="utf-8"))
    characters = []
    aliases: dict[str, list[dict]] = defaultdict(list)
    for item in seeds["characters"]:
        character_id = _stable("person", item["canonical_name"])
        character = {
            "character_id": character_id,
            "canonical_name": item["canonical_name"],
            "aliases": sorted(set(item["aliases"])),
            "faction_seed": item.get("faction"),
            "source_provenance": "project_authored_alias_seed_dictionary; evidence accepted only from direct corpus matches",
            "identity_status": "CURATED_SEED_UNVERIFIED_AS_HISTORICAL_IDENTITY",
            "birth_year": None,
            "death_year": None,
        }
        characters.append(character)
        for alias in character["aliases"]:
            aliases[alias].append(character)
    person_matcher = AhoCorasick(dict(aliases))

    place_mentions, person_mentions, times, events = [], [], [], []
    place_counts, place_paragraphs, person_counts, event_counts = Counter(), defaultdict(set), Counter(), Counter()
    for paragraph in paragraphs:
        text = paragraph["text"]
        chapter_id = paragraph["chapter_id"]
        chapter_order = paragraph["chapter_order"]
        paragraph_id = paragraph["paragraph_id"]
        paragraph_places, paragraph_people = [], []
        place_hits = list(place_matcher.finditer(text))
        paragraph_time_ids = []
        # Prefer the longest exact gazetteer name at a shared start location.
        best_at_start = {}
        for hit in place_hits:
            start, end, name, _ = hit
            current = best_at_start.get(start)
            if current is None or end - start > current[1] - current[0]:
                best_at_start[start] = (start, end, name)
        selected = sorted(best_at_start.values())
        accepted, last_end = [], -1
        for start, end, name in selected:
            if start < last_end:
                continue
            accepted.append((start, end, name))
            last_end = end
        for start, end, name in accepted:
            records = gazetteer_names.get(name, [])
            mention_id = _stable("pm", f"{paragraph_id}:{start}:{name}")
            place_id = _stable("place", name)
            mention = {
                "mention_id": mention_id,
                "place_id": place_id,
                "historical_toponym": name,
                "paragraph_id": paragraph_id,
                "chapter_id": chapter_id,
                "chapter_order": chapter_order,
                "paragraph_order": paragraph["paragraph_order"],
                "mention_char_start_in_paragraph": start,
                "mention_char_end_in_paragraph": end,
                "source_char_start": paragraph["source_char_start"] + start,
                "source_char_end": paragraph["source_char_start"] + end,
                "source_byte_start": paragraph["source_byte_start"] + len(text[:start].encode("utf-8")),
                "source_byte_end": paragraph["source_byte_start"] + len(text[:end].encode("utf-8")),
                "source_file": paragraph["source_file"],
                "source_sha256": paragraph["source_sha256"],
                "extractor": f"Aho-Corasick exact surface match; {place_term_provenance[name]}",
                "gazetteer_candidate_ids": sorted({record["gazetteer_id"] for record in records}),
                "gazetteer_candidate_count": len({record["gazetteer_id"] for record in records}),
                "geocode_status": "NOT_RUN",
                "historical_meaning_review": "UNREVIEWED",
            }
            place_mentions.append(mention)
            paragraph_places.append(mention)
            place_counts[name] += 1
            place_paragraphs[name].add(paragraph_id)

        person_hits = list(person_matcher.finditer(text))
        person_starts = {}
        for start, end, alias, _ in person_hits:
            current = person_starts.get(start)
            if current is None or end - start > current[1] - current[0]:
                person_starts[start] = (start, end, alias)
        last_end = -1
        for start, end, alias in sorted(person_starts.values()):
            if start < last_end:
                continue
            last_end = end
            matches = aliases[alias]
            mention = {
                "mention_id": _stable("cm", f"{paragraph_id}:{start}:{alias}"),
                "paragraph_id": paragraph_id,
                "chapter_id": chapter_id,
                "chapter_order": chapter_order,
                "character_ids": [row["character_id"] for row in matches],
                "surface_form": alias,
                "canonical_names": [row["canonical_name"] for row in matches],
                "identity_status": "AMBIGUOUS_SEED_ALIAS" if len(matches) > 1 else "TEXT_MATCH_IDENTITY_UNREVIEWED",
                "mention_char_start_in_paragraph": start,
                "mention_char_end_in_paragraph": end,
                "source_char_start": paragraph["source_char_start"] + start,
                "source_char_end": paragraph["source_char_start"] + end,
                "source_file": paragraph["source_file"],
                "source_sha256": paragraph["source_sha256"],
                "extractor": "exact alias dictionary match against supplied corpus",
            }
            person_mentions.append(mention)
            paragraph_people.append(mention)
            person_counts[alias] += 1

        for match in TIME_RE.finditer(text):
            time_row = {
                "time_id": _stable("time", f"{paragraph_id}:{match.start()}:{match.group(0)}"),
                "paragraph_id": paragraph_id,
                "chapter_id": chapter_id,
                "chapter_order": chapter_order,
                "original_temporal_expression": match.group(0),
                "year_start": None,
                "year_end": None,
                "narrative_order": (chapter_order * 1_000_000) + paragraph["paragraph_order"],
                "time_source": "EXPLICIT_TEXT_UNMAPPED_TO_GREGORIAN",
                "temporal_confidence": "TEXT_SPAN_EXACT_CALENDAR_INTERPRETATION_UNKNOWN",
                "source_sha256": paragraph["source_sha256"],
            }
            times.append(time_row)
            paragraph_time_ids.append(time_row["time_id"])

        category = next((name for name, pattern in EVENT_PATTERNS if pattern.search(text)), None)
        if category:
            participant_mentions = paragraph_people
            location_mentions = paragraph_places
            event_id = f"ev_{paragraph_id}"
            trigger = next((pattern.search(text).group(0) for name, pattern in EVENT_PATTERNS if name == category and pattern.search(text)), None)
            events.append({
                "event_id": event_id,
                "event_type_candidate": category,
                "candidate_label": f"{category.upper()}_PARAGRAPH_CANDIDATE",
                "paragraph_id": paragraph_id,
                "chapter_id": chapter_id,
                "chapter_order": chapter_order,
                "paragraph_order": paragraph["paragraph_order"],
                "narrative_order": (chapter_order * 1_000_000) + paragraph["paragraph_order"],
                "trigger_surface": trigger,
                "candidate_summary": text[:220],
                "source_excerpt": text,
                "source_file": paragraph["source_file"],
                "source_sha256": paragraph["source_sha256"],
                "candidate_person_ids": sorted({person_id for row in participant_mentions for person_id in row["character_ids"]}),
                "candidate_place_mention_ids": [row["mention_id"] for row in location_mentions],
                "candidate_time_ids": paragraph_time_ids,
                "event_review_status": "AUTOMATED_CANDIDATE_REQUIRES_HUMAN_EVENT_SEGMENTATION",
                "historical_status": "NARRATIVE_FICTION_NOT_HISTORICAL_EVENT_VERIFICATION",
            })
            event_counts[category] += 1

    output = project_root / "data" / "extracted"
    _write_json(output / "characters.json", characters)
    _write_jsonl(output / "character_mentions.jsonl", person_mentions)
    _write_jsonl(output / "place_mentions.jsonl", place_mentions)
    _write_json(output / "places.json", [
        {
            "place_id": _stable("place", name),
            "historical_toponym": name,
            "mention_count": count,
            "paragraph_count": len(place_paragraphs[name]),
            "gazetteer_candidates": gazetteer_names.get(name, []),
            "seed_provenance": place_term_provenance[name],
            "geocode_status": "NOT_RUN",
            "historical_meaning_review": "UNREVIEWED",
        }
        for name, count in place_counts.most_common()
    ])
    _write_jsonl(output / "time_expressions.jsonl", times)
    _write_jsonl(output / "event_candidates.jsonl", events)
    summary = {
        "chapter_count_processed": len({row["chapter_id"] for row in paragraphs}),
        "paragraph_count_processed": len(paragraphs),
        "gazetteer_surface_terms": len(place_terms),
        "user_specified_place_seed_count": len(place_seed_data.get("terms", [])),
        "user_specified_place_seed_mentions": sum(count for name, count in place_counts.items() if place_term_provenance.get(name) == "USER_SPECIFIED_NARRATIVE_PLACE_SEED_EXACT_SURFACE"),
        "place_mention_count": len(place_mentions),
        "distinct_toponym_count": len(place_counts),
        "character_seed_count": len(characters),
        "character_mention_count": len(person_mentions),
        "distinct_character_surface_count": len(person_counts),
        "time_expression_count": len(times),
        "event_candidate_count": len(events),
        "event_candidates_by_type": dict(event_counts),
        "extraction_method": "Deterministic exact gazetteer/alias dictionary matching and paragraph trigger rules. No model/API inference was run.",
        "interpretation_limit": "Names and events are text-grounded candidate records, not human-validated entity resolution, historical geocoding, event segmentation, or historical fact claims.",
    }
    _write_json(output / "extraction_metrics.json", summary)
    return {"place_mentions": place_mentions, "person_mentions": person_mentions, "times": times, "events": events, "places": place_counts, "summary": summary}
