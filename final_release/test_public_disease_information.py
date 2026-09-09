"""Focused tests for public disease profiles and typed medicine relations."""

from pathlib import Path
import ast
import importlib.util
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.disease_information import DiseaseInformationService


class DiseaseInformationServiceTests(unittest.TestCase):
    SUPPORTED_NUTRITION = {
        "5148": ("type 2 diabetes mellitus", "NIDDK"),
        "5393": ("gout", "NIAMS"),
        "1356": ("iron deficiency anemia", "NHLBI"),
    }

    @classmethod
    def setUpClass(cls):
        cls.service = DiseaseInformationService(project_dir=ROOT)

    def test_approved_description_and_provenance_are_returned(self):
        payload = self.service.get_disease_information("5148")
        disease = payload["disease"]
        self.assertEqual(disease["name"], "type 2 diabetes mellitus")
        self.assertTrue(disease["verified_description_available"])
        self.assertTrue(disease["description"])
        self.assertEqual(disease["description_provenance"]["source"], "MONDO")

    def test_unapproved_description_is_not_presented(self):
        disease = self.service.get_disease_information("5015")["disease"]
        self.assertFalse(disease["verified_description_available"])
        self.assertEqual(disease["description_status"], "needs_review")
        self.assertNotIn("description", disease)

    def test_indications_are_separate_from_other_relationships(self):
        relationships = self.service.get_disease_information("5148")["medicine_relationships"]
        self.assertTrue(relationships["indications"])
        self.assertTrue(all(item["relation"] == "indication" for item in relationships["indications"]))
        self.assertTrue(all(item["relation"] != "indication" for item in relationships["other"]))
        self.assertTrue(any(item["relation"] == "contraindication" for item in relationships["other"]))

    def test_payload_contains_no_personalized_suitability_score(self):
        payload = self.service.get_disease_information("5148")
        self.assertNotIn("suitability", str(payload).casefold())
        self.assertNotIn("recommended_for_you", str(payload).casefold())

    def test_three_reviewed_diseases_have_nutrition_information(self):
        for disease_id, (expected_name, _) in self.SUPPORTED_NUTRITION.items():
            with self.subTest(disease_id=disease_id):
                payload = self.service.get_disease_information(disease_id)
                self.assertEqual(payload["disease"]["name"], expected_name)
                nutrition = payload["nutrition_lifestyle"]
                self.assertEqual(nutrition["status"], "available")
                self.assertTrue(nutrition["general_guidance"])
                self.assertTrue(nutrition["foods_emphasized"])
                self.assertTrue(nutrition["relevant_nutrients"])
                self.assertTrue(nutrition["not_personalized"])

    def test_nutrition_source_and_traceability_are_present(self):
        for disease_id, (_, source_short_name) in self.SUPPORTED_NUTRITION.items():
            with self.subTest(disease_id=disease_id):
                nutrition = self.service.get_disease_information(disease_id)[
                    "nutrition_lifestyle"
                ]
                source = nutrition["source"]
                self.assertIn(source_short_name, source["organization"])
                self.assertTrue(source["page_title"])
                self.assertTrue(source["url"].startswith("https://"))
                self.assertTrue(source["source_date"]["value"])
                self.assertTrue(nutrition["cheers_reviewed_date"])
                for field in (
                    "general_guidance",
                    "foods_emphasized",
                    "foods_limited",
                    "relevant_nutrients",
                ):
                    for item in nutrition[field]:
                        self.assertTrue(item["text"])
                        self.assertTrue(item["source_section"])

    def test_unsupported_disease_has_no_inferred_nutrition(self):
        nutrition = self.service.get_disease_information("5015")[
            "nutrition_lifestyle"
        ]
        self.assertEqual(nutrition, {"status": "unavailable"})

    def test_hypertension_is_not_in_nutrition_runtime(self):
        hypertension_id = "1200_1134_15512_5080_100078"
        nutrition = self.service.get_disease_information(hypertension_id)[
            "nutrition_lifestyle"
        ]
        self.assertEqual(nutrition, {"status": "unavailable"})
        self.assertNotIn(
            hypertension_id.casefold(), self.service.nutrition_lifestyle
        )

    def test_nutrition_payload_has_no_personalized_plan_fields_or_claims(self):
        forbidden_keys = {
            "best_diet",
            "calories",
            "macronutrients",
            "meal_plan",
            "recommended_for_you",
            "treatment",
        }
        forbidden_phrases = (
            "best diet",
            "you should eat",
            "will treat your disease",
        )
        for disease_id in self.SUPPORTED_NUTRITION:
            with self.subTest(disease_id=disease_id):
                nutrition = self.service.get_disease_information(disease_id)[
                    "nutrition_lifestyle"
                ]
                self.assertTrue(forbidden_keys.isdisjoint(nutrition))
                serialized = str(nutrition).casefold()
                for phrase in forbidden_phrases:
                    self.assertNotIn(phrase, serialized)


class DiseaseInformationRouteTests(unittest.TestCase):
    def test_route_is_registered(self):
        tree = ast.parse((ROOT / "api/main.py").read_text(encoding="utf-8-sig"))
        routes = set()
        for node in ast.walk(tree):
            for decorator in getattr(node, "decorator_list", []):
                if (
                    isinstance(decorator, ast.Call)
                    and decorator.args
                    and isinstance(decorator.func, ast.Attribute)
                    and isinstance(decorator.args[0], ast.Constant)
                ):
                    routes.add(decorator.args[0].value)
        self.assertIn("/api/public/disease", routes)

    @unittest.skipUnless(
        importlib.util.find_spec("fastapi") and importlib.util.find_spec("numpy"),
        "API runtime dependencies are not installed.",
    )
    def test_route_returns_typed_disease_payload(self):
        from fastapi.testclient import TestClient
        from api.main import app

        with TestClient(app) as client:
            response = client.get("/api/public/disease", params={"disease_id": "5148"})

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["disease"]["entity_id"], "5148")
        self.assertTrue(payload["medicine_relationships"]["indications"])


if __name__ == "__main__":
    unittest.main()
