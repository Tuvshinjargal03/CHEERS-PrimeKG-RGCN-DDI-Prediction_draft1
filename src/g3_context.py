"""Standard-library context index for exported G3 support relationships."""

from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path


RELATION_ORDER = (
    "target",
    "enzyme",
    "transporter",
    "carrier",
    "indication",
    "contraindication",
    "off-label use",
)
RELATION_RANK = {
    relation: index
    for index, relation in enumerate(RELATION_ORDER)
}
GROUP_ORDER = {
    "gene/protein": 0,
    "disease": 1,
}


class G3ContextStore:
    """Load and query the exact forward support relationships used in G3."""

    REQUIRED_COLUMNS = {
        "drug_node_id",
        "drug_id",
        "drug_name",
        "relation",
        "context_group",
        "context_node_id",
        "context_id",
        "context_name",
        "context_source",
    }

    INTERPRETATION = (
        "These relationships are graph context available to the G3 model. "
        "They are not causal explanations of the model score. Shared context "
        "does not establish that the drug pair is clinically safe, dangerous, "
        "beneficial, or harmful."
    )

    def __init__(self, project_dir=None, csv_path=None):
        if project_dir is None:
            project_dir = Path(__file__).resolve().parents[1]

        self.project_dir = Path(project_dir).resolve()
        self.csv_path = (
            Path(csv_path).resolve()
            if csv_path is not None
            else self.project_dir
            / "final_release"
            / "g3_context_runtime"
            / "g3_drug_context.csv"
        )
        self.total_rows = 0
        self.group_edge_counts = defaultdict(int)
        self._drugs = {}
        self._load()

    def _load(self):
        with self.csv_path.open(
            "r",
            encoding="utf-8-sig",
            newline="",
        ) as context_file:
            reader = csv.DictReader(context_file)
            if reader.fieldnames is None or not self.REQUIRED_COLUMNS.issubset(
                reader.fieldnames
            ):
                raise ValueError("G3 context CSV columns are incomplete.")

            for row in reader:
                self.total_rows += 1
                group = row["context_group"].strip()
                relation = row["relation"].strip()

                if group not in GROUP_ORDER:
                    raise ValueError(f"Unexpected context group: {group!r}.")
                if relation not in RELATION_RANK:
                    raise ValueError(f"Unexpected G3 relation: {relation!r}.")

                self.group_edge_counts[group] += 1
                drug_key = row["drug_id"].strip().casefold()
                context_node_id = int(row["context_node_id"])
                drug = self._drugs.setdefault(
                    drug_key,
                    {
                        "drug_id": row["drug_id"].strip(),
                        "drug_name": row["drug_name"].strip(),
                        "drug_node_id": int(row["drug_node_id"]),
                        "entities": {},
                    },
                )

                if (
                    drug["drug_id"] != row["drug_id"].strip()
                    or drug["drug_name"] != row["drug_name"].strip()
                    or drug["drug_node_id"] != int(row["drug_node_id"])
                ):
                    raise ValueError(
                        f"Inconsistent drug metadata for {row['drug_id']!r}."
                    )

                entity = drug["entities"].setdefault(
                    context_node_id,
                    {
                        "context_node_id": context_node_id,
                        "context_id": row["context_id"].strip(),
                        "context_name": row["context_name"].strip(),
                        "context_group": group,
                        "context_source": row["context_source"].strip(),
                        "relations": set(),
                    },
                )
                expected_metadata = (
                    row["context_id"].strip(),
                    row["context_name"].strip(),
                    group,
                    row["context_source"].strip(),
                )
                actual_metadata = (
                    entity["context_id"],
                    entity["context_name"],
                    entity["context_group"],
                    entity["context_source"],
                )
                if actual_metadata != expected_metadata:
                    raise ValueError(
                        f"Inconsistent context metadata for node {context_node_id}."
                    )
                entity["relations"].add(relation)

    @staticmethod
    def _entity_sort_key(entity):
        return (
            GROUP_ORDER[entity["context_group"]],
            entity["context_name"].casefold(),
            entity["context_node_id"],
        )

    @staticmethod
    def _sorted_relations(relations):
        return sorted(
            relations,
            key=lambda relation: RELATION_RANK[relation],
        )

    def _resolve(self, drug_id):
        key = str(drug_id).strip().casefold()
        if not key or key not in self._drugs:
            raise KeyError(f"Unknown G3 context drug ID: {drug_id!s}.")
        return self._drugs[key]

    def _serialize_drug(self, drug):
        grouped = {
            "gene_protein": {
                "count": 0,
                "relationships": [],
            },
            "disease": {
                "count": 0,
                "relationships": [],
            },
        }

        for entity in sorted(
            drug["entities"].values(),
            key=self._entity_sort_key,
        ):
            group_key = (
                "gene_protein"
                if entity["context_group"] == "gene/protein"
                else "disease"
            )
            for relation in self._sorted_relations(entity["relations"]):
                grouped[group_key]["relationships"].append(
                    {
                        "context_node_id": entity["context_node_id"],
                        "context_id": entity["context_id"],
                        "context_name": entity["context_name"],
                        "context_group": entity["context_group"],
                        "context_source": entity["context_source"],
                        "relation": relation,
                    }
                )
                grouped[group_key]["count"] += 1

        return {
            "drug_id": drug["drug_id"],
            "drug_name": drug["drug_name"],
            "drug_node_id": drug["drug_node_id"],
            "total_context_edges": (
                grouped["gene_protein"]["count"]
                + grouped["disease"]["count"]
            ),
            "context": grouped,
        }

    def get_drug_context(self, drug_id):
        """Return complete, sorted G3 support context for one drug."""
        return self._serialize_drug(self._resolve(drug_id))

    def get_pair_context(self, drug_a_id, drug_b_id):
        """Return shared and individual G3 support context for a drug pair."""
        drug_a = self._resolve(drug_a_id)
        drug_b = self._resolve(drug_b_id)
        shared_node_ids = (
            set(drug_a["entities"])
            & set(drug_b["entities"])
        )

        shared_entities = []
        for context_node_id in shared_node_ids:
            entity_a = drug_a["entities"][context_node_id]
            entity_b = drug_b["entities"][context_node_id]
            shared_entities.append(
                {
                    "context_node_id": context_node_id,
                    "context_id": entity_a["context_id"],
                    "context_name": entity_a["context_name"],
                    "context_group": entity_a["context_group"],
                    "context_source": entity_a["context_source"],
                    "drug_a_relations": self._sorted_relations(
                        entity_a["relations"]
                    ),
                    "drug_b_relations": self._sorted_relations(
                        entity_b["relations"]
                    ),
                }
            )

        shared_entities.sort(key=self._entity_sort_key)
        gene_protein_count = sum(
            entity["context_group"] == "gene/protein"
            for entity in shared_entities
        )
        disease_count = sum(
            entity["context_group"] == "disease"
            for entity in shared_entities
        )

        return {
            "drug_a": self._serialize_drug(drug_a),
            "drug_b": self._serialize_drug(drug_b),
            "shared": {
                "total": len(shared_entities),
                "gene_protein_count": gene_protein_count,
                "disease_count": disease_count,
                "entities": shared_entities,
            },
            "interpretation": self.INTERPRETATION,
        }


__all__ = [
    "G3ContextStore",
    "GROUP_ORDER",
    "RELATION_ORDER",
]
