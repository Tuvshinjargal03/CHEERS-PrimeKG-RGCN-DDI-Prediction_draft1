"""Independently verify the committed Phase B.3A Disease source mapping."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
INVENTORY = PROJECT_DIR / "final_release/entity_metadata_runtime/entity_description_inventory.jsonl"
MAPPING = PROJECT_DIR / "final_release/entity_metadata_runtime/disease_source_mapping.jsonl"
MANIFEST = PROJECT_DIR / "final_release/entity_metadata_runtime/DISEASE_SOURCE_MAPPING_MANIFEST.json"
RAW_MONDO = PROJECT_DIR / "data/downloads/mondo/v2026-09-01/mondo-base.obo"

RELEASE = "v2026-09-01"
RELEASE_COMMIT = "d50a5d1"
ARTIFACT = "mondo-base.obo"
EXPECTED_SOURCE_SHA256 = "b617457ad70f5eba773700eecf013e59e752096bd57f88821876c3150e148dd6"
EXPECTED_INVENTORY_SHA256 = "239d8d0be347abc9a47fc93a501fd6efb5391cb352dd20281891fb35c2c7ba9b"
EXPECTED_TOTAL = 2_010
EXPECTED_ORDINARY = 1_720
EXPECTED_GROUPED = 290
CURIE_PATTERN = re.compile(r"MONDO:\d{7}$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_jsonl(path: Path) -> list[dict]:
    raw = path.read_bytes()
    assert raw and raw.endswith(b"\n"), f"{path.name} must be nonempty and newline-terminated."
    assert b"\r" not in raw, f"{path.name} must use LF line endings."
    text = raw.decode("utf-8")
    records = []
    for line_number, line in enumerate(text.splitlines(), 1):
        assert line, f"Blank record at {path.name}:{line_number}."
        records.append(json.loads(line))
    return records


def quoted(value: str) -> str:
    assert value.startswith('"')
    result: list[str] = []
    escaped = False
    for character in value[1:]:
        if escaped:
            result.append({"n": "\n", "r": "\r", "t": "\t"}.get(character, character))
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == '"':
            return "".join(result)
        else:
            result.append(character)
    raise AssertionError("Unterminated quoted OBO value.")


def parse_raw_mondo(path: Path) -> dict[str, dict]:
    terms: dict[str, dict] = {}
    current: dict | None = None

    def finish() -> None:
        nonlocal current
        if current is not None and str(current.get("id", "")).startswith("MONDO:"):
            assert current["id"] not in terms
            terms[current["id"]] = current
        current = None

    with path.open("r", encoding="utf-8", newline="") as handle:
        for raw_line in handle:
            line = raw_line.rstrip("\r\n")
            if line == "[Term]":
                finish()
                current = {
                    "label": None,
                    "definition": None,
                    "synonyms": [],
                    "is_obsolete": False,
                    "replaced_by": [],
                    "consider": [],
                }
                continue
            if line.startswith("["):
                finish()
                continue
            if current is None or ": " not in line:
                continue
            tag, value = line.split(": ", 1)
            if tag == "id":
                current["id"] = value
            elif tag == "name":
                current["label"] = value
            elif tag == "def":
                current["definition"] = quoted(value)
            elif tag == "synonym":
                current["synonyms"].append(quoted(value))
            elif tag == "is_obsolete":
                current["is_obsolete"] = value == "true"
            elif tag in {"replaced_by", "consider"}:
                current[tag].append(value)
    finish()
    return terms


def normalize_label(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def curie(component: str) -> str:
    assert component.isascii() and component.isdecimal()
    result = f"MONDO:{component.zfill(7)}"
    assert CURIE_PATTERN.fullmatch(result)
    return result


def expected_status(record: dict) -> tuple[str, list[str]]:
    fields = record["source_fields"]
    reasons: list[str] = []
    if record["mapping"]["status"] == "missing":
        return "unresolved", ["missing_term"]
    status = "approved"
    if fields["is_obsolete"]:
        status = "needs_review"
        reasons.append("obsolete_term")
        if fields["replaced_by"]:
            reasons.append("replacement_available")
        if fields["consider"]:
            reasons.append("consider_available")
    elif fields["definition"] is None:
        status = "unresolved"
        reasons.append("no_definition")
    if fields["label"] is None:
        status = "unresolved"
        reasons.append("missing_source_label")
    elif normalize_label(record["display_name"]) != normalize_label(fields["label"]):
        if status == "approved":
            status = "needs_review"
        reasons.append("label_mismatch")
    return status, reasons


def main() -> None:
    assert sha256(INVENTORY) == EXPECTED_INVENTORY_SHA256
    inventory = load_jsonl(INVENTORY)
    expected_diseases = [record for record in inventory if record["entity_type"] == "disease"]
    records = load_jsonl(MAPPING)
    assert len(records) == EXPECTED_TOTAL == len(expected_diseases)
    assert all(record["entity_type"] == "disease" for record in records)
    expected_identity = [
        (r["entity_id"], r["graph_node_id"], r["display_name"], r["source"])
        for r in expected_diseases
    ]
    actual_identity = [
        (r["entity_id"], r["graph_node_id"], r["display_name"], r["cheers_source"])
        for r in records
    ]
    assert actual_identity == expected_identity, "Disease identities or deterministic order differ from Phase A."
    assert len({(r["entity_type"], r["entity_id"]) for r in records}) == len(records)
    assert len({r["graph_node_id"] for r in records}) == len(records)

    source_counts = Counter(record["cheers_source"] for record in records)
    assert source_counts == {"MONDO": EXPECTED_ORDINARY, "MONDO_grouped": EXPECTED_GROUPED}
    snapshot = {
        "release": RELEASE,
        "release_commit": RELEASE_COMMIT,
        "artifact": ARTIFACT,
        "sha256": EXPECTED_SOURCE_SHA256,
    }
    allowed_methods = {
        "primekg_numeric_mondo_reconstruction",
        "primekg_grouped_numeric_mondo_reconstruction",
    }
    for record in records:
        assert record["schema_version"] == 1
        assert record["source_snapshot"] == snapshot
        assert record["mapping"]["method"] in allowed_methods
        serialized = json.dumps(record, ensure_ascii=False).casefold()
        assert "fuzzy" not in serialized and "name-based" not in serialized
        if record["cheers_source"] == "MONDO":
            assert record["entity_id"].isascii() and record["entity_id"].isdecimal()
            assert record["mapping"]["source_id"] == curie(record["entity_id"])
            assert record["mapping"]["source"] == "MONDO"
            status, reasons = expected_status(record)
            assert record["review_status"] == status
            assert record["reason_codes"] == reasons
        else:
            parts = record["entity_id"].split("_")
            expected_curies = [curie(part) for part in parts]
            assert len(parts) >= 2
            assert record["mapping"]["component_source_ids"] == expected_curies
            resolutions = record["mapping"]["component_resolution"]
            assert [item["source_id"] for item in resolutions] == expected_curies
            assert record["mapping"]["status"] == "composite"
            assert record["review_status"] == "needs_review"
            assert "grouped_entity" in record["reason_codes"]
            has_missing_component = any(not item["exists"] for item in resolutions)
            assert (
                "grouped_component_missing" in record["reason_codes"]
            ) is has_missing_component
            assert "source_fields" not in record
            assert "definition" not in serialized
            assert "primary_component" not in serialized

    manifest_raw = MANIFEST.read_bytes()
    assert manifest_raw.endswith(b"\n") and b"\r" not in manifest_raw
    manifest = json.loads(manifest_raw.decode("utf-8"))
    assert manifest["schema"] == "cheers.disease-source-mapping" and manifest["version"] == 1
    assert manifest["phase_a_inventory"]["sha256"] == sha256(INVENTORY)
    source = manifest["source"]
    assert source["release"] == RELEASE
    assert source["release_commit"] == RELEASE_COMMIT
    assert source["artifact"] == ARTIFACT
    assert source["expected_sha256"] == EXPECTED_SOURCE_SHA256
    assert source["observed_sha256"] == EXPECTED_SOURCE_SHA256
    assert source["license"] == "CC BY 4.0"
    assert manifest["output"]["sha256"] == sha256(MAPPING)
    assert manifest["output"]["encoding"] == "UTF-8"
    assert manifest["output"]["line_endings"] == "LF"
    assert manifest["output"]["final_newline"] is True
    assert manifest["deterministic_build_policy"]["description_generation"] is False

    statuses = Counter(record["review_status"] for record in records)
    ordinary = [record for record in records if record["cheers_source"] == "MONDO"]
    grouped = [record for record in records if record["cheers_source"] == "MONDO_grouped"]
    components = [item for record in grouped for item in record["mapping"]["component_resolution"]]
    calculated_counts = {
        "disease_total": len(records),
        "ordinary": len(ordinary),
        "grouped": len(grouped),
        "review_status": dict(sorted(statuses.items())),
        "ordinary_with_definition": sum(r["source_fields"]["definition"] is not None for r in ordinary),
        "ordinary_without_definition": sum(r["source_fields"]["definition"] is None for r in ordinary),
        "ordinary_obsolete": sum(r["source_fields"]["is_obsolete"] is True for r in ordinary),
        "ordinary_missing_term": sum(r["mapping"]["status"] == "missing" for r in ordinary),
        "grouped_components_total": len(components),
        "grouped_components_resolved": sum(item["exists"] for item in components),
        "grouped_components_missing": sum(not item["exists"] for item in components),
    }
    assert manifest["counts"] == calculated_counts
    expected_reason_code_counts = Counter(
        reason_code for record in records for reason_code in record["reason_codes"]
    )
    assert manifest["reason_code_counts"] == dict(
        sorted(expected_reason_code_counts.items())
    )

    if RAW_MONDO.exists():
        assert sha256(RAW_MONDO) == EXPECTED_SOURCE_SHA256
        assert source["byte_size"] == RAW_MONDO.stat().st_size
        terms = parse_raw_mondo(RAW_MONDO)
        for record in records:
            if record["cheers_source"] == "MONDO":
                term = terms.get(record["mapping"]["source_id"])
                if term is None:
                    assert record["mapping"]["status"] == "missing"
                else:
                    expected_fields = {key: term[key] for key in (
                        "label", "definition", "synonyms", "is_obsolete", "replaced_by", "consider"
                    )}
                    assert record["source_fields"] == expected_fields
            else:
                for item in record["mapping"]["component_resolution"]:
                    assert item["exists"] == (item["source_id"] in terms)
        deep_message = "PASS: raw-source deep verification matched every committed source field."
    else:
        deep_message = "SKIP: raw MONDO absent; raw-source deep verification was skipped."

    print("PASS: exact Phase A Disease identities, counts, uniqueness, and order verified.")
    print("PASS: ordinary and grouped CURIE reconstruction and status policies verified.")
    print("PASS: grouped records have no synthesized definition or primary component.")
    print("PASS: UTF-8, LF, final newline, manifest counts, and output SHA-256 verified.")
    print(deep_message)
    print(f"PASS: {EXPECTED_ORDINARY:,} ordinary + {EXPECTED_GROUPED:,} grouped = {EXPECTED_TOTAL:,} Disease records.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
