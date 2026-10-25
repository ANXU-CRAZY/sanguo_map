from __future__ import annotations

import hashlib
import json
import re
from array import array
from pathlib import Path


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _byte_offsets(text: str) -> array:
    offsets = array("Q", [0])
    total = 0
    for char in text:
        total += len(char.encode("utf-8"))
        offsets.append(total)
    return offsets


def parse_chapter(path: Path, ordinal: int) -> tuple[dict, list[dict]]:
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="strict")
    lines = text.splitlines(keepends=True)
    if not lines or not lines[0].startswith("# "):
        raise ValueError(f"Missing Markdown chapter heading: {path}")
    original_title = lines[0][2:].rstrip("\r\n")
    body_start = len(lines[0])
    body = text[body_start:]
    chapter_id = f"ch_{ordinal:03d}"
    offsets = _byte_offsets(text)
    paragraphs = []
    pattern = re.compile(r"\S(?:.*?\S)?(?=\n[ \t]*\n|\Z)", re.S)
    for index, match in enumerate(pattern.finditer(body), start=1):
        passage = match.group(0)
        if not passage.strip():
            continue
        char_start = body_start + match.start()
        char_end = body_start + match.end()
        paragraph_id = f"{chapter_id}_p_{len(paragraphs) + 1:04d}"
        paragraphs.append({
            "paragraph_id": paragraph_id,
            "chapter_id": chapter_id,
            "chapter_order": ordinal,
            "paragraph_order": len(paragraphs) + 1,
            "source_file": path.name,
            "source_sha256": sha256(raw),
            "source_char_start": char_start,
            "source_char_end": char_end,
            "source_byte_start": offsets[char_start],
            "source_byte_end": offsets[char_end],
            "text": passage,
        })
    chapter = {
        "chapter_id": chapter_id,
        "source_ordinal": ordinal,
        "source_file_prefix": int(path.name[:3]),
        "source_filename": path.name,
        "original_title": original_title,
        "original_title_numbering": re.match(r"^第(.+?章)", original_title).group(1)
        if re.match(r"^第(.+?章)", original_title) else None,
        "body": body,
        "body_characters": len(body),
        "source_bytes": len(raw),
        "source_sha256": sha256(raw),
        "paragraph_count": len(paragraphs),
        "chapter_mapping_120_edition": None,
        "chapter_mapping_status": "UNKNOWN_NOT_ATTEMPTED",
    }
    return chapter, paragraphs


def _normal_text(value: str) -> str:
    value = re.sub(r"(?m)^\s*---+\s*$", "", value)
    return re.sub(r"\s+", "", value)


def validate_integrated_text(corpus_root: Path, chapters: list[dict]) -> dict:
    integrated_path = corpus_root / "三国演义_全文.md"
    catalog_path = corpus_root / "目录.md"
    integrated = integrated_path.read_text(encoding="utf-8")
    catalog = catalog_path.read_text(encoding="utf-8")
    headings = list(re.finditer(r"^## (第.+?)\s*$", integrated, re.M))
    source_titles = [chapter["original_title"] for chapter in chapters]
    integrated_titles = [match.group(1) for match in headings]
    catalog_ordinals = [int(value) for value in re.findall(r"^-\s*(\d{3})\.", catalog, re.M)]
    title_matches = integrated_titles == source_titles
    catalog_complete = catalog_ordinals == list(range(1, 120))
    body_comparisons = []
    for index, chapter in enumerate(chapters):
        start = headings[index].end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(integrated)
        integrated_body = integrated[start:end]
        body_comparisons.append(_normal_text(integrated_body) == _normal_text(chapter["body"]))
    return {
        "integrated_file": integrated_path.name,
        "integrated_sha256": sha256(integrated_path.read_bytes()),
        "catalog_file": catalog_path.name,
        "catalog_sha256": sha256(catalog_path.read_bytes()),
        "integrated_heading_count": len(headings),
        "chapter_heading_sequence_matches": title_matches,
        "integrated_body_matches_119_source_files_after_whitespace_normalization": sum(body_comparisons),
        "integrated_body_mismatch_ordinals": [i + 1 for i, ok in enumerate(body_comparisons) if not ok],
        "catalog_has_119_contiguous_ordinals": catalog_complete,
        "catalog_ordinals": catalog_ordinals,
        "method": "Exact chapter heading order; integrated bodies compared after ignoring whitespace and the merged-file-only Markdown horizontal-rule separators. Source Markdown bytes remain unmodified.",
    }


def ingest_corpus(corpus_root: Path, output_dir: Path) -> dict:
    chapter_dir = corpus_root / "章节"
    candidates = sorted(chapter_dir.glob("[0-9][0-9][0-9]_*.md"), key=lambda p: p.name)
    if len(candidates) != 119:
        raise ValueError(f"Expected exactly 119 numbered Markdown files, found {len(candidates)}")
    prefixes = [int(path.name[:3]) for path in candidates]
    if prefixes != list(range(1, 120)):
        raise ValueError(f"Chapter filename prefixes are not contiguous 001-119: {prefixes}")
    chapters, paragraphs, source_files = [], [], []
    for ordinal, path in enumerate(candidates, start=1):
        chapter, rows = parse_chapter(path, ordinal)
        if not rows:
            raise ValueError(f"Chapter has no parseable body paragraphs: {path}")
        chapters.append(chapter)
        paragraphs.extend(rows)
        source_files.append({
            "source_file": path.name,
            "source_path": str(path.resolve()),
            "sha256": chapter["source_sha256"],
            "bytes": chapter["source_bytes"],
            "chapter_id": chapter["chapter_id"],
            "paragraph_count": chapter["paragraph_count"],
        })
    audit = validate_integrated_text(corpus_root, chapters)
    if audit["integrated_heading_count"] != 119 or not audit["chapter_heading_sequence_matches"]:
        raise ValueError("The integrated Markdown does not have the same 119-heading sequence")
    if audit["integrated_body_mismatch_ordinals"]:
        raise ValueError(f"Integrated Markdown body differs from chapter files: {audit['integrated_body_mismatch_ordinals']}")
    if not audit["catalog_has_119_contiguous_ordinals"]:
        raise ValueError("The supplied chapter catalog is not a contiguous 001-119 list")

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "chapters.json").write_text(json.dumps(chapters, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (output_dir / "paragraphs.jsonl").open("w", encoding="utf-8", newline="\n") as stream:
        for row in paragraphs:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    index = {
        "schema_version": 1,
        "corpus": str(corpus_root.resolve()),
        "chapter_count": len(chapters),
        "paragraph_count": len(paragraphs),
        "chapters": [{key: chapter[key] for key in ("chapter_id", "source_ordinal", "original_title", "source_filename", "source_sha256", "paragraph_count")} for chapter in chapters],
    }
    (output_dir / "text_index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest = {
        "source_root": str(corpus_root.resolve()),
        "source_files": source_files,
        "integrity_audit": audit,
        "chapter_count": len(chapters),
        "paragraph_count": len(paragraphs),
        "source_byte_count_total": sum(chapter["source_bytes"] for chapter in chapters),
        "source_character_count_including_heading": sum(chapter["body_characters"] + len(chapter["original_title"]) + 2 for chapter in chapters),
        "raw_input_policy": "Read-only. Original chapter files were not copied, rewritten, normalized, or edited.",
        "stable_id_policy": "chapter_id uses source filename ordinal; paragraph_id uses chapter_id and ordinal within that immutable source file. Source SHA and byte offsets independently detect drift.",
    }
    (output_dir / "corpus_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"chapters": chapters, "paragraphs": paragraphs, "manifest": manifest}


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]
