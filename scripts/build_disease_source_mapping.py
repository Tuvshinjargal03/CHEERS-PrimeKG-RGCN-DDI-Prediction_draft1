"""Build deterministic MONDO source mappings for Phase A Disease identities."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
INVENTORY = PROJECT_DIR / "final_release/entity_metadata_runtime/entity_description_inventory.jsonl"
RAW_DIR = PROJECT_DIR / "data/downloads/mondo/v2026-09-01"
MONDO_OBO = RAW_DIR / "mondo-base.obo"
ACQUISITION_METADATA = RAW_DIR / "acquisition_metadata.json"
OUTPUT = PROJECT_DIR / "final_release/entity_metadata_runtime/disease_source_mapping.jsonl"
MANIFEST = PROJECT_DIR / "final_release/entity_metadata_runtime/DISEASE_SOURCE_MAPPING_MANIFEST.json"

RELEASE = "v2026-09-01"
RELEASE_COMMIT = "d50a5d1"
ARTIFACT = "mondo-base.obo"
SOURCE_URL = (
    "https://github.com/monarch-initiative/mondo/releases/download/"
    f"{RELEASE}/{ARTIFACT}"
)
EXPECTED_SOURCE_SHA256 = "b617457ad70f5eba773700eecf013e59e752096bd57f88821876c3150e148dd6"
EXPECTED_DISEASES = 2_010
EXPECTED_ORDINARY = 1_720
EXPECTED_GROUPED = 290
CURIE_PATTERN = re.compile(r"MONDO:\d{7}$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_quoted_value(value: str) -> str:
    if not value.startswith('"'):
        raise ValueError(f"Expected OBO quoted value: {value[:80]!r}")
    characters: list[str] = []
    escaped = False
    for character in value[1:]:
        if escaped:
            characters.append({"n": "\n", "r": "\r", "t": "\t"}.get(character, character))
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == '"':
            return "".join(characters)
        else:
            characters.append(character)
    raise ValueError(f"Unterminated OBO quoted value: {value[:80]!r}")


def parse_mondo(path: Path) -> dict[str, dict]:
    terms: dict[str, dict] = {}
    stanza: dict[str, object] | None = None

    def finish() -> None:
        nonlocal stanza
        if stanza is None:
            return
        term_id = stanza.get("id")
        if isinstance(term_id, str) and term_id.startswith("MONDO:"):
            if term_id in terms:
                raise AssertionError(f"Duplicate MONDO term: {term_id}")
            terms[term_id] = stanza
        stanza = None

    with path.open("r", encoding="utf-8", newline="") as handle:
        for raw_line in handle:
            line = raw_line.rstrip("\r\n")
            if line == "[Term]":
                finish()
                stanza = {
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
            if stanza is None or ": " not in line:
                continue
            tag, value = line.split(": ", 1)
            if tag == "id":
                stanza["id"] = value
            elif tag == "name":
                stanza["label"] = value
            elif tag == "def":
                stanza["definition"] = parse_quoted_value(value)
            elif tag == "synonym":
                stanza["synonyms"].append(parse_quoted_value(value))
            elif tag == "is_obsolete":
                stanza["is_obsolete"] = value == "true"
            elif tag == "replaced_by":
                stanza["replaced_by"].append(value)
            elif tag == "consider":
                stanza["consider"].append(value)
    finish()
    return terms


def normalized_label(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def canonical_curie(component: str) -> str:
    if not component.isascii() or not component.isdecimal():
        raise AssertionError(f"Non-decimal MONDO component: {component!r}")
    curie = f"MONDO:{component.zfill(7)}"
    if not CURIE_PATTERN.fullmatch(curie):
        raise AssertionError(f"Invalid reconstructed MONDO CURIE: {curie}")
    return curie


def source_snapshot() -> dict:
    return {
        "release": RELEASE,
        "release_commit": RELEASE_COMMIT,
        "artifact": ARTIFACT,
        "sha256": EXPECTED_SOURCE_SHA256,
    }


def ordinary_record(inventory_record: dict, terms: dict[str, dict]) -> dict:
    entity_id = inventory_record["entity_id"]
    curie = canonical_curie(entity_id)
    term = terms.get(curie)
    reasons: list[str] = []
    review_status = "approved"
    mapping_status = "exact" if term is not None else "missing"
    if term is None:
        review_status = "unresolved"
        reasons.append("missing_term")
        fields = {
            "label": None,
            "definition": None,
            "synonyms": [],
            "is_obsolete": None,
            "replaced_by": [],
            "consider": [],
        }
    else:
        fields = {
            "label": term["label"],
            "definition": term["definition"],
            "synonyms": term["synonyms"],
            "is_obsolete": term["is_obsolete"],
            "replaced_by": term["replaced_by"],
            "consider": term["consider"],
        }
        if term["is_obsolete"]:
            review_status = "needs_review"
            reasons.append("obsolete_term")
            if term["replaced_by"]:
                reasons.append("replacement_available")
            if term["consider"]:
                reasons.append("consider_available")
        elif term["definition"] is None:
            review_status = "unresolved"
            reasons.append("no_definition")
        if term["label"] is None:
            review_status = "unresolved"
            reasons.append("missing_source_label")
        elif normalized_label(inventory_record["display_name"]) != normalized_label(term["label"]):
            if review_status == "approved":
                review_status = "needs_review"
            reasons.append("label_mismatch")

    return {
        "schema_version": 1,
        "entity_type": "disease",
        "entity_id": entity_id,
        "graph_node_id": inventory_record["graph_node_id"],
        "display_name": inventory_record["display_name"],
        "cheers_source": "MONDO",
        "mapping": {
            "status": mapping_status,
            "method": "primekg_numeric_mondo_reconstruction",
            "source": "MONDO",
            "source_id": curie,
        },
        "source_fields": fields,
        "source_snapshot": source_snapshot(),
        "review_status": review_status,
        "reason_codes": reasons,
    }


def grouped_record(inventory_record: dict, terms: dict[str, dict]) -> dict:
    components = inventory_record["entity_id"].split("_")
    if len(components) < 2:
        raise AssertionError("MONDO_grouped identity must contain at least two components.")
    component_source_ids = [canonical_curie(component) for component in components]
    component_resolution = [
        {"source_id": source_id, "exists": source_id in terms}
        for source_id in component_source_ids
    ]
    reasons = ["grouped_entity"]
    if not all(item["exists"] for item in component_resolution):
        reasons.append("grouped_component_missing")
    return {
        "schema_version": 1,
        "entity_type": "disease",
        "entity_id": inventory_record["entity_id"],
        "graph_node_id": inventory_record["graph_node_id"],
        "display_name": inventory_record["display_name"],
        "cheers_source": "MONDO_grouped",
        "mapping": {
            "status": "composite",
            "method": "primekg_grouped_numeric_mondo_reconstruction",
            "source": "MONDO",
            "component_source_ids": component_source_ids,
            "component_resolution": component_resolution,
        },
        "source_snapshot": source_snapshot(),
        "review_status": "needs_review",
        "reason_codes": reasons,
    }


def main() -> None:
    observed_source_sha256 = sha256(MONDO_OBO)
    if observed_source_sha256 != EXPECTED_SOURCE_SHA256:
        raise AssertionError(
            f"Pinned source SHA-256 mismatch: {observed_source_sha256}"
        )
    source_bytes = MONDO_OBO.stat().st_size
    acquisition = (
        json.loads(ACQUISITION_METADATA.read_text(encoding="utf-8"))
        if ACQUISITION_METADATA.exists()
        else None
    )
    if acquisition is not None:
        for key, expected in {
            "release": RELEASE,
            "release_commit": RELEASE_COMMIT,
            "artifact": ARTIFACT,
            "url": SOURCE_URL,
            "expected_sha256": EXPECTED_SOURCE_SHA256,
            "observed_sha256": observed_source_sha256,
            "byte_size": source_bytes,
        }.items():
            if acquisition.get(key) != expected:
                raise AssertionError(f"Acquisition metadata mismatch for {key}.")

    inventory_raw = INVENTORY.read_bytes()
    inventory_records = [json.loads(line) for line in inventory_raw.decode("utf-8").splitlines()]
    diseases = [record for record in inventory_records if record["entity_type"] == "disease"]
    if len(diseases) != EXPECTED_DISEASES:
        raise AssertionError(f"Expected {EXPECTED_DISEASES:,} Disease records.")
    terms = parse_mondo(MONDO_OBO)
    records = []
    for record in diseases:
        if record["source"] == "MONDO":
            records.append(ordinary_record(record, terms))
        elif record["source"] == "MONDO_grouped":
            records.append(grouped_record(record, terms))
        else:
            raise AssertionError(
                f"Unexpected Phase A Disease source: {record['source']!r}"
            )
    source_counts = Counter(record["cheers_source"] for record in records)
    if source_counts != {"MONDO": EXPECTED_ORDINARY, "MONDO_grouped": EXPECTED_GROUPED}:
        raise AssertionError(f"Unexpected Disease source counts: {source_counts}")

    payload = "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        for record in records
    ).encode("utf-8")
    OUTPUT.write_bytes(payload)

    status_counts = Counter(record["review_status"] for record in records)
    reason_code_counts = Counter(
        reason_code for record in records for reason_code in record["reason_codes"]
    )
    ordinary_records = [record for record in records if record["cheers_source"] == "MONDO"]
    grouped_records = [record for record in records if record["cheers_source"] == "MONDO_grouped"]
    definition_count = sum(
        record["source_fields"]["definition"] is not None for record in ordinary_records
    )
    obsolete_count = sum(
        record["source_fields"]["is_obsolete"] is True for record in ordinary_records
    )
    missing_count = sum(record["mapping"]["status"] == "missing" for record in ordinary_records)
    component_resolutions = [
        component
        for record in grouped_records
        for component in record["mapping"]["component_resolution"]
    ]
    manifest = {
        "schema": "cheers.disease-source-mapping",
        "version": 1,
        "purpose": "Pinned MONDO source fields for Phase A Disease identities; no generated descriptions.",
        "phase_a_inventory": {
            "path": INVENTORY.relative_to(PROJECT_DIR).as_posix(),
            "sha256": hashlib.sha256(inventory_raw).hexdigest(),
        },
        "source": {
            "name": "Mondo Disease Ontology",
            "release": RELEASE,
            "release_commit": RELEASE_COMMIT,
            "artifact": ARTIFACT,
            "url": SOURCE_URL,
            "expected_sha256": EXPECTED_SOURCE_SHA256,
            "observed_sha256": observed_source_sha256,
            "byte_size": source_bytes,
            "retrieval": acquisition,
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
        },
        "counts": {
            "disease_total": len(records),
            "ordinary": len(ordinary_records),
            "grouped": len(grouped_records),
            "review_status": dict(sorted(status_counts.items())),
            "ordinary_with_definition": definition_count,
            "ordinary_without_definition": len(ordinary_records) - definition_count,
            "ordinary_obsolete": obsolete_count,
            "ordinary_missing_term": missing_count,
            "grouped_components_total": len(component_resolutions),
            "grouped_components_resolved": sum(item["exists"] for item in component_resolutions),
            "grouped_components_missing": sum(not item["exists"] for item in component_resolutions),
        },
        "reason_code_counts": dict(sorted(reason_code_counts.items())),
        "output": {
            "path": OUTPUT.relative_to(PROJECT_DIR).as_posix(),
            "sha256": sha256(OUTPUT),
            "encoding": "UTF-8",
            "line_endings": "LF",
            "final_newline": True,
        },
        "deterministic_build_policy": {
            "ordering": "Exact Phase A Disease record order.",
            "ordinary_mapping": "MONDO: + ASCII-decimal CHEERS entity_id zero-filled to seven digits.",
            "label_comparison": "Unicode NFKC, casefold, and whitespace collapse; no fuzzy matching.",
            "replacement_policy": "Preserve obsolete source identity, replaced_by, and consider; never follow automatically.",
            "grouped_policy": "Split exact composite ID on underscores for component provenance only; never choose a primary component or synthesize a definition.",
            "description_generation": False,
        },
        "scientific_boundary": (
            "Source definitions are for UI identification/general context only; they are not R-GCN textual input, "
            "DDI evidence, explanations of model scores, mechanism inference, or clinical guidance."
        ),
    }
    MANIFEST.write_bytes(
        (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    )

    print(f"PASS: wrote {len(records):,} Disease source mappings.")
    print(f"Ordinary: {len(ordinary_records):,}; grouped: {len(grouped_records):,}")
    print(f"Definitions: {definition_count:,}; obsolete: {obsolete_count:,}; missing: {missing_count:,}")
    print(f"Status: {dict(sorted(status_counts.items()))}")
    print(f"SHA256: {manifest['output']['sha256']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
