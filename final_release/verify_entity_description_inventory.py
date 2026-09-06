"""Independently verify the frozen Subgraph Explorer Drug/Disease inventory."""

from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np


PROJECT_DIR = Path(__file__).resolve().parents[1]
DRUG_METADATA = PROJECT_DIR / "final_release/lightweight_runtime/drug_metadata.csv"
DDI_NEIGHBORS = PROJECT_DIR / "final_release/g3_context_runtime/training_ddi_neighbors.npz"
G3_CONTEXT = PROJECT_DIR / "final_release/g3_context_runtime/g3_drug_context.csv"
INVENTORY = PROJECT_DIR / "final_release/entity_metadata_runtime/entity_description_inventory.jsonl"
MANIFEST = PROJECT_DIR / "final_release/entity_metadata_runtime/ENTITY_DESCRIPTION_INVENTORY_MANIFEST.json"
EXPECTED_DRUGS = 4_278
EXPECTED_DISEASES = 2_010


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def csv_rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def expected_records() -> tuple[list[dict], set[int], set[int]]:
    drugs = []
    candidate_by_node = {}
    for row in csv_rows(DRUG_METADATA):
        assert row["entity_type"] == "drug" and row["entity_source"] == "DrugBank"
        record = {
            "entity_type": "drug",
            "entity_id": row["entity_id"],
            "graph_node_id": int(row["node_id"]),
            "display_name": row["entity_name"],
            "source": row["entity_source"],
        }
        assert record["graph_node_id"] not in candidate_by_node
        candidate_by_node[record["graph_node_id"]] = record
        drugs.append(record)

    with np.load(DDI_NEIGHBORS, allow_pickle=False) as exported:
        indptr = exported["indptr"]
        indices = exported["indices"]
        ddi_nodes = exported["drug_node_ids"]
        assert ddi_nodes.tolist() == [record["graph_node_id"] for record in drugs]
        assert indptr.shape == (len(drugs) + 1,)
        assert int(indptr[0]) == 0 and int(indptr[-1]) == len(indices)
        ddi_neighbor_nodes = {int(ddi_nodes[int(local)]) for local in indices}
    candidate_nodes = set(candidate_by_node)
    assert candidate_nodes == ddi_neighbor_nodes, (
        f"Candidate/DDI difference: centers_only={sorted(candidate_nodes - ddi_neighbor_nodes)}, "
        f"neighbors_only={sorted(ddi_neighbor_nodes - candidate_nodes)}"
    )

    disease_by_node = {}
    reachable_disease_nodes = set()
    for row in csv_rows(G3_CONTEXT):
        drug_node = int(row["drug_node_id"])
        if drug_node not in candidate_nodes:
            continue
        candidate = candidate_by_node[drug_node]
        assert (row["drug_id"], row["drug_name"]) == (
            candidate["entity_id"], candidate["display_name"]
        )
        if row["context_group"] != "disease":
            continue
        node = int(row["context_node_id"])
        identity = (row["context_id"], row["context_name"], row["context_source"])
        assert identity[2] in {"MONDO", "MONDO_grouped"}
        assert node not in disease_by_node or disease_by_node[node] == identity
        disease_by_node[node] = identity
        reachable_disease_nodes.add(node)
    diseases = [
        {
            "entity_type": "disease",
            "entity_id": identity[0],
            "graph_node_id": node,
            "display_name": identity[1],
            "source": identity[2],
        }
        for node, identity in disease_by_node.items()
    ]
    expected = sorted(drugs + diseases, key=lambda r: ((0 if r["entity_type"] == "drug" else 1), r["graph_node_id"]))
    return expected, candidate_nodes, reachable_disease_nodes


def load_inventory() -> list[dict]:
    raw = INVENTORY.read_bytes()
    assert b"\r" not in raw, "Inventory must use LF line endings."
    text = raw.decode("utf-8")
    assert text.endswith("\n") and text, "Inventory must be nonempty and newline-terminated."
    records = []
    for line_number, line in enumerate(text.splitlines(), 1):
        assert line, f"Blank JSONL record at line {line_number}."
        record = json.loads(line)
        assert set(record) == {"entity_type", "entity_id", "graph_node_id", "display_name", "source"}
        assert record["entity_type"] in {"drug", "disease"}
        assert isinstance(record["graph_node_id"], int) and not isinstance(record["graph_node_id"], bool)
        assert all(isinstance(record[key], str) and record[key] for key in ("entity_id", "display_name", "source"))
        if record["entity_type"] == "drug":
            assert record["source"] == "DrugBank"
        else:
            assert record["source"] in {"MONDO", "MONDO_grouped"}
        records.append(record)
    return records


def main() -> None:
    expected, candidate_nodes, reachable_disease_nodes = expected_records()
    actual = load_inventory()
    assert len(expected) == EXPECTED_DRUGS + EXPECTED_DISEASES
    assert sum(r["entity_type"] == "drug" for r in expected) == EXPECTED_DRUGS
    assert sum(r["entity_type"] == "disease" for r in expected) == EXPECTED_DISEASES
    assert actual == expected, "Inventory differs from independently reconstructed identities or ordering."
    assert len({json.dumps(r, sort_keys=True, ensure_ascii=False) for r in actual}) == len(actual)
    assert len({(r["entity_type"], r["entity_id"]) for r in actual}) == len(actual)
    assert len({(r["entity_type"], r["graph_node_id"]) for r in actual}) == len(actual)
    assert {r["graph_node_id"] for r in actual if r["entity_type"] == "drug"} == candidate_nodes
    assert {r["graph_node_id"] for r in actual if r["entity_type"] == "disease"} == reachable_disease_nodes

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    counts = Counter(r["entity_type"] for r in expected)
    sources = Counter(r["source"] for r in expected)
    assert manifest["counts"] == {
        "total": len(expected), "drug": counts["drug"], "disease": counts["disease"],
        "MONDO": sources["MONDO"], "MONDO_grouped": sources["MONDO_grouped"],
    }
    source_paths = {item["path"]: item["sha256"] for item in manifest["source_inputs"]}
    for path in (DRUG_METADATA, DDI_NEIGHBORS, G3_CONTEXT):
        relative = path.relative_to(PROJECT_DIR).as_posix()
        assert source_paths.get(relative) == sha256(path), f"Input SHA-256 mismatch: {relative}"
    assert set(source_paths) == {
        path.relative_to(PROJECT_DIR).as_posix() for path in (DRUG_METADATA, DDI_NEIGHBORS, G3_CONTEXT)
    }
    assert manifest["inventory"]["sha256"] == sha256(INVENTORY)
    assert manifest["descriptions_included"] is False
    assert manifest["phase_a_external_retrieval_or_llm_generation"] is False

    print("PASS: independently reconstructed exact Drug/Disease identity coverage.")
    print(f"PASS: {counts['drug']:,} Drugs + {counts['disease']:,} Diseases = {len(expected):,} records.")
    print(f"PASS: MONDO={sources['MONDO']:,}; MONDO_grouped={sources['MONDO_grouped']:,}.")
    print("PASS: candidate centers exactly equal exposed training-DDI neighbor Drugs.")
    print("PASS: identity, uniqueness, reachability, UTF-8 JSONL, LF ordering, counts, and SHA-256 integrity verified.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
