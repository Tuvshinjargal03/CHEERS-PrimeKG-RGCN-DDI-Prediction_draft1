"""Standalone verification for the exported G3 support-context runtime."""

from __future__ import annotations

import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from src.g3_context import G3ContextStore


def main():
    store = G3ContextStore(project_dir=PROJECT_DIR)

    assert store.total_rows == 68_284, (
        f"Expected 68,284 CSV rows, found {store.total_rows:,}."
    )
    assert store.group_edge_counts["gene/protein"] == 25_653, (
        "Unexpected gene/protein edge count: "
        f"{store.group_edge_counts['gene/protein']:,}."
    )
    assert store.group_edge_counts["disease"] == 42_631, (
        "Unexpected disease edge count: "
        f"{store.group_edge_counts['disease']:,}."
    )

    pair = store.get_pair_context("DB01394", "DB01032")
    assert pair["drug_a"]["drug_name"] == "Colchicine"
    assert pair["drug_b"]["drug_name"] == "Probenecid"
    assert pair["drug_a"]["total_context_edges"] == 39, (
        "Colchicine context edge count differs: "
        f"{pair['drug_a']['total_context_edges']}."
    )
    assert pair["drug_b"]["total_context_edges"] == 69, (
        "Probenecid context edge count differs: "
        f"{pair['drug_b']['total_context_edges']}."
    )
    assert pair["shared"]["total"] == 33, (
        "Colchicine + Probenecid shared context count differs: "
        f"{pair['shared']['total']}."
    )

    for entity in pair["shared"]["entities"]:
        assert entity["drug_a_relations"], (
            f"Missing Drug A relations for context node "
            f"{entity['context_node_id']}."
        )
        assert entity["drug_b_relations"], (
            f"Missing Drug B relations for context node "
            f"{entity['context_node_id']}."
        )
        assert entity["context_name"], (
            f"Missing name for context node {entity['context_node_id']}."
        )
        assert entity["context_group"] in {
            "gene/protein",
            "disease",
        }, (
            f"Unexpected group for context node "
            f"{entity['context_node_id']}: "
            f"{entity['context_group']!r}."
        )

    print(
        "PASS: G3 context runtime verified 68,284 exported support "
        "relationships."
    )
    print(
        "PASS: Colchicine (39) + Probenecid (69) returned "
        "33 shared contextual entities."
    )


if __name__ == "__main__":
    main()
