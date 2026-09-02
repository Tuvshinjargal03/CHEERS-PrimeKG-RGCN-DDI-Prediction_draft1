"""NumPy-only access to the one-hop context available in frozen G3."""

from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path

import numpy as np


RELATION_ORDER = (
    "drug_drug",
    "target",
    "enzyme",
    "carrier",
    "transporter",
    "indication",
    "contraindication",
    "off-label use",
)
ENTITY_TYPE_ORDER = ("drug", "gene/protein", "disease")
DISPLAY_RELATIONS = {
    "drug_drug": "DDI",
    "target": "Target",
    "enzyme": "Enzyme",
    "carrier": "Carrier",
    "transporter": "Transporter",
    "indication": "Indication",
    "contraindication": "Contraindication",
    "off-label use": "Off-label use",
}


class GraphNeighborhoodStore:
    """Combine training-only DDI adjacency with forward G3 support context."""

    INTERPRETATION = (
        "These relationships describe biomedical context available in the G3 "
        "graph. They are not a causal explanation of model scores and should "
        "not be interpreted as clinical interaction, safety, severity, or "
        "treatment guidance."
    )

    def __init__(self, context_store, project_dir=None):
        if project_dir is None:
            project_dir = Path(__file__).resolve().parents[1]
        self.project_dir = Path(project_dir).resolve()
        self.context_store = context_store
        runtime = self.project_dir / "final_release"
        adjacency_path = runtime / "g3_context_runtime/training_ddi_neighbors.npz"
        metadata_path = runtime / "lightweight_runtime/drug_metadata.csv"

        with np.load(adjacency_path, allow_pickle=False) as adjacency:
            self.indptr = adjacency["indptr"].copy()
            self.indices = adjacency["indices"].copy()
            self.drug_node_ids = adjacency["drug_node_ids"].copy()

        self.drugs = self._load_drugs(metadata_path)
        self.by_id = {drug["entity_id"].casefold(): drug for drug in self.drugs}
        self.by_node = {drug["node_id"]: drug for drug in self.drugs}
        self.local_by_node = {
            int(node_id): index for index, node_id in enumerate(self.drug_node_ids)
        }
        self._validate()

    @staticmethod
    def _load_drugs(path):
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return [
                {
                    "node_id": int(row["node_id"]),
                    "entity_id": row["entity_id"],
                    "name": row["entity_name"],
                    "entity_type": "drug",
                    "source": row["entity_source"],
                }
                for row in csv.DictReader(handle)
            ]

    def _validate(self):
        if self.indptr.shape != (4_279,) or self.indptr.dtype != np.uint32:
            raise ValueError("Training DDI indptr export is invalid.")
        if self.indices.shape != (2_138_160,) or self.indices.dtype != np.uint16:
            raise ValueError("Training DDI indices export is invalid.")
        if self.drug_node_ids.shape != (4_278,):
            raise ValueError("Training DDI drug mapping is invalid.")
        metadata_ids = np.asarray([row["node_id"] for row in self.drugs], dtype=np.int64)
        if not np.array_equal(metadata_ids, self.drug_node_ids):
            raise ValueError("Training DDI and metadata mappings differ.")

    @staticmethod
    def _normalize_filter(values, allowed, label):
        if values is None:
            return None
        normalized = tuple(dict.fromkeys(str(value).strip() for value in values))
        invalid = sorted(set(normalized) - set(allowed))
        if invalid:
            raise ValueError(f"Unknown {label}: {', '.join(invalid)}.")
        return set(normalized)

    def _resolve(self, drug_id):
        drug = self.by_id.get(str(drug_id).strip().casefold())
        if drug is None:
            raise KeyError(f"Unknown drug ID: {drug_id}.")
        return drug

    @staticmethod
    def _relationship(relation):
        return {
            "relation": relation,
            "display_relation": DISPLAY_RELATIONS[relation],
        }

    def get_drug_neighborhood(
        self, drug_id, limit=50, offset=0, relations=None, entity_types=None
    ):
        relation_filter = self._normalize_filter(relations, RELATION_ORDER, "relation")
        entity_filter = self._normalize_filter(
            entity_types, ENTITY_TYPE_ORDER, "entity type"
        )
        center = self._resolve(drug_id)
        center_local = self.local_by_node[center["node_id"]]
        neighbors = {}

        start = int(self.indptr[center_local])
        end = int(self.indptr[center_local + 1])
        for neighbor_local in self.indices[start:end].astype(np.int64):
            drug = self.drugs[int(neighbor_local)]
            neighbors[drug["node_id"]] = {
                **drug,
                "relationships": [self._relationship("drug_drug")],
            }

        try:
            support = self.context_store.get_drug_context(center["entity_id"])
        except KeyError:
            support = {"context": {"gene_protein": {"relationships": []}, "disease": {"relationships": []}}}

        for group in support["context"].values():
            for item in group["relationships"]:
                node = neighbors.setdefault(
                    item["context_node_id"],
                    {
                        "node_id": item["context_node_id"],
                        "entity_id": item["context_id"],
                        "name": item["context_name"],
                        "entity_type": item["context_group"],
                        "source": item["context_source"],
                        "relationships": [],
                    },
                )
                if not any(
                    edge["relation"] == item["relation"]
                    for edge in node["relationships"]
                ):
                    node["relationships"].append(self._relationship(item["relation"]))

        filtered = []
        relation_rank = {value: index for index, value in enumerate(RELATION_ORDER)}
        type_rank = {value: index for index, value in enumerate(ENTITY_TYPE_ORDER)}
        for neighbor in neighbors.values():
            relationships = [
                edge
                for edge in neighbor["relationships"]
                if relation_filter is None or edge["relation"] in relation_filter
            ]
            if not relationships:
                continue
            if entity_filter is not None and neighbor["entity_type"] not in entity_filter:
                continue
            relationships.sort(key=lambda edge: relation_rank[edge["relation"]])
            filtered.append({**neighbor, "relationships": relationships})

        filtered.sort(
            key=lambda item: (
                type_rank[item["entity_type"]],
                item["name"].casefold(),
                item["node_id"],
            )
        )
        by_type = Counter(item["entity_type"] for item in filtered)
        by_relation = Counter(
            edge["relation"] for item in filtered for edge in item["relationships"]
        )
        total_relationships = sum(by_relation.values())
        selected = filtered[int(offset) : int(offset) + int(limit)]
        returned_relationships = sum(
            len(item["relationships"]) for item in selected
        )
        next_offset = int(offset) + len(selected)

        return {
            "center": center,
            "scope": {
                "graph": "G3",
                "hop_depth": 1,
                "ddi_edges": "training_only",
                "support_edges": "g3_forward_support",
            },
            "neighbors": selected,
            "counts": {
                "total_neighbors": len(filtered),
                "total_relationships": total_relationships,
                "by_entity_type": {
                    value: by_type.get(value, 0) for value in ENTITY_TYPE_ORDER
                },
                "by_relation": {
                    value: by_relation.get(value, 0) for value in RELATION_ORDER
                },
            },
            "pagination": {
                "offset": int(offset),
                "limit": int(limit),
                "returned_neighbors": len(selected),
                "returned_relationships": returned_relationships,
                "has_more": next_offset < len(filtered),
                "next_offset": next_offset if next_offset < len(filtered) else None,
            },
            "filters": {
                "relations": list(relations or []),
                "entity_types": list(entity_types or []),
            },
            "interpretation": self.INTERPRETATION,
        }


__all__ = ["ENTITY_TYPE_ORDER", "GraphNeighborhoodStore", "RELATION_ORDER"]
