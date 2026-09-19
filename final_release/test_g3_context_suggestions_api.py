"""Focused non-network tests for the G3 pair-suggestion API route."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from fastapi.testclient import TestClient

from api import main as api


class FixtureContextStore:
    def __init__(self):
        self.suggestion_calls = []
        self.pair_calls = []
        self.suggestions = [
            {
                "anchor_drug_id": "DB00001",
                "anchor_drug_name": "Alpha",
                "candidate_drug_id": "DB00020",
                "candidate_drug_name": "Twenty",
                "shared": {
                    "total": 8,
                    "gene_protein_count": 5,
                    "disease_count": 3,
                },
            },
            {
                "anchor_drug_id": "DB00002",
                "anchor_drug_name": "Beta",
                "candidate_drug_id": "DB00003",
                "candidate_drug_name": "Gamma",
                "shared": {
                    "total": 6,
                    "gene_protein_count": 4,
                    "disease_count": 2,
                },
            },
            {
                "anchor_drug_id": "DB00001",
                "anchor_drug_name": "Alpha",
                "candidate_drug_id": "DB00004",
                "candidate_drug_name": "Delta",
                "shared": {
                    "total": 5,
                    "gene_protein_count": 3,
                    "disease_count": 2,
                },
            },
        ]
        self.pair_payload = {
            "drug_a": {"drug_id": "DB00001", "drug_name": "Alpha"},
            "drug_b": {"drug_id": "DB00002", "drug_name": "Beta"},
            "shared": {
                "total": 0,
                "gene_protein_count": 0,
                "disease_count": 0,
                "entities": [],
            },
            "interpretation": "Existing pair-context fixture.",
        }

    def get_pair_suggestions(self, drug_a_id, drug_b_id, limit=6):
        self.suggestion_calls.append((drug_a_id, drug_b_id, limit))
        if "DB99999" in {drug_a_id, drug_b_id}:
            raise KeyError("Unknown G3 context drug ID: DB99999.")
        if {drug_a_id, drug_b_id} == {"DB00009", "DB00010"}:
            return []
        return self.suggestions[:limit]

    def get_pair_context(self, drug_a_id, drug_b_id):
        self.pair_calls.append((drug_a_id, drug_b_id))
        return self.pair_payload


class PairSuggestionApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(api.app)
        cls.addClassCleanup(cls.client.close)

    def setUp(self):
        self.store = FixtureContextStore()
        self.enterContext(
            patch.object(
                api.app.state,
                "context_store",
                self.store,
                create=True,
            )
        )

    def request_suggestions(self, **params):
        return self.client.get(
            "/api/context/pair-suggestions",
            params={
                "drug_a_id": "DB00001",
                "drug_b_id": "DB00002",
                **params,
            },
        )

    def test_valid_response_preserves_service_order_and_safe_shape(self):
        response = self.request_suggestions()

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(
            set(payload),
            {"pair", "suggestions", "count", "interpretation"},
        )
        self.assertEqual(
            payload["pair"],
            {"drug_a_id": "DB00001", "drug_b_id": "DB00002"},
        )
        self.assertEqual(payload["suggestions"], self.store.suggestions)
        self.assertEqual(payload["count"], len(payload["suggestions"]))
        self.assertEqual(
            self.store.suggestion_calls,
            [("DB00001", "DB00002", 6)],
        )

        serialized = json.dumps(payload).casefold()
        for forbidden in (
            "model_score",
            "probability",
            "risk",
            "safe",
            "unsafe",
            "recommendation",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, serialized)

    def test_limit_is_forwarded_and_out_of_range_values_are_rejected(self):
        response = self.request_suggestions(limit=2)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["suggestions"], self.store.suggestions[:2])
        self.assertEqual(response.json()["count"], 2)
        self.assertEqual(
            self.store.suggestion_calls,
            [("DB00001", "DB00002", 2)],
        )

        for invalid_limit in (0, 51):
            with self.subTest(limit=invalid_limit):
                invalid = self.request_suggestions(limit=invalid_limit)
                self.assertEqual(invalid.status_code, 422, invalid.text)

        self.assertEqual(len(self.store.suggestion_calls), 1)

    def test_invalid_id_uses_existing_context_route_error_style(self):
        response = self.request_suggestions(drug_b_id="DB99999")

        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(
            response.json(),
            {"detail": "Unknown G3 context drug ID: DB99999."},
        )

    def test_empty_suggestions_are_a_successful_response(self):
        response = self.request_suggestions(
            drug_a_id="DB00009",
            drug_b_id="DB00010",
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["suggestions"], [])
        self.assertEqual(response.json()["count"], 0)

    def test_existing_pair_context_route_is_unchanged(self):
        response = self.client.get(
            "/api/context/pair",
            params={"drug_a_id": "DB00001", "drug_b_id": "DB00002"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), self.store.pair_payload)
        self.assertEqual(self.store.pair_calls, [("DB00001", "DB00002")])


if __name__ == "__main__":
    unittest.main()
