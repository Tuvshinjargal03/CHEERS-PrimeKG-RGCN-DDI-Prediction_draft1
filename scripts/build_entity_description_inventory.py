"""Build the deterministic Drug/Disease identity inventory for Subgraph Explorer."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np


PROJECT_DIR = Path(__file__).resolve().parents[1]
DRUG_METADATA = PROJECT_DIR / "final_release/lightweight_runtime/drug_metadata.csv"
DDI_NEIGHBORS = PROJECT_DIR / "final_release/g3_context_runtime/training_ddi_neighbors.npz"
G3_CONTEXT = PROJECT_DIR / "final_release/g3_context_runtime/g3_drug_context.csv"
OUTPUT_DIR = PROJECT_DIR / "final_release/entity_metadata_runtime"
INVENTORY = OUTPUT_DIR / "entity_description_inventory.jsonl"
MANIFEST = OUTPUT_DIR / "ENTITY_DESCRIPTION_INVENTORY_MANIFEST.json"

EXPECTED_DRUGS = 4_278
EXPECTED_DISEASES = 2_010
TYPE_RANK = {"drug": 0, "disease": 1}
# Syntax-only heuristic: a name consisting of an optional symbol prefix followed
# by a digit and then only ASCII code-like characters (digits, letters, -, _, /).
CODE_LIKE_NAME = re.compile(r"^[A-Za-z]{0,12}[ _-]?\d[A-Za-z0-9_/-]*$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def duplicate_name_audit(records: list[dict], case_insensitive: bool) -> dict:
    groups: dict[str, list[str]] = defaultdict(list)
    for record in records:
        name = record["display_name"]
        groups[name.casefold() if case_insensitive else name].append(record["entity_id"])
    duplicates = [ids for ids in groups.values() if len(ids) > 1]
    return {
        "duplicate_name_groups": len(duplicates),
        "records_in_duplicate_name_groups": sum(map(len, duplicates)),
    }


def derive_inventory() -> tuple[list[dict], dict]:
    drug_rows = read_csv(DRUG_METADATA)
    if len(drug_rows) != EXPECTED_DRUGS:
        raise AssertionError(f"Expected {EXPECTED_DRUGS:,} candidate drugs.")

    drugs = []
    candidate_nodes = []
    candidate_by_node = {}
    for row in drug_rows:
        if row["entity_type"] != "drug" or row["entity_source"] != "DrugBank":
            raise AssertionError("Unexpected candidate Drug identity metadata.")
        node_id = int(row["node_id"])
        record = {
            "entity_type": "drug",
            "entity_id": row["entity_id"],
            "graph_node_id": node_id,
            "display_name": row["entity_name"],
            "source": row["entity_source"],
        }
        drugs.append(record)
        candidate_nodes.append(node_id)
        if node_id in candidate_by_node:
            raise AssertionError(f"Duplicate candidate graph node {node_id}.")
        candidate_by_node[node_id] = record

    with np.load(DDI_NEIGHBORS, allow_pickle=False) as adjacency:
        indptr = adjacency["indptr"].copy()
        indices = adjacency["indices"].copy()
        ddi_nodes = adjacency["drug_node_ids"].copy()
    if ddi_nodes.tolist() != candidate_nodes:
        raise AssertionError("Candidate centers and training-DDI node mapping differ.")
    if indptr.shape != (len(drugs) + 1,) or int(indptr[-1]) != indices.size:
        raise AssertionError("Training-DDI CSR structure is invalid.")
    exposed_local = set(int(value) for value in indices)
    if exposed_local != set(range(len(drugs))):
        raise AssertionError("Candidate centers and exposed training-DDI neighbors differ.")

    disease_by_node = {}
    for row in read_csv(G3_CONTEXT):
        drug_node = int(row["drug_node_id"])
        if drug_node not in candidate_by_node:
            continue
        candidate = candidate_by_node[drug_node]
        if (row["drug_id"], row["drug_name"]) != (
            candidate["entity_id"], candidate["display_name"]
        ):
            raise AssertionError(f"G3 context candidate identity differs at node {drug_node}.")
        if row["context_group"] != "disease":
            continue
        if row["context_source"] not in {"MONDO", "MONDO_grouped"}:
            raise AssertionError("Unexpected disease source.")
        node_id = int(row["context_node_id"])
        identity = (
            row["context_id"],
            row["context_name"],
            row["context_source"],
        )
        previous = disease_by_node.setdefault(node_id, identity)
        if previous != identity:
            raise AssertionError(f"Inconsistent disease identity at node {node_id}.")

    diseases = [
        {
            "entity_type": "disease",
            "entity_id": identity[0],
            "graph_node_id": node_id,
            "display_name": identity[1],
            "source": identity[2],
        }
        for node_id, identity in disease_by_node.items()
    ]
    if len(diseases) != EXPECTED_DISEASES:
        raise AssertionError(f"Expected {EXPECTED_DISEASES:,} reachable diseases.")

    records = sorted(
        drugs + diseases,
        key=lambda item: (TYPE_RANK[item["entity_type"]], item["graph_node_id"]),
    )
    keys = [(item["entity_type"], item["entity_id"]) for item in records]
    if len(keys) != len(set(keys)):
        raise AssertionError("Duplicate (entity_type, entity_id) identity key.")
    graph_keys = [(item["entity_type"], item["graph_node_id"]) for item in records]
    if len(graph_keys) != len(set(graph_keys)):
        raise AssertionError("Duplicate graph node identity within an entity type.")

    source_counts = Counter(item["source"] for item in diseases)
    component_counts = [
        len(item["entity_id"].split("_"))
        for item in diseases
        if item["source"] == "MONDO_grouped"
    ]
    code_like = [
        {"entity_id": item["entity_id"], "display_name": item["display_name"]}
        for item in drugs
        if CODE_LIKE_NAME.fullmatch(item["display_name"])
    ]
    audit = {
        "drug": {
            "duplicate_exact_display_names": duplicate_name_audit(drugs, False),
            "duplicate_case_insensitive_display_names": duplicate_name_audit(drugs, True),
            "empty_entity_ids": sum(not item["entity_id"] for item in drugs),
            "empty_display_names": sum(not item["display_name"] for item in drugs),
            "unusual_code_like_name_heuristic": (
                "Full match of ^[A-Za-z]{0,12}[ _-]?\\d[A-Za-z0-9_/-]*$; "
                "syntax-only and not a biomedical classification."
            ),
            "unusual_code_like_names": code_like,
        },
        "disease": {
            "duplicate_exact_display_names": duplicate_name_audit(diseases, False),
            "duplicate_case_insensitive_display_names": duplicate_name_audit(diseases, True),
            "empty_entity_ids": sum(not item["entity_id"] for item in diseases),
            "empty_display_names": sum(not item["display_name"] for item in diseases),
            "MONDO_records": source_counts["MONDO"],
            "MONDO_grouped_records": source_counts["MONDO_grouped"],
            "grouped_component_count": {
                "minimum": min(component_counts),
                "maximum": max(component_counts),
                "mean": sum(component_counts) / len(component_counts),
                "median": statistics.median(component_counts),
            },
        },
    }
    return records, audit


def main() -> None:
    records, audit = derive_inventory()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        for record in records
    )
    INVENTORY.write_bytes(payload.encode("utf-8"))

    source_paths = [DRUG_METADATA, DDI_NEIGHBORS, G3_CONTEXT]
    manifest = {
        "schema": "cheers.entity-description-inventory",
        "version": 1,
        "purpose": "Frozen identities of Drug and Disease entities exposed by CHEERS Subgraph Explorer.",
        "counts": {
            "total": len(records),
            "drug": sum(item["entity_type"] == "drug" for item in records),
            "disease": sum(item["entity_type"] == "disease" for item in records),
            "MONDO": sum(item["source"] == "MONDO" for item in records),
            "MONDO_grouped": sum(item["source"] == "MONDO_grouped" for item in records),
        },
        "source_inputs": [
            {"path": path.relative_to(PROJECT_DIR).as_posix(), "sha256": sha256(path)}
            for path in source_paths
        ],
        "inventory": {
            "path": INVENTORY.relative_to(PROJECT_DIR).as_posix(),
            "sha256": sha256(INVENTORY),
            "encoding": "UTF-8",
            "line_endings": "LF",
        },
        "ordering_rule": "entity_type rank (drug, disease), then graph_node_id ascending",
        "identity_key_rule": "Exact (entity_type, entity_id); no normalization or inferred identifiers.",
        "scope_definition": (
            "All candidate-center Drugs, verified equal to Drugs exposed as training-DDI neighbors, "
            "plus Disease support neighbors reachable from those candidate Drugs in forward G3 context."
        ),
        "descriptions_included": False,
        "phase_a_external_retrieval_or_llm_generation": False,
        "ambiguity_audit": audit,
    }
    MANIFEST.write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(f"PASS: wrote {len(records):,} entity identities.")
    print(f"Drug: {manifest['counts']['drug']:,}; Disease: {manifest['counts']['disease']:,}")
    print(f"SHA256: {manifest['inventory']['sha256']}")


if __name__ == "__main__":
    main()
