"""Focused tests for bounded one-medicine openFDA label information."""

from pathlib import Path
import ast
import importlib.util
import sys
import unittest
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.drug_information import OpenFDADrugInformationService


class FixtureDrugInformationService(OpenFDADrugInformationService):
    def __init__(self, payload=None, error=None, **kwargs):
        super().__init__(**kwargs)
        self.payload = payload
        self.fixture_error = error

    def _request_json(self, url):
        if self.fixture_error:
            raise self.fixture_error
        return self.payload


class DrugInformationServiceTests(unittest.TestCase):
    def test_returns_selected_sections_with_record_metadata(self):
        service = FixtureDrugInformationService(
            payload={
                "meta": {"results": {"total": 8}},
                "results": [{
                    "set_id": "set-1",
                    "effective_time": "20260101",
                    "openfda": {
                        "application_number": ["NDA123"],
                        "brand_name": ["Example Brand"],
                        "generic_name": ["Example Drug"],
                        "manufacturer_name": ["Example Manufacturer"],
                        "substance_name": ["EXAMPLE DRUG HYDROCHLORIDE"],
                    },
                    "indications_and_usage": ["Official use information."],
                    "adverse_reactions": ["Official adverse reaction information."],
                    "dosage_and_administration": ["Take Example Drug with meals."],
                }],
            },
        )

        result = service.get_drug_information("Example Drug")

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["records_found"], 8)
        self.assertEqual(result["records_examined"], 1)
        self.assertEqual(
            result["available_sections"],
            [
                "indications_and_usage",
                "adverse_reactions",
                "dosage_and_administration",
            ],
        )
        record = result["records"][0]
        self.assertEqual(record["spl_set_id"], "set-1")
        self.assertEqual(record["application_number"], "NDA123")
        self.assertEqual(record["product_metadata"]["brand_name"], ["Example Brand"])
        self.assertEqual(record["product_name"], "Example Brand")
        self.assertEqual(
            record["product_classification"]["category"], "single_ingredient"
        )
        self.assertIn("dosage_and_administration", record["sections"])

    def test_extracts_supported_topics_from_source_sections(self):
        service = FixtureDrugInformationService(
            payload={
                "results": [{
                    "set_id": "set-food-1",
                    "openfda": {
                        "brand_name": ["Example Brand"],
                        "substance_name": ["EXAMPLE DRUG"],
                    },
                    "drug_interactions": [
                        "Alcohol use is discussed here. Grapefruit juice may change exposure. "
                        "Vitamin K intake can affect response."
                    ],
                    "dosage_and_administration": [
                        "Take Example Drug with meals. Take it on an empty stomach only when "
                        "the label directs this. A high-fat meal may change absorption."
                    ],
                    "information_for_patients": [
                        "Tell a clinician about cigarette smoking or tobacco use."
                    ],
                }]
            }
        )

        result = service.get_drug_information("Example Drug")
        module = result["food_lifestyle_information"]
        found = {item["topic"] for item in module["topics"]}

        self.assertEqual(module["status"], "available")
        self.assertTrue(
            {
                "alcohol",
                "grapefruit",
                "vitamin_k",
                "food_or_meals",
                "high_fat_meal",
                "fasting_or_empty_stomach",
                "smoking_or_tobacco",
            }.issubset(found)
        )
        self.assertTrue(
            all(item["section"] in service.FOOD_LIFESTYLE_SECTIONS for item in module["topics"])
        )

    def test_extracts_food_and_milk_but_not_breast_milk(self):
        service = FixtureDrugInformationService(
            payload={
                "results": [{
                    "openfda": {
                        "brand_name": ["Example Drug"],
                        "substance_name": ["EXAMPLE DRUG"],
                    },
                    "information_for_patients": [
                        "Take this medicine with food or milk if stomach upset occurs."
                    ],
                    "precautions": [
                        "The medicine may be present in human breast milk during lactation."
                    ],
                }]
            }
        )

        module = service.get_drug_information("Example Drug")[
            "food_lifestyle_information"
        ]
        milk_items = [item for item in module["topics"] if item["topic"] == "milk_or_dairy"]

        self.assertEqual(len(milk_items), 1)
        self.assertEqual(milk_items[0]["section"], "information_for_patients")
        self.assertNotIn("breast milk", milk_items[0]["excerpt"].casefold())

    def test_skips_non_instructional_fasting_context(self):
        service = FixtureDrugInformationService(
            payload={
                "results": [{
                    "warnings": ["Fasting blood glucose should be measured regularly."],
                    "precautions": [
                        "A pharmacokinetic study was conducted under fasting conditions. "
                        "Take a blood sample while fasting for the laboratory assessment."
                    ],
                }]
            }
        )

        module = service.get_drug_information("Example Drug")[
            "food_lifestyle_information"
        ]

        self.assertNotIn(
            "fasting_or_empty_stomach",
            {item["topic"] for item in module["topics"]},
        )

    def test_skips_generic_food_and_chemical_alcohol_contexts(self):
        service = FixtureDrugInformationService(
            payload={
                "results": [{
                    "warnings": [
                        "Patients with food allergy require separate assessment. "
                        "This formulation contains benzyl alcohol as an excipient."
                    ]
                }]
            }
        )

        module = service.get_drug_information("Example Drug")[
            "food_lifestyle_information"
        ]

        self.assertEqual(module["status"], "no_explicit_mentions")
        self.assertEqual(module["topics"], [])

    def test_combination_product_identity_is_retained_on_each_item(self):
        service = FixtureDrugInformationService(
            payload={
                "results": [{
                    "set_id": "combo-set",
                    "openfda": {
                        "brand_name": ["Example Combination"],
                        "substance_name": ["EXAMPLE DRUG", "SECOND INGREDIENT"],
                    },
                    "dosage_and_administration": [
                        "Take Example Combination with meals."
                    ],
                }]
            }
        )

        module = service.get_drug_information("Example Drug")[
            "food_lifestyle_information"
        ]
        item = module["topics"][0]

        self.assertEqual(item["product_classification"], "combination")
        self.assertEqual(item["product_name"], "Example Combination")
        self.assertEqual(
            item["active_ingredients"],
            ["EXAMPLE DRUG", "SECOND INGREDIENT"],
        )
        self.assertEqual(item["source_id"], "combo-set")

    def test_food_lifestyle_excerpt_is_bounded_without_full_label_dump(self):
        source_text = (
            "Prefix material " * 80
            + "Alcohol use is explicitly discussed in this label. "
            + "Suffix material " * 80
        )
        service = FixtureDrugInformationService(
            payload={"results": [{"warnings": [source_text]}]},
            max_food_lifestyle_excerpt_chars=180,
        )

        module = service.get_drug_information("Example Drug")[
            "food_lifestyle_information"
        ]
        item = module["topics"][0]

        self.assertLessEqual(len(item["excerpt"]), 180)
        self.assertTrue(item["excerpt_truncated"])
        self.assertNotEqual(item["excerpt"], " ".join(source_text.split()))
        self.assertNotIn("sections", module)
        self.assertNotIn("text", item)

    def test_module_does_not_generate_medical_conclusion_fields(self):
        service = FixtureDrugInformationService(
            payload={"results": [{"warnings": ["Alcohol is mentioned."]}]}
        )

        module = service.get_drug_information("Example Drug")[
            "food_lifestyle_information"
        ]

        banned = {"safe", "unsafe", "avoid", "recommended", "recommendation"}
        self.assertTrue(banned.isdisjoint(module))
        self.assertTrue(
            all(banned.isdisjoint(item) for item in module["topics"])
        )

    def test_no_explicit_mentions_has_narrow_message(self):
        service = FixtureDrugInformationService(
            payload={"results": [{"warnings": ["Routine monitoring applies."]}]}
        )

        module = service.get_drug_information("Example Drug")[
            "food_lifestyle_information"
        ]

        self.assertEqual(module["status"], "no_explicit_mentions")
        self.assertEqual(module["topics"], [])
        self.assertEqual(
            module["message"],
            "No explicit mention was retrieved in the checked label records.",
        )

    def test_classifies_and_prioritizes_single_combination_and_unknown_records(self):
        service = FixtureDrugInformationService(
            payload={
                "results": [
                    {
                        "openfda": {
                            "brand_name": ["ZITUVIMET"],
                            "substance_name": [
                                "SITAGLIPTIN PHOSPHATE",
                                "METFORMIN HYDROCHLORIDE",
                            ],
                        },
                        "warnings": ["Combination-product warning text."],
                    },
                    {
                        "openfda": {
                            "brand_name": ["Metformin Hydrochloride"],
                            "substance_name": ["METFORMIN HYDROCHLORIDE"],
                        },
                        "warnings": ["Single-ingredient warning text."],
                    },
                    {
                        "openfda": {"brand_name": ["Unclassified product"]},
                        "warnings": ["Unclassified warning text."],
                    },
                ]
            }
        )

        result = service.get_drug_information("Metformin")

        self.assertEqual(
            [record["product_classification"]["category"] for record in result["records"]],
            ["single_ingredient", "combination", "unknown"],
        )
        self.assertEqual(result["records"][1]["product_name"], "ZITUVIMET")
        self.assertEqual(
            result["records"][1]["product_classification"]["active_ingredients"],
            ["SITAGLIPTIN PHOSPHATE", "METFORMIN HYDROCHLORIDE"],
        )
        self.assertEqual(
            result["records"][2]["product_classification"]["label"],
            "Product type not confirmed",
        )

    def test_marks_bounded_text_when_truncated(self):
        service = FixtureDrugInformationService(
            payload={"results": [{"warnings": ["x" * 800]}]},
            max_section_chars=500,
        )
        result = service.get_drug_information("Example Drug")
        entry = result["records"][0]["sections"]["warnings"][0]
        self.assertEqual(len(entry["text"]), 500)
        self.assertTrue(entry["truncated"])

    def test_distinguishes_no_match_from_request_failure(self):
        no_match = FixtureDrugInformationService(
            error=HTTPError("https://api.fda.gov", 404, "not found", {}, None)
        ).get_drug_information("No Label Drug")
        unavailable = FixtureDrugInformationService(
            error=URLError("offline")
        ).get_drug_information("Unavailable Drug")

        self.assertEqual(no_match["status"], "no_matches")
        self.assertEqual(unavailable["status"], "error")
        self.assertIn("openFDA is unavailable", unavailable["error"])
        self.assertEqual(
            no_match["food_lifestyle_information"]["status"],
            "no_explicit_mentions",
        )
        self.assertEqual(
            unavailable["food_lifestyle_information"]["status"],
            "unavailable",
        )

    def test_public_query_url_does_not_expose_api_key(self):
        service = FixtureDrugInformationService(payload={"results": [{"warnings": ["Text"]}]})
        service.api_key = "secret"
        result = service.get_drug_information("Example Drug")
        self.assertNotIn("api_key", result["query_url"])
        self.assertIn("openfda.generic_name", result["query_url"])


class DrugInformationRouteTests(unittest.TestCase):
    def test_route_is_registered_without_changing_pair_route(self):
        tree = ast.parse((ROOT / "api/main.py").read_text(encoding="utf-8-sig"))
        routes = set()
        for node in ast.walk(tree):
            for decorator in getattr(node, "decorator_list", []):
                if not isinstance(decorator, ast.Call) or not decorator.args:
                    continue
                if isinstance(decorator.func, ast.Attribute) and isinstance(decorator.args[0], ast.Constant):
                    routes.add(decorator.args[0].value)
        self.assertIn("/api/public/medicine", routes)
        self.assertIn("/api/evidence/pair", routes)

    @unittest.skipUnless(
        importlib.util.find_spec("fastapi") and importlib.util.find_spec("numpy"),
        "API runtime dependencies are not installed.",
    )
    def test_route_resolves_drug_identity_and_returns_service_payload(self):
        from fastapi.testclient import TestClient
        from api.main import app

        class FakeService:
            @staticmethod
            def get_drug_information(drug_name):
                return {
                    "drug_name": drug_name,
                    "status": "ok",
                    "available_sections": ["adverse_reactions"],
                    "records": [],
                }

        with TestClient(app) as client:
            app.state.drug_information_service = FakeService()
            response = client.get("/api/public/medicine", params={"drug_id": "DB00331"})

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["drug"]["drug_id"], "DB00331")
        self.assertEqual(payload["label_information"]["drug_name"], "Metformin")
        self.assertNotIn("clinical_conclusion", payload)


if __name__ == "__main__":
    unittest.main()
