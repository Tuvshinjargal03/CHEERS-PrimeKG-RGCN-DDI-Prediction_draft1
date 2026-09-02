"""Export the frozen G3 training-only DDI adjacency as NumPy CSR arrays."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import torch


PROJECT_DIR = Path(__file__).resolve().parents[1]
GRAPH_PATH = PROJECT_DIR / "data/processed/rgcn_tensors/G3.pt"
EMBEDDINGS_PATH = (
    PROJECT_DIR
    / "final_release/lightweight_runtime/ddi_runtime_embeddings.npz"
)
OUTPUT_DIR = PROJECT_DIR / "final_release/g3_context_runtime"
OUTPUT_PATH = OUTPUT_DIR / "training_ddi_neighbors.npz"
MANIFEST_PATH = OUTPUT_DIR / "TRAINING_DDI_NEIGHBORS_MANIFEST.json"

EXPECTED_DRUGS = 4_278
EXPECTED_DIRECTED = 2_138_160
EXPECTED_UNDIRECTED = 1_069_080
DDI_RELATION_ID = 0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    graph = torch.load(GRAPH_PATH, map_location="cpu", weights_only=True)
    edge_index = graph["edge_index"][:, graph["edge_type"] == DDI_RELATION_ID]

    with np.load(EMBEDDINGS_PATH, allow_pickle=False) as exported:
        drug_node_ids = exported["drug_node_ids"].astype(np.int64, copy=True)

    if drug_node_ids.shape != (EXPECTED_DRUGS,):
        raise AssertionError("Unexpected candidate drug-node mapping shape.")
    if not np.all(drug_node_ids[:-1] < drug_node_ids[1:]):
        raise AssertionError("Candidate drug node IDs must be sorted and unique.")
    if edge_index.shape != (2, EXPECTED_DIRECTED):
        raise AssertionError("Unexpected relation-0 directed edge count.")

    source = edge_index[0].numpy()
    target = edge_index[1].numpy()
    if np.any(source == target):
        raise AssertionError("Training DDI adjacency contains a self-loop.")

    source_local = np.searchsorted(drug_node_ids, source)
    target_local = np.searchsorted(drug_node_ids, target)
    if np.any(source_local >= EXPECTED_DRUGS) or not np.array_equal(
        drug_node_ids[source_local], source
    ):
        raise AssertionError("A G3 DDI source lies outside the candidate universe.")
    if np.any(target_local >= EXPECTED_DRUGS) or not np.array_equal(
        drug_node_ids[target_local], target
    ):
        raise AssertionError("A G3 DDI target lies outside the candidate universe.")

    order = np.lexsort((target_local, source_local))
    source_local = source_local[order]
    target_local = target_local[order]
    encoded = source_local.astype(np.uint64) * EXPECTED_DRUGS + target_local
    if np.unique(encoded).size != EXPECTED_DIRECTED:
        raise AssertionError("Duplicate directed training DDI rows were found.")

    reverse_encoded = target_local.astype(np.uint64) * EXPECTED_DRUGS + source_local
    if not np.array_equal(np.sort(encoded), np.sort(reverse_encoded)):
        raise AssertionError("Training DDI adjacency is not symmetric.")

    counts = np.bincount(source_local, minlength=EXPECTED_DRUGS)
    if np.any(counts == 0):
        raise AssertionError("A candidate drug has no training DDI adjacency row.")
    indptr = np.empty(EXPECTED_DRUGS + 1, dtype=np.uint32)
    indptr[0] = 0
    np.cumsum(counts, dtype=np.uint32, out=indptr[1:])
    indices = target_local.astype(np.uint16, copy=False)

    undirected = np.minimum(source_local, target_local).astype(np.uint64)
    undirected *= EXPECTED_DRUGS
    undirected += np.maximum(source_local, target_local).astype(np.uint64)
    if np.unique(undirected).size != EXPECTED_UNDIRECTED:
        raise AssertionError("Unexpected unique undirected training DDI count.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        OUTPUT_PATH,
        indptr=indptr,
        indices=indices,
        drug_node_ids=drug_node_ids,
    )

    manifest = {
        "graph": "G3",
        "relation": "drug_drug",
        "relation_id": DDI_RELATION_ID,
        "scope": "training_only",
        "candidate_drugs": EXPECTED_DRUGS,
        "directed_entries": EXPECTED_DIRECTED,
        "undirected_pairs": EXPECTED_UNDIRECTED,
        "self_loops": 0,
        "duplicate_directed_rows": 0,
        "missing_reverse_edges": 0,
        "source_artifact": "data/processed/rgcn_tensors/G3.pt",
        "runtime_artifact": (
            "final_release/g3_context_runtime/training_ddi_neighbors.npz"
        ),
        "arrays": {
            "indptr": {"shape": [4_279], "dtype": "uint32"},
            "indices": {"shape": [EXPECTED_DIRECTED], "dtype": "uint16"},
            "drug_node_ids": {"shape": [EXPECTED_DRUGS], "dtype": "int64"},
        },
        "sha256": {
            "source_artifact": sha256(GRAPH_PATH),
            "runtime_artifact": sha256(OUTPUT_PATH),
        },
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    print(f"PASS: exported {EXPECTED_DIRECTED:,} directed training DDI entries.")
    print(f"PASS: verified {EXPECTED_UNDIRECTED:,} unique undirected pairs.")
    print(f"Artifact: {OUTPUT_PATH}")
    print(f"SHA256: {manifest['sha256']['runtime_artifact']}")


if __name__ == "__main__":
    main()
