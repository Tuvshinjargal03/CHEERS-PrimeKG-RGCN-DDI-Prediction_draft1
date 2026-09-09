"""Deterministic public-query routing over frozen CHEERS entity artifacts.

This module resolves only repository-backed drug and disease identities and may
query the existing evidence services for a resolved medicine pair. It does not
generate personalized medical conclusions, infer aliases, or use R-GCN scores.
"""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import urlencode

from src.disease_information import DiseaseInformationService
from src.entity_metadata import EntityMetadataStore


SUPPORTED_INTENTS = frozenset(
    {
        "disease_information",
        "drug_information",
        "drug_side_effects",
        "drug_interactions",
        "drug_food_lifestyle",
        "drug_pair",
        "drug_pair_question",
        "drug_for_disease",
        "medicines_for_disease",
        "disease_nutrition",
        "unknown",
        "unsupported",
    }
)

INFORMATION_PREFIXES = ("tell me about", "what is")
SIDE_EFFECT_PHRASES = (
    "side effects",
    "side effect",
    "adverse effects",
    "adverse effect",
)
INTERACTION_PHRASES = ("drug interactions", "drug interaction", "interactions", "interaction")
PAIR_QUESTION_PREFIXES = (
    "is it okay to take",
    "is it okay to use",
    "is it ok to take",
    "is it ok to use",
    "can i take",
    "can i use",
)
PAIR_QUESTION_SUFFIXES = ("together",)
MEDICINES_FOR_DISEASE_PREFIXES = (
    "what medicines are used for",
    "what drugs are used for",
    "medicines for",
    "drugs for",
)
DRUG_FOR_DISEASE_PATTERNS = (
    re.compile(r"^can i use (?P<drug>.+?) for (?P<disease>.+)$"),
    re.compile(r"^is (?P<drug>.+?) used for (?P<disease>.+)$"),
    re.compile(r"^does (?P<drug>.+?) treat (?P<disease>.+)$"),
    re.compile(r"^is (?P<drug>.+?) for (?P<disease>.+)$"),
    re.compile(r"^(?P<drug>.+?) for (?P<disease>.+)$"),
)
DISEASE_NUTRITION_PATTERNS = (
    re.compile(r"^nutrition for (?P<disease>.+)$"),
    re.compile(r"^diet information for (?P<disease>.+)$"),
    re.compile(r"^foods? to limit with (?P<disease>.+)$"),
    re.compile(r"^(?P<disease>.+?) nutrition$"),
    re.compile(r"^(?P<disease>.+?) diet(?: information)?$"),
)
FOOD_LIFESTYLE_TOPICS = (
    ("high_fat_meal", "High-fat meal", ("high fat meal", "high fat meals")),
    (
        "fasting_or_empty_stomach",
        "Fasting / empty stomach",
        ("empty stomach", "fasting"),
    ),
    ("smoking_or_tobacco", "Smoking / tobacco", ("smoking", "tobacco")),
    ("milk_or_dairy", "Milk / dairy", ("milk", "dairy")),
    ("food_or_meals", "Food & meals", ("food", "meal", "meals")),
    ("grapefruit", "Grapefruit", ("grapefruit",)),
    ("vitamin_k", "Vitamin K", ("vitamin k",)),
    ("alcohol", "Alcohol", ("alcohol",)),
)
UNSUPPORTED_DIET_PATTERNS = (
    re.compile(r"^foods? to avoid(?: with .+)?$"),
    re.compile(r"^best diet(?: for .+)?$"),
    re.compile(r"^make me (?:a )?diet(?: plan)?$"),
    re.compile(r"^(?:a )?meal plan(?: for me)?$"),
    re.compile(r"^(?:calories|macros)(?: for me)?$"),
    re.compile(r"^what should i eat(?: .+)?$"),
    re.compile(r"^what should i personally eat(?: .+)?$"),
    re.compile(r"^weight loss plan(?: for me)?$"),
)
MAX_AMBIGUOUS_MATCHES = 20


def normalize_query(value):
    """Normalize punctuation and whitespace without fuzzy spelling correction."""
    normalized = unicodedata.normalize("NFKC", str(value)).casefold()
    normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
    return " ".join(normalized.split())


def _without_phrases(value, phrases):
    result = value
    for phrase in sorted(phrases, key=len, reverse=True):
        result = re.sub(rf"(?:^|\s){re.escape(phrase)}(?=\s|$)", " ", result)
    return " ".join(result.split())


class PublicSearchService:
    """Resolve public queries through verified identities and source services."""

    EXPECTED_DRUGS = 4_278
    EXPECTED_DISEASES = 2_010

    def __init__(
        self,
        project_dir=None,
        disease_information_service=None,
        label_evidence_service=None,
        literature_service=None,
    ):
        if project_dir is None:
            project_dir = Path(__file__).resolve().parents[1]
        self.project_dir = Path(project_dir).resolve()
        runtime = self.project_dir / "final_release"
        metadata_runtime = runtime / "entity_metadata_runtime"

        self.drugs = self._load_drugs(
            runtime / "lightweight_runtime" / "drug_metadata.csv"
        )
        description_store = EntityMetadataStore.load_descriptions(
            metadata_runtime / "disease_descriptions.jsonl",
            metadata_runtime / "DISEASE_DESCRIPTIONS_MANIFEST.json",
            metadata_runtime / "entity_description_inventory.jsonl",
            self.project_dir,
        )
        self.diseases = self._load_diseases(
            metadata_runtime / "entity_description_inventory.jsonl",
            description_store,
        )
        self.g3_context_drug_ids = self._load_g3_context_drug_ids(
            runtime / "g3_context_runtime" / "g3_drug_context.csv"
        )
        self.disease_information_service = (
            disease_information_service
            if disease_information_service is not None
            else DiseaseInformationService(project_dir=self.project_dir)
        )
        self.label_evidence_service = label_evidence_service
        self.literature_service = literature_service
        self.entities = self.drugs + self.diseases
        self._validate()

    @staticmethod
    def _load_drugs(path):
        with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
            return tuple(
                {
                    "entity_type": "drug",
                    "entity_id": row["entity_id"].strip(),
                    "name": row["entity_name"].strip(),
                    "node_id": int(row["node_id"]),
                    "source": row["entity_source"].strip(),
                    "normalized_name": normalize_query(row["entity_name"]),
                    "normalized_id": normalize_query(row["entity_id"]),
                }
                for row in csv.DictReader(handle)
            )

    @staticmethod
    def _load_diseases(path, description_store):
        diseases = []
        with Path(path).open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    raise ValueError(f"Blank entity inventory line {line_number}.")
                row = json.loads(line)
                if row.get("entity_type") != "disease":
                    continue
                metadata = description_store.get("disease", row["entity_id"])
                if metadata is None:
                    raise ValueError(
                        f"Disease description metadata is missing for {row['entity_id']}."
                    )
                description = (
                    metadata["description"]
                    if metadata["status"] == "approved" and metadata["description"]
                    else None
                )
                diseases.append(
                    {
                        "entity_type": "disease",
                        "entity_id": row["entity_id"],
                        "name": row["display_name"],
                        "node_id": int(row["graph_node_id"]),
                        "source": row["source"],
                        "normalized_name": normalize_query(row["display_name"]),
                        "normalized_id": normalize_query(row["entity_id"]),
                        "description": description,
                        "description_status": metadata["status"],
                        "description_source": metadata["source"] if description else None,
                        "description_source_id": metadata["source_id"] if description else None,
                        "description_license": metadata["license"] if description else None,
                    }
                )
        return tuple(diseases)

    @staticmethod
    def _load_g3_context_drug_ids(path):
        with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
            return frozenset(
                row["drug_id"].strip() for row in csv.DictReader(handle)
            )

    def _validate(self):
        if len(self.drugs) != self.EXPECTED_DRUGS:
            raise ValueError(f"Expected {self.EXPECTED_DRUGS:,} candidate drugs.")
        if len(self.diseases) != self.EXPECTED_DISEASES:
            raise ValueError(f"Expected {self.EXPECTED_DISEASES:,} disease entities.")

        searchable_ids = {item["entity_id"] for item in self.drugs}
        if len(searchable_ids & self.g3_context_drug_ids) != 2_974:
            raise ValueError("Expected 2,974 candidate drugs with exported G3 context.")

        for entity_type, entities in (("drug", self.drugs), ("disease", self.diseases)):
            ids = [item["entity_id"] for item in entities]
            names = [item["normalized_name"] for item in entities]
            if len(ids) != len(set(ids)):
                raise ValueError(f"Duplicate {entity_type} entity IDs in public search data.")
            if len(names) != len(set(names)):
                raise ValueError(f"Duplicate normalized {entity_type} names in public search data.")
            if any(not item["normalized_name"] or not item["normalized_id"] for item in entities):
                raise ValueError(f"Empty {entity_type} search identity.")

    @staticmethod
    def _match_type(entity, fragment):
        if entity["normalized_name"] == fragment:
            return "exact_canonical_name", 1
        if entity["normalized_id"] == fragment:
            return "exact_entity_id", 2
        if entity["normalized_name"].startswith(fragment):
            return "canonical_name_prefix", 3
        if fragment in entity["normalized_name"]:
            return "canonical_name_substring", 4
        return None

    def _resolve_fragment(self, fragment, entity_types=None):
        allowed = set(entity_types or ("drug", "disease"))
        candidates = []
        for entity in self.entities:
            if entity["entity_type"] not in allowed:
                continue
            match = self._match_type(entity, fragment)
            if match is not None:
                match_type, priority = match
                candidates.append((priority, entity["name"].casefold(), entity, match_type))

        if not candidates:
            return None, None

        candidates.sort(key=lambda item: (item[0], item[1], item[2]["entity_id"]))
        exact = [item for item in candidates if item[0] <= 2]
        considered = exact if exact else candidates
        if len(considered) == 1:
            _, _, entity, match_type = considered[0]
            return (entity, match_type), None

        return None, self._ambiguity(fragment, considered)

    def _ambiguity(self, fragment, matches):
        return {
            "query_fragment": fragment,
            "total_matches": len(matches),
            "entity_types": sorted({entity["entity_type"] for _, _, entity, _ in matches}),
            "candidates": [
                {
                    "entity_type": entity["entity_type"],
                    "entity_id": entity["entity_id"],
                    "name": entity["name"],
                    "node_id": entity["node_id"],
                    "source": entity["source"],
                    "match_type": match_type,
                    "verified_description_available": bool(entity.get("description")),
                }
                for _, _, entity, match_type in matches[:MAX_AMBIGUOUS_MATCHES]
            ],
        }

    def _exact_drug_mentions(self, content):
        mentions = []
        for drug in self.drugs:
            for value, match_type in (
                (drug["normalized_name"], "exact_canonical_name"),
                (drug["normalized_id"], "exact_entity_id"),
            ):
                match = re.search(rf"(?<!\w){re.escape(value)}(?!\w)", content)
                if match:
                    mentions.append(
                        (match.start(), match.end(), -(match.end() - match.start()), drug, match_type)
                    )

        mentions.sort(key=lambda item: (item[2], item[0], item[3]["entity_id"]))
        selected = []
        occupied = set()
        for start, end, _, drug, match_type in mentions:
            span = set(range(start, end))
            if span & occupied:
                continue
            selected.append((start, end, drug, match_type))
            occupied.update(span)

        uncovered = "".join(
            character
            for index, character in enumerate(content)
            if index not in occupied and not character.isspace()
        )
        if uncovered:
            return []

        selected.sort(key=lambda item: item[0])
        unique = []
        seen = set()
        for _, _, drug, match_type in selected:
            if drug["entity_id"] not in seen:
                unique.append((drug, match_type))
                seen.add(drug["entity_id"])
        return unique

    def _resolve_pair(self, content):
        if re.search(r"\s+(?:with|and)\s+", content):
            parts = [
                part.strip()
                for part in re.split(r"\s+(?:with|and)\s+", content, maxsplit=1)
            ]
            if len(parts) == 2 and all(parts):
                resolved = []
                ambiguities = []
                for part in parts:
                    match, ambiguity = self._resolve_fragment(part, ("drug",))
                    if match:
                        resolved.append(match)
                    if ambiguity:
                        ambiguities.append(ambiguity)
                if ambiguities:
                    return None, ambiguities
                if len(resolved) == 2 and resolved[0][0]["entity_id"] != resolved[1][0]["entity_id"]:
                    return resolved, None
                return None, None

        mentions = self._exact_drug_mentions(content)
        if len(mentions) == 2:
            return mentions, None
        return None, None

    @staticmethod
    def _pair_question_content(normalized):
        content = normalized
        has_question_form = False
        for prefix in PAIR_QUESTION_PREFIXES:
            if content.startswith(f"{prefix} "):
                content = content[len(prefix) :].strip()
                has_question_form = True
                break
        for suffix in PAIR_QUESTION_SUFFIXES:
            if content.endswith(f" {suffix}"):
                content = content[: -len(suffix)].strip()
                has_question_form = True
                break
        if re.search(r"\s+(?:with|and)\s+", content):
            has_question_form = True
        return content, has_question_form

    def _resolve_medicines_for_disease(self, normalized):
        for prefix in MEDICINES_FOR_DISEASE_PREFIXES:
            if normalized.startswith(f"{prefix} "):
                disease_fragment = normalized[len(prefix) :].strip()
                match, ambiguity = self._resolve_fragment(
                    disease_fragment, ("disease",)
                )
                return True, match, ambiguity
        return False, None, None

    def _resolve_disease_nutrition(self, normalized):
        for pattern in DISEASE_NUTRITION_PATTERNS:
            query_match = pattern.fullmatch(normalized)
            if query_match is None:
                continue
            match, ambiguity = self._resolve_fragment(
                query_match.group("disease"),
                ("disease",),
            )
            return True, match, ambiguity
        return False, None, None

    def _resolve_drug_for_disease(self, normalized):
        for pattern in DRUG_FOR_DISEASE_PATTERNS:
            query_match = pattern.fullmatch(normalized)
            if query_match is None:
                continue

            resolved = []
            ambiguities = []
            for fragment, entity_type in (
                (query_match.group("drug"), "drug"),
                (query_match.group("disease"), "disease"),
            ):
                match, ambiguity = self._resolve_fragment(fragment, (entity_type,))
                if match:
                    resolved.append(match)
                if ambiguity:
                    ambiguities.append(ambiguity)
            return True, resolved, ambiguities
        return False, [], []

    def _resolve_drug_food_lifestyle(self, normalized):
        for topic, label, phrases in FOOD_LIFESTYLE_TOPICS:
            for phrase in phrases:
                escaped = re.escape(phrase)
                patterns = (
                    re.compile(
                        rf"^take (?P<drug>.+?) with {escaped}(?: information)?$"
                    ),
                    re.compile(
                        rf"^(?P<drug>.+?) with {escaped}(?: information)?$"
                    ),
                    re.compile(
                        rf"^(?P<drug>.+?) {escaped}(?: information)?$"
                    ),
                )
                for pattern in patterns:
                    query_match = pattern.fullmatch(normalized)
                    if query_match is None:
                        continue
                    match, ambiguity = self._resolve_fragment(
                        query_match.group("drug"),
                        ("drug",),
                    )
                    return True, match, ambiguity, topic, label
        return False, None, None, None, None

    @staticmethod
    def _serialize_entity(entity, match_type):
        result = {
            "entity_type": entity["entity_type"],
            "entity_id": entity["entity_id"],
            "name": entity["name"],
            "node_id": entity["node_id"],
            "source": entity["source"],
            "match_type": match_type,
        }
        if entity["entity_type"] == "disease":
            result["verified_description_available"] = bool(entity["description"])
            result["description_status"] = entity["description_status"]
            if entity["description"]:
                result["description"] = entity["description"]
                result["description_provenance"] = {
                    "source": entity["description_source"],
                    "source_id": entity["description_source_id"],
                    "license": entity["description_license"],
                }
        return result

    @staticmethod
    def _base_response(original_query, normalized_query, intent):
        if intent not in SUPPORTED_INTENTS:
            raise ValueError(f"Unsupported public-search intent: {intent}.")
        return {
            "original_query": str(original_query),
            "normalized_query": normalized_query,
            "intent": intent,
            "recognized_entities": [],
            "ambiguous_matches": [],
            "available_modules": [],
            "unavailable_modules": [],
            "destinations": [],
            "safety_note": (
                "This response only routes to source-backed CHEERS information. "
                "It is not medical advice and does not determine whether a drug "
                "or drug combination is safe or appropriate."
            ),
        }

    @staticmethod
    def _unknown_response(original_query, normalized_query, reason):
        response = PublicSearchService._base_response(
            original_query, normalized_query, "unknown"
        )
        response["unavailable_modules"].append(
            {"module": "query_resolution", "reason": reason}
        )
        return response

    @staticmethod
    def _answer_entity(entity):
        return {
            "entity_type": entity["entity_type"],
            "entity_id": entity["entity_id"],
            "name": entity["name"],
            "source": entity["source"],
        }

    def _drug_for_disease_answer(self, drug, disease):
        source_scope = (
            "Checked against typed drug-disease relationships in the frozen "
            "G3 context artifact used by the CHEERS Disease Guide."
        )
        safety_note = (
            "This answer describes relationships in the checked CHEERS data. "
            "It is not a personalized treatment recommendation and does not "
            "determine whether this medicine is safe or appropriate for an individual."
        )
        answer = {
            "answer_type": "insufficient_data",
            "direct_answer": "Not enough information",
            "drug": self._answer_entity(drug),
            "disease": self._answer_entity(disease),
            "relationships": [],
            "source_scope": source_scope,
            "safety_note": safety_note,
        }

        try:
            disease_information = (
                self.disease_information_service.get_disease_information(
                    disease["entity_id"]
                )
            )
            relationship_groups = disease_information["medicine_relationships"]
            indications = relationship_groups["indications"]
            other_relationships = relationship_groups["other"]
            if not isinstance(indications, list) or not isinstance(
                other_relationships, list
            ):
                return answer
        except (KeyError, OSError, TypeError, ValueError):
            return answer

        drug_id = drug["entity_id"].casefold()
        relationships = [
            dict(relationship)
            for relationship in indications + other_relationships
            if str(relationship.get("drug_id", "")).casefold() == drug_id
        ]
        answer["relationships"] = relationships

        if any(
            relationship.get("relation") == "indication"
            for relationship in relationships
        ):
            answer["answer_type"] = "indication_found"
            answer["direct_answer"] = "Yes — treatment indication found"
        elif relationships:
            answer["answer_type"] = "other_relationship_found"
            answer["direct_answer"] = (
                "Not as a standard indication in the checked data"
            )
        else:
            answer["answer_type"] = "no_indication_found"
            answer["direct_answer"] = (
                "No treatment indication found in the checked data"
            )
        return answer

    def _medicines_for_disease_answer(self, disease):
        answer = {
            "answer_type": "insufficient_data",
            "direct_answer": "Not enough information",
            "disease": self._answer_entity(disease),
            "total_count": 0,
            "medicines": [],
            "source_scope": (
                "Checked indication relationships in the frozen G3 context "
                "artifact used by the CHEERS Disease Guide."
            ),
            "safety_note": (
                "These are source-backed indication relationships, not ranked "
                "or personalized treatment recommendations. Missing relationships "
                "do not establish a universal clinical conclusion."
            ),
        }
        try:
            disease_information = (
                self.disease_information_service.get_disease_information(
                    disease["entity_id"]
                )
            )
            indications = disease_information["medicine_relationships"]["indications"]
            if not isinstance(indications, list) or any(
                not isinstance(item, dict)
                or item.get("relation") != "indication"
                for item in indications
            ):
                return answer
        except (KeyError, OSError, TypeError, ValueError):
            return answer

        answer["total_count"] = len(indications)
        answer["medicines"] = [dict(item) for item in indications[:6]]
        if indications:
            answer["answer_type"] = "indication_medicines_found"
            answer["direct_answer"] = "Indication medicines found"
        else:
            answer["answer_type"] = "no_indication_medicines_found"
            answer["direct_answer"] = "No indication medicines found"
        return answer

    def _disease_nutrition_answer(self, disease):
        unavailable_message = (
            "Nutrition information is not currently available for this "
            "condition in CHEERS."
        )
        answer = {
            "disease": self._answer_entity(disease),
            "topic": "Nutrition & lifestyle",
            "availability": False,
            "source_organization": None,
            "destination": f"/diseases/{disease['entity_id']}",
            "message": unavailable_message,
        }
        try:
            disease_information = (
                self.disease_information_service.get_disease_information(
                    disease["entity_id"]
                )
            )
            nutrition = disease_information["nutrition_lifestyle"]
            if not isinstance(nutrition, dict) or nutrition.get("status") != "available":
                return answer
        except (KeyError, OSError, TypeError, ValueError):
            return answer

        source = nutrition.get("source")
        answer.update(
            {
                "availability": True,
                "source_organization": (
                    source.get("organization") if isinstance(source, dict) else None
                ),
                "destination": (
                    f"/diseases/{disease['entity_id']}?section=nutrition-lifestyle"
                ),
                "message": (
                    "CHEERS has reviewed general nutrition information for "
                    "this condition."
                ),
            }
        )
        return answer

    def _drug_pair_question_answer(self, drug_a, drug_b):
        answer = {
            "answer_type": "insufficient_information",
            "direct_answer": "Not enough information",
            "supporting_text": (
                "The checked sources did not provide enough reliable "
                "information for a clearer status."
            ),
            "drug_1": self._answer_entity(drug_a),
            "drug_2": self._answer_entity(drug_b),
            "evidence_summary": {
                "label_mentions": 0,
                "pubmed_records": 0,
            },
            "source_scope": (
                "Checked official-label cross-mentions from openFDA and "
                "name-based literature records from PubMed. These sources "
                "are independent of the R-GCN model."
            ),
            "safety_note": (
                "This is source review, not medical advice or a personalized "
                "instruction to use or avoid a medicine combination. Missing "
                "retrieved evidence does not establish safety."
            ),
        }
        if self.label_evidence_service is None or self.literature_service is None:
            return answer

        try:
            label_evidence = self.label_evidence_service.get_pair_evidence(
                drug_a_name=drug_a["name"],
                drug_b_name=drug_b["name"],
            )
            literature = self.literature_service.search_pair(
                drug_a_name=drug_a["name"],
                drug_b_name=drug_b["name"],
            )
        except (KeyError, OSError, TypeError, ValueError):
            return answer

        if not isinstance(label_evidence, dict) or not isinstance(literature, dict):
            return answer

        label_mentions = label_evidence.get("pair_evidence")
        papers = literature.get("papers")
        label_mentions = label_mentions if isinstance(label_mentions, list) else []
        papers = papers if isinstance(papers, list) else []
        answer["evidence_summary"] = {
            "label_mentions": len(label_mentions),
            "pubmed_records": len(papers),
        }

        # Parity with the Medicine Checker: an explicit structured label
        # cross-mention takes precedence, followed by literature-only review.
        if label_evidence.get("evidence_found") and label_mentions:
            answer["answer_type"] = "interaction_warning_found"
            answer["direct_answer"] = "Interaction warning found"
            answer["supporting_text"] = (
                "Interaction-related information for these medicines was found "
                "in official drug-label sources."
            )
        elif papers:
            answer["answer_type"] = "needs_review"
            answer["direct_answer"] = "Needs review"
            answer["supporting_text"] = (
                "Related literature was retrieved, but the checked sources do "
                "not justify a direct safety verdict."
            )
        return answer

    def _resolved_response(self, original_query, normalized_query, intent, matches):
        response = self._base_response(original_query, normalized_query, intent)
        response["recognized_entities"] = [
            self._serialize_entity(entity, match_type) for entity, match_type in matches
        ]
        response["available_modules"].append("entity_identity")

        if intent == "disease_nutrition":
            disease = matches[0][0]
            answer = self._disease_nutrition_answer(disease)
            response["answer"] = answer
            if answer["availability"]:
                response["available_modules"].append(
                    "disease_nutrition_information"
                )
                response["destinations"].append(
                    {
                        "module": "disease_nutrition_information",
                        "api_path": (
                            "/api/public/disease?"
                            f"{urlencode({'disease_id': disease['entity_id']})}"
                        ),
                        "frontend_path": answer["destination"],
                        "focus": "nutrition_lifestyle",
                    }
                )
            else:
                response["unavailable_modules"].append(
                    {
                        "module": "disease_nutrition_information",
                        "reason": answer["message"],
                    }
                )
        elif intent == "medicines_for_disease":
            disease = matches[0][0]
            answer = self._medicines_for_disease_answer(disease)
            response["answer"] = answer
            if answer["answer_type"] == "insufficient_data":
                response["unavailable_modules"].append(
                    {
                        "module": "disease_indication_medicines_answer",
                        "reason": "The checked Disease Guide indication data could not be read reliably.",
                    }
                )
            else:
                response["available_modules"].append(
                    "disease_indication_medicines_answer"
                )
        elif intent == "disease_information":
            disease = matches[0][0]
            if disease["description"]:
                response["available_modules"].append("disease_explanation")
            else:
                response["unavailable_modules"].append(
                    {
                        "module": "disease_explanation",
                        "reason": (
                            "No approved disease description is available for this "
                            f"entity; its source record is {disease['description_status']}."
                        ),
                    }
                )
        elif intent == "drug_information":
            response["unavailable_modules"].append(
                {
                    "module": "drug_explanation",
                    "reason": "Phase 1 exposes verified identity only; a distributable drug-information source is not bundled.",
                }
            )
        elif intent == "drug_side_effects":
            response["unavailable_modules"].append(
                {
                    "module": "drug_side_effects",
                    "reason": "One-drug label-section retrieval is intentionally deferred beyond Phase 1.",
                }
            )
        elif intent == "drug_interactions":
            drug_id = matches[0][0]["entity_id"]
            response["available_modules"].append("research_graph_context")
            response["destinations"].append(
                {
                    "module": "research_graph_context",
                    "api_path": f"/api/context/drug?{urlencode({'drug_id': drug_id})}",
                }
            )
            response["unavailable_modules"].append(
                {
                    "module": "single_drug_label_interactions",
                    "reason": "One-drug label-section retrieval is intentionally deferred beyond Phase 1.",
                }
            )
        elif intent == "drug_food_lifestyle":
            drug_id = matches[0][0]["entity_id"]
            response["available_modules"].append(
                "drug_food_lifestyle_information"
            )
            response["destinations"].append(
                {
                    "module": "drug_food_lifestyle_information",
                    "api_path": (
                        f"/api/public/medicine?{urlencode({'drug_id': drug_id})}"
                    ),
                    "frontend_path": (
                        f"/medicines/{drug_id}?section=food-lifestyle"
                    ),
                    "focus": "food_lifestyle",
                }
            )
        elif intent == "drug_for_disease":
            drug = matches[0][0]
            disease = matches[1][0]
            answer = self._drug_for_disease_answer(drug, disease)
            response["answer"] = answer
            if answer["answer_type"] == "insufficient_data":
                response["unavailable_modules"].append(
                    {
                        "module": "drug_disease_relationship_answer",
                        "reason": "The checked Disease Guide relationship data could not be read reliably.",
                    }
                )
            else:
                response["available_modules"].append(
                    "drug_disease_relationship_answer"
                )
        elif intent in {"drug_pair", "drug_pair_question"}:
            drug_a = matches[0][0]
            drug_b = matches[1][0]
            drug_a_id = matches[0][0]["entity_id"]
            drug_b_id = matches[1][0]["entity_id"]
            params = urlencode({"drug_a_id": drug_a_id, "drug_b_id": drug_b_id})
            response["available_modules"].append("pair_external_evidence")
            response["destinations"].append(
                {
                    "module": "pair_external_evidence",
                    "api_path": f"/api/evidence/pair?{params}",
                    "frontend_path": f"/evidence?{params}",
                }
            )
            if {drug_a_id, drug_b_id}.issubset(self.g3_context_drug_ids):
                response["available_modules"].append("pair_graph_context")
                response["destinations"].append(
                    {
                        "module": "pair_graph_context",
                        "api_path": f"/api/context/pair?{params}",
                        "frontend_path": f"/graph?{params}",
                    }
                )
            else:
                response["unavailable_modules"].append(
                    {
                        "module": "pair_graph_context",
                        "reason": "One or both drugs lack exported G3 support context; this does not imply safety or absence of biomedical relationships.",
                    }
                )
            if intent == "drug_pair_question":
                answer = self._drug_pair_question_answer(drug_a, drug_b)
                response["answer"] = answer
                if answer["answer_type"] == "insufficient_information":
                    response["unavailable_modules"].append(
                        {
                            "module": "drug_pair_question_answer",
                            "reason": "The checked evidence sources did not provide enough reliable information for a clearer status.",
                        }
                    )
                else:
                    response["available_modules"].append(
                        "drug_pair_question_answer"
                    )
        return response

    def search(self, query):
        original_query = str(query)
        normalized = normalize_query(original_query)
        if not normalized:
            return self._unknown_response(
                original_query, normalized, "No searchable words were provided."
            )

        if any(pattern.fullmatch(normalized) for pattern in UNSUPPORTED_DIET_PATTERNS):
            response = self._base_response(
                original_query,
                normalized,
                "unsupported",
            )
            response["unavailable_modules"].append(
                {
                    "module": "query_resolution",
                    "reason": "Personalized food, nutrition, and disease-diet guidance is not supported.",
                }
            )
            return response

        nutrition_attempted, disease_match, disease_ambiguity = (
            self._resolve_disease_nutrition(normalized)
        )
        if nutrition_attempted:
            if disease_ambiguity:
                response = self._base_response(
                    original_query, normalized, "disease_nutrition"
                )
                response["ambiguous_matches"] = [disease_ambiguity]
                response["unavailable_modules"].append(
                    {
                        "module": "query_resolution",
                        "reason": "Multiple diseases are plausible; choose one explicit candidate before continuing.",
                    }
                )
                return response
            if disease_match:
                return self._resolved_response(
                    original_query,
                    normalized,
                    "disease_nutrition",
                    [disease_match],
                )
            return self._unknown_response(
                original_query,
                normalized,
                "No repository-backed disease identity matched conservatively.",
            )

        medicines_attempted, disease_match, disease_ambiguity = (
            self._resolve_medicines_for_disease(normalized)
        )
        if medicines_attempted:
            if disease_ambiguity:
                response = self._base_response(
                    original_query, normalized, "medicines_for_disease"
                )
                response["ambiguous_matches"] = [disease_ambiguity]
                response["unavailable_modules"].append(
                    {
                        "module": "query_resolution",
                        "reason": "Multiple diseases are plausible; choose one explicit candidate before continuing.",
                    }
                )
                return response
            if disease_match:
                return self._resolved_response(
                    original_query,
                    normalized,
                    "medicines_for_disease",
                    [disease_match],
                )
            return self._unknown_response(
                original_query,
                normalized,
                "No repository-backed disease identity matched conservatively.",
            )

        drug_disease_attempted, drug_disease_matches, drug_disease_ambiguities = (
            self._resolve_drug_for_disease(normalized)
        )
        if drug_disease_attempted:
            if drug_disease_ambiguities:
                response = self._base_response(
                    original_query, normalized, "drug_for_disease"
                )
                response["ambiguous_matches"] = drug_disease_ambiguities
                response["unavailable_modules"].append(
                    {
                        "module": "query_resolution",
                        "reason": "The drug or disease is ambiguous; choose explicit candidates before continuing.",
                    }
                )
                return response
            if len(drug_disease_matches) == 2:
                return self._resolved_response(
                    original_query,
                    normalized,
                    "drug_for_disease",
                    drug_disease_matches,
                )
            return self._unknown_response(
                original_query,
                normalized,
                "A repository-backed drug and disease could not both be resolved conservatively.",
            )

        (
            food_lifestyle_attempted,
            food_lifestyle_match,
            food_lifestyle_ambiguity,
            food_lifestyle_topic,
            food_lifestyle_label,
        ) = self._resolve_drug_food_lifestyle(normalized)
        if food_lifestyle_attempted:
            if food_lifestyle_ambiguity:
                response = self._base_response(
                    original_query,
                    normalized,
                    "drug_food_lifestyle",
                )
                response["topic"] = food_lifestyle_topic
                response["topic_label"] = food_lifestyle_label
                response["focus"] = "food_lifestyle"
                response["ambiguous_matches"] = [food_lifestyle_ambiguity]
                response["unavailable_modules"].append(
                    {
                        "module": "query_resolution",
                        "reason": "Multiple medicines are plausible; choose one explicit candidate before continuing.",
                    }
                )
                return response
            if food_lifestyle_match:
                response = self._resolved_response(
                    original_query,
                    normalized,
                    "drug_food_lifestyle",
                    [food_lifestyle_match],
                )
                response["topic"] = food_lifestyle_topic
                response["topic_label"] = food_lifestyle_label
                response["focus"] = "food_lifestyle"
                response["destinations"][0]["topic"] = food_lifestyle_topic
                return response
            return self._unknown_response(
                original_query,
                normalized,
                "No repository-backed medicine identity matched conservatively.",
            )

        has_side_effect_intent = any(
            re.search(rf"(?:^|\s){re.escape(phrase)}(?:\s|$)", normalized)
            for phrase in SIDE_EFFECT_PHRASES
        )
        has_interaction_intent = any(
            re.search(rf"(?:^|\s){re.escape(phrase)}(?:\s|$)", normalized)
            for phrase in INTERACTION_PHRASES
        )
        content = _without_phrases(
            normalized,
            INFORMATION_PREFIXES + SIDE_EFFECT_PHRASES + INTERACTION_PHRASES,
        )
        if not content:
            return self._unknown_response(
                original_query,
                normalized,
                "The query contains a topic but no recognizable entity name or ID.",
            )

        pair_content, has_pair_question_form = self._pair_question_content(content)
        pair_intent = "drug_pair_question" if has_pair_question_form else "drug_pair"
        pair, pair_ambiguities = self._resolve_pair(pair_content)
        if pair_ambiguities:
            response = self._base_response(original_query, normalized, pair_intent)
            response["ambiguous_matches"] = pair_ambiguities
            response["unavailable_modules"].append(
                {
                    "module": "query_resolution",
                    "reason": "One or both drug names are ambiguous; choose explicit candidates before continuing.",
                }
            )
            return response
        if pair:
            if has_side_effect_intent:
                response = self._base_response(original_query, normalized, "unsupported")
                response["recognized_entities"] = [
                    self._serialize_entity(entity, match_type)
                    for entity, match_type in pair
                ]
                response["unavailable_modules"].append(
                    {
                        "module": "query_resolution",
                        "reason": "A side-effect query must identify one drug, not a pair.",
                    }
                )
                return response
            return self._resolved_response(
                original_query, normalized, pair_intent, pair
            )

        if has_side_effect_intent or has_interaction_intent:
            intent = "drug_side_effects" if has_side_effect_intent else "drug_interactions"
            match, ambiguity = self._resolve_fragment(content, ("drug",))
        else:
            match, ambiguity = self._resolve_fragment(content)
            intent = None

        if ambiguity:
            candidate_types = set(ambiguity["entity_types"])
            if intent is None and candidate_types == {"disease"}:
                intent = "disease_information"
            elif intent is None and candidate_types == {"drug"}:
                intent = "drug_information"
            response = self._base_response(
                original_query, normalized, intent or "unknown"
            )
            response["ambiguous_matches"] = [ambiguity]
            response["unavailable_modules"].append(
                {
                    "module": "query_resolution",
                    "reason": "Multiple entities are plausible; choose one explicit candidate before continuing.",
                }
            )
            return response

        if not match:
            return self._unknown_response(
                original_query,
                normalized,
                "No repository-backed drug or disease identity matched conservatively.",
            )

        entity, match_type = match
        if intent is None:
            intent = (
                "disease_information"
                if entity["entity_type"] == "disease"
                else "drug_information"
            )
        return self._resolved_response(
            original_query, normalized, intent, [(entity, match_type)]
        )


__all__ = ["PublicSearchService", "SUPPORTED_INTENTS", "normalize_query"]
