"""Verify the frozen CHEERS NCBI gene metadata artifact."""

from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
CONTEXT_PATH = PROJECT_DIR / "final_release/g3_context_runtime/g3_drug_context.csv"
ARTIFACT_PATH = PROJECT_DIR / "final_release/entity_metadata_runtime/gene_metadata.jsonl"
MANIFEST_PATH = PROJECT_DIR / "final_release/entity_metadata_runtime/GENE_METADATA_MANIFEST.json"
EXPECTED_COUNT = 3_094
EXPECTED_MAPPING_RULE = (
    "Exact decimal NCBI GeneID only: CHEERS context_id == NCBI gene_id. "
    "No name, symbol, synonym, alias, fuzzy, or case-insensitive fallback."
)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_context_identity():
    by_node = {}
    by_id = {}
    with CONTEXT_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["context_group"] != "gene/protein" or row["context_source"] != "NCBI":
                continue
            identity = {
                "graph_node_id": int(row["context_node_id"]),
                "entity_id": row["context_id"].strip(),
                "entity_type": "gene/protein",
                "display_name": row["context_name"].strip(),
                "source": "NCBI",
            }
            node_id = identity["graph_node_id"]
            gene_id = identity["entity_id"]
            if node_id in by_node:
                assert by_node[node_id] == identity
            if gene_id in by_id:
                assert by_id[gene_id] == identity
            by_node[node_id] = identity
            by_id[gene_id] = identity
    assert len(by_node) == EXPECTED_COUNT
    assert len(by_id) == EXPECTED_COUNT
    return by_node, by_id


def load_artifact():
    records = []
    with ARTIFACT_PATH.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            assert line.strip(), f"Blank JSONL line {line_number}."
            records.append(json.loads(line))
    return records


def calculate_statistics(records):
    taxonomy = {}
    for record in records:
        metadata = record["metadata"]
        tax_id = metadata["taxonomy_id"]
        if tax_id:
            entry = taxonomy.setdefault(
                tax_id, {"organism": metadata["organism"], "count": 0}
            )
            assert entry["organism"] == metadata["organism"]
            entry["count"] += 1
    matched = sum(record["metadata"]["matched"] for record in records)
    return {
        "matched_count": matched,
        "unmatched_count": len(records) - matched,
        "taxonomy_counts": dict(sorted(taxonomy.items(), key=lambda item: int(item[0]))),
        "human_gene_count": sum(r["metadata"]["taxonomy_id"] == "9606" for r in records),
        "nonhuman_gene_count": sum(r["metadata"]["taxonomy_id"] not in (None, "9606") for r in records),
        "missing_taxonomy_count": sum(r["metadata"]["taxonomy_id"] is None for r in records),
        "missing_official_symbol": sum(r["metadata"]["official_symbol"] is None for r in records),
        "missing_official_full_name": sum(r["metadata"]["official_full_name"] is None for r in records),
        "missing_aliases": sum(not r["metadata"]["aliases"] for r in records),
        "missing_summary": sum(r["metadata"]["summary"] is None for r in records),
        "project_name_symbol_mismatches": sum(
            r["metadata"]["matched"]
            and r["display_name"] != r["metadata"]["official_symbol"]
            for r in records
        ),
    }


def main():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    records = load_artifact()
    context_by_node, context_by_id = load_context_identity()

    assert len(records) == EXPECTED_COUNT
    assert len({record["graph_node_id"] for record in records}) == EXPECTED_COUNT
    assert len({record["entity_id"] for record in records}) == EXPECTED_COUNT
    assert all(record["entity_id"].isascii() and record["entity_id"].isdigit() for record in records)
    assert records == sorted(records, key=lambda record: record["graph_node_id"])
    assert manifest["mapping_rule"] == EXPECTED_MAPPING_RULE

    required_metadata = {
        "matched", "ncbi_gene_id", "official_symbol", "official_full_name",
        "aliases", "taxonomy_id", "organism", "summary", "summary_source",
        "summary_date", "source_modified_date", "record_status",
        "replacement_gene_id",
    }
    for record in records:
        identity = {key: record[key] for key in (
            "graph_node_id", "entity_id", "entity_type", "display_name", "source"
        )}
        assert identity == context_by_node[record["graph_node_id"]]
        assert identity == context_by_id[record["entity_id"]]
        assert record["entity_type"] == "gene/protein"
        assert record["source"] == "NCBI"
        metadata = record["metadata"]
        assert set(metadata) == required_metadata
        assert isinstance(metadata["aliases"], list)
        assert len(metadata["aliases"]) == len(set(metadata["aliases"]))
        assert metadata["aliases"] == sorted(
            metadata["aliases"], key=lambda value: (value.casefold(), value)
        )
        if metadata["matched"]:
            assert metadata["ncbi_gene_id"] == record["entity_id"]
        else:
            assert metadata["ncbi_gene_id"] is None
            assert metadata["official_symbol"] is None
            assert metadata["official_full_name"] is None
            assert metadata["aliases"] == []
            assert metadata["taxonomy_id"] is None
            assert metadata["organism"] is None
            assert metadata["summary"] is None

    statistics = calculate_statistics(records)
    for key, value in statistics.items():
        assert manifest[key] == value, f"Manifest mismatch for {key}."
    assert manifest["project_gene_count"] == EXPECTED_COUNT
    assert manifest["output_sha256"] == sha256(ARTIFACT_PATH)
    assert manifest["project_context_sha256"] == sha256(CONTEXT_PATH)
    for relative_path, expected_hash in manifest["raw_input_sha256"].items():
        assert sha256(PROJECT_DIR / relative_path) == expected_hash
    expected_replacements = [
        {
            "project_gene_id": record["entity_id"],
            "replacement_gene_id": record["metadata"]["replacement_gene_id"],
        }
        for record in records
        if record["metadata"]["replacement_gene_id"] is not None
    ]
    assert manifest["deprecated_or_merged_geneids"] == expected_replacements

    by_id = {record["entity_id"]: record for record in records}
    expected = {
        "1562": (361, "CYP2C18"),
        "7498": (1691, "XDH"),
        "6564": (0, "SLC15A1"),
    }
    for gene_id, (node_id, name) in expected.items():
        record = by_id[gene_id]
        assert record["graph_node_id"] == node_id
        assert record["display_name"] == name
        assert record["source"] == "NCBI"

    assert not any(record["entity_type"] in {"drug", "disease"} for record in records)
    print(f"PASS: {EXPECTED_COUNT} unique CHEERS gene identities preserved exactly.")
    print("PASS: exact GeneID-only matched metadata and safe unmatched records verified.")
    print("PASS: taxonomy and coverage statistics reproduce the manifest.")
    print("PASS: artifact and project-context SHA-256 values match the manifest.")
    print("PASS: CYP2C18, XDH, and SLC15A1 identities are unchanged.")


if __name__ == "__main__":
    main()
