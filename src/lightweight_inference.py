"""NumPy-only inference runtime for the verified CHEERS G3 model export."""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np


class DDIPredictor:
    """Serve the verified G3 / Seed 44 DDI export without PyTorch."""

    GRAPH_NAME = "G3"
    SEED = 44
    BEST_EPOCH = 499
    CANDIDATE_DRUG_COUNT = 4_278
    EMBEDDING_DIMENSION = 128
    NUM_NODES = 13_094
    NUM_RELATIONS = 15

    def __init__(self, project_dir=None, device=None):
        del device  # Kept only for compatibility with the original constructor.

        if project_dir is None:
            project_dir = Path(__file__).resolve().parents[1]

        self.project_dir = Path(project_dir).resolve()
        self.runtime_dir = (
            self.project_dir / "final_release" / "lightweight_runtime"
        )

        embeddings_path = self.runtime_dir / "ddi_runtime_embeddings.npz"
        mask_path = self.runtime_dir / "known_positive_mask_packed.npz"
        metadata_path = self.runtime_dir / "drug_metadata.csv"

        with np.load(embeddings_path, allow_pickle=False) as exported:
            self.candidate_embeddings = exported[
                "candidate_embeddings"
            ].copy()
            self.ddi_relation = exported["ddi_relation"].copy()
            self.drug_node_ids = exported["drug_node_ids"].copy()

        with np.load(mask_path, allow_pickle=False) as exported_mask:
            self.packed_known_positive_mask = exported_mask[
                "packed_mask"
            ].copy()
            exported_num_drugs = int(exported_mask["num_drugs"][0])

        self.drug_metadata = self._load_metadata(metadata_path)
        self._validate_export(exported_num_drugs)

        self.metadata_lookup = {
            row["node_id"]: row for row in self.drug_metadata
        }

        self.device = "cpu"
        self.graph_name = self.GRAPH_NAME
        self.seed = self.SEED
        self.best_epoch = self.BEST_EPOCH
        self.num_nodes = self.NUM_NODES
        self.num_relations = self.NUM_RELATIONS
        self.candidate_drug_count = self.CANDIDATE_DRUG_COUNT
        self.embedding_dimension = self.EMBEDDING_DIMENSION

    @staticmethod
    def _load_metadata(path):
        with path.open("r", encoding="utf-8-sig", newline="") as metadata_file:
            reader = csv.DictReader(metadata_file)
            required_columns = {
                "node_id",
                "original_index",
                "entity_name",
                "entity_id",
                "entity_source",
            }

            if reader.fieldnames is None or not required_columns.issubset(
                reader.fieldnames
            ):
                raise ValueError("Drug metadata columns are incomplete.")

            return [
                {
                    "node_id": int(row["node_id"]),
                    "original_index": int(row["original_index"]),
                    "entity_name": str(row["entity_name"]),
                    "entity_id": str(row["entity_id"]),
                    "entity_source": str(row["entity_source"]),
                }
                for row in reader
            ]

    def _validate_export(self, exported_num_drugs):
        expected_embedding_shape = (
            self.CANDIDATE_DRUG_COUNT,
            self.EMBEDDING_DIMENSION,
        )
        expected_packed_columns = (self.CANDIDATE_DRUG_COUNT + 7) // 8

        if self.candidate_embeddings.shape != expected_embedding_shape:
            raise ValueError(
                "Expected 4,278 candidate embeddings with dimension 128."
            )

        if self.ddi_relation.shape != (self.EMBEDDING_DIMENSION,):
            raise ValueError("Expected a 128-dimensional DDI relation vector.")

        if self.drug_node_ids.shape != (self.CANDIDATE_DRUG_COUNT,):
            raise ValueError("Expected 4,278 candidate drug node IDs.")

        if self.packed_known_positive_mask.shape != (
            self.CANDIDATE_DRUG_COUNT,
            expected_packed_columns,
        ):
            raise ValueError("Known-positive packed mask shape is invalid.")

        if exported_num_drugs != self.CANDIDATE_DRUG_COUNT:
            raise ValueError("Known-positive mask drug count is invalid.")

        if len(self.drug_metadata) != self.CANDIDATE_DRUG_COUNT:
            raise ValueError("Expected 4,278 drug metadata rows.")

        metadata_node_ids = np.fromiter(
            (row["node_id"] for row in self.drug_metadata),
            dtype=self.drug_node_ids.dtype,
            count=self.CANDIDATE_DRUG_COUNT,
        )

        if not np.array_equal(metadata_node_ids, self.drug_node_ids):
            raise ValueError("Candidate drug metadata mapping mismatch.")

        if len(set(metadata_node_ids.tolist())) != self.CANDIDATE_DRUG_COUNT:
            raise ValueError("Drug node IDs are not unique.")

    def _matching_drugs(self, query):
        """Return deterministic candidate rows for browsing or text search."""
        query = str(query).strip()
        query_folded = query.casefold()

        if query_folded:
            matches = [
                row
                for row in self.drug_metadata
                if query_folded in row["entity_name"].casefold()
                or row["entity_id"].casefold() == query_folded
            ]
        else:
            matches = list(self.drug_metadata)

        def match_priority(row):
            name_folded = row["entity_name"].casefold()
            entity_id_folded = row["entity_id"].casefold()
            if not query_folded:
                return 0
            if name_folded == query_folded:
                return 0
            if entity_id_folded == query_folded:
                return 1
            if name_folded.startswith(query_folded):
                return 2
            return 3

        matches.sort(
            key=lambda row: (
                match_priority(row),
                row["entity_name"].casefold(),
                row["entity_id"].casefold(),
                int(row["node_id"]),
            )
        )
        return matches

    def search_drug_page(self, query, limit=20, offset=0):
        """Return one bounded page plus the total number of matching drugs."""
        matches = self._matching_drugs(query)
        offset = max(0, int(offset))
        limit = max(0, int(limit))
        page = matches[offset:offset + limit]

        return (
            [
                {
                    "name": row["entity_name"],
                    "entity_id": row["entity_id"],
                    "node_id": row["node_id"],
                }
                for row in page
            ],
            len(matches),
        )

    def search_drugs(self, query, limit=20, offset=0):
        """Compatibility wrapper returning only the requested result rows."""
        results, _ = self.search_drug_page(
            query=query,
            limit=limit,
            offset=offset,
        )
        return results

    def resolve_drug(self, query):
        query = str(query).strip()
        query_folded = query.casefold()
        matches = [
            row
            for row in self.drug_metadata
            if row["entity_name"].casefold() == query_folded
            or row["entity_id"].casefold() == query_folded
        ]

        if not matches:
            suggestions = self.search_drugs(query, limit=10)
            raise ValueError(
                f"No exact drug found for '{query}'. Suggestions: {suggestions}"
            )

        if len(matches) > 1:
            raise ValueError(f"Ambiguous exact query: '{query}'.")

        row = matches[0]
        return {
            "name": row["entity_name"],
            "entity_id": row["entity_id"],
            "node_id": row["node_id"],
            "original_index": row["original_index"],
            "source": row["entity_source"],
        }

    def predict(self, query, top_k=10):
        top_k = int(top_k)

        if top_k < 1:
            raise ValueError("top_k must be at least 1.")

        query_info = self.resolve_drug(query)
        query_node = query_info["node_id"]
        query_local = int(np.searchsorted(self.drug_node_ids, query_node))

        if (
            query_local >= self.candidate_drug_count
            or int(self.drug_node_ids[query_local]) != query_node
        ):
            raise RuntimeError("Drug node mapping failed.")

        query_embedding = self.candidate_embeddings[query_local]
        scores = query_embedding @ (
            self.candidate_embeddings * self.ddi_relation
        ).T

        # Only the selected query row is unpacked from the exported packed mask.
        known = np.unpackbits(
            self.packed_known_positive_mask[query_local],
            count=self.candidate_drug_count,
            bitorder="big",
        ).astype(bool, copy=False)
        known_positive_count = int(known.sum())

        filter_mask = known.copy()
        filter_mask[query_local] = True
        available_count = int(np.count_nonzero(~filter_mask))
        actual_top_k = min(top_k, available_count)

        filtered_scores = scores.copy()
        filtered_scores[filter_mask] = -np.inf
        ranked_local = np.argsort(-filtered_scores, kind="stable")[:actual_top_k]

        predictions = []
        for rank, candidate_local in enumerate(ranked_local.tolist(), start=1):
            candidate_node = int(self.drug_node_ids[candidate_local])

            if candidate_node == query_node:
                raise RuntimeError("Self-pair escaped filtering.")

            if bool(known[candidate_local]):
                raise RuntimeError("Known positive escaped filtering.")

            metadata = self.metadata_lookup[candidate_node]
            predictions.append(
                {
                    "rank": rank,
                    "name": metadata["entity_name"],
                    "entity_id": metadata["entity_id"],
                    "node_id": candidate_node,
                    "raw_score": float(filtered_scores[candidate_local]),
                    "known_positive_in_primekg": False,
                }
            )

        return {
            "query": query_info,
            "model": {
                "graph": self.graph_name,
                "seed": self.seed,
                "best_epoch": self.best_epoch,
            },
            "candidate_drug_count": self.candidate_drug_count,
            "known_positive_candidates_filtered": known_positive_count,
            "available_unobserved_candidates": available_count,
            "predictions": predictions,
            "disclaimer": (
                "These are model-predicted unobserved PrimeKG drug_drug "
                "candidate links. They are not clinically validated "
                "interactions and raw scores are not probabilities."
            ),
        }


__all__ = ["DDIPredictor"]
