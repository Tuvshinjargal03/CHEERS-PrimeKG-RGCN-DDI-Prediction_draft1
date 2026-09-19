"""Deterministic, non-network pair-route and source concurrency regressions."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import io
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from api import main as api
from final_release.verify_external_evidence import (
    FixtureOpenFDAService,
    FixturePubMedService,
    forbidden_key_paths,
    resolve_known_pair,
    verify_offline_schema,
)
from src.pubmed_literature import PubMedLiteratureService


class PairEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stack = ExitStack()
        cls.addClassCleanup(cls.stack.close)
        # Fail immediately if any test accidentally attempts an external request.
        cls.stack.enter_context(patch("src.safety_evidence.urlopen", side_effect=AssertionError("Network forbidden")))
        cls.stack.enter_context(patch("src.pubmed_literature.urlopen", side_effect=AssertionError("Network forbidden")))
        cls.client = cls.stack.enter_context(TestClient(api.app))
        cls.drug_a, cls.drug_b = resolve_known_pair()
        cls.expected = verify_offline_schema(cls.drug_a, cls.drug_b)

    def setUp(self):
        self.labels = FixtureOpenFDAService()
        self.literature = FixturePubMedService()
        stack = self.enterContext(ExitStack())
        stack.enter_context(patch.object(api.app.state, "label_evidence_service", self.labels))
        stack.enter_context(patch.object(api.app.state, "literature_service", self.literature))

    def request_pair(self):
        return self.client.get("/api/evidence/pair", params={
            "drug_a_id": self.drug_a["drug_id"],
            "drug_b_id": self.drug_b["drug_id"],
        })

    def assert_contract(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(set(payload), {"pair", "ai_context", "label_evidence", "literature", "limitations"})
        for key in ("pair", "ai_context", "limitations"):
            self.assertEqual(payload[key], self.expected[key])
        self.assertEqual(forbidden_key_paths(payload), [])
        return payload

    def test_sources_overlap_and_response_waits_for_both_in_either_order(self):
        self.check_overlap(unexpected=False)

    def test_unexpected_exception_waits_for_other_source_and_pool_stays_usable(self):
        self.check_overlap(unexpected=True)

    def check_overlap(self, unexpected):
        for first in (0, 1):
            with self.subTest(first=first, unexpected=unexpected):
                started = [threading.Event(), threading.Event()]
                release = [threading.Event(), threading.Event()]
                finished = [threading.Event(), threading.Event()]
                methods = [self.labels.get_pair_evidence, self.literature.search_pair]

                def source(index, **kwargs):
                    started[index].set()
                    try:
                        if not release[index].wait(5):
                            raise AssertionError("Test did not release source")
                        if unexpected and index == first:
                            raise RuntimeError("unexpected fixture error")
                        return methods[index](**kwargs)
                    finally:
                        finished[index].set()

                with (
                    patch.object(self.labels, "get_pair_evidence", side_effect=lambda **kw: source(0, **kw)) as fda,
                    patch.object(self.literature, "search_pair", side_effect=lambda **kw: source(1, **kw)) as pubmed,
                    patch.object(api, "build_evidence_response", wraps=api.build_evidence_response) as build,
                    ThreadPoolExecutor(max_workers=1) as caller,
                ):
                    pending = caller.submit(self.request_pair)
                    try:
                        # Event gates prove overlap without elapsed-time thresholds.
                        self.assertTrue(started[0].wait(5))
                        self.assertTrue(started[1].wait(5))
                        self.assertFalse(pending.done())
                        release[first].set()
                        self.assertTrue(finished[first].wait(5))
                        self.assertFalse(pending.done())
                        build.assert_not_called()
                    finally:
                        for event in release:
                            event.set()
                    if unexpected:
                        with self.assertRaisesRegex(RuntimeError, "unexpected fixture error"):
                            pending.result(timeout=5)
                        build.assert_not_called()
                    else:
                        self.assertEqual(self.assert_contract(pending.result(timeout=5)), self.expected)
                        build.assert_called_once()
                    for method in (fda, pubmed):
                        method.assert_called_once_with(drug_a_name="Colchicine", drug_b_name="Probenecid")
                    self.assertTrue(all(event.is_set() for event in finished))
                self.assertEqual(api.app.state.evidence_executor.submit(lambda: "usable").result(timeout=5), "usable")

    def test_expected_openfda_failure_preserves_pubmed_result(self):
        with patch.object(self.labels, "_request_json", side_effect=TimeoutError):
            payload = self.assert_contract(self.request_pair())
        self.assertEqual(payload["literature"], self.expected["literature"])
        self.assertFalse(payload["label_evidence"]["evidence_found"])
        for drug in ("drug_a", "drug_b"):
            self.assertEqual(payload["label_evidence"][drug]["status"], "error")
            self.assertEqual(payload["label_evidence"][drug]["error"], "openFDA is unavailable: TimeoutError.")

    def test_expected_pubmed_failure_preserves_openfda_result(self):
        with patch.object(self.literature, "_request_json", side_effect=TimeoutError):
            payload = self.assert_contract(self.request_pair())
        self.assertEqual(payload["label_evidence"], self.expected["label_evidence"])
        self.assertEqual(payload["literature"]["status"], "error")
        self.assertEqual(payload["literature"]["papers"], [])
        self.assertEqual(payload["literature"]["error"], "NCBI is unavailable: TimeoutError.")

    def test_repeated_route_requests_reuse_both_source_caches(self):
        with (
            patch.object(self.labels, "_request_json", wraps=self.labels._request_json) as fda,
            patch.object(self.literature, "_request_json", wraps=self.literature._request_json) as pubmed,
        ):
            self.assertEqual(self.assert_contract(self.request_pair()), self.expected)
            self.assertEqual(self.assert_contract(self.request_pair()), self.expected)
        self.assertEqual(fda.call_count, 2)  # One label lookup per drug.
        self.assertEqual(pubmed.call_count, 2)  # One esearch followed by esummary.

    def test_unknown_drug_does_not_start_source_work(self):
        with (
            patch.object(self.labels, "get_pair_evidence") as fda,
            patch.object(self.literature, "search_pair") as pubmed,
        ):
            response = self.client.get("/api/evidence/pair", params={
                "drug_a_id": "unknown", "drug_b_id": self.drug_b["drug_id"],
            })
        self.assertEqual(response.status_code, 404)
        fda.assert_not_called()
        pubmed.assert_not_called()


class SourceBehaviorTests(unittest.TestCase):
    def test_caches_return_independent_copies(self):
        labels = FixtureOpenFDAService()
        literature = FixturePubMedService()
        with (
            patch.object(labels, "_request_json", wraps=labels._request_json) as fda,
            patch.object(literature, "_request_json", wraps=literature._request_json) as pubmed,
        ):
            labels._fetch_labels("Colchicine")["records"].clear()
            self.assertEqual(len(labels._fetch_labels("Colchicine")["records"]), 1)
            literature.search_pair("Colchicine", "Probenecid")["papers"].clear()
            self.assertEqual(len(literature.search_pair("Colchicine", "Probenecid")["papers"]), 1)
        self.assertEqual(fda.call_count, 1)
        self.assertEqual(pubmed.call_count, 2)

    def test_ncbi_lock_pacing_key_timeout_and_dependent_sequence(self):
        for api_key in ("", "fixture-key"):
            with self.subTest(authenticated=bool(api_key)), patch.dict("os.environ", {"NCBI_API_KEY": api_key}):
                service = PubMedLiteratureService(timeout_seconds=1.25)
                fixtures = FixturePubMedService()
                requests = []
                clock = [10.0]
                service._last_request_at = clock[0]

                def sleep(seconds):
                    self.assertTrue(service._request_lock.locked())
                    clock[0] += seconds

                def open_url(request, timeout):
                    self.assertTrue(service._request_lock.locked())
                    self.assertEqual(timeout, 1.25)
                    params = parse_qs(urlparse(request.full_url).query)
                    self.assertEqual(params.get("api_key"), [api_key] if api_key else None)
                    if not requests:
                        self.assertIn("esearch.fcgi", request.full_url)
                    else:
                        self.assertIn("esummary.fcgi", request.full_url)
                        self.assertEqual(params["id"], ["12345678"])
                    requests.append(request.full_url)
                    return io.BytesIO(json.dumps(fixtures._request_json(request.full_url)).encode())

                with (
                    patch("src.pubmed_literature.time.monotonic", side_effect=lambda: clock[0]),
                    patch("src.pubmed_literature.time.sleep", side_effect=sleep) as pause,
                    patch("src.pubmed_literature.urlopen", side_effect=open_url),
                ):
                    result = service.search_pair("Colchicine", "Probenecid")
                self.assertEqual(result["status"], "ok")
                self.assertEqual(len(requests), 2)
                self.assertFalse(service._request_lock.locked())
                if api_key:
                    pause.assert_not_called()
                else:
                    self.assertEqual(pause.call_count, 2)
                    for call in pause.call_args_list:
                        self.assertAlmostEqual(call.args[0], 0.4)
                self.assertNotIn("api_key", result["search_url"])

    def test_ncbi_timeout_releases_lock_and_preserves_error_payload(self):
        service = PubMedLiteratureService()
        with (
            patch("src.pubmed_literature.time.sleep"),
            patch("src.pubmed_literature.urlopen", side_effect=TimeoutError),
        ):
            result = service.search_pair("Colchicine", "Probenecid")
        self.assertEqual(result["status"], "error")
        self.assertFalse(service._request_lock.locked())
        self.assertGreater(service._last_request_at, 0)


if __name__ == "__main__":
    unittest.main()
