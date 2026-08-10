"""Standalone verification for the exported CHEERS NumPy inference runtime."""

from __future__ import annotations

import math
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from src.lightweight_inference import DDIPredictor


EXPECTED_TOP_10 = [
    ("Probenecid", "DB01032"),
    ("Hydrocortisone", "DB00741"),
    ("Ondansetron", "DB00904"),
    ("Sulfinpyrazone", "DB01138"),
    ("Melengestrol acetate", "DB14659"),
    ("Prednisone acetate", "DB14646"),
    ("Coumarin", "DB04665"),
    ("Dicoumarol", "DB00266"),
    ("Methylprednisolone hemisuccinate", "DB14644"),
    ("Oxycodone", "DB00497"),
]


def main():
    predictor = DDIPredictor(project_dir=PROJECT_DIR)

    resolved_by_id = predictor.resolve_drug("DB01394")
    if resolved_by_id["name"] != "Colchicine":
        raise AssertionError(
            "DrugBank-ID lookup failed: DB01394 did not resolve to Colchicine."
        )

    result = predictor.predict("Colchicine", top_k=10)
    query = result["query"]
    if query["entity_id"] != "DB01394":
        raise AssertionError(
            "Exact-name lookup failed: Colchicine did not resolve to DB01394."
        )

    actual_top_10 = [
        (prediction["name"], prediction["entity_id"])
        for prediction in result["predictions"]
    ]
    if actual_top_10 != EXPECTED_TOP_10:
        expected_lines = "\n".join(
            f"  {rank}. {name} ({entity_id})"
            for rank, (name, entity_id) in enumerate(EXPECTED_TOP_10, start=1)
        )
        actual_lines = "\n".join(
            f"  {rank}. {name} ({entity_id})"
            for rank, (name, entity_id) in enumerate(actual_top_10, start=1)
        )
        raise AssertionError(
            "Lightweight Top-10 ranking mismatch.\n"
            f"Expected:\n{expected_lines}\nActual:\n{actual_lines}"
        )

    first_score = result["predictions"][0]["raw_score"]
    if not math.isclose(first_score, 40.8524, rel_tol=0.0, abs_tol=0.001):
        raise AssertionError(
            f"Unexpected first raw score: expected about 40.8524, got {first_score}."
        )

    if result["known_positive_candidates_filtered"] != 1_488:
        raise AssertionError(
            "Unexpected Colchicine known-positive count: "
            f"{result['known_positive_candidates_filtered']}."
        )

    print("PASS: lightweight runtime reproduced the verified Colchicine Top-10.")
    print(f"First raw model score: {first_score:.4f}")


if __name__ == "__main__":
    main()
