import unittest

from src.lightweight_inference import DDIPredictor


class DrugSearchQualityTests(unittest.TestCase):
    def setUp(self):
        self.predictor = DDIPredictor.__new__(DDIPredictor)
        self.predictor.drug_metadata = [
            {"entity_name": "Carbaspirin calcium", "entity_id": "DB13612", "node_id": 1},
            {"entity_name": "Acetylsalicylic acid", "entity_id": "DB00945", "node_id": 2},
            {"entity_name": "Nitroaspirin", "entity_id": "DB12445", "node_id": 3},
            {"entity_name": "Warfarin", "entity_id": "DB00682", "node_id": 4},
        ]

    def test_verified_common_name_prefixes_return_aspirin_first(self):
        for query in ("asp", "aspi", "aspir", "aspirin"):
            with self.subTest(query=query):
                results, total = self.predictor.search_drug_page(query, limit=10)
                self.assertEqual(total, 3)
                self.assertEqual(results[0]["entity_id"], "DB00945")
                self.assertEqual(results[0]["name"], "Acetylsalicylic acid")
                self.assertEqual(
                    {result["entity_id"] for result in results[1:]},
                    {"DB13612", "DB12445"},
                )

    def test_exact_canonical_search_behavior_is_preserved(self):
        results, total = self.predictor.search_drug_page("Warfarin", limit=10)
        self.assertEqual(total, 1)
        self.assertEqual(results[0]["entity_id"], "DB00682")


if __name__ == "__main__":
    unittest.main()
