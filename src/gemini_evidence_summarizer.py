"""Grounded, bounded Gemini explanations for retrieved CHEERS evidence."""

from __future__ import annotations

import json
import os
import re
from urllib.request import Request, urlopen

from src.gemini_query_interpreter import GEMINI_MODEL


MAX_EVIDENCE_CHARS = 6_000
MAX_ITEM_CHARS = 700
ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)


class GeminiEvidenceSummarizer:
    def __init__(self, api_key=None, timeout_seconds=6.0):
        self.api_key = api_key if api_key is not None else os.getenv("GEMINI_API_KEY")
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def bound_evidence(evidence):
        bounded = {}
        remaining = MAX_EVIDENCE_CHARS
        for category, items in evidence.items():
            if remaining <= 0:
                break
            values = items if isinstance(items, list) else [items]
            kept = []
            for item in values[:6]:
                text = " ".join(str(item).split())[:MAX_ITEM_CHARS]
                if not text:
                    continue
                text = text[:remaining]
                kept.append(text)
                remaining -= len(text)
                if remaining <= 0:
                    break
            if kept:
                bounded[str(category)[:80]] = kept
        return bounded

    @staticmethod
    def _validate(value):
        if not isinstance(value, dict):
            return None
        required = {
            "status", "short_answer", "key_points",
            "what_we_cannot_conclude", "sources_used",
        }
        if set(value) != required or value["status"] not in {
            "answered", "limited", "unavailable",
        }:
            return None
        if not all(
            isinstance(value[key], str)
            for key in ("short_answer", "what_we_cannot_conclude")
        ):
            return None
        for key, maximum in (("key_points", 3), ("sources_used", 3)):
            if not isinstance(value[key], list) or len(value[key]) > maximum:
                return None
            if not all(isinstance(item, str) for item in value[key]):
                return None
        value["short_answer"] = value["short_answer"].strip()[:600]
        value["key_points"] = [item.strip()[:300] for item in value["key_points"]]
        value["what_we_cannot_conclude"] = value["what_we_cannot_conclude"].strip()[:400]
        value["sources_used"] = [item.strip()[:80] for item in value["sources_used"]]
        combined = " ".join(
            [value["short_answer"], *value["key_points"], value["what_we_cannot_conclude"]]
        ).casefold()
        if re.search(
            r"\b(?:is|are|considered|definitely) safe\b|\bsafe to (?:take|use)\b|"
            r"\bno interaction exists\b",
            combined,
        ):
            return None
        return value

    def summarize(self, question, evidence):
        if not self.api_key:
            return None
        bounded = self.bound_evidence(evidence)
        if not bounded:
            return None
        instruction = (
            "Explain only the supplied evidence in simple everyday English. Do not add "
            "facts from general knowledge. Do not prescribe, recommend a dose or treatment, "
            "diagnose, or call a medicine combination safe. Distinguish missing retrieved "
            "evidence from evidence of absence. Explain necessary technical terms briefly. "
            "If evidence is insufficient, use status limited and say so. Keep FDA/openFDA and "
            "PubMed external evidence separate from CHEERS knowledge-graph context. Never "
            "treat an R-GCN ranking score as probability, safety, risk, severity, diagnosis, "
            "or treatment advice. Use at most three short key points.\n"
            f"Question: {json.dumps(str(question), ensure_ascii=False)}\n"
            f"Evidence: {json.dumps(bounded, ensure_ascii=False)}"
        )
        schema = {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["answered", "limited", "unavailable"]},
                "short_answer": {"type": "string"},
                "key_points": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
                "what_we_cannot_conclude": {"type": "string"},
                "sources_used": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
            },
            "required": ["status", "short_answer", "key_points", "what_we_cannot_conclude", "sources_used"],
            "additionalProperties": False,
        }
        request = Request(
            ENDPOINT,
            data=json.dumps({
                "contents": [{"parts": [{"text": instruction}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseJsonSchema": schema,
                    "temperature": 0,
                    "maxOutputTokens": 600,
                },
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            return self._validate(json.loads(text))
        except Exception:
            return None


__all__ = ["GeminiEvidenceSummarizer", "MAX_EVIDENCE_CHARS"]
