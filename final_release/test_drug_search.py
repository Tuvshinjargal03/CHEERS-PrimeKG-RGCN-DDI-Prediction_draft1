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

    def test_research_browse_orders_verified_names_first(self):
        results, total = self.predictor.search_drug_page(
            "",
            limit=4,
            common_names_first=True,
        )
        self.assertEqual(total, 4)
        self.assertEqual(results[0]["entity_id"], "DB00945")
        self.assertEqual(
            [result["name"] for result in results[1:]],
            ["Carbaspirin calcium", "Nitroaspirin", "Warfarin"],
        )

    def test_eligible_inventory_is_filtered_before_pagination_and_search(self):
        eligible_ids = {"DB00945", "DB00682"}
        first, total = self.predictor.search_drug_page(
            "",
            limit=1,
            offset=0,
            eligible_entity_ids=eligible_ids,
            common_names_first=True,
        )
        second, second_total = self.predictor.search_drug_page(
            "",
            limit=1,
            offset=1,
            eligible_entity_ids=eligible_ids,
            common_names_first=True,
        )
        excluded, excluded_total = self.predictor.search_drug_page(
            "nitro",
            limit=10,
            eligible_entity_ids=eligible_ids,
        )
        self.assertEqual(total, 2)
        self.assertEqual(second_total, 2)
        self.assertEqual(first[0]["entity_id"], "DB00945")
        self.assertEqual(second[0]["entity_id"], "DB00682")
        self.assertEqual(excluded, [])
        self.assertEqual(excluded_total, 0)

    def test_common_drugs_use_verified_alias_targets_and_respect_scope(self):
        all_common = self.predictor.common_drugs()
        scoped_common = self.predictor.common_drugs({"DB00682"})
        self.assertEqual([item["entity_id"] for item in all_common], ["DB00945"])
        self.assertEqual(all_common[0]["name"], "Acetylsalicylic acid")
        self.assertEqual(scoped_common, [])


if __name__ == "__main__":
    unittest.main()
