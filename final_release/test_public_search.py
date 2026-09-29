"""Focused tests for deterministic public drug/disease query resolution."""

from pathlib import Path
import ast
import importlib.util
import json
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.gemini_query_interpreter import (
    GEMINI_FALLBACK_MODEL,
    GEMINI_PRIMARY_MODEL,
    GeminiQueryInterpreter,
    open_with_retry,
)
from src.gemini_evidence_summarizer import GeminiEvidenceSummarizer, MAX_EVIDENCE_CHARS
from src.public_search import PublicSearchService


class FixtureQueryInterpreter:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []

    def interpret(self, query):
        self.calls.append(query)
        if self.error:
            raise self.error
        return self.result


class InvalidGeminiResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    @staticmethod
    def read():
        return b'{"candidates":[{"content":{"parts":[{"text":"not json"}]}}]}'


class EmptyResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class GeminiJsonResponse(EmptyResponse):
    def __init__(self, value):
        self.value = value

    def read(self):
        return json.dumps({
            "candidates": [{"content": {"parts": [{"text": json.dumps(self.value)}]}}]
        }).encode("utf-8")


class FixtureEvidenceSummarizer:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []

    def summarize(self, question, evidence):
        self.calls.append((question, evidence))
        if self.error:
            raise self.error
        return self.result


class FixtureDrugInformationService:
    def get_drug_information(self, _drug_name):
        return {
            "status": "ok",
            "records": [{
                "sections": {
                    "indications_and_usage": [{"text": "Retrieved use text."}],
                    "adverse_reactions": [{"text": "Retrieved side-effect text."}],
                },
            }],
        }


class GroundedUseDrugInformationService:
    def get_drug_information(self, drug_name):
        if drug_name == "Ibuprofen":
            text = "Ibuprofen tablets are indicated for relief of mild to moderate pain."
        else:
            text = (
                "Metformin hydrochloride tablets are indicated as an adjunct to diet "
                "and exercise to improve glycemic control in people with type 2 diabetes mellitus."
            )
        return {
            "status": "ok",
            "records": [{
                "product_name": drug_name,
                "product_classification": {"category": "single_ingredient"},
                "sections": {"indications_and_usage": [{"text": text}]},
            }],
        }


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

    def use_interpreter(self, interpreter):
        previous = self.search.query_interpreter
        self.search.query_interpreter = interpreter
        self.addCleanup(setattr, self.search, "query_interpreter", previous)

    def use_summarizer(self, summarizer):
        previous = self.search.evidence_summarizer
        self.search.evidence_summarizer = summarizer
        self.addCleanup(setattr, self.search, "evidence_summarizer", previous)

    def use_drug_information(self, service):
        previous = self.search.drug_information_service
        self.search.drug_information_service = service
        self.addCleanup(setattr, self.search, "drug_information_service", previous)

    def test_grounded_pair_explanation_uses_retrieved_source_summary(self):
        explanation = {
            "status": "answered",
            "short_answer": "The retrieved FDA label information includes an interaction warning.",
            "key_points": ["One label mention and one PubMed record were retrieved."],
            "what_we_cannot_conclude": "This does not establish whether the pair is safe for you.",
            "sources_used": ["FDA label", "PubMed"],
        }
        summarizer = FixtureEvidenceSummarizer(result=explanation)
        self.use_summarizer(summarizer)
        payload = self.search.search("can i take warfarin with ibuprofen")
        self.assertEqual(payload["explanation"], explanation)
        self.assertEqual(len(summarizer.calls), 1)
        self.assertIn("FDA label", summarizer.calls[0][1])
        self.assertIn("PubMed", summarizer.calls[0][1])

    def test_fast_search_does_not_wait_for_external_sources_or_summarizer(self):
        class FailingLabels:
            def get_pair_evidence(self, **_kwargs):
                raise AssertionError("external label lookup must not run")

        class FailingLiterature:
            def search_pair(self, **_kwargs):
                raise AssertionError("PubMed lookup must not run")

        search = PublicSearchService(
            project_dir=ROOT,
            label_evidence_service=FailingLabels(),
            literature_service=FailingLiterature(),
            evidence_summarizer=FixtureEvidenceSummarizer(
                error=AssertionError("Gemini summarizer must not run")
            ),
        )
        payload = search.search(
            "warfarin aspirin together?",
            include_explanation=False,
            include_external_evidence=False,
        )
        self.assertEqual(payload["intent"], "drug_pair_question")
        self.assertEqual(
            [entity["entity_id"] for entity in payload["recognized_entities"]],
            ["DB00682", "DB00945"],
        )
        self.assertTrue(payload["ai_explanation_eligible"])
        self.assertNotIn("explanation", payload)

    def test_summarizer_failure_keeps_safe_deterministic_pair_explanation(self):
        self.use_summarizer(FixtureEvidenceSummarizer(error=TimeoutError()))
        payload = self.search.search("can i take fluoxymesterone with icosapent")
        self.assertEqual(payload["explanation"]["status"], "limited")
        self.assertIn("not establish", payload["explanation"]["what_we_cannot_conclude"])
        self.assertNotEqual(payload["explanation"]["short_answer"].casefold(), "safe")
        self.assertNotIn("test-key", str(payload))

    def test_evidence_sent_for_summarization_is_bounded(self):
        bounded = GeminiEvidenceSummarizer.bound_evidence(
            {"FDA label": ["x" * 20_000], "PubMed": ["y" * 20_000]}
        )
        self.assertLessEqual(
            sum(len(item) for values in bounded.values() for item in values),
            MAX_EVIDENCE_CHARS,
        )
        self.assertTrue(all(len(item) <= 700 for values in bounded.values() for item in values))
        unsafe = {
            "status": "answered",
            "short_answer": "This combination is safe.",
            "key_points": [],
            "what_we_cannot_conclude": "",
            "sources_used": [],
        }
        self.assertIsNone(GeminiEvidenceSummarizer._validate(unsafe))

    def test_medicine_uses_and_side_effects_use_retrieved_label_sections(self):
        explanation = {
            "status": "answered",
            "short_answer": "A short grounded label explanation.",
            "key_points": [],
            "what_we_cannot_conclude": "This is not personal medical advice.",
            "sources_used": ["FDA label"],
        }
        summarizer = FixtureEvidenceSummarizer(result=explanation)
        self.use_summarizer(summarizer)
        self.use_drug_information(FixtureDrugInformationService())
        information = self.search.search("metformin")
        side_effects = self.search.search("metformin side effects")
        self.assertEqual(information["explanation"], explanation)
        self.assertEqual(side_effects["explanation"], explanation)
        self.assertIn("Retrieved use text.", str(summarizer.calls[0][1]))
        self.assertIn("Retrieved side-effect text.", str(summarizer.calls[1][1]))

    def test_label_fallback_is_short_and_useful_when_gemini_is_unavailable(self):
        self.use_summarizer(FixtureEvidenceSummarizer(error=TimeoutError()))
        self.use_drug_information(FixtureDrugInformationService())
        payload = self.search.search("what does metformin do?")
        explanation = payload["explanation"]
        self.assertEqual(
            explanation["short_answer"],
            "CHEERS found official label information for Metformin.",
        )
        self.assertEqual(explanation["key_points"], ["Retrieved use text."])
        self.assertLessEqual(len(explanation["key_points"]), 3)
        self.assertNotIn("recommend", explanation["short_answer"].casefold())

    def test_metformin_answer_excludes_combination_product_evidence(self):
        class MixedProductDrugInformationService:
            def get_drug_information(self, _drug_name):
                return {
                    "status": "ok",
                    "records": [
                        {
                            "product_name": "ZITUVIMET",
                            "product_classification": {"category": "combination"},
                            "sections": {"indications_and_usage": [{"text": "ZITUVIMET combination-product wording."}]},
                        },
                        GroundedUseDrugInformationService().get_drug_information("Metformin")["records"][0],
                    ],
                }

        self.use_summarizer(FixtureEvidenceSummarizer(error=TimeoutError()))
        self.use_drug_information(MixedProductDrugInformationService())
        explanation = self.search.search("What does metformin do?")["explanation"]
        self.assertIn("control blood sugar", explanation["short_answer"])
        self.assertNotIn("ZITUVIMET", str(explanation))

    def test_grounded_pain_use_answers_directly(self):
        self.use_drug_information(GroundedUseDrugInformationService())
        payload = self.search.search("can i use ibuprofin for pain?")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB01050")
        self.assertIn("used for pain relief", payload["explanation"]["short_answer"])
        self.assertIn("specific", payload["explanation"]["what_we_cannot_conclude"])
        self.assertNotIn("dose recommendation", str(payload).casefold())

    def test_side_effect_fallback_removes_headings_and_duplicate_points(self):
        class RepeatedHeadingDrugInformationService:
            def get_drug_information(self, _drug_name):
                entry = {"text": "6 ADVERSE REACTIONS 6.1 Clinical Trials Experience Nausea was reported."}
                return {
                    "status": "ok",
                    "records": [{"sections": {"adverse_reactions": [entry, entry]}}],
                }

        self.use_summarizer(FixtureEvidenceSummarizer(error=TimeoutError()))
        self.use_drug_information(RepeatedHeadingDrugInformationService())
        explanation = self.search.search("metformin side effects")["explanation"]
        self.assertEqual(explanation["key_points"], ["Nausea was reported."])
        self.assertNotIn("Missing label text", explanation["what_we_cannot_conclude"])
        self.assertEqual(explanation["sources_used"], ["FDA label"])

    def test_side_effect_summary_is_cleaned_after_gemini(self):
        summary = {
            "status": "answered",
            "short_answer": "6 ADVERSE REACTIONS Nausea was reported.",
            "key_points": [
                "6.1 Clinical Trials Experience Nausea was reported.",
                "Headache was reported.",
                "Headache was reported.",
            ],
            "what_we_cannot_conclude": "Missing label text does not mean no risks exist.",
            "sources_used": ["FDA label"],
        }
        self.use_summarizer(FixtureEvidenceSummarizer(result=summary))
        self.use_drug_information(FixtureDrugInformationService())
        explanation = self.search.search("metformin side effects")["explanation"]
        self.assertEqual(
            explanation["short_answer"],
            "CHEERS found official label information for Metformin.",
        )
        self.assertEqual(explanation["key_points"], ["Retrieved side-effect text."])
        self.assertEqual(
            explanation["what_we_cannot_conclude"],
            "Official label information is general information, not personalized medical advice.",
        )

    def test_current_metformin_side_effect_text_becomes_one_plain_point(self):
        evidence = (
            "adverse_reactions: 6 ADVERSE REACTIONS The following adverse reactions "
            "are also discussed elsewhere in the labeling: Lactic Acidosis [ see Boxed "
            "Warning and Warnings and Precautions (5.1) ]. Vitamin B12 Deficiency [ see "
            "Warnings and Precautions (5.2) ]. For metformin hydrochloride tablets, the "
            "most common adverse reactions (>5.0%) are diarrhea, nausea/vomiting, "
            "flatulence, asthenia, indigestion, abdominal discomfort, and headache."
        )
        points = PublicSearchService._plain_label_points([evidence, evidence])
        self.assertEqual(len(points), 1)
        self.assertLessEqual(len(points[0]), 140)
        self.assertTrue(points[0].endswith("."))
        combined = " ".join(points)
        self.assertNotIn("(5.1)", combined)
        self.assertNotIn("(5.2)", combined)
        self.assertNotIn("see Boxed Warning", combined)

    def test_side_effect_points_deduplicate_similar_wording(self):
        points = PublicSearchService._plain_label_points([
            "warnings: Metformin may lower vitamin B12 levels.",
            "warnings: Vitamin B12 levels may be lowered by metformin.",
        ])
        self.assertEqual(points, ["Metformin may lower vitamin B12 levels."])

    def test_side_effect_points_skip_incomplete_product_heading(self):
        points = PublicSearchService._plain_label_points([
            "adverse_reactions: Metformin Hydrochloride Tablets In a U.S. "
            "Diarrhea was reported more often than with placebo.",
            "adverse_reactions: The following adverse reactions have been identified during postapproval use.",
        ])
        self.assertEqual(points, ["Diarrhea was reported more often than with placebo."])

    def test_exact_drug_name(self):
        payload = self.search.search("Metformin")
        self.assertEqual(payload["intent"], "drug_information")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00331")
        self.assertEqual(
            payload["recognized_entities"][0]["match_type"],
            "exact_canonical_name",
        )

    def test_deterministic_match_does_not_call_interpreter(self):
        interpreter = FixtureQueryInterpreter(error=AssertionError("unexpected call"))
        self.use_interpreter(interpreter)
        payload = self.search.search("Metformin")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00331")
        self.assertEqual(interpreter.calls, [])
        self.assertNotIn("ai_interpretation", payload)

    def test_natural_language_drug_information_works_without_interpreter(self):
        interpreter = FixtureQueryInterpreter(error=TimeoutError())
        self.use_interpreter(interpreter)
        payload = self.search.search("what does metformin do?")
        self.assertEqual(payload["intent"], "drug_information")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00331")
        self.assertEqual(payload["original_query"], "what does metformin do?")
        self.assertEqual(interpreter.calls, [])

    def test_typo_side_effects_work_without_interpreter(self):
        interpreter = FixtureQueryInterpreter(error=TimeoutError())
        self.use_interpreter(interpreter)
        payload = self.search.search("tell me about metphormin side efects")
        self.assertEqual(payload["intent"], "drug_side_effects")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00331")
        self.assertEqual(interpreter.calls, [])

    def test_common_single_entity_phrasings_resolve_deterministically(self):
        cases = (
            ("what is metformin used for", "drug_information", "DB00331"),
            ("tell me about metformin", "drug_information", "DB00331"),
            ("metformin information", "drug_information", "DB00331"),
            ("what is ibuprofen for", "drug_information", "DB01050"),
            ("tell me metformin side effects", "drug_side_effects", "DB00331"),
            ("what are the side effects of metformin", "drug_side_effects", "DB00331"),
            ("side effects of metphormin", "drug_side_effects", "DB00331"),
        )
        interpreter = FixtureQueryInterpreter(error=AssertionError("unexpected call"))
        self.use_interpreter(interpreter)
        for query, intent, entity_id in cases:
            with self.subTest(query=query):
                payload = self.search.search(query)
                self.assertEqual(payload["intent"], intent)
                self.assertEqual(payload["recognized_entities"][0]["entity_id"], entity_id)
        self.assertEqual(interpreter.calls, [])

    def test_common_medicine_and_symptom_wording_stays_general(self):
        interpreter = FixtureQueryInterpreter(error=AssertionError("unexpected call"))
        self.use_interpreter(interpreter)
        payload = self.search.search("does ibuprofen help pain")
        self.assertEqual(payload["intent"], "general_symptom_or_treatment_question")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB01050")
        self.assertEqual(payload["topic"], "pain")
        self.assertNotIn("disease", str(payload["recognized_entities"]).casefold())
        self.assertEqual(interpreter.calls, [])

    def test_whats_diabetes_returns_choices_without_interpreter(self):
        interpreter = FixtureQueryInterpreter(error=AssertionError("unexpected call"))
        self.use_interpreter(interpreter)
        payload = self.search.search("what's diabetes?")
        self.assertEqual(payload["intent"], "disease_information")
        self.assertEqual(payload["recognized_entities"], [])
        self.assertTrue(payload["ambiguous_matches"][0]["candidates"])
        self.assertEqual(
            [item["name"] for item in payload["ambiguous_matches"][0]["candidates"]],
            [
                "diabetes mellitus (disease)",
                "type 2 diabetes mellitus",
                "type 1 diabetes mellitus",
                "gestational diabetes",
            ],
        )
        self.assertEqual(interpreter.calls, [])

    def test_interpreter_failure_preserves_unknown_response(self):
        interpreter = FixtureQueryInterpreter(error=TimeoutError())
        self.use_interpreter(interpreter)
        payload = self.search.search("banana spaceship medicine purple")
        self.assertEqual(payload["intent"], "unknown")
        self.assertEqual(payload["recognized_entities"], [])
        self.assertEqual(payload["ai_interpretation"], {"status": "unavailable"})

    def test_personalized_treatment_question_has_no_recommendation(self):
        interpreter = FixtureQueryInterpreter(
            result={
                "intent": "general_symptom_or_treatment_question",
                "drug_names": [],
                "disease_names": [],
                "topic": "pain",
                "rewritten_query": "what should I take for pain",
                "confidence": 0.98,
            }
        )
        self.use_interpreter(interpreter)
        payload = self.search.search("what should I take for pain?")
        self.assertEqual(payload["intent"], "general_symptom_or_treatment_question")
        self.assertNotIn("answer", payload)
        self.assertNotIn("recommendation", payload)
        self.assertEqual(payload["topic"], "pain")
        self.assertEqual(interpreter.calls, [])

    def test_invalid_interpreter_output_fails_safely(self):
        interpreter = GeminiQueryInterpreter(api_key="test-key")
        with patch(
            "src.gemini_query_interpreter.urlopen",
            return_value=InvalidGeminiResponse(),
        ):
            result = interpreter.interpret("banana spaceship medicine purple")
        self.assertIsNone(result)
        interpreter = FixtureQueryInterpreter(result=result)
        self.use_interpreter(interpreter)
        payload = self.search.search("banana spaceship medicine purple")
        self.assertEqual(payload["intent"], "unknown")
        self.assertEqual(payload["ai_interpretation"], {"status": "unavailable"})

    def test_exact_drugbank_id(self):
        payload = self.search.search("DB00682")
        self.assertEqual(payload["intent"], "drug_information")
        self.assertEqual(payload["recognized_entities"][0]["name"], "Warfarin")
        self.assertEqual(
            payload["recognized_entities"][0]["match_type"], "exact_entity_id"
        )

    def test_close_drug_spelling_resolves_when_match_is_clear(self):
        payload = self.search.search("ibuprofin")
        self.assertEqual(payload["intent"], "drug_information")
        self.assertEqual(payload["recognized_entities"][0]["name"], "Ibuprofen")
        self.assertEqual(
            payload["recognized_entities"][0]["match_type"],
            "close_fuzzy_name",
        )

    def test_uncertain_disease_spelling_returns_diabetes_suggestions(self):
        payload = self.search.search("diabetis")
        self.assertEqual(payload["recognized_entities"], [])
        candidates = payload["ambiguous_matches"][0]["candidates"]
        self.assertLessEqual(len(candidates), 5)
        self.assertTrue(candidates)
        self.assertTrue(
            all(item["match_type"] == "close_fuzzy_name" for item in candidates)
        )
        self.assertTrue(
            any("diabetes" in item["name"].casefold() for item in candidates)
        )

    def test_disease_suggestions_are_bounded_and_prioritize_common_matches(self):
        payload = self.search.disease_suggestions("diab")
        names = [item["name"].casefold() for item in payload["suggestions"]]
        self.assertLessEqual(len(names), 6)
        self.assertEqual(names[:4], [
            "diabetes mellitus (disease)",
            "type 2 diabetes mellitus",
            "type 1 diabetes mellitus",
            "gestational diabetes",
        ])
        self.assertTrue(all(item["entity_type"] == "disease" for item in payload["suggestions"]))

    def test_disease_suggestions_rank_exact_then_conservative_typo(self):
        exact = self.search.disease_suggestions("type 2 diabetes mellitus")
        self.assertEqual(exact["suggestions"][0]["entity_id"], "5148")
        self.assertEqual(exact["suggestions"][0]["match_type"], "exact_canonical_name")
        typo = self.search.disease_suggestions("diabetis")
        self.assertIn("diabetes", typo["suggestions"][0]["name"].casefold())
        self.assertEqual(
            self.search.disease_suggestions("banana spaceship")["suggestions"], []
        )

    def test_disease_suggestions_do_not_use_optional_services(self):
        interpreter = FixtureQueryInterpreter(error=AssertionError("Gemini must not run"))
        summarizer = FixtureEvidenceSummarizer(error=AssertionError("Gemini must not run"))
        self.use_interpreter(interpreter)
        self.use_summarizer(summarizer)
        payload = self.search.disease_suggestions("diab")
        self.assertTrue(payload["suggestions"])
        self.assertEqual(interpreter.calls, [])
        self.assertEqual(summarizer.calls, [])

    def test_exact_canonical_name_outranks_containing_name(self):
        search = object.__new__(PublicSearchService)
        search.entities = (
            {
                "entity_type": "drug",
                "entity_id": "EXACT",
                "name": "Aspirin",
                "normalized_name": "aspirin",
                "normalized_id": "exact",
                "node_id": 1,
                "source": "fixture",
            },
            {
                "entity_type": "drug",
                "entity_id": "LONGER",
                "name": "Nitroaspirin",
                "normalized_name": "nitroaspirin",
                "normalized_id": "longer",
                "node_id": 2,
                "source": "fixture",
            },
        )
        match, ambiguity = search._resolve_fragment("aspirin", ("drug",))
        self.assertIsNone(ambiguity)
        self.assertEqual(match[0]["name"], "Aspirin")
        self.assertEqual(match[1], "exact_canonical_name")

    def test_common_aspirin_name_resolves_to_canonical_drug(self):
        payload = self.search.search("aspirin")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00945")
        self.assertEqual(
            payload["recognized_entities"][0]["match_type"], "exact_common_name"
        )
        self.assertEqual(payload["recognized_entities"][0]["display_name"], "Aspirin")

    def test_two_drug_wording_prefers_pair_question(self):
        cases = (
            "warfarin aspirin together?",
            "warfarin and aspirin?",
            "aspirin with warfarin",
            "can I take warfarin aspirin together?",
            "ibuprofin aspirin together?",
        )
        for query in cases:
            with self.subTest(query=query):
                payload = self.search.search(query)
                self.assertEqual(payload["intent"], "drug_pair_question")
                self.assertEqual(
                    {item["entity_id"] for item in payload["recognized_entities"]},
                    {"DB00682", "DB00945"}
                    if "warfarin" in query.casefold()
                    else {"DB01050", "DB00945"},
                )

    def test_generic_pain_is_not_resolved_as_specific_disease(self):
        payload = self.search.search("can i use ibuprofin for pain?")
        self.assertEqual(payload["intent"], "general_symptom_or_treatment_question")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB01050")
        self.assertNotIn("myofascial pain syndrome", str(payload).casefold())
        self.assertIn("cannot decide", payload["explanation"]["short_answer"])
        self.assertNotIn("dose", payload["explanation"]["short_answer"].casefold())

    def test_gemini_http_retries_one_retryable_failure(self):
        retryable = HTTPError("https://example.invalid", 503, "unavailable", {}, None)
        with patch(
            "src.gemini_query_interpreter.urlopen",
            side_effect=[retryable, EmptyResponse()],
        ) as mocked_open:
            response = open_with_retry(object(), 5, backoff_seconds=0)
        self.assertIsInstance(response, EmptyResponse)
        self.assertEqual(mocked_open.call_count, 2)

    @staticmethod
    def _valid_interpretation():
        return {
            "intent": "drug_information",
            "drug_names": ["metformin"],
            "disease_names": [],
            "topic": "",
            "rewritten_query": "metformin",
            "confidence": 0.95,
        }

    def test_gemini_primary_model_success(self):
        interpreter = GeminiQueryInterpreter(api_key="test-key")
        with patch(
            "src.gemini_query_interpreter.urlopen",
            return_value=GeminiJsonResponse(self._valid_interpretation()),
        ) as mocked_open:
            result = interpreter.interpret("what does metformin do")
        self.assertEqual(result["model_used"], GEMINI_PRIMARY_MODEL)
        self.assertEqual(mocked_open.call_count, 1)
        self.assertIn(GEMINI_PRIMARY_MODEL, mocked_open.call_args.args[0].full_url)

    def test_retryable_primary_failure_uses_fallback_model_once(self):
        failures = [
            HTTPError("https://example.invalid", 503, "unavailable", {}, None),
            HTTPError("https://example.invalid", 503, "unavailable", {}, None),
        ]
        interpreter = GeminiQueryInterpreter(api_key="test-key")
        with patch(
            "src.gemini_query_interpreter.time.sleep",
        ), patch(
            "src.gemini_query_interpreter.urlopen",
            side_effect=[
                *failures,
                GeminiJsonResponse(self._valid_interpretation()),
            ],
        ) as mocked_open:
            result = interpreter.interpret("what does metformin do")
        self.assertEqual(result["model_used"], GEMINI_FALLBACK_MODEL)
        self.assertEqual(mocked_open.call_count, 3)
        self.assertIn(GEMINI_FALLBACK_MODEL, mocked_open.call_args.args[0].full_url)

    def test_both_gemini_models_unavailable_keeps_deterministic_fallback(self):
        failures = [
            HTTPError("https://example.invalid", 503, "unavailable", {}, None)
            for _ in range(3)
        ]
        interpreter = GeminiQueryInterpreter(api_key="test-key")
        self.use_interpreter(interpreter)
        with patch(
            "src.gemini_query_interpreter.time.sleep",
        ), patch(
            "src.gemini_query_interpreter.urlopen",
            side_effect=failures,
        ) as mocked_open:
            payload = self.search.search("banana spaceship medicine purple")
        self.assertEqual(mocked_open.call_count, 3)
        self.assertEqual(payload["intent"], "unknown")
        self.assertEqual(payload["ai_interpretation"], {"status": "unavailable"})

    def test_summarizer_uses_fallback_model_after_primary_unavailable(self):
        summary = {
            "status": "answered",
            "short_answer": "A short grounded explanation.",
            "key_points": ["One retrieved point."],
            "what_we_cannot_conclude": "This is not a safety conclusion.",
            "sources_used": ["FDA label"],
        }
        failures = [
            HTTPError("https://example.invalid", 503, "unavailable", {}, None),
            HTTPError("https://example.invalid", 503, "unavailable", {}, None),
        ]
        summarizer = GeminiEvidenceSummarizer(api_key="test-key")
        with patch(
            "src.gemini_query_interpreter.time.sleep",
        ), patch(
            "src.gemini_query_interpreter.urlopen",
            side_effect=[*failures, GeminiJsonResponse(summary)],
        ):
            result = summarizer.summarize("question", {"FDA label": ["evidence"]})
        self.assertEqual(result["model_used"], GEMINI_FALLBACK_MODEL)

    def test_identical_grounded_summary_is_reused_from_bounded_cache(self):
        summary = {
            "status": "answered",
            "short_answer": "A short grounded explanation.",
            "key_points": ["One retrieved point."],
            "what_we_cannot_conclude": "This is not a safety conclusion.",
            "sources_used": ["FDA label"],
        }
        summarizer = GeminiEvidenceSummarizer(api_key="test-key")
        with patch(
            "src.gemini_evidence_summarizer.open_with_model_fallback",
            return_value=(GeminiJsonResponse(summary), GEMINI_PRIMARY_MODEL),
        ) as request:
            first = summarizer.summarize("question", {"FDA label": ["evidence"]})
            second = summarizer.summarize("question", {"FDA label": ["evidence"]})
        self.assertEqual(first, second)
        self.assertEqual(request.call_count, 1)

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
        self.assertIn("/api/public/explain", routes)
        self.assertIn("/api/public/disease-suggestions", routes)

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
            summarizer = FixtureEvidenceSummarizer(result={
                "status": "answered",
                "short_answer": "A later grounded explanation.",
                "key_points": [],
                "what_we_cannot_conclude": "This is not personalized medical advice.",
                "sources_used": ["FDA label"],
            })
            with patch.object(
                app.state.public_search,
                "drug_information_service",
                FixtureDrugInformationService(),
            ), patch.object(
                app.state.public_search,
                "evidence_summarizer",
                summarizer,
            ):
                initial = client.get(
                    "/api/public/search", params={"q": "what does metformin do"}
                )
                enhanced = client.post(
                    "/api/public/explain",
                    json={"query": "what does metformin do"},
                )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["intent"], "drug_interactions")
        self.assertEqual(payload["recognized_entities"][0]["entity_id"], "DB00682")
        self.assertNotIn("conclusion", payload)
        self.assertEqual(initial.status_code, 200, initial.text)
        self.assertNotIn("explanation", initial.json())
        self.assertTrue(initial.json()["ai_explanation_eligible"])
        self.assertEqual(enhanced.status_code, 200, enhanced.text)
        self.assertEqual(
            enhanced.json()["explanation"]["short_answer"],
            "A later grounded explanation.",
        )
        self.assertEqual(len(summarizer.calls), 1)


if __name__ == "__main__":
    unittest.main()
