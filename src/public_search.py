"""Deterministic public-query routing over frozen CHEERS entity artifacts.

This module resolves only repository-backed drug and disease identities and may
query the existing evidence services for a resolved medicine pair. It does not
generate personalized medical conclusions, invent unverified aliases, or use
R-GCN scores.
"""

from __future__ import annotations

import csv
from difflib import SequenceMatcher
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
        "general_symptom_or_treatment_question",
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
DRUG_NAME_ALIASES = {"aspirin": "acetylsalicylic acid"}
GENERIC_SYMPTOM_TERMS = frozenset(
    {"pain", "headache", "fever", "nausea", "cough", "dizziness", "fatigue"}
)
NATURAL_SINGLE_ENTITY_PATTERNS = (
    ("drug_side_effects", ("drug",), re.compile(r"^(?:tell me(?: about)? )?(?P<entity>.+?) side efects$")),
    ("drug_side_effects", ("drug",), re.compile(r"^tell me (?P<entity>.+?) side effects$")),
    ("drug_side_effects", ("drug",), re.compile(r"^what are the side effects of (?P<entity>.+)$")),
    ("drug_information", ("drug",), re.compile(r"^what does (?P<entity>.+?) do$")),
    ("drug_information", ("drug",), re.compile(r"^what is (?P<entity>.+?) used for$")),
    ("drug_information", ("drug",), re.compile(r"^what is (?P<entity>.+?) for$")),
    (None, ("drug", "disease"), re.compile(r"^what s (?P<entity>.+)$")),
    (None, ("drug", "disease"), re.compile(r"^tell me about (?P<entity>.+)$")),
    (None, ("drug", "disease"), re.compile(r"^(?P<entity>.+?) information$")),
)
MAX_FUZZY_SUGGESTIONS = 5
FUZZY_MIN_SCORE = 0.84
FUZZY_AUTO_ACCEPT_SCORE = 0.86
FUZZY_AUTO_ACCEPT_MARGIN = 0.08


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
        query_interpreter=None,
        drug_information_service=None,
        evidence_summarizer=None,
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
        self.query_interpreter = query_interpreter
        self.drug_information_service = drug_information_service
        self.evidence_summarizer = evidence_summarizer
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

    @staticmethod
    def _fuzzy_score(entity, fragment):
        """Score conservative spelling similarity against a canonical name."""
        if len(fragment) < 5:
            return 0.0
        name = entity["normalized_name"]
        comparisons = [name]
        comparisons.extend(token for token in name.split() if len(token) >= 5)
        return max(
            SequenceMatcher(None, fragment, candidate, autojunk=False).ratio()
            for candidate in comparisons
        )

    def _fuzzy_matches(self, fragment, allowed):
        matches = []
        for entity in self.entities:
            if entity["entity_type"] not in allowed:
                continue
            score = self._fuzzy_score(entity, fragment)
            if score >= FUZZY_MIN_SCORE:
                matches.append(
                    (score, entity["name"].casefold(), entity, "close_fuzzy_name")
                )
        matches.sort(key=lambda item: (-item[0], item[1], item[2]["entity_id"]))
        return matches

    def disease_suggestions(self, query, limit=6):
        """Return bounded deterministic disease matches from the loaded inventory."""
        fragment = normalize_query(query)
        bounded_limit = max(1, min(int(limit), 6))
        if len(fragment) < 2:
            return {"query": fragment, "suggestions": []}

        diabetes_priority = {
            "diabetes mellitus disease": 0,
            "type 2 diabetes mellitus": 1,
            "type 1 diabetes mellitus": 2,
            "gestational diabetes": 3,
        }
        ranked = []
        for disease in self.diseases:
            name = disease["normalized_name"]
            match_type = None
            priority = None
            detail = 0
            if name == fragment:
                match_type, priority = "exact_canonical_name", 0
            elif fragment.startswith("diab") and name in diabetes_priority:
                match_type, priority, detail = "common_topic_match", 1, diabetes_priority[name]
            elif name.startswith(fragment):
                match_type, priority = "canonical_name_prefix", 2
            else:
                fuzzy_score = self._fuzzy_score(disease, fragment)
                if fuzzy_score >= FUZZY_MIN_SCORE:
                    match_type, priority, detail = "close_fuzzy_name", 3, -fuzzy_score
                elif fragment in name:
                    match_type, priority = "canonical_name_substring", 4
            if match_type is not None:
                ranked.append((priority, detail, len(name), name, disease, match_type))

        ranked.sort(key=lambda item: item[:4] + (item[4]["entity_id"],))
        return {
            "query": fragment,
            "suggestions": [
                {
                    "name": disease["name"],
                    "entity_id": disease["entity_id"],
                    "entity_type": "disease",
                    "match_type": match_type,
                }
                for _, _, _, _, disease, match_type in ranked[:bounded_limit]
            ],
        }

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

        candidates.sort(key=lambda item: (item[0], item[1], item[2]["entity_id"]))
        exact_names = [item for item in candidates if item[0] == 1]
        exact_ids = [item for item in candidates if item[0] == 2]
        aliases = []
        alias_name = DRUG_NAME_ALIASES.get(fragment) if "drug" in allowed else None
        if alias_name:
            aliases = [
                (2.5, entity["name"].casefold(), entity, "exact_common_name")
                for entity in self.entities
                if entity["entity_type"] == "drug"
                and entity["normalized_name"] == alias_name
            ]
        prefixes = [item for item in candidates if item[0] == 3]
        if exact_names:
            considered = exact_names
        elif exact_ids:
            considered = exact_ids
        elif aliases:
            considered = aliases
        elif prefixes:
            # Preserve ambiguity when a short prefix also occurs in other names.
            considered = candidates
        else:
            fuzzy_candidates = self._fuzzy_matches(fragment, allowed)
            if not fuzzy_candidates:
                considered = candidates
            else:
                top_score = fuzzy_candidates[0][0]
                next_score = fuzzy_candidates[1][0] if len(fuzzy_candidates) > 1 else 0.0
                if (
                    top_score >= FUZZY_AUTO_ACCEPT_SCORE
                    and top_score - next_score >= FUZZY_AUTO_ACCEPT_MARGIN
                ):
                    _, _, entity, match_type = fuzzy_candidates[0]
                    return (entity, match_type), None

                considered = [
                    (4, name, entity, match_type)
                    for _, name, entity, match_type in fuzzy_candidates[
                        :MAX_FUZZY_SUGGESTIONS
                    ]
                ]

        if not considered:
            return None, None
        if len(considered) == 1:
            _, _, entity, match_type = considered[0]
            return (entity, match_type), None

        return None, self._ambiguity(fragment, considered)

    def _ambiguity(self, fragment, matches):
        displayed_matches = matches
        if fragment == "diabetes" and all(
            entity["entity_type"] == "disease" for _, _, entity, _ in matches
        ):
            preferred_names = {
                "diabetes mellitus disease": 0,
                "type 2 diabetes mellitus": 1,
                "type 1 diabetes mellitus": 2,
                "gestational diabetes": 3,
            }
            preferred = sorted(
                (
                    item for item in matches
                    if item[2]["normalized_name"] in preferred_names
                ),
                key=lambda item: preferred_names[item[2]["normalized_name"]],
            )
            if preferred:
                displayed_matches = preferred
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
                for _, _, entity, match_type in displayed_matches[:MAX_AMBIGUOUS_MATCHES]
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
        for alias, canonical_name in DRUG_NAME_ALIASES.items():
            drug = next(
                (item for item in self.drugs if item["normalized_name"] == canonical_name),
                None,
            )
            match = re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", content)
            if drug is not None and match:
                mentions.append(
                    (match.start(), match.end(), -(match.end() - match.start()), drug, "exact_common_name")
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

        words = content.split()
        for index in range(1, len(words)):
            left = " ".join(words[:index])
            right = " ".join(words[index:])
            left_match, left_ambiguity = self._resolve_fragment(left, ("drug",))
            right_match, right_ambiguity = self._resolve_fragment(right, ("drug",))
            if left_ambiguity or right_ambiguity:
                continue
            if (
                left_match and right_match
                and left_match[0]["entity_id"] != right_match[0]["entity_id"]
            ):
                return [left_match, right_match], None

        mentions = self._exact_drug_mentions(content)
        if len(mentions) == 2:
            return mentions, None
        return None, None

    def _resolve_generic_treatment_question(self, normalized):
        selection_match = re.fullmatch(
            r"^what should i (?:take|use) for (?P<topic>.+)$", normalized
        )
        if selection_match and selection_match.group("topic") in GENERIC_SYMPTOM_TERMS:
            return True, None, None, selection_match.group("topic")
        for pattern in DRUG_FOR_DISEASE_PATTERNS:
            query_match = pattern.fullmatch(normalized)
            if query_match is None:
                continue
            topic = query_match.group("disease")
            if topic not in GENERIC_SYMPTOM_TERMS:
                continue
            match, ambiguity = self._resolve_fragment(query_match.group("drug"), ("drug",))
            return True, match, ambiguity, topic
        return False, None, None, None

    def _resolve_natural_single_entity(self, normalized):
        for intent, entity_types, pattern in NATURAL_SINGLE_ENTITY_PATTERNS:
            query_match = pattern.fullmatch(normalized)
            if query_match is None:
                continue
            match, ambiguity = self._resolve_fragment(
                query_match.group("entity"), entity_types
            )
            return True, intent, match, ambiguity
        return False, None, None, None

    def _generic_treatment_response(self, original_query, normalized, match, topic):
        response = self._base_response(
            original_query, normalized, "general_symptom_or_treatment_question"
        )
        drug = match[0] if match else None
        if match:
            response["recognized_entities"] = [self._serialize_entity(*match)]
            response["available_modules"].append("entity_identity")
        response["topic"] = topic
        supported_use = False
        if drug and self.drug_information_service is not None:
            try:
                label = self.drug_information_service.get_drug_information(drug["name"])
            except (KeyError, OSError, TypeError, ValueError):
                label = None
            use_evidence = self._label_evidence(
                label, ("indications_and_usage",), drug["name"]
            )
            supported_use = topic == "pain" and any(
                re.search(r"\b(?:pain|analges(?:ia|ic)|aches?)\b", item, re.IGNORECASE)
                for item in use_evidence
            )
        response["explanation"] = {
            "status": "limited",
            "short_answer": (
                (
                    f"{drug['name']} is used for pain relief in the available label information."
                    if supported_use else
                    f"CHEERS can show available label information about {drug['name']}, "
                    f"but it cannot decide whether it is appropriate for your {topic}."
                )
                if drug else "CHEERS cannot choose a medicine or treatment for you."
            ),
            "key_points": [
                (
                    "Review the medicine profile for available uses and side-effect information."
                    if drug else "Search for a medicine you are already considering to review its available information."
                ),
                "Use Check Medicines if you want to review it with another medicine.",
                "Ask a pharmacist or qualified health professional about a personal treatment choice.",
            ],
            "what_we_cannot_conclude": (
                "CHEERS cannot determine whether it is appropriate for your specific situation."
                if supported_use else
                "CHEERS cannot recommend what you should take or provide a dose."
            ),
            "sources_used": ["FDA label"] if supported_use else [],
        }
        if drug:
            response["destinations"] = [
                {"module": "medicine_profile", "frontend_path": f"/medicines/{drug['entity_id']}"},
                {"module": "medicine_uses", "frontend_path": f"/medicines/{drug['entity_id']}?section=uses"},
                {"module": "medicine_side_effects", "frontend_path": f"/medicines/{drug['entity_id']}?section=side-effects"},
                {"module": "medicine_checker", "frontend_path": f"/check?drug_a_id={drug['entity_id']}"},
            ]
        return response

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
        if entity["entity_type"] == "drug" and match_type == "exact_common_name":
            result["display_name"] = next(
                (
                    alias.title()
                    for alias, canonical_name in DRUG_NAME_ALIASES.items()
                    if canonical_name == entity["normalized_name"]
                ),
                entity["name"],
            )
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

    def _drug_pair_question_answer(
        self, drug_a, drug_b, include_external_evidence=True
    ):
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
        if (
            not include_external_evidence
            or self.label_evidence_service is None
            or self.literature_service is None
        ):
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

    def _resolved_response(
        self,
        original_query,
        normalized_query,
        intent,
        matches,
        include_external_evidence=True,
    ):
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
                answer = self._drug_pair_question_answer(
                    drug_a,
                    drug_b,
                    include_external_evidence=include_external_evidence,
                )
                if not include_external_evidence:
                    answer["supporting_text"] = (
                        "CHEERS recognized both medicines. Source details can load separately."
                    )
                    answer["source_scope"] = (
                        "FDA label and PubMed source details load separately."
                    )
                response["answer"] = answer
                if (
                    include_external_evidence
                    and answer["answer_type"] == "insufficient_information"
                ):
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

    def _search_deterministic(self, query, include_external_evidence=True):
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

        natural_attempted, natural_intent, natural_match, natural_ambiguity = (
            self._resolve_natural_single_entity(normalized)
        )
        if natural_attempted:
            if natural_ambiguity:
                candidate_types = set(natural_ambiguity["entity_types"])
                intent = natural_intent
                if intent is None and candidate_types == {"disease"}:
                    intent = "disease_information"
                elif intent is None and candidate_types == {"drug"}:
                    intent = "drug_information"
                response = self._base_response(
                    original_query, normalized, intent or "unknown"
                )
                response["ambiguous_matches"] = [natural_ambiguity]
                return response
            if natural_match:
                entity = natural_match[0]
                intent = natural_intent or (
                    "disease_information"
                    if entity["entity_type"] == "disease"
                    else "drug_information"
                )
                return self._resolved_response(
                    original_query, normalized, intent, [natural_match]
                )

        generic_attempted, generic_match, generic_ambiguity, generic_topic = (
            self._resolve_generic_treatment_question(normalized)
        )
        if generic_attempted:
            if generic_match or (generic_topic and generic_ambiguity is None):
                return self._generic_treatment_response(
                    original_query, normalized, generic_match, generic_topic
                )
            if generic_ambiguity:
                response = self._base_response(
                    original_query, normalized, "general_symptom_or_treatment_question"
                )
                response["ambiguous_matches"] = [generic_ambiguity]
                return response
            return self._unknown_response(
                original_query,
                normalized,
                "The medicine could not be resolved conservatively.",
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
                original_query,
                normalized,
                pair_intent,
                pair,
                include_external_evidence=include_external_evidence,
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

    @staticmethod
    def _interpreted_query(interpretation):
        intent = interpretation["intent"]
        drugs = interpretation["drug_names"]
        diseases = interpretation["disease_names"]
        topic = interpretation["topic"]
        if intent == "drug_information" and drugs:
            return drugs[0]
        if intent == "disease_information" and diseases:
            return f"what is {diseases[0]}"
        if intent == "drug_side_effects" and drugs:
            return f"{drugs[0]} side effects"
        if intent == "drug_interactions" and drugs:
            return f"{drugs[0]} interactions"
        if intent == "drug_food_lifestyle" and drugs and topic:
            return f"{drugs[0]} {topic}"
        if intent == "drug_pair_question" and len(drugs) >= 2:
            return f"can i take {drugs[0]} with {drugs[1]} together"
        if intent == "drug_for_disease" and drugs and diseases:
            return f"is {drugs[0]} used for {diseases[0]}"
        if intent == "medicines_for_disease" and diseases:
            return f"medicines for {diseases[0]}"
        if intent == "disease_nutrition" and diseases:
            return f"nutrition for {diseases[0]}"
        return interpretation["rewritten_query"]

    @staticmethod
    def _ai_metadata(status, interpretation=None):
        metadata = {"status": status}
        if interpretation is not None:
            metadata.update(interpretation)
        return metadata

    @staticmethod
    def _fallback_explanation(response):
        intent = response["intent"]
        answer = response.get("answer", {})
        if intent == "drug_pair_question":
            return {
                "status": "limited" if answer.get("answer_type") == "insufficient_information" else "answered",
                "short_answer": answer.get("supporting_text", "CHEERS could not summarize this pair."),
                "key_points": [
                    f"FDA label mentions retrieved: {answer.get('evidence_summary', {}).get('label_mentions', 0)}.",
                    f"PubMed records retrieved: {answer.get('evidence_summary', {}).get('pubmed_records', 0)}.",
                ],
                "what_we_cannot_conclude": "These retrieved sources do not establish that the combination is safe or appropriate for a person.",
                "sources_used": ["FDA label", "PubMed"],
            }
        if intent == "drug_for_disease":
            relations = [item.get("relation") for item in answer.get("relationships", []) if item.get("relation")]
            return {
                "status": "answered" if relations else "limited",
                "short_answer": answer.get("direct_answer", "CHEERS could not determine a relationship from its checked data."),
                "key_points": [f"CHEERS relationship found: {relation}." for relation in relations[:3]],
                "what_we_cannot_conclude": "A graph relationship is not a personalized treatment recommendation.",
                "sources_used": ["CHEERS knowledge graph"],
            }
        return None

    @staticmethod
    def _label_evidence(label_information, sections, selected_drug_name=None):
        evidence = []
        if not isinstance(label_information, dict) or label_information.get("status") != "ok":
            return evidence
        for record in label_information.get("records", [])[:3]:
            classification = record.get("product_classification", {})
            if (
                selected_drug_name
                and classification.get("category") == "combination"
            ):
                continue
            record_sections = record.get("sections", {})
            for section in sections:
                for entry in record_sections.get(section, [])[:2]:
                    if isinstance(entry, dict) and entry.get("text"):
                        evidence.append(f"{section}: {entry['text']}")
        return evidence

    @staticmethod
    def _plain_use_points(snippets, drug_name):
        points = []
        for snippet in snippets:
            text = snippet.split(": ", 1)[-1]
            if re.search(
                r"adjunct to diet and exercise to improve glycemic control.*type 2 diabetes",
                text,
                re.IGNORECASE,
            ):
                return [
                    f"{drug_name} is used to help control blood sugar in people with type 2 diabetes, together with diet and exercise.",
                    "It is used for blood-sugar control in type 2 diabetes.",
                    "It is commonly used alongside diet and exercise.",
                ]
        return PublicSearchService._plain_label_points(snippets)

    @staticmethod
    def _plain_label_points(snippets):
        candidates = []
        for snippet in snippets:
            text = snippet.split(": ", 1)[-1]
            common = re.search(
                r"most common adverse reactions\s*(?:\([^)]*\))?\s*are\s+([^.]+)",
                text,
                re.IGNORECASE,
            )
            if common:
                effects = common.group(1).strip(" ,;:")
                candidates.append(f"Commonly reported side effects include {effects}.")

            cleaned = re.sub(r"\[\s*see\b.*?\]", " ", text, flags=re.IGNORECASE)
            cleaned = re.sub(r"\(\s*\d+(?:\.\d+)*\s*\)", " ", cleaned)
            cleaned = re.sub(
                r"\b\d+(?:\.\d+)?\s+(?:ADVERSE REACTIONS?|WARNINGS(?: AND (?:CAUTIONS|PRECAUTIONS))?|"
                r"CLINICAL (?:STUDIES|TRIALS) EXPERIENCE|POSTMARKETING EXPERIENCE)\b",
                " ",
                cleaned,
                flags=re.IGNORECASE,
            )
            for sentence in re.split(r"(?<=[.!?])\s+", cleaned):
                sentence = " ".join(sentence.split()).strip(" -:;")
                sentence = re.sub(r"^[A-Za-z0-9 /-]{2,55}:\s*", "", sentence)
                sentence = re.sub(r"\s+([.!?])", r"\1", sentence)
                if not sentence or re.search(
                    r"following adverse reactions are also discussed|see boxed warning|"
                    r"following adverse reactions have been identified|"
                    r"to report suspected adverse reactions|clinical trials are conducted|"
                    r"listed in table|www\.fda\.gov|\btable\s+\d+",
                    sentence,
                    re.IGNORECASE,
                ):
                    continue
                if re.search(
                    r"\btablets?\s+in\s+(?:an?\s+)?u\.s\.?$",
                    sentence,
                    re.IGNORECASE,
                ):
                    continue
                words = re.findall(r"[A-Za-z][A-Za-z0-9-]*", sentence)
                if words and len(words) <= 6 and all(word[0].isupper() for word in words):
                    continue
                if len(sentence) > 140:
                    first_clause = re.split(r"[;:]", sentence, maxsplit=1)[0].strip()
                    if len(first_clause) < 35 or len(first_clause) > 139:
                        continue
                    sentence = first_clause
                if len(sentence) < 12:
                    continue
                candidates.append(sentence.rstrip(".!?") + ".")

        points = []
        token_sets = []
        stopwords = {"a", "an", "and", "are", "for", "in", "of", "the", "to", "was", "were", "with"}
        for point in candidates:
            tokens = {
                token for token in re.findall(r"[a-z0-9]+", point.casefold())
                if token not in stopwords
            }
            if not tokens:
                continue
            duplicate = any(
                len(tokens & prior) / len(tokens | prior) >= 0.5
                or len(tokens & prior) / min(len(tokens), len(prior)) >= 0.75
                for prior in token_sets
            )
            if duplicate:
                continue
            points.append(point)
            token_sets.append(tokens)
            if len(points) == 3:
                break
        return points

    def _with_explanation(self, query, response):
        intent = response["intent"]
        if intent not in {
            "drug_pair_question", "drug_information", "drug_side_effects", "drug_for_disease",
        }:
            return response
        evidence = {}
        snippets = []
        fallback = self._fallback_explanation(response)
        if intent == "drug_pair_question":
            answer = response.get("answer", {})
            evidence = {
                "FDA label": [
                    answer.get("supporting_text", ""),
                    f"Retrieved label mentions: {answer.get('evidence_summary', {}).get('label_mentions', 0)}",
                ],
                "PubMed": [f"Retrieved records: {answer.get('evidence_summary', {}).get('pubmed_records', 0)}"],
            }
        elif intent == "drug_for_disease":
            evidence = {"CHEERS knowledge graph": [json.dumps(response.get("answer", {}))]}
        elif self.drug_information_service is not None and response.get("recognized_entities"):
            entity = response["recognized_entities"][0]
            try:
                label = self.drug_information_service.get_drug_information(entity["name"])
            except (KeyError, OSError, TypeError, ValueError):
                label = None
            sections = (
                ("adverse_reactions", "warnings", "warnings_and_cautions")
                if intent == "drug_side_effects"
                else ("indications_and_usage", "description")
            )
            snippets = self._label_evidence(label, sections, entity["name"])
            plain_points = (
                self._plain_label_points(snippets)
                if intent == "drug_side_effects"
                else self._plain_use_points(snippets, entity["name"])
            )
            evidence = {"FDA label": snippets}
            direct_use_answer = (
                plain_points[0]
                if intent == "drug_information"
                and plain_points
                and plain_points[0].casefold().startswith(
                    f"{entity['name'].casefold()} is used"
                )
                else None
            )
            fallback = {
                "status": "limited" if not snippets else "answered",
                "short_answer": (
                    direct_use_answer or f"CHEERS found official label information for {entity['name']}."
                    if snippets else "CHEERS could not retrieve relevant official label text for this medicine."
                ),
                "key_points": plain_points[1:] if direct_use_answer else plain_points,
                "what_we_cannot_conclude": (
                    "Official label information is general information, not personalized medical advice."
                    if snippets else
                    "Missing label text does not mean the medicine has no uses, side effects, or risks."
                ),
                "sources_used": ["FDA label"] if snippets else [],
            }
        explanation = None
        can_summarize = not (
            intent == "drug_pair_question"
            and response.get("answer", {}).get("answer_type") == "insufficient_information"
        )
        if self.evidence_summarizer is not None and any(evidence.values()) and can_summarize:
            try:
                explanation = self.evidence_summarizer.summarize(query, evidence)
            except Exception:
                explanation = None
        if explanation and intent == "drug_side_effects":
            if snippets:
                entity = response["recognized_entities"][0]
                explanation["short_answer"] = (
                    f"CHEERS found official label information for {entity['name']}."
                )
                explanation["key_points"] = plain_points
                explanation["what_we_cannot_conclude"] = (
                    "Official label information is general information, not personalized medical advice."
                )
            else:
                cleaned = self._plain_label_points(
                    [explanation.get("short_answer", ""), *explanation.get("key_points", [])]
                )
                if cleaned:
                    explanation["short_answer"] = cleaned[0]
                    explanation["key_points"] = cleaned[1:]
        elif explanation and intent == "drug_information" and direct_use_answer:
            explanation["short_answer"] = direct_use_answer
            explanation["key_points"] = plain_points[1:]
            explanation["what_we_cannot_conclude"] = (
                "Official label information is general information, not personalized medical advice."
            )
        response["explanation"] = explanation or fallback
        return response

    @staticmethod
    def _explanation_eligible(response):
        if response.get("ambiguous_matches"):
            return False
        intent = response.get("intent")
        if intent in {"drug_pair_question", "drug_side_effects", "drug_for_disease"}:
            return True
        if intent != "drug_information" or not response.get("recognized_entities"):
            return False
        entity = response["recognized_entities"][0]
        query = response.get("normalized_query", "")
        return query not in {
            normalize_query(entity.get("name", "")),
            normalize_query(entity.get("entity_id", "")),
        }

    def search(
        self,
        query,
        *,
        include_explanation=True,
        include_external_evidence=True,
    ):
        deterministic = self._search_deterministic(
            query,
            include_external_evidence=include_external_evidence,
        )
        if deterministic["intent"] != "unknown" or self.query_interpreter is None:
            deterministic["ai_explanation_eligible"] = self._explanation_eligible(
                deterministic
            )
            return (
                self._with_explanation(query, deterministic)
                if include_explanation
                else deterministic
            )

        try:
            interpretation = self.query_interpreter.interpret(query)
        except Exception:
            interpretation = None
        if not interpretation or interpretation.get("confidence", 0) < 0.7:
            deterministic["ai_interpretation"] = self._ai_metadata("unavailable")
            return deterministic

        intent = interpretation["intent"]
        if intent in {"general_symptom_or_treatment_question", "unsupported"}:
            response = self._base_response(
                query,
                normalize_query(query),
                intent,
            )
            response["unavailable_modules"].append(
                {
                    "module": "query_resolution",
                    "reason": (
                        "CHEERS does not select treatments or provide personalized "
                        "medicine recommendations."
                    ),
                }
            )
            if intent == "general_symptom_or_treatment_question":
                response["explanation"] = {
                    "status": "limited",
                    "short_answer": "CHEERS cannot choose a medicine or treatment for you.",
                    "key_points": [
                        "You can search for a medicine you are already considering.",
                        "You can compare two medicines in Check Medicines.",
                        "A pharmacist or other qualified health professional can help with a personal treatment choice.",
                    ],
                    "what_we_cannot_conclude": "CHEERS cannot recommend what you should take.",
                    "sources_used": [],
                }
        elif intent == "unknown":
            response = deterministic
        else:
            response = self._search_deterministic(
                self._interpreted_query(interpretation),
                include_external_evidence=include_external_evidence,
            )
            response["original_query"] = str(query)
            response["normalized_query"] = normalize_query(query)
        response["ai_interpretation"] = self._ai_metadata("used", interpretation)
        response["ai_explanation_eligible"] = self._explanation_eligible(response)
        return (
            self._with_explanation(query, response)
            if include_explanation
            else response
        )


__all__ = ["PublicSearchService", "SUPPORTED_INTENTS", "normalize_query"]
