"""Focused tests for deterministic public drug/disease query resolution."""

from pathlib import Path
import ast
import importlib.util
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.public_search import PublicSearchService


class UnavailableDiseaseInformationService:
    def get_disease_information(self, disease_id):
        raise OSError(f"Relationship data unavailable for {disease_id}.")


class FixtureLabelEvidenceService:
    def get_pair_evidence(self, drug_a_name, drug_b_name):
        pair = {drug_a_name.casefold(), drug_b_name.casefold()}
        if pair == {"warfarin", "ibuprofen"}:
            return {
                "evidence_found": True,
                "pair_evidence": [
                    {
                        "source_drug": "Warfarin",
                        "mentioned_drug": "Ibuprofen",
                        "section": "drug_interactions",
                    }
                ],
            }
        return {"evidence_found": False, "pair_evidence": []}


class FixtureLiteratureService:
    def search_pair(self, drug_a_name, drug_b_name):
        pair = {drug_a_name.casefold(), drug_b_name.casefold()}
        if pair == {"warfarin", "ibuprofen"}:
            return {"status": "ok", "papers": [{"pmid": "fixture-1"}]}
        if pair == {"warfarin", "metformin"}:
            return {"status": "ok", "papers": [{"pmid": "fixture-2"}]}
        return {"status": "error", "papers": []}


class PublicSearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.search = PublicSearchService(
            project_dir=ROOT,
            label_evidence_service=FixtureLabelEvidenceService(),
            literature_service=FixtureLiteratureService(),
        )

    def test_exact_drug_name(self):
        payload = self.search.search("Metformin")
        self.assertEqual(payload["intent"], "drug_information")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00331")
        self.assertEqual(
            payload["recognized_entities"][0]["match_type"],
            "exact_canonical_name",
        )

    def test_exact_drugbank_id(self):
        payload = self.search.search("DB00682")
        self.assertEqual(payload["intent"], "drug_information")
        self.assertEqual(payload["recognized_entities"][0]["name"], "Warfarin")
        self.assertEqual(
            payload["recognized_entities"][0]["match_type"], "exact_entity_id"
        )

    def test_approved_disease_description(self):
        payload = self.search.search("what is type 2 diabetes mellitus")
        entity = payload["recognized_entities"][0]
        self.assertEqual(payload["intent"], "disease_information")
        self.assertEqual(entity["entity_id"], "5148")
        self.assertTrue(entity["verified_description_available"])
        self.assertIn("description", entity)
        self.assertEqual(entity["description_provenance"]["source"], "MONDO")
        self.assertIn("disease_explanation", payload["available_modules"])

    def test_unapproved_disease_description_is_not_returned(self):
        payload = self.search.search("what is diabetes mellitus disease")
        entity = payload["recognized_entities"][0]
        self.assertEqual(entity["entity_id"], "5015")
        self.assertEqual(entity["description_status"], "needs_review")
        self.assertFalse(entity["verified_description_available"])
        self.assertNotIn("description", entity)
        self.assertEqual(
            payload["unavailable_modules"][0]["module"], "disease_explanation"
        )

    def test_disease_nutrition_queries_route_to_reviewed_information(self):
        cases = (
            (
                "type 2 diabetes nutrition",
                "5148",
                "National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK)",
            ),
            ("nutrition for type 2 diabetes mellitus", "5148", None),
            ("diet information for type 2 diabetes mellitus", "5148", None),
            (
                "gout diet",
                "5393",
                "National Institute of Arthritis and Musculoskeletal and Skin Diseases (NIAMS)",
            ),
            ("gout diet information", "5393", None),
            ("nutrition for gout", "5393", None),
            ("foods to limit with gout", "5393", None),
            (
                "iron deficiency anemia nutrition?",
                "1356",
                "National Heart, Lung, and Blood Institute (NHLBI)",
            ),
            ("diet information for iron deficiency anemia", "1356", None),
        )
        for query, disease_id, source_organization in cases:
            with self.subTest(query=query):
                payload = self.search.search(query)
                self.assertEqual(payload["intent"], "disease_nutrition")
                self.assertEqual(
                    payload["recognized_entities"][0]["entity_id"],
                    disease_id,
                )
                answer = payload["answer"]
                self.assertTrue(answer["availability"])
                self.assertEqual(answer["topic"], "Nutrition & lifestyle")
                self.assertEqual(
                    answer["destination"],
                    f"/diseases/{disease_id}?section=nutrition-lifestyle",
                )
                self.assertEqual(
                    answer["message"],
                    "CHEERS has reviewed general nutrition information for this condition.",
                )
                self.assertNotIn("general_guidance", answer)
                self.assertNotIn("foods_emphasized", answer)
                if source_organization:
                    self.assertEqual(
                        answer["source_organization"], source_organization
                    )

    def test_unavailable_disease_nutrition_keeps_the_resolved_disease(self):
        payload = self.search.search("hypertension nutrition")
        self.assertEqual(payload["intent"], "disease_nutrition")
        disease_id = "1200_1134_15512_5080_100078"
        self.assertEqual(
            payload["recognized_entities"][0]["entity_id"], disease_id
        )
        answer = payload["answer"]
        self.assertFalse(answer["availability"])
        self.assertEqual(answer["destination"], f"/diseases/{disease_id}")
        self.assertEqual(
            answer["message"],
            "Nutrition information is not currently available for this condition in CHEERS.",
        )
        self.assertEqual(
            payload["unavailable_modules"][-1]["module"],
            "disease_nutrition_information",
        )

    def test_personalized_diet_requests_remain_unsupported(self):
        for query in (
            "best diet for me",
            "make me a diet",
            "meal plan",
            "calories for me",
            "macros for me",
            "what should I personally eat",
            "weight-loss plan",
        ):
            with self.subTest(query=query):
                payload = self.search.search(query)
                self.assertEqual(payload["intent"], "unsupported")
                self.assertEqual(payload["recognized_entities"], [])
                self.assertNotIn("answer", payload)

    def test_ambiguous_disease_nutrition_is_not_selected_silently(self):
        payload = self.search.search("diabetes nutrition")
        self.assertEqual(payload["intent"], "disease_nutrition")
        self.assertEqual(payload["recognized_entities"], [])
        self.assertGreater(payload["ambiguous_matches"][0]["total_matches"], 1)

    def test_ambiguous_disease_query_does_not_select_silently(self):
        payload = self.search.search("what is diabetes")
        self.assertEqual(payload["intent"], "disease_information")
        self.assertEqual(payload["recognized_entities"], [])
        self.assertGreater(payload["ambiguous_matches"][0]["total_matches"], 1)
        self.assertTrue(payload["ambiguous_matches"][0]["candidates"])

    def test_unknown_query(self):
        payload = self.search.search("quantum umbrella")
        self.assertEqual(payload["intent"], "unknown")
        self.assertEqual(payload["recognized_entities"], [])
        self.assertEqual(payload["ambiguous_matches"], [])

    def test_interaction_intent(self):
        payload = self.search.search("warfarin interactions")
        self.assertEqual(payload["intent"], "drug_interactions")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00682")
        self.assertIn("research_graph_context", payload["available_modules"])
        self.assertEqual(
            payload["unavailable_modules"][0]["module"],
            "single_drug_label_interactions",
        )

    def test_side_effect_intent(self):
        payload = self.search.search("metformin side effects")
        self.assertEqual(payload["intent"], "drug_side_effects")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00331")
        self.assertEqual(
            payload["unavailable_modules"][0]["module"], "drug_side_effects"
        )

    def test_food_lifestyle_queries_resolve_medicine_topic_and_destination(self):
        cases = (
            ("metformin alcohol", "DB00331", "alcohol"),
            ("metformin alcohol information", "DB00331", "alcohol"),
            ("simvastatin grapefruit", "DB00641", "grapefruit"),
            ("warfarin vitamin K", "DB00682", "vitamin_k"),
            ("ibuprofen with food", "DB01050", "food_or_meals"),
            ("take metformin with food", "DB00331", "food_or_meals"),
            ("ibuprofen milk", "DB01050", "milk_or_dairy"),
        )
        for query, drug_id, topic in cases:
            with self.subTest(query=query):
                payload = self.search.search(query)
                self.assertEqual(payload["intent"], "drug_food_lifestyle")
                self.assertEqual(
                    payload["recognized_entities"][0]["entity_id"],
                    drug_id,
                )
                self.assertEqual(payload["topic"], topic)
                self.assertEqual(payload["focus"], "food_lifestyle")
                self.assertEqual(
                    payload["destinations"][0]["frontend_path"],
                    f"/medicines/{drug_id}?section=food-lifestyle",
                )
                self.assertEqual(
                    payload["destinations"][0]["focus"],
                    "food_lifestyle",
                )

    def test_food_lifestyle_query_does_not_generate_medical_answer(self):
        payload = self.search.search("metformin alcohol")
        self.assertNotIn("answer", payload)
        self.assertNotIn("recommendation", payload)
        self.assertNotIn("clinical_conclusion", payload)

    def test_ambiguous_food_lifestyle_medicine_is_not_selected_silently(self):
        payload = self.search.search("insulin alcohol")
        self.assertEqual(payload["intent"], "drug_food_lifestyle")
        self.assertEqual(payload["recognized_entities"], [])
        self.assertGreater(payload["ambiguous_matches"][0]["total_matches"], 1)

    def test_broad_diet_questions_remain_unsupported(self):
        for query in (
            "foods to avoid with metformin",
            "best diet for diabetes",
            "what should i eat",
        ):
            with self.subTest(query=query):
                payload = self.search.search(query)
                self.assertIn(payload["intent"], {"unknown", "unsupported"})
                self.assertNotEqual(payload["intent"], "drug_food_lifestyle")

    def test_two_drug_intent(self):
        payload = self.search.search("Warfarin with Ibuprofen")
        self.assertEqual(payload["intent"], "drug_pair_question")
        self.assertEqual(
            [item["entity_id"] for item in payload["recognized_entities"]],
            ["DB00682", "DB01050"],
        )
        self.assertIn("pair_external_evidence", payload["available_modules"])
        self.assertIn("drug_a_id=DB00682", payload["destinations"][0]["api_path"])

    def test_two_drug_intent_without_connector(self):
        payload = self.search.search("Warfarin Ibuprofen")
        self.assertEqual(payload["intent"], "drug_pair")
        self.assertEqual(len(payload["recognized_entities"]), 2)

    def test_natural_drug_pair_question(self):
        cases = (
            ("can i take warfarin with ibuprofen?", ["DB00682", "DB01050"]),
            ("can i use warfarin and ibuprofen together", ["DB00682", "DB01050"]),
            ("can i take metformin and ibuprofen together", ["DB00331", "DB01050"]),
            ("warfarin and ibuprofen", ["DB00682", "DB01050"]),
            ("warfarin with ibuprofen", ["DB00682", "DB01050"]),
        )
        for query, expected_ids in cases:
            with self.subTest(query=query):
                payload = self.search.search(query)
                self.assertEqual(payload["original_query"], query)
                self.assertEqual(payload["intent"], "drug_pair_question")
                self.assertEqual(
                    [item["entity_id"] for item in payload["recognized_entities"]],
                    expected_ids,
                )

        punctuated = self.search.search(cases[0][0])
        self.assertEqual(
            punctuated["normalized_query"], "can i take warfarin with ibuprofen"
        )

    def test_is_it_ok_drug_pair_question(self):
        payload = self.search.search("is it ok to take warfarin with ibuprofen")
        self.assertEqual(payload["intent"], "drug_pair_question")
        self.assertEqual(len(payload["recognized_entities"]), 2)

    def test_drug_pair_question_interaction_warning_answer(self):
        payload = self.search.search("can i take warfarin with ibuprofen?")
        answer = payload["answer"]
        self.assertEqual(answer["answer_type"], "interaction_warning_found")
        self.assertEqual(answer["direct_answer"], "Interaction warning found")
        self.assertEqual(
            answer["evidence_summary"],
            {"label_mentions": 1, "pubmed_records": 1},
        )
        self.assertEqual(answer["drug_1"]["entity_id"], "DB00682")
        self.assertEqual(answer["drug_2"]["entity_id"], "DB01050")
        self.assertIn("safety_note", answer)

    def test_drug_pair_question_literature_only_needs_review(self):
        payload = self.search.search(
            "can i take warfarin and metformin together"
        )
        answer = payload["answer"]
        self.assertEqual(answer["answer_type"], "needs_review")
        self.assertEqual(answer["direct_answer"], "Needs review")
        self.assertEqual(
            answer["evidence_summary"],
            {"label_mentions": 0, "pubmed_records": 1},
        )

    def test_drug_pair_question_insufficient_information(self):
        payload = self.search.search(
            "can i take fluoxymesterone with icosapent"
        )
        answer = payload["answer"]
        self.assertEqual(answer["answer_type"], "insufficient_information")
        self.assertEqual(answer["direct_answer"], "Not enough information")
        self.assertEqual(
            answer["evidence_summary"],
            {"label_mentions": 0, "pubmed_records": 0},
        )
        self.assertEqual(
            payload["unavailable_modules"][-1]["module"],
            "drug_pair_question_answer",
        )

    def test_drug_pair_question_has_no_hard_safety_or_model_score_state(self):
        answer = self.search.search(
            "can i take warfarin with ibuprofen"
        )["answer"]
        self.assertNotIn(
            answer["answer_type"],
            {"safe", "unsafe", "avoid_combination"},
        )
        self.assertNotIn(
            answer["direct_answer"].casefold(),
            {"safe", "unsafe", "definitely safe"},
        )
        self.assertNotIn("score", str(answer).casefold())
        self.assertNotIn("probability", str(answer).casefold())
        self.assertNotIn("confidence", str(answer).casefold())

    def test_legacy_drug_pair_response_is_not_enriched(self):
        payload = self.search.search("warfarin ibuprofen")
        self.assertEqual(payload["intent"], "drug_pair")
        self.assertNotIn("answer", payload)

    def test_drug_for_disease_question(self):
        queries = (
            "can i use metformin for type 2 diabetes mellitus?",
            "is metformin used for type 2 diabetes mellitus",
            "does metformin treat type 2 diabetes mellitus",
            "is metformin for type 2 diabetes mellitus",
            "metformin for type 2 diabetes mellitus",
        )
        for query in queries:
            with self.subTest(query=query):
                payload = self.search.search(query)
                self.assertEqual(payload["intent"], "drug_for_disease")
                self.assertEqual(
                    [item["entity_type"] for item in payload["recognized_entities"]],
                    ["drug", "disease"],
                )
                self.assertEqual(
                    [item["entity_id"] for item in payload["recognized_entities"]],
                    ["DB00331", "5148"],
                )

    def test_drug_for_disease_indication_answer(self):
        payload = self.search.search(
            "can i use metformin for type 2 diabetes mellitus?"
        )
        answer = payload["answer"]
        self.assertEqual(answer["answer_type"], "indication_found")
        self.assertTrue(answer["direct_answer"].startswith("Yes"))
        self.assertEqual(answer["drug"]["entity_id"], "DB00331")
        self.assertEqual(answer["disease"]["entity_id"], "5148")
        self.assertEqual(
            {relationship["relation"] for relationship in answer["relationships"]},
            {"indication"},
        )
        self.assertIn("safety_note", answer)

    def test_drug_for_disease_other_relationship_answer(self):
        payload = self.search.search(
            "is acetazolamide used for type 2 diabetes mellitus"
        )
        answer = payload["answer"]
        self.assertEqual(answer["answer_type"], "other_relationship_found")
        self.assertEqual(
            {relationship["relation"] for relationship in answer["relationships"]},
            {"contraindication"},
        )
        self.assertNotIn("Yes", answer["direct_answer"])

    def test_drug_for_disease_preserves_off_label_relationship(self):
        payload = self.search.search(
            "is fluoxymesterone used for anemia disease"
        )
        answer = payload["answer"]
        self.assertEqual(answer["answer_type"], "other_relationship_found")
        self.assertEqual(
            [relationship["relation"] for relationship in answer["relationships"]],
            ["off-label use"],
        )

    def test_drug_for_disease_no_indication_answer(self):
        payload = self.search.search("can i use warfarin for influenza")
        answer = payload["answer"]
        self.assertEqual(answer["answer_type"], "no_indication_found")
        self.assertEqual(answer["relationships"], [])
        self.assertIn("checked data", answer["direct_answer"])

    def test_drug_for_disease_insufficient_data_answer(self):
        search = PublicSearchService(
            project_dir=ROOT,
            disease_information_service=UnavailableDiseaseInformationService(),
        )
        payload = search.search("can i use metformin for type 2 diabetes mellitus")
        answer = payload["answer"]
        self.assertEqual(answer["answer_type"], "insufficient_data")
        self.assertEqual(answer["direct_answer"], "Not enough information")
        self.assertEqual(answer["relationships"], [])
        self.assertEqual(
            payload["unavailable_modules"][-1]["module"],
            "drug_disease_relationship_answer",
        )

    def test_drug_for_disease_answer_has_no_suitability_or_probability(self):
        answer = self.search.search(
            "can i use metformin for type 2 diabetes mellitus"
        )["answer"]
        serialized = str(answer).casefold()
        self.assertNotIn("suitability", serialized)
        self.assertNotIn("probability", serialized)
        self.assertNotIn("confidence", serialized)

    def test_drug_for_influenza_question(self):
        payload = self.search.search("can i use warfarin for influenza")
        self.assertEqual(payload["intent"], "drug_for_disease")
        self.assertEqual(
            [item["entity_id"] for item in payload["recognized_entities"]],
            ["DB00682", "5812"],
        )

    def test_medicines_for_disease_question(self):
        queries = (
            "what medicines are used for type 2 diabetes mellitus?",
            "what drugs are used for type 2 diabetes mellitus",
            "medicines for type 2 diabetes mellitus",
            "drugs for type 2 diabetes mellitus",
        )
        for query in queries:
            with self.subTest(query=query):
                payload = self.search.search(query)
                self.assertEqual(payload["intent"], "medicines_for_disease")
                self.assertEqual(len(payload["recognized_entities"]), 1)
                self.assertEqual(
                    payload["recognized_entities"][0]["entity_id"], "5148"
                )
                answer = payload["answer"]
                self.assertEqual(
                    answer["answer_type"], "indication_medicines_found"
                )
                self.assertEqual(answer["total_count"], 47)
                self.assertEqual(len(answer["medicines"]), 6)
                self.assertEqual(
                    [item["drug_id"] for item in answer["medicines"]],
                    [
                        "DB00284",
                        "DB00414",
                        "DB09043",
                        "DB06203",
                        "DB12417",
                        "DB04830",
                    ],
                )
                self.assertTrue(
                    all(
                        item["relation"] == "indication"
                        for item in answer["medicines"]
                    )
                )

    def test_medicines_for_disease_with_no_indications(self):
        payload = self.search.search(
            "what medicines are used for tibial muscular dystrophy"
        )
        answer = payload["answer"]
        self.assertEqual(
            answer["answer_type"], "no_indication_medicines_found"
        )
        self.assertEqual(answer["disease"]["entity_id"], "10870")
        self.assertEqual(answer["total_count"], 0)
        self.assertEqual(answer["medicines"], [])

    def test_medicines_for_disease_insufficient_data(self):
        search = PublicSearchService(
            project_dir=ROOT,
            disease_information_service=UnavailableDiseaseInformationService(),
        )
        payload = search.search(
            "what medicines are used for type 2 diabetes mellitus"
        )
        answer = payload["answer"]
        self.assertEqual(answer["answer_type"], "insufficient_data")
        self.assertEqual(answer["total_count"], 0)
        self.assertEqual(answer["medicines"], [])
        self.assertEqual(
            payload["unavailable_modules"][-1]["module"],
            "disease_indication_medicines_answer",
        )

    def test_medicines_for_disease_answer_has_no_other_relations_or_scores(self):
        answer = self.search.search(
            "what medicines are used for type 2 diabetes mellitus"
        )["answer"]
        serialized_medicines = str(answer["medicines"]).casefold()
        serialized_answer = str(answer).casefold()
        self.assertNotIn("contraindication", serialized_medicines)
        self.assertNotIn("off-label", serialized_medicines)
        self.assertNotIn("score", serialized_answer)
        self.assertNotIn("percentage", serialized_answer)
        self.assertNotIn("confidence", serialized_answer)
        self.assertNotIn("suitability", serialized_answer)
        self.assertIn("safety_note", answer)

    def test_ambiguous_drug_for_disease_is_not_selected_silently(self):
        payload = self.search.search("can i use metformin for diabetes")
        self.assertEqual(payload["intent"], "drug_for_disease")
        self.assertEqual(payload["recognized_entities"], [])
        self.assertGreater(payload["ambiguous_matches"][0]["total_matches"], 1)

    def test_unrecognized_pair_entity_is_not_selected_silently(self):
        payload = self.search.search("can i take warfarin with mysterymedicine")
        self.assertEqual(payload["intent"], "unknown")
        self.assertEqual(payload["recognized_entities"], [])

    def test_api_route_is_registered(self):
        tree = ast.parse((ROOT / "api/main.py").read_text(encoding="utf-8"))
        routes = set()
        for node in ast.walk(tree):
            for decorator in getattr(node, "decorator_list", []):
                if not isinstance(decorator, ast.Call) or not decorator.args:
                    continue
                if not isinstance(decorator.func, ast.Attribute):
                    continue
                if decorator.func.attr not in {"get", "post"}:
                    continue
                if isinstance(decorator.args[0], ast.Constant):
                    routes.add(decorator.args[0].value)
        self.assertIn("/api/public/search", routes)

    @unittest.skipUnless(
        importlib.util.find_spec("fastapi") and importlib.util.find_spec("numpy"),
        "API runtime dependencies are not installed in this Python environment.",
    )
    def test_api_returns_structured_public_search_response(self):
        from fastapi.testclient import TestClient
        from api.main import app

        with TestClient(app) as client:
            response = client.get(
                "/api/public/search", params={"q": "warfarin interactions"}
            )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["intent"], "drug_interactions")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00682")
        self.assertNotIn("conclusion", payload)


if __name__ == "__main__":
    unittest.main()
