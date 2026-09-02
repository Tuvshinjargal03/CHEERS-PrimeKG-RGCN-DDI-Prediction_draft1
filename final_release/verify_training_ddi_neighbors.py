"""Verify the exported G3 training-only DDI CSR runtime artifact."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np


PROJECT_DIR = Path(__file__).resolve().parents[1]
ARTIFACT = PROJECT_DIR / "final_release/g3_context_runtime/training_ddi_neighbors.npz"
MANIFEST = PROJECT_DIR / "final_release/g3_context_runtime/TRAINING_DDI_NEIGHBORS_MANIFEST.json"
EMBEDDINGS = PROJECT_DIR / "final_release/lightweight_runtime/ddi_runtime_embeddings.npz"
GRAPH = PROJECT_DIR / "data/processed/rgcn_tensors/G3.pt"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    with np.load(ARTIFACT, allow_pickle=False) as exported:
        indptr = exported["indptr"].copy()
        indices = exported["indices"].copy()
        drug_node_ids = exported["drug_node_ids"].copy()
    with np.load(EMBEDDINGS, allow_pickle=False) as runtime:
        expected_ids = runtime["drug_node_ids"].copy()

    assert indptr.shape == (4_279,) and indptr.dtype == np.uint32
    assert indices.shape == (2_138_160,) and indices.dtype == np.uint16
    assert drug_node_ids.shape == (4_278,) and drug_node_ids.dtype == np.int64
    assert np.array_equal(drug_node_ids, expected_ids)
    assert int(indptr[0]) == 0 and int(indptr[-1]) == indices.size
    assert bool(np.all(indptr[:-1] <= indptr[1:]))
    assert int(indices.min()) >= 0 and int(indices.max()) < 4_278

    sources = np.repeat(np.arange(4_278, dtype=np.uint32), np.diff(indptr))
    targets = indices.astype(np.uint32)
    assert not bool(np.any(sources == targets))
    encoded = sources.astype(np.uint64) * 4_278 + targets
    assert np.unique(encoded).size == 2_138_160
    reverse = targets.astype(np.uint64) * 4_278 + sources
    assert np.array_equal(np.sort(encoded), np.sort(reverse))
    undirected = np.minimum(sources, targets).astype(np.uint64) * 4_278
    undirected += np.maximum(sources, targets).astype(np.uint64)
    assert np.unique(undirected).size == 1_069_080
    assert bool(np.all(np.diff(indptr) > 0))

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    expected_manifest = {
        "graph": "G3",
        "relation": "drug_drug",
        "relation_id": 0,
        "scope": "training_only",
        "candidate_drugs": 4_278,
        "directed_entries": 2_138_160,
        "undirected_pairs": 1_069_080,
        "self_loops": 0,
        "duplicate_directed_rows": 0,
        "missing_reverse_edges": 0,
    }
    for key, value in expected_manifest.items():
        assert manifest[key] == value, f"Manifest mismatch for {key}."
    assert manifest["sha256"]["runtime_artifact"] == sha256(ARTIFACT)
    assert manifest["sha256"]["source_artifact"] == sha256(GRAPH)

    try:
        import torch
    except ImportError:
        print("SKIP: PyTorch direct-source comparison unavailable.")
    else:
        graph = torch.load(GRAPH, map_location="cpu", weights_only=True)
        ddi = graph["edge_index"][:, graph["edge_type"] == 0].numpy()
        source_local = np.searchsorted(drug_node_ids, ddi[0])
        target_local = np.searchsorted(drug_node_ids, ddi[1])
        source_encoded = source_local.astype(np.uint64) * 4_278 + target_local
        assert np.array_equal(np.sort(encoded), np.sort(source_encoded))
        endpoints = set(ddi.reshape(-1).tolist())
        assert endpoints <= set(drug_node_ids.tolist())
        print("PASS: CSR adjacency exactly matches G3.pt relation 0.")

    print("PASS: NumPy loaded 4,278 candidate adjacency rows.")
    print("PASS: 2,138,160 directed entries and 1,069,080 pairs verified.")
    print("PASS: no self-neighbors, duplicates, missing reverse edges, or mapping gaps.")
    print("PASS: manifest metadata and SHA-256 checksums verified.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
