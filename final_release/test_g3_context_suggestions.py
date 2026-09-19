"""Focused tests for G3 shared-context pair suggestions."""

from __future__ import annotations

import csv
from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from src.g3_context import G3ContextStore


FIELDNAMES = (
    "drug_node_id",
    "drug_id",
    "drug_name",
    "relation",
    "context_group",
    "context_node_id",
    "context_id",
    "context_name",
    "context_source",
)


class G3ContextSuggestionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_directory = tempfile.TemporaryDirectory()
        csv_path = Path(cls.temp_directory.name) / "g3_context.csv"
        rows = []

        def add_drug(drug_id, name, gene_nodes=(), disease_nodes=()):
            drug_node_id = int(drug_id.removeprefix("DB"))
            for node_id in gene_nodes:
                rows.append(
                    {
                        "drug_node_id": drug_node_id,
                        "drug_id": drug_id,
                        "drug_name": name,
                        "relation": "target",
                        "context_group": "gene/protein",
                        "context_node_id": node_id,
                        "context_id": f"GENE{node_id}",
                        "context_name": f"Gene {node_id}",
                        "context_source": "fixture",
                    }
                )
            for node_id in disease_nodes:
                rows.append(
                    {
                        "drug_node_id": drug_node_id,
                        "drug_id": drug_id,
                        "drug_name": name,
                        "relation": "indication",
                        "context_group": "disease",
                        "context_node_id": node_id,
                        "context_id": f"DISEASE{node_id}",
                        "context_name": f"Disease {node_id}",
                        "context_source": "fixture",
                    }
                )

        add_drug("DB00001", "Alpha", (1, 2, 3, 4), (101, 102))
        add_drug("DB00002", "Beta", (1, 5, 6), (103, 104))
        add_drug("DB00003", "Gamma", (1, 2, 3, 4), (101, 102, 110))
        add_drug("DB00004", "Delta", (1, 2, 3), (101, 102, 111))
        add_drug("DB00005", "Epsilon", (1, 2), (101, 102, 112))
        add_drug("DB00006", "Zeta", (1, 2), (101, 102, 113))
        add_drug("DB00007", "Eta", (1, 5, 6), (103, 104, 114))
        add_drug("DB00008", "Theta", (1, 2), (101, 102, 115))
        add_drug("DB00009", "Iota", (900,), (901,))
        add_drug("DB00010", "Kappa", (910,), (911,))
        for index in range(100, 160):
            add_drug(
                f"DB{index:05d}",
                f"Candidate {index}",
                (1,),
            )

        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
            writer.writeheader()
            writer.writerows(rows)

        cls.store = G3ContextStore(csv_path=csv_path)

    @classmethod
    def tearDownClass(cls):
        cls.temp_directory.cleanup()

    def test_suggestions_are_positive_anchored_unique_and_exclude_current_pair(self):
        suggestions = self.store.get_pair_suggestions(
            "DB00001",
            "DB00002",
            limit=50,
        )
        current_ids = {"DB00001", "DB00002"}
        canonical_pairs = []

        self.assertTrue(suggestions)
        for suggestion in suggestions:
            self.assertGreater(suggestion["shared"]["total"], 0)
            self.assertIn(suggestion["anchor_drug_id"], current_ids)
            self.assertNotIn(suggestion["candidate_drug_id"], current_ids)
            canonical_pairs.append(
                tuple(
                    sorted(
                        (
                            suggestion["anchor_drug_id"],
                            suggestion["candidate_drug_id"],
                        )
                    )
                )
            )

        self.assertEqual(len(canonical_pairs), len(set(canonical_pairs)))
        self.assertNotIn(("DB00001", "DB00002"), canonical_pairs)

    def test_ranking_uses_counts_then_ids(self):
        suggestions = self.store.get_pair_suggestions(
            "DB00001",
            "DB00002",
            limit=50,
        )
        actual_keys = [
            self.store._suggestion_sort_key(suggestion)
            for suggestion in suggestions
        ]

        self.assertEqual(actual_keys, sorted(actual_keys))
        self.assertEqual(
            actual_keys[0],
            (-6, -4, -2, "DB00001", "DB00003"),
        )
        self.assertEqual(
            [
                (
                    item["anchor_drug_id"],
                    item["candidate_drug_id"],
                    item["shared"]["total"],
                    item["shared"]["gene_protein_count"],
                    item["shared"]["disease_count"],
                )
                for item in suggestions[:5]
            ],
            [
                ("DB00001", "DB00003", 6, 4, 2),
                ("DB00001", "DB00004", 5, 3, 2),
                ("DB00002", "DB00007", 5, 3, 2),
                ("DB00001", "DB00005", 4, 2, 2),
                ("DB00001", "DB00006", 4, 2, 2),
            ],
        )

    def test_counts_match_pair_context_and_result_has_no_verdict_fields(self):
        suggestions = self.store.get_pair_suggestions(
            "DB00001",
            "DB00002",
            limit=50,
        )
        forbidden_fields = {
            "model_score",
            "probability",
            "risk_score",
            "safety_label",
            "treatment_recommendation",
        }

        for suggestion in suggestions:
            self.assertEqual(
                set(suggestion),
                {
                    "anchor_drug_id",
                    "anchor_drug_name",
                    "candidate_drug_id",
                    "candidate_drug_name",
                    "shared",
                },
            )
            self.assertEqual(
                set(suggestion["shared"]),
                {"total", "gene_protein_count", "disease_count"},
            )
            pair = self.store.get_pair_context(
                suggestion["anchor_drug_id"],
                suggestion["candidate_drug_id"],
            )
            self.assertEqual(
                suggestion["shared"],
                {
                    "total": pair["shared"]["total"],
                    "gene_protein_count": pair["shared"]["gene_protein_count"],
                    "disease_count": pair["shared"]["disease_count"],
                },
            )
            self.assertTrue(forbidden_fields.isdisjoint(suggestion))
            self.assertTrue(forbidden_fields.isdisjoint(suggestion["shared"]))

    def test_limit_same_anchor_deduplication_and_validation(self):
        self.assertEqual(
            len(self.store.get_pair_suggestions("DB00001", "DB00002")),
            6,
        )
        self.assertEqual(
            len(self.store.get_pair_suggestions("DB00001", "DB00002", limit=3)),
            3,
        )
        self.assertEqual(
            len(
                self.store.get_pair_suggestions(
                    "DB00001",
                    "DB00002",
                    limit=1_000,
                )
            ),
            50,
        )
        same_anchor = self.store.get_pair_suggestions(
            "DB00001",
            "db00001",
            limit=50,
        )
        pairs = {
            tuple(sorted((item["anchor_drug_id"], item["candidate_drug_id"])))
            for item in same_anchor
        }
        self.assertEqual(len(same_anchor), len(pairs))

        for invalid_limit in (0, -1, 1.5, True, "6"):
            with self.subTest(limit=invalid_limit):
                with self.assertRaises(ValueError):
                    self.store.get_pair_suggestions(
                        "DB00001",
                        "DB00002",
                        limit=invalid_limit,
                    )

    def test_invalid_ids_match_existing_behavior_and_no_result_is_empty(self):
        with self.assertRaises(KeyError):
            self.store.get_pair_suggestions("DB99999", "DB00002")
        with self.assertRaises(KeyError):
            self.store.get_pair_suggestions("DB00001", "DB99999")

        self.assertEqual(
            self.store.get_pair_suggestions("DB00009", "DB00010"),
            [],
        )


if __name__ == "__main__":
    unittest.main()
