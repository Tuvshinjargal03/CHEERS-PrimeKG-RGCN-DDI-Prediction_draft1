"""Bounded one-medicine information from official openFDA label records.

This service returns source text and record metadata only. It does not infer
clinical severity, safety, dosing, suitability, or treatment advice.
"""

from __future__ import annotations

import copy
import json
import os
import re
import threading
import time
from collections import OrderedDict
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class _TTLCache:
    def __init__(self, max_size=64, ttl_seconds=900):
        self.max_size = max(1, int(max_size))
        self.ttl_seconds = max(1.0, float(ttl_seconds))
        self._items = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            cached = self._items.get(key)
            if cached is None:
                return None
            stored_at, value = cached
            if time.monotonic() - stored_at >= self.ttl_seconds:
                del self._items[key]
                return None
            self._items.move_to_end(key)
            return copy.deepcopy(value)

    def put(self, key, value):
        with self._lock:
            self._items[key] = (time.monotonic(), copy.deepcopy(value))
            self._items.move_to_end(key)
            while len(self._items) > self.max_size:
                self._items.popitem(last=False)


class OpenFDADrugInformationService:
    """Retrieve selected official label sections for one canonical drug name."""

    ENDPOINT = "https://api.fda.gov/drug/label.json"
    LABEL_SECTIONS = (
        "indications_and_usage",
        "adverse_reactions",
        "warnings",
        "warnings_and_cautions",
        "boxed_warning",
        "drug_interactions",
        "dosage_and_administration",
        "information_for_patients",
        "patient_medication_information",
        "precautions",
        "general_precautions",
    )
    FOOD_LIFESTYLE_SECTIONS = (
        "drug_interactions",
        "warnings",
        "warnings_and_cautions",
        "dosage_and_administration",
        "information_for_patients",
        "patient_medication_information",
        "precautions",
        "general_precautions",
    )
    FOOD_LIFESTYLE_PATTERNS = {
        "alcohol": (
            r"\b(?:alcohol|alcoholic\s+(?:drink|drinks|beverage|beverages)|ethanol)\b",
        ),
        "grapefruit": (r"\bgrapefruit(?:\s+juice)?\b",),
        "vitamin_k": (r"\bvitamin\s+k\b",),
        "food_or_meals": (
            r"\b(?:take|administer(?:ed|ing)?|use|dose(?:d)?|swallow|give|given)\b"
            r".{0,120}?\b(?:with(?:\s+or\s+without)?|without|before|after)\s+"
            r"(?:(?:a|the|your)\s+)?(?:food|meals?)\b",
            r"\b(?:with(?:\s+or\s+without)?|without|before|after)\s+"
            r"(?:(?:a|the|your)\s+)?(?:food|meals?)\b",
            r"\b(?:food|meal)\s+(?:intake|instructions?)\b",
        ),
        "milk_or_dairy": (
            r"\b(?:take|administer(?:ed|ing)?|use|dose(?:d)?|swallow|give|given)\b"
            r".{0,100}?\b(?:with|after)\s+(?:food\s+or\s+)?milk\b",
            r"\b(?:with|after)\s+(?:food\s+or\s+)?milk\b",
            r"\b(?:food|meals?)\s+or\s+milk\b",
            r"\bdairy\s+(?:products?|foods?)\b",
            r"\bmilk\s+(?:products?|intake)\b",
        ),
        "high_fat_meal": (r"\bhigh[\s-]+fat\s+meal\b",),
        "fasting_or_empty_stomach": (
            r"\b(?:take|administer(?:ed|ing)?|use|dose(?:d)?|swallow|give|given)\b"
            r".{0,100}?\b(?:on\s+an?\s+empty\s+stomach|while\s+fasting|"
            r"in\s+the\s+fasted\s+state)\b",
            r"\b(?:on\s+an?\s+empty\s+stomach|while\s+fasting)\b"
            r".{0,100}?\b(?:take|administer(?:ed|ing)?|use|dose(?:d)?|swallow|give|given)\b",
        ),
        "smoking_or_tobacco": (
            r"\b(?:cigarette\s+smoking|smoking|tobacco\s+(?:use|products?)|"
            r"use\s+of\s+tobacco)\b",
        ),
    }
    PRODUCT_FIELDS = (
        "brand_name",
        "generic_name",
        "manufacturer_name",
        "product_ndc",
        "route",
        "substance_name",
    )

    def __init__(
        self,
        timeout_seconds=4.0,
        max_records=3,
        max_section_chars=6_000,
        max_food_lifestyle_excerpt_chars=360,
        max_food_lifestyle_items=24,
        cache_size=64,
        cache_ttl_seconds=900,
    ):
        self.timeout_seconds = max(0.1, float(timeout_seconds))
        self.max_records = max(1, min(int(max_records), 10))
        self.max_section_chars = max(500, int(max_section_chars))
        self.max_food_lifestyle_excerpt_chars = max(
            120,
            min(int(max_food_lifestyle_excerpt_chars), 600),
        )
        self.max_food_lifestyle_items = max(
            1,
            min(int(max_food_lifestyle_items), 64),
        )
        self.api_key = os.environ.get("OPENFDA_API_KEY", "").strip()
        self._cache = _TTLCache(cache_size, cache_ttl_seconds)

    @staticmethod
    def _quoted_term(name):
        escaped = str(name).replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'

    def _search_expression(self, drug_name):
        term = self._quoted_term(drug_name)
        return " OR ".join(
            (
                f"openfda.generic_name:{term}",
                f"openfda.brand_name:{term}",
                f"openfda.substance_name:{term}",
            )
        )

    def _build_url(self, drug_name, include_api_key=True):
        params = {
            "search": self._search_expression(drug_name),
            "limit": self.max_records,
        }
        if include_api_key and self.api_key:
            params["api_key"] = self.api_key
        return f"{self.ENDPOINT}?{urlencode(params)}"

    def _request_json(self, url):
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "CHEERS_PrimeKG_RGCN/1.0",
            },
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("openFDA returned a non-object JSON response.")
        return payload

    @staticmethod
    def _first_text(value):
        if isinstance(value, str):
            return value.strip() or None
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str) and item.strip():
                    return item.strip()
        return None

    @staticmethod
    def _text_values(value):
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            return [item for item in value if isinstance(item, str)]
        return []

    def _section_entries(self, value):
        entries = []
        for text in self._text_values(value):
            normalized = " ".join(text.split())
            if not normalized:
                continue
            truncated = len(normalized) > self.max_section_chars
            entries.append(
                {
                    "text": normalized[: self.max_section_chars],
                    "truncated": truncated,
                }
            )
        return entries

    @staticmethod
    def _normalized_ingredient(value):
        return " ".join(re.sub(r"[^a-z0-9]+", " ", str(value).casefold()).split())

    @classmethod
    def _product_classification(cls, selected_drug_name, active_ingredients):
        selected = cls._normalized_ingredient(selected_drug_name)
        ingredients = []
        seen = set()
        for ingredient in active_ingredients:
            normalized = cls._normalized_ingredient(ingredient)
            if normalized and normalized not in seen:
                seen.add(normalized)
                ingredients.append({"name": ingredient, "normalized": normalized})

        matches_selected = any(
            selected == item["normalized"]
            or (len(selected) >= 4 and selected in item["normalized"])
            or (len(item["normalized"]) >= 4 and item["normalized"] in selected)
            for item in ingredients
        )
        if not ingredients or not matches_selected:
            category = "unknown"
            label = "Product type not confirmed"
        elif len(ingredients) == 1:
            category = "single_ingredient"
            label = "Single-ingredient / direct medicine product"
        else:
            category = "combination"
            label = f"Combination product containing {selected_drug_name}"

        return {
            "category": category,
            "label": label,
            "active_ingredients": [item["name"] for item in ingredients],
            "selected_ingredient_match": matches_selected,
            "basis": "openfda.substance_name" if ingredients else None,
        }

    def _compact_record(self, record, selected_drug_name):
        openfda = record.get("openfda")
        if not isinstance(openfda, dict):
            openfda = {}

        product_metadata = {
            field: [
                item.strip()
                for item in self._text_values(openfda.get(field))
                if item.strip()
            ]
            for field in self.PRODUCT_FIELDS
            if self._text_values(openfda.get(field))
        }
        active_ingredients = product_metadata.get("substance_name", [])
        classification = self._product_classification(
            selected_drug_name,
            active_ingredients,
        )
        product_name = (
            (product_metadata.get("brand_name") or [None])[0]
            or (product_metadata.get("generic_name") or [None])[0]
            or selected_drug_name
        )
        sections = {
            section: entries
            for section in self.LABEL_SECTIONS
            if (entries := self._section_entries(record.get(section)))
        }

        spl_set_id = self._first_text(record.get("spl_set_id"))
        if spl_set_id is None:
            spl_set_id = self._first_text(record.get("set_id"))
        if spl_set_id is None:
            spl_set_id = self._first_text(openfda.get("spl_set_id"))

        return {
            "product_name": product_name,
            "product_classification": classification,
            "spl_set_id": spl_set_id,
            "application_number": (
                self._first_text(record.get("application_number"))
                or self._first_text(openfda.get("application_number"))
            ),
            "effective_time": self._first_text(record.get("effective_time")),
            "product_metadata": product_metadata,
            "sections": sections,
        }

    @staticmethod
    def _match_context(text, match, radius=140):
        start = max(0, match.start() - radius)
        end = min(len(text), match.end() + radius)
        return text[start:end]

    @classmethod
    def _topic_match(cls, topic, text):
        for pattern in cls.FOOD_LIFESTYLE_PATTERNS[topic]:
            for match in re.finditer(pattern, text, flags=re.IGNORECASE):
                context = cls._match_context(text, match).casefold()
                if topic == "alcohol" and re.search(
                    r"\b(?:benzyl|butyl|cetyl|isopropyl|phenethyl|polyvinyl|"
                    r"stearyl)\s+alcohol\s*$",
                    text[max(0, match.start() - 24) : match.end()].casefold(),
                ):
                    continue
                if topic == "food_or_meals" and re.match(
                    r"\s+(?:allerg(?:y|ies|ic)|poisoning|insecurity|borne)\b",
                    text[match.end() :],
                    flags=re.IGNORECASE,
                ):
                    continue
                if topic == "fasting_or_empty_stomach" and re.search(
                    r"\b(?:blood|glucose|laborator(?:y|ies)|pharmacokinetic|"
                    r"plasma|samples?|sampling|serum|stud(?:y|ies))\b",
                    match.group(0),
                    flags=re.IGNORECASE,
                ):
                    continue
                if topic == "milk_or_dairy":
                    if re.search(
                        r"\b(?:breast|human)\s+milk\b|\bbreastfeed\w*\b|"
                        r"\blactat\w*\b|\bnursing\s+(?:mother|parent|infant)s?\b",
                        context,
                    ):
                        continue
                return match
        return None

    def _bounded_food_lifestyle_excerpt(self, text, match):
        limit = self.max_food_lifestyle_excerpt_chars
        if len(text) <= limit:
            return text, False

        content_limit = max(1, limit - 2)
        center = (match.start() + match.end()) // 2
        start = max(0, center - content_limit // 2)
        end = min(len(text), start + content_limit)
        start = max(0, end - content_limit)
        excerpt = text[start:end].strip()
        prefix = "…" if start > 0 else ""
        suffix = "…" if end < len(text) else ""
        excerpt = f"{prefix}{excerpt}{suffix}"
        return excerpt[:limit], True

    def _food_lifestyle_information(self, records, unavailable=False):
        if unavailable:
            return {
                "status": "unavailable",
                "topics": [],
                "checked_sections": list(self.FOOD_LIFESTYLE_SECTIONS),
                "source": "openFDA Drug Label",
                "source_url": self.ENDPOINT,
                "message": "Food and lifestyle label information could not be retrieved from the checked source.",
                "disclaimer": "Label excerpts are source information, not personalized diet or treatment advice.",
            }

        topics = []
        seen = set()
        for record in records:
            classification = record["product_classification"]
            source_id = record["spl_set_id"] or record["application_number"]
            for section in self.FOOD_LIFESTYLE_SECTIONS:
                for entry in record["sections"].get(section, []):
                    text = entry["text"]
                    for topic in self.FOOD_LIFESTYLE_PATTERNS:
                        match = self._topic_match(topic, text)
                        if match is None:
                            continue
                        identity = (
                            topic,
                            section,
                            source_id,
                            record["product_name"],
                        )
                        if identity in seen:
                            continue
                        seen.add(identity)
                        excerpt, truncated = self._bounded_food_lifestyle_excerpt(
                            text,
                            match,
                        )
                        topics.append(
                            {
                                "topic": topic,
                                "section": section,
                                "product_name": record["product_name"],
                                "product_classification": classification["category"],
                                "product_classification_label": classification["label"],
                                "active_ingredients": list(
                                    classification["active_ingredients"]
                                ),
                                "source_id": source_id,
                                "spl_set_id": record["spl_set_id"],
                                "application_number": record["application_number"],
                                "effective_time": record["effective_time"],
                                "excerpt": excerpt,
                                "excerpt_truncated": truncated,
                                "source": "openFDA Drug Label",
                                "source_url": self.ENDPOINT,
                            }
                        )
                        if len(topics) >= self.max_food_lifestyle_items:
                            break
                    if len(topics) >= self.max_food_lifestyle_items:
                        break
                if len(topics) >= self.max_food_lifestyle_items:
                    break
            if len(topics) >= self.max_food_lifestyle_items:
                break

        status = "available" if topics else "no_explicit_mentions"
        message = (
            "Explicit food or lifestyle mentions were retrieved from the checked label records."
            if topics
            else "No explicit mention was retrieved in the checked label records."
        )
        return {
            "status": status,
            "topics": topics,
            "checked_sections": list(self.FOOD_LIFESTYLE_SECTIONS),
            "source": "openFDA Drug Label",
            "source_url": self.ENDPOINT,
            "message": message,
            "disclaimer": "Label excerpts are source information, not personalized diet or treatment advice.",
        }

    def _error_result(self, drug_name, message):
        return {
            "drug_name": drug_name,
            "status": "error",
            "records_found": 0,
            "records_examined": 0,
            "available_sections": [],
            "records": [],
            "food_lifestyle_information": self._food_lifestyle_information(
                [],
                unavailable=True,
            ),
            "source": "openFDA Drug Label",
            "source_url": self.ENDPOINT,
            "query_url": self._build_url(drug_name, include_api_key=False),
            "error": message,
            "disclaimer": "Official label text is presented as source information, not personalized medical advice.",
        }

    def get_drug_information(self, drug_name):
        normalized_name = str(drug_name).strip()
        if not normalized_name:
            raise ValueError("A drug name is required.")

        cache_key = normalized_name.casefold()
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            payload = self._request_json(self._build_url(normalized_name))
        except HTTPError as exc:
            if exc.code == 404:
                result = self._no_matches_result(normalized_name)
                self._cache.put(cache_key, result)
                return result
            return self._error_result(
                normalized_name,
                f"openFDA request failed with HTTP status {exc.code}.",
            )
        except (URLError, TimeoutError, OSError) as exc:
            return self._error_result(
                normalized_name,
                f"openFDA is unavailable: {type(exc).__name__}.",
            )
        except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
            return self._error_result(
                normalized_name,
                f"openFDA returned malformed data: {exc}",
            )

        raw_records = payload.get("results", [])
        if not isinstance(raw_records, list):
            return self._error_result(normalized_name, "openFDA returned malformed results.")

        records = [
            self._compact_record(record, normalized_name)
            for record in raw_records
            if isinstance(record, dict)
        ]
        records = [record for record in records if record["sections"] or record["product_metadata"]]
        if not records:
            result = self._no_matches_result(normalized_name)
            self._cache.put(cache_key, result)
            return result

        category_order = {"single_ingredient": 0, "combination": 1, "unknown": 2}
        records.sort(
            key=lambda record: category_order.get(
                record["product_classification"]["category"], 2
            )
        )

        total = len(records)
        metadata = payload.get("meta")
        result_metadata = metadata.get("results", {}) if isinstance(metadata, dict) else {}
        if isinstance(result_metadata, dict):
            try:
                total = int(result_metadata.get("total", total))
            except (TypeError, ValueError):
                total = len(records)

        available_sections = sorted(
            {
                section
                for record in records
                for section in record["sections"]
            },
            key=self.LABEL_SECTIONS.index,
        )
        result = {
            "drug_name": normalized_name,
            "status": "ok",
            "records_found": total,
            "records_examined": len(records),
            "available_sections": available_sections,
            "records": records,
            "food_lifestyle_information": self._food_lifestyle_information(records),
            "product_group_counts": {
                category: sum(
                    record["product_classification"]["category"] == category
                    for record in records
                )
                for category in ("single_ingredient", "combination", "unknown")
            },
            "source": "openFDA Drug Label",
            "source_url": self.ENDPOINT,
            "query_url": self._build_url(normalized_name, include_api_key=False),
            "disclaimer": "Official label text is presented as source information, not personalized medical advice.",
        }
        self._cache.put(cache_key, result)
        return result

    def _no_matches_result(self, drug_name):
        return {
            "drug_name": drug_name,
            "status": "no_matches",
            "records_found": 0,
            "records_examined": 0,
            "available_sections": [],
            "records": [],
            "food_lifestyle_information": self._food_lifestyle_information([]),
            "source": "openFDA Drug Label",
            "source_url": self.ENDPOINT,
            "query_url": self._build_url(drug_name, include_api_key=False),
            "disclaimer": "No retrieved label is not evidence that a medicine is safe or free of side effects or interactions.",
        }


__all__ = ["OpenFDADrugInformationService"]
