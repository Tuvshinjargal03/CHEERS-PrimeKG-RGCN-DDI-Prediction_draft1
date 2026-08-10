"""Verify the CHEERS external-evidence modules without requiring live results."""

from __future__ import annotations

import csv
import sys
from pathlib import Path
from urllib.parse import unquote


PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from api.main import app, build_evidence_response
from src.pubmed_literature import PubMedLiteratureService
from src.safety_evidence import OpenFDALabelEvidenceService


FORBIDDEN_VERDICT_KEYS = {
    "safe",
    "dangerous",
    "risk_probability",
    "clinical_confidence",
}


class FixtureOpenFDAService(OpenFDALabelEvidenceService):
    """Deterministic non-network fixture for response construction checks."""

    def _request_json(self, url):
        decoded_url = unquote(url)
        source_name = (
            "Colchicine" if "Colchicine" in decoded_url else "Probenecid"
        )
        mentioned_name = (
            "Probenecid" if source_name == "Colchicine" else "Colchicine"
        )
        return {
            "meta": {"results": {"total": 1}},
            "results": [
                {
                    "set_id": f"fixture-{source_name.casefold()}",
                    "effective_time": "20260101",
                    "openfda": {
                        "application_number": ["FIXTURE-NDA"],
                    },
                    "drug_interactions": [
                        "Verification fixture text explicitly names "
                        f"{mentioned_name} for schema testing only."
                    ],
                }
            ],
        }


class FixturePubMedService(PubMedLiteratureService):
    """Deterministic non-network fixture for response construction checks."""

    def _request_json(self, url):
        if "esearch.fcgi" in url:
            return {
                "esearchresult": {
                    "count": "1",
                    "idlist": ["12345678"],
                }
            }
        if "esummary.fcgi" in url:
            return {
                "result": {
                    "uids": ["12345678"],
                    "12345678": {
                        "title": "Verification fixture record",
                        "authors": [{"name": "Example A"}],
                        "fulljournalname": "Verification Journal",
                        "pubdate": "2026",
                    },
                }
            }
        raise AssertionError(f"Unexpected fixture URL: {url}")


def resolve_known_pair():
    metadata_path = (
        PROJECT_DIR
        / "final_release"
        / "lightweight_runtime"
        / "drug_metadata.csv"
    )
    expected_ids = {"DB01394", "DB01032"}
    found = {}
    with metadata_path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["entity_id"] in expected_ids:
                found[row["entity_id"]] = {
                    "drug_id": row["entity_id"],
                    "drug_name": row["entity_name"],
                    "drug_node_id": int(row["node_id"]),
                    "source": row["entity_source"],
                }

    if set(found) != expected_ids:
        raise AssertionError("Known local verification pair could not be resolved.")
    if found["DB01394"]["drug_name"] != "Colchicine":
        raise AssertionError("DB01394 did not resolve to Colchicine.")
    if found["DB01032"]["drug_name"] != "Probenecid":
        raise AssertionError("DB01032 did not resolve to Probenecid.")
    return found["DB01394"], found["DB01032"]


def forbidden_key_paths(value, path="$", matches=None):
    if matches is None:
        matches = []
    if isinstance(value, dict):
        for key, nested_value in value.items():
            nested_path = f"{path}.{key}"
            if str(key).casefold() in FORBIDDEN_VERDICT_KEYS:
                matches.append(nested_path)
            forbidden_key_paths(nested_value, nested_path, matches)
    elif isinstance(value, list):
        for index, nested_value in enumerate(value):
            forbidden_key_paths(nested_value, f"{path}[{index}]", matches)
    return matches


def verify_offline_schema(drug_a, drug_b):
    label_result = FixtureOpenFDAService().get_pair_evidence(
        drug_a["drug_name"],
        drug_b["drug_name"],
    )
    literature_result = FixturePubMedService().search_pair(
        drug_a["drug_name"],
        drug_b["drug_name"],
    )
    response = build_evidence_response(
        drug_a,
        drug_b,
        label_result,
        literature_result,
    )

    required_top_level = {
        "pair",
        "ai_context",
        "label_evidence",
        "literature",
        "limitations",
    }
    if not required_top_level.issubset(response):
        raise AssertionError("Combined evidence response schema is incomplete.")
    if len(label_result["pair_evidence"]) != 2:
        raise AssertionError("Explicit cross-label mention extraction failed.")
    if literature_result["returned_results"] != 1:
        raise AssertionError("PubMed summary fixture parsing failed.")
    if literature_result["papers"][0]["url"] != (
        "https://pubmed.ncbi.nlm.nih.gov/12345678/"
    ):
        raise AssertionError("PubMed source URL construction failed.")

    forbidden_paths = forbidden_key_paths(response)
    if forbidden_paths:
        raise AssertionError(
            "Forbidden clinical verdict keys found: "
            + ", ".join(forbidden_paths)
        )
    return response


def verify_live_services(drug_a, drug_b):
    label_result = OpenFDALabelEvidenceService(
        timeout_seconds=4.0
    ).get_pair_evidence(
        drug_a["drug_name"],
        drug_b["drug_name"],
    )
    label_statuses = {
        label_result["drug_a"]["status"],
        label_result["drug_b"]["status"],
    }
    if "error" in label_statuses:
        print(
            "SKIP: live openFDA check unavailable; local openFDA schema "
            "checks already passed."
        )
    else:
        print(
            "PASS: live openFDA request completed with valid status "
            f"values {sorted(label_statuses)}."
        )

    literature_result = PubMedLiteratureService(
        timeout_seconds=4.0
    ).search_pair(
        drug_a["drug_name"],
        drug_b["drug_name"],
    )
    if literature_result["status"] == "error":
        print(
            "SKIP: live PubMed check unavailable; local PubMed schema "
            "checks already passed."
        )
    else:
        print(
            "PASS: live PubMed request completed with status "
            f"{literature_result['status']!r}."
        )


def main():
    print("PASS: external-evidence modules imported successfully.")
    drug_a, drug_b = resolve_known_pair()
    print(
        "PASS: resolved local pair Colchicine (DB01394) and "
        "Probenecid (DB01032)."
    )

    verify_offline_schema(drug_a, drug_b)
    print("PASS: deterministic FDA and PubMed response schemas verified.")
    print("PASS: combined response contains no forbidden clinical verdict keys.")

    route_paths = {route.path for route in app.routes}
    if "/api/evidence/pair" not in route_paths:
        raise AssertionError("The /api/evidence/pair route is not registered.")
    print("PASS: /api/evidence/pair is registered.")

    verify_live_services(drug_a, drug_b)
    print("PASS: external-evidence verification completed.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
