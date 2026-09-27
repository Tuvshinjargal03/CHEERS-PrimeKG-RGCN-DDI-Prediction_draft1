"""Bounded Gemini fallback for interpreting unresolved Ask CHEERS queries."""

from __future__ import annotations

import json
import os
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


GEMINI_PRIMARY_MODEL = "gemini-3.8-flash"
GEMINI_FALLBACK_MODEL = "gemini-3.5-flash"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
INTERPRETER_INTENTS = (
    "drug_information",
    "disease_information",
    "drug_side_effects",
    "drug_interactions",
    "drug_food_lifestyle",
    "drug_pair_question",
    "drug_for_disease",
    "medicines_for_disease",
    "disease_nutrition",
    "general_symptom_or_treatment_question",
    "unsupported",
    "unknown",
)
RETRYABLE_GEMINI_STATUS = frozenset({429, 500, 502, 503, 504})


def open_with_retry(request, timeout_seconds, backoff_seconds=1.0):
    """Open once, with one bounded retry for transient Gemini HTTP failures."""
    try:
        return urlopen(request, timeout=timeout_seconds)
    except HTTPError as exc:
        if exc.code not in RETRYABLE_GEMINI_STATUS:
            raise
        exc.close()
        time.sleep(backoff_seconds)
        return urlopen(request, timeout=timeout_seconds)


def open_with_model_fallback(request_factory, timeout_seconds, backoff_seconds=1.0):
    """Use the fallback model once only after exhausted retryable primary errors."""
    try:
        return (
            open_with_retry(
                request_factory(GEMINI_PRIMARY_MODEL),
                timeout_seconds,
                backoff_seconds,
            ),
            GEMINI_PRIMARY_MODEL,
        )
    except HTTPError as exc:
        if exc.code not in RETRYABLE_GEMINI_STATUS:
            raise
        exc.close()
        return (
            urlopen(
                request_factory(GEMINI_FALLBACK_MODEL),
                timeout=timeout_seconds,
            ),
            GEMINI_FALLBACK_MODEL,
        )


class GeminiQueryInterpreter:
    """Convert wording to a small schema; never answer the medical question."""

    def __init__(self, api_key=None, timeout_seconds=5.0):
        self.api_key = api_key if api_key is not None else os.getenv("GEMINI_API_KEY")
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def _schema():
        return {
            "type": "object",
            "properties": {
                "intent": {"type": "string", "enum": list(INTERPRETER_INTENTS)},
                "drug_names": {"type": "array", "items": {"type": "string"}},
                "disease_names": {"type": "array", "items": {"type": "string"}},
                "topic": {"type": "string"},
                "rewritten_query": {"type": "string"},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": [
                "intent",
                "drug_names",
                "disease_names",
                "topic",
                "rewritten_query",
                "confidence",
            ],
            "additionalProperties": False,
        }

    @staticmethod
    def _prompt(query):
        return (
            "Interpret the user query for CHEERS. Do not answer the medical question. "
            "Do not recommend medicines, doses, diagnoses, or treatments. Only classify "
            "the wording and extract medicine/disease names. Preserve names, correct only "
            "obvious spelling mistakes conservatively, and return unknown when uncertain. "
            "Questions asking what a person should take are "
            "general_symptom_or_treatment_question, never a recommendation.\n"
            f"User query: {json.dumps(str(query), ensure_ascii=False)}"
        )

    @staticmethod
    def _validate(value):
        if not isinstance(value, dict) or set(value) != {
            "intent",
            "drug_names",
            "disease_names",
            "topic",
            "rewritten_query",
            "confidence",
        }:
            return None
        if value["intent"] not in INTERPRETER_INTENTS:
            return None
        if not all(isinstance(value[key], str) for key in ("topic", "rewritten_query")):
            return None
        for key in ("drug_names", "disease_names"):
            if not isinstance(value[key], list) or not all(
                isinstance(item, str) and 0 < len(item.strip()) <= 200
                for item in value[key]
            ):
                return None
            value[key] = [item.strip() for item in value[key][:2]]
        confidence = value["confidence"]
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            return None
        if not 0 <= confidence <= 1:
            return None
        value["topic"] = value["topic"].strip()[:100]
        value["rewritten_query"] = value["rewritten_query"].strip()[:200]
        value["confidence"] = float(confidence)
        return value

    def interpret(self, query):
        if not self.api_key:
            return None
        body = {
            "contents": [{"parts": [{"text": self._prompt(query)}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": self._schema(),
                "temperature": 0,
                "maxOutputTokens": 512,
            },
        }
        def request_factory(model):
            return Request(
                f"{GEMINI_API_BASE}/{model}:generateContent",
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": self.api_key,
                },
                method="POST",
            )
        try:
            response, model_used = open_with_model_fallback(
                request_factory, self.timeout_seconds
            )
            with response:
                payload = json.loads(response.read().decode("utf-8"))
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            result = self._validate(json.loads(text))
            if result is not None:
                result["model_used"] = model_used
            return result
        except Exception:
            return None


__all__ = [
    "GeminiQueryInterpreter", "GEMINI_PRIMARY_MODEL", "GEMINI_FALLBACK_MODEL",
    "INTERPRETER_INTENTS", "open_with_retry", "open_with_model_fallback",
]
