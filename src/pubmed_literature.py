"""Related literature metadata from the official NCBI PubMed E-utilities.

This source-backed search is independent from R-GCN inference and does not
produce a clinical conclusion. No retrieved papers does not establish safety.
"""

from __future__ import annotations

import copy
import json
import os
import threading
import time
from collections import OrderedDict
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class _TTLCache:
    """Small bounded cache for successful pair searches in one process."""

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


class PubMedLiteratureService:
    """Search PubMed conservatively for records naming both drugs."""

    BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
    TOOL = "CHEERS_PrimeKG_RGCN"
    DISCLAIMER = (
        "PubMed results are a conservative name-based literature search, "
        "not a systematic review or clinical recommendation. No retrieved "
        "papers does not establish safety."
    )

    def __init__(
        self,
        timeout_seconds=4.0,
        default_limit=5,
        cache_size=64,
        cache_ttl_seconds=900,
    ):
        self.timeout_seconds = max(0.1, float(timeout_seconds))
        self.default_limit = max(1, min(int(default_limit), 5))
        self.api_key = os.environ.get("NCBI_API_KEY", "").strip()
        self.email = os.environ.get("NCBI_EMAIL", "").strip()
        self._cache = _TTLCache(cache_size, cache_ttl_seconds)
        self._request_lock = threading.Lock()
        self._last_request_at = 0.0

    @staticmethod
    def _quoted_name(drug_name):
        escaped = str(drug_name).replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"[Title/Abstract]'

    def _query(self, drug_a_name, drug_b_name):
        return (
            f"{self._quoted_name(drug_a_name)} AND "
            f"{self._quoted_name(drug_b_name)}"
        )

    def _common_params(self):
        params = {
            "tool": self.TOOL,
            "retmode": "json",
        }
        if self.email:
            params["email"] = self.email
        if self.api_key:
            params["api_key"] = self.api_key
        return params

    def _build_url(self, utility, params, include_api_key=True):
        combined = self._common_params()
        combined.update(params)
        if not include_api_key:
            combined.pop("api_key", None)
            combined.pop("email", None)
        return f"{self.BASE_URL}{utility}?{urlencode(combined)}"

    def _request_json(self, url):
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "CHEERS_PrimeKG_RGCN/1.0",
            },
        )

        # Serialize and pace unauthenticated calls below NCBI's 3/second limit.
        with self._request_lock:
            if not self.api_key:
                elapsed = time.monotonic() - self._last_request_at
                remaining = 0.4 - elapsed
                if remaining > 0:
                    time.sleep(remaining)
            try:
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            finally:
                self._last_request_at = time.monotonic()

        if not isinstance(payload, dict):
            raise ValueError("NCBI returned a non-object JSON response.")
        return payload

    @staticmethod
    def _error_result(drug_a_name, drug_b_name, query, message):
        return {
            "status": "error",
            "pair_query": {
                "drug_a_name": drug_a_name,
                "drug_b_name": drug_b_name,
            },
            "query": query,
            "total_results": 0,
            "returned_results": 0,
            "papers": [],
            "source": "PubMed",
            "error": message,
            "disclaimer": PubMedLiteratureService.DISCLAIMER,
        }

    @staticmethod
    def _authors(record):
        authors = record.get("authors", [])
        if not isinstance(authors, list):
            return []
        return [
            author["name"].strip()
            for author in authors
            if isinstance(author, dict)
            and isinstance(author.get("name"), str)
            and author["name"].strip()
        ]

    @staticmethod
    def _optional_text(record, *fields):
        for field in fields:
            value = record.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def _parse_papers(self, summary_payload, pmids):
        result = summary_payload.get("result")
        if not isinstance(result, dict):
            raise ValueError("NCBI esummary result is missing or malformed.")

        papers = []
        for pmid in pmids:
            record = result.get(str(pmid))
            if not isinstance(record, dict):
                continue
            papers.append(
                {
                    "pmid": str(pmid),
                    "title": self._optional_text(record, "title"),
                    "authors": self._authors(record),
                    "journal": self._optional_text(
                        record,
                        "fulljournalname",
                        "source",
                    ),
                    "publication_date": self._optional_text(
                        record,
                        "pubdate",
                    ),
                    "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                    "source": "PubMed",
                }
            )
        if pmids and not papers:
            raise ValueError("NCBI esummary contained no usable paper records.")
        return papers

    def search_pair(self, drug_a_name, drug_b_name, limit=None):
        """Return up to five PubMed records whose query names both drugs."""

        drug_a_name = str(drug_a_name).strip()
        drug_b_name = str(drug_b_name).strip()
        if not drug_a_name or not drug_b_name:
            raise ValueError("Both drug names are required for PubMed search.")

        if limit is None:
            limit = self.default_limit
        limit = max(1, min(int(limit), 5))
        query = self._query(drug_a_name, drug_b_name)
        cache_key = (drug_a_name.casefold(), drug_b_name.casefold(), limit)
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        search_params = {
            "db": "pubmed",
            "term": query,
            "retmax": limit,
            "sort": "relevance",
        }
        search_url = self._build_url("esearch.fcgi", search_params)

        try:
            search_payload = self._request_json(search_url)
            search_result = search_payload.get("esearchresult")
            if not isinstance(search_result, dict):
                raise ValueError("NCBI esearch result is missing or malformed.")
            raw_pmids = search_result.get("idlist", [])
            if not isinstance(raw_pmids, list):
                raise ValueError("NCBI esearch PMID list is malformed.")
            pmids = [str(pmid) for pmid in raw_pmids[:limit] if str(pmid)]
            try:
                total_results = int(search_result.get("count", len(pmids)))
            except (TypeError, ValueError):
                total_results = len(pmids)

            if not pmids:
                response = {
                    "status": "no_results",
                    "pair_query": {
                        "drug_a_name": drug_a_name,
                        "drug_b_name": drug_b_name,
                    },
                    "query": query,
                    "total_results": total_results,
                    "returned_results": 0,
                    "papers": [],
                    "source": "PubMed",
                    "search_url": self._build_url(
                        "esearch.fcgi",
                        search_params,
                        include_api_key=False,
                    ),
                    "disclaimer": self.DISCLAIMER,
                }
                self._cache.put(cache_key, response)
                return response

            summary_params = {
                "db": "pubmed",
                "id": ",".join(pmids),
            }
            summary_payload = self._request_json(
                self._build_url("esummary.fcgi", summary_params)
            )
            papers = self._parse_papers(summary_payload, pmids)
        except HTTPError as exc:
            return self._error_result(
                drug_a_name,
                drug_b_name,
                query,
                f"NCBI request failed with HTTP status {exc.code}.",
            )
        except (URLError, TimeoutError, OSError) as exc:
            return self._error_result(
                drug_a_name,
                drug_b_name,
                query,
                f"NCBI is unavailable: {type(exc).__name__}.",
            )
        except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
            return self._error_result(
                drug_a_name,
                drug_b_name,
                query,
                f"NCBI returned malformed data: {exc}",
            )

        response = {
            "status": "ok",
            "pair_query": {
                "drug_a_name": drug_a_name,
                "drug_b_name": drug_b_name,
            },
            "query": query,
            "total_results": total_results,
            "returned_results": len(papers),
            "papers": papers,
            "source": "PubMed",
            "search_url": self._build_url(
                "esearch.fcgi",
                search_params,
                include_api_key=False,
            ),
            "disclaimer": self.DISCLAIMER,
        }
        self._cache.put(cache_key, response)
        return response
