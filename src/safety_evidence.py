"""Source-backed drug-pair evidence from the official openFDA label API.

This module is independent from R-GCN inference. A missing label or explicit
cross-drug mention must never be interpreted as evidence that a pair is safe.
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
    """Small bounded cache for successful external lookups in one process."""

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


class OpenFDALabelEvidenceService:
    """Retrieve literal pair mentions from selected official label sections."""

    ENDPOINT = "https://api.fda.gov/drug/label.json"
    LABEL_SECTIONS = (
        "drug_interactions",
        "contraindications",
        "boxed_warning",
        "warnings",
        "warnings_and_cautions",
        "precautions",
    )
    DISCLAIMER = (
        "openFDA label evidence is independent from the R-GCN prediction. "
        "Only explicit name mentions in selected label sections are returned; "
        "no retrieved mention or no retrieved label does not establish safety."
    )

    def __init__(
        self,
        timeout_seconds=4.0,
        max_records=10,
        cache_size=64,
        cache_ttl_seconds=900,
    ):
        self.timeout_seconds = max(0.1, float(timeout_seconds))
        self.max_records = max(1, min(int(max_records), 100))
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
    def _error_result(drug_name, message):
        return {
            "drug_name": drug_name,
            "status": "error",
            "records_found": 0,
            "records_examined": 0,
            "records": [],
            "error": message,
        }

    def _fetch_labels(self, drug_name):
        normalized_name = str(drug_name).strip()
        cache_key = normalized_name.casefold()
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            payload = self._request_json(self._build_url(normalized_name))
        except HTTPError as exc:
            if exc.code == 404:
                result = {
                    "drug_name": normalized_name,
                    "status": "no_matches",
                    "records_found": 0,
                    "records_examined": 0,
                    "records": [],
                }
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

        records = payload.get("results", [])
        if not isinstance(records, list):
            return self._error_result(
                normalized_name,
                "openFDA returned malformed results.",
            )

        records = [
            self._compact_record(record)
            for record in records
            if isinstance(record, dict)
        ]
        if not records:
            result = {
                "drug_name": normalized_name,
                "status": "no_matches",
                "records_found": 0,
                "records_examined": 0,
                "records": [],
            }
            self._cache.put(cache_key, result)
            return result

        total = len(records)
        metadata = payload.get("meta")
        if isinstance(metadata, dict):
            result_metadata = metadata.get("results")
            if isinstance(result_metadata, dict):
                try:
                    total = int(result_metadata.get("total", total))
                except (TypeError, ValueError):
                    total = len(records)

        result = {
            "drug_name": normalized_name,
            "status": "ok",
            "records_found": total,
            "records_examined": len(records),
            "records": records,
        }
        self._cache.put(cache_key, result)
        return result

    def _compact_record(self, record):
        """Retain only identifiers and label sections this service inspects."""

        compact = {
            field: record[field]
            for field in (
                "set_id",
                "spl_set_id",
                "application_number",
                "effective_time",
            )
            if field in record
        }
        openfda = record.get("openfda")
        if isinstance(openfda, dict):
            compact["openfda"] = {
                field: openfda[field]
                for field in ("spl_set_id", "application_number")
                if field in openfda
            }
        for section in self.LABEL_SECTIONS:
            if section in record:
                compact[section] = record[section]
        return compact

    @staticmethod
    def _first_text(value):
        if isinstance(value, str):
            return value.strip() or None
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str) and item.strip():
                    return item.strip()
        return None

    @classmethod
    def _record_identifier(cls, record, field):
        direct_value = cls._first_text(record.get(field))
        if direct_value:
            return direct_value
        openfda = record.get("openfda")
        if isinstance(openfda, dict):
            return cls._first_text(openfda.get(field))
        return None

    @staticmethod
    def _section_texts(value):
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            return [item for item in value if isinstance(item, str)]
        return []

    @staticmethod
    def _mention_pattern(drug_name):
        return re.compile(
            rf"(?<!\w){re.escape(drug_name)}(?!\w)",
            flags=re.IGNORECASE,
        )

    @staticmethod
    def _snippet(text, match, before=140, after=180):
        start = max(0, match.start() - before)
        end = min(len(text), match.end() + after)
        excerpt = re.sub(r"\s+", " ", text[start:end]).strip()
        if start > 0:
            excerpt = "... " + excerpt
        if end < len(text):
            excerpt += " ..."
        return excerpt

    def _find_mentions(self, label_result, mentioned_drug):
        pattern = self._mention_pattern(mentioned_drug)
        evidence = []
        seen = set()

        for record in label_result["records"]:
            spl_set_id = self._record_identifier(record, "spl_set_id")
            if spl_set_id is None:
                spl_set_id = self._record_identifier(record, "set_id")
            application_number = self._record_identifier(
                record,
                "application_number",
            )
            effective_time = self._first_text(record.get("effective_time"))

            for section in self.LABEL_SECTIONS:
                for text in self._section_texts(record.get(section)):
                    for match in pattern.finditer(text):
                        snippet = self._snippet(text, match)
                        deduplication_key = (
                            label_result["drug_name"].casefold(),
                            mentioned_drug.casefold(),
                            section,
                            snippet.casefold(),
                            spl_set_id,
                            application_number,
                            effective_time,
                        )
                        if deduplication_key in seen:
                            continue
                        seen.add(deduplication_key)
                        evidence.append(
                            {
                                "source_drug": label_result["drug_name"],
                                "mentioned_drug": mentioned_drug,
                                "section": section,
                                "snippet": snippet,
                                "source": "openFDA Drug Label",
                                "source_url": self.ENDPOINT,
                                "spl_set_id": spl_set_id,
                                "application_number": application_number,
                                "effective_time": effective_time,
                            }
                        )

        return evidence

    @staticmethod
    def _public_summary(label_result, query_url):
        summary = {
            "drug_name": label_result["drug_name"],
            "status": label_result["status"],
            "records_found": label_result["records_found"],
            "records_examined": label_result["records_examined"],
            "query_url": query_url,
        }
        if "error" in label_result:
            summary["error"] = label_result["error"]
        return summary

    def get_pair_evidence(self, drug_a_name, drug_b_name):
        """Return literal B-in-A-label and A-in-B-label evidence only."""

        drug_a_name = str(drug_a_name).strip()
        drug_b_name = str(drug_b_name).strip()
        if not drug_a_name or not drug_b_name:
            raise ValueError("Both drug names are required for label evidence.")

        label_a = self._fetch_labels(drug_a_name)
        label_b = self._fetch_labels(drug_b_name)
        pair_evidence = []
        if label_a["status"] == "ok":
            pair_evidence.extend(self._find_mentions(label_a, drug_b_name))
        if label_b["status"] == "ok":
            pair_evidence.extend(self._find_mentions(label_b, drug_a_name))

        return {
            "drug_a": self._public_summary(
                label_a,
                self._build_url(drug_a_name, include_api_key=False),
            ),
            "drug_b": self._public_summary(
                label_b,
                self._build_url(drug_b_name, include_api_key=False),
            ),
            "pair_evidence": pair_evidence,
            "evidence_found": bool(pair_evidence),
            "source": "openFDA Drug Label",
            "source_url": self.ENDPOINT,
            "disclaimer": self.DISCLAIMER,
        }
