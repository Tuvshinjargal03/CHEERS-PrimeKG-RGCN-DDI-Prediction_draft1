"""Verify the NumPy-only single-drug G3 neighborhood service and API."""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient


PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from api.main import app


def assert_counts(payload):
    assert payload["counts"]["total_neighbors"] >= len(payload["neighbors"])
    assert payload["counts"]["total_relationships"] == sum(
        payload["counts"]["by_relation"].values()
    )
    assert payload["counts"]["total_neighbors"] == sum(
        payload["counts"]["by_entity_type"].values()
    )
    assert payload["pagination"]["returned_relationships"] == sum(
        len(node["relationships"]) for node in payload["neighbors"]
    )


def main():
    with TestClient(app) as client:
        first = client.get("/api/context/drug", params={"drug_id": "DB00437"})
        assert first.status_code == 200
        payload = first.json()
        assert len(payload["neighbors"]) <= 50
        assert payload["scope"]["ddi_edges"] == "training_only"
        assert len({node["node_id"] for node in payload["neighbors"]}) == len(payload["neighbors"])
        assert all(node["node_id"] != payload["center"]["node_id"] for node in payload["neighbors"])
        assert_counts(payload)

        allopurinol = client.get(
            "/api/context/drug",
            params={
                "drug_id": "DB00437",
                "relations": "target,enzyme",
                "entity_types": "gene/protein",
                "limit": 200,
            },
        ).json()
        xdh = next(node for node in allopurinol["neighbors"] if node["name"] == "XDH")
        assert {edge["relation"] for edge in xdh["relationships"]} == {"target", "enzyme"}
        assert_counts(allopurinol)

        regression_examples = [
            ("DB00415", "SLC15A1", "target,transporter", {"target", "transporter"}),
            ("DB11100", "dermatitis", "indication,contraindication", {"indication", "contraindication"}),
        ]
        for drug_id, neighbor_name, relations, expected_relations in regression_examples:
            example = client.get(
                "/api/context/drug",
                params={"drug_id": drug_id, "relations": relations, "limit": 200},
            )
            assert example.status_code == 200
            example_payload = example.json()
            neighbor = next(
                node for node in example_payload["neighbors"]
                if node["name"] == neighbor_name
            )
            assert {
                edge["relation"] for edge in neighbor["relationships"]
            } == expected_relations
            assert_counts(example_payload)

        ddi = client.get(
            "/api/context/drug",
            params={"drug_id": "DB00437", "relations": "drug_drug", "limit": 200},
        ).json()
        assert ddi["counts"]["by_entity_type"]["drug"] == ddi["counts"]["total_neighbors"]
        assert all(
            [edge["relation"] for edge in node["relationships"]] == ["drug_drug"]
            for node in ddi["neighbors"]
        )
        assert not any(
            "predicted" in node or "raw_score" in node
            for node in ddi["neighbors"]
        )
        assert_counts(ddi)

        page_one = client.get(
            "/api/context/drug", params={"drug_id": "DB00437", "limit": 10}
        ).json()
        page_two = client.get(
            "/api/context/drug", params={"drug_id": "DB00437", "limit": 10, "offset": 10}
        ).json()
        assert not ({n["node_id"] for n in page_one["neighbors"]} & {n["node_id"] for n in page_two["neighbors"]})
        repeat = client.get(
            "/api/context/drug", params={"drug_id": "DB00437", "limit": 10}
        ).json()
        assert page_one["neighbors"] == repeat["neighbors"]

        assert client.get("/api/context/drug", params={"drug_id": "DB00000"}).status_code == 404
        assert client.get(
            "/api/context/drug", params={"drug_id": "DB00437", "relations": "ddi"}
        ).status_code == 422
        assert client.get(
            "/api/context/drug", params={"drug_id": "DB00437", "entity_types": "protein"}
        ).status_code == 422

    print("PASS: valid, unknown-drug, and invalid-filter API behavior verified.")
    print("PASS: unique-neighbor pagination and deterministic offsets verified.")
    print("PASS: relation/entity filters and pre-pagination counts verified.")
    print("PASS: all three multi-relation regression examples were preserved.")
    print("PASS: DDI scope is training_only with no self or duplicate neighbor.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
