"""Run the isolated G3 seed-44 DDInter external-ranking pilot.

The evaluated positives are the already-prepared DDInter interactions absent
from the complete known-positive DDI set in the project PrimeKG snapshot. The
script performs no training, graph encoding, thresholding, or probability
conversion. It uses the verified NumPy export of the exact G3 seed-44 model.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


PACKAGE = Path(__file__).resolve().parents[2]
PROJECT = PACKAGE.parents[1]
PREPARATION = PACKAGE / "ddinter/preparation"
DEFAULT_OUTPUT = PACKAGE / "ddinter/pilot/reproduction_run"
COHORT = PREPARATION / "ddinter_primekg_novel_pairs.csv"
MAPPED_POSITIVE_FILTER_PAIRS = PREPARATION / "ddinter_mapped_positive_filter_pairs.csv"
RUNTIME = PROJECT / "final_release/lightweight_runtime"
EMBEDDINGS = RUNTIME / "ddi_runtime_embeddings.npz"
KNOWN_MASK = RUNTIME / "known_positive_mask_packed.npz"
METADATA = RUNTIME / "drug_metadata.csv"
RUNTIME_MANIFEST = RUNTIME / "LIGHTWEIGHT_RUNTIME_MANIFEST.json"
CHECKPOINT = PROJECT / "checkpoints/rgcn_multiseed/G3_seed44_best.pt"

EXPECTED_HASHES = {
    "cohort": "a63c11610075734b18cbc4fa35f19015caebeadacfa29f83f855aa3711ceca36",
    "mapped_positive_filter_pairs": "1af413b3c23ac08d8966252c86069dc7ab01cf75f578ce6b4f8536bede46b64a",
    "embeddings": "1bde47026e0d6fcfbb2de772b62280bd67df1fc7a3404672bfcdfc2b603de442",
    "known_mask": "c87cc2e0ab2eac70c2aa98fc995853bf5c6e97ef0ef7881568b550d924120d37",
    "metadata": "8020ae748baa567d08487c148ba851763fcac54601c183dd6803b587974d857b",
    "checkpoint": "d4df7c845fe65b175afdfdc8512fe466451029c682a2a34f9d52a84b35811d50",
}
SEVERITIES = ("Major", "Moderate", "Minor", "Unknown")
CANDIDATE_COUNT = 4_278
EXPECTED_PAIRS = 49_105
EXPECTED_MAPPED_POSITIVE_PAIRS = 138_358


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=(
            "Fresh directory for reproduction outputs "
            f"(default: {DEFAULT_OUTPUT})"
        ),
    )
    parser.add_argument(
        "--verify-inputs-only",
        action="store_true",
        help="Verify all evaluator inputs and filtering invariants without scoring or writing outputs.",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def lower_median(values: np.ndarray) -> int:
    """Match torch.median: select the lower middle rank for even-length data."""

    index = (values.size - 1) // 2
    return int(np.partition(values, index)[index])


def metrics(ranks: np.ndarray) -> dict[str, int | float]:
    if ranks.size == 0:
        raise ValueError("Cannot calculate metrics for an empty query set")
    return {
        "MRR": float(np.mean(1.0 / ranks.astype(np.float64))),
        "Hits@1": float(np.mean(ranks <= 1)),
        "Hits@5": float(np.mean(ranks <= 5)),
        "Hits@10": float(np.mean(ranks <= 10)),
        "MeanRank": float(np.mean(ranks.astype(np.float64))),
        "MedianRank": lower_median(ranks),
        "MinRank": int(ranks.min()),
        "MaxRank": int(ranks.max()),
    }


def verify_hashes() -> dict[str, str]:
    paths = {
        "cohort": COHORT,
        "mapped_positive_filter_pairs": MAPPED_POSITIVE_FILTER_PAIRS,
        "embeddings": EMBEDDINGS,
        "known_mask": KNOWN_MASK,
        "metadata": METADATA,
        "checkpoint": CHECKPOINT,
    }
    actual = {name: sha256(path) for name, path in paths.items()}
    failures = {
        name: {"expected": EXPECTED_HASHES[name], "actual": value}
        for name, value in actual.items()
        if value != EXPECTED_HASHES[name]
    }
    if failures:
        raise ValueError(f"Input hash verification failed: {failures}")
    return actual


def load_runtime() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[dict[str, str]]]:
    with np.load(EMBEDDINGS, allow_pickle=False) as exported:
        embeddings = exported["candidate_embeddings"].copy()
        relation = exported["ddi_relation"].copy()
        node_ids = exported["drug_node_ids"].copy()
    with np.load(KNOWN_MASK, allow_pickle=False) as exported:
        packed_mask = exported["packed_mask"].copy()
        num_drugs = int(exported["num_drugs"][0])
    metadata = read_csv(METADATA)

    if embeddings.shape != (CANDIDATE_COUNT, 128) or embeddings.dtype != np.float32:
        raise ValueError("Candidate embedding export has unexpected shape or dtype")
    if relation.shape != (128,) or relation.dtype != np.float32:
        raise ValueError("DDI relation export has unexpected shape or dtype")
    if node_ids.shape != (CANDIDATE_COUNT,) or len(set(node_ids.tolist())) != CANDIDATE_COUNT:
        raise ValueError("Candidate node IDs are invalid")
    if packed_mask.shape != (CANDIDATE_COUNT, (CANDIDATE_COUNT + 7) // 8):
        raise ValueError("Packed known-positive mask has unexpected shape")
    if num_drugs != CANDIDATE_COUNT or len(metadata) != CANDIDATE_COUNT:
        raise ValueError("Runtime candidate counts differ")
    metadata_nodes = np.array([int(row["node_id"]) for row in metadata], dtype=node_ids.dtype)
    if not np.array_equal(metadata_nodes, node_ids):
        raise ValueError("Metadata and embedding candidate order differ")
    return embeddings, relation, node_ids, packed_mask, metadata


def verify_cohort(
    cohort: list[dict[str, str]], node_to_local: dict[int, int], packed_mask: np.ndarray
) -> dict[str, object]:
    if len(cohort) != EXPECTED_PAIRS:
        raise ValueError(f"Expected {EXPECTED_PAIRS:,} pairs, found {len(cohort):,}")
    symmetric_pairs: set[tuple[int, int]] = set()
    severity_counts: Counter[str] = Counter()
    for row in cohort:
        if row["PrimeKG_known_overlap"].casefold() != "false":
            raise ValueError("Prepared cohort contains a PrimeKG-known overlap flag")
        if row["severity"] not in SEVERITIES:
            raise ValueError(f"Unexpected severity: {row['severity']}")
        node_a = int(row["PrimeKG_node_A"])
        node_b = int(row["PrimeKG_node_B"])
        if node_a not in node_to_local or node_b not in node_to_local:
            raise ValueError("Cohort endpoint is outside the 4,278-candidate vocabulary")
        if node_a == node_b:
            raise ValueError("Self-pair found in prepared cohort")
        pair = tuple(sorted((node_a, node_b)))
        if pair in symmetric_pairs:
            raise ValueError("Duplicate symmetric pair found in prepared cohort")
        symmetric_pairs.add(pair)
        severity_counts[row["severity"]] += 1

        local_a = node_to_local[node_a]
        local_b = node_to_local[node_b]
        known_a = np.unpackbits(
            packed_mask[local_a], count=CANDIDATE_COUNT, bitorder="big"
        )
        if bool(known_a[local_b]):
            raise ValueError("Cohort pair is present in the complete PrimeKG-known mask")

    return {
        "pair_count": len(cohort),
        "directional_query_count": 2 * len(cohort),
        "all_known_overlap_flags_false": True,
        "all_endpoints_in_candidate_vocabulary": True,
        "self_pairs": 0,
        "duplicate_symmetric_pairs": 0,
        "severity_counts": dict(sorted(severity_counts.items())),
        "all_pairs_absent_from_complete_primekg_known_mask": True,
    }


def ddinter_partner_sets(
    node_to_local: dict[int, int],
) -> tuple[dict[int, set[int]], dict[str, object]]:
    """Load the tracked symmetric DDInter-positive filter universe.

    Each canonical node pair contributes both partner directions, exactly matching
    the filtering semantics of the original mapped-pair review table.
    """

    partners: dict[int, set[int]] = defaultdict(set)
    symmetric_pairs: set[tuple[int, int]] = set()
    rows = read_csv(MAPPED_POSITIVE_FILTER_PAIRS)
    for row in rows:
        node_a = int(row["PrimeKG_node_A"])
        node_b = int(row["PrimeKG_node_B"])
        if node_a == node_b:
            raise ValueError("Self-pair found in DDInter-positive filter universe")
        if node_a not in node_to_local or node_b not in node_to_local:
            raise ValueError("DDInter-positive filter endpoint is outside candidate vocabulary")
        pair = (node_a, node_b)
        if node_a > node_b:
            raise ValueError("DDInter-positive filter pairs must use canonical node order")
        if pair in symmetric_pairs:
            raise ValueError("Duplicate symmetric DDInter-positive filter pair found")
        symmetric_pairs.add(pair)
        local_a = node_to_local[node_a]
        local_b = node_to_local[node_b]
        partners[local_a].add(local_b)
        partners[local_b].add(local_a)
    if len(rows) != EXPECTED_MAPPED_POSITIVE_PAIRS:
        raise ValueError(
            f"Expected {EXPECTED_MAPPED_POSITIVE_PAIRS:,} mapped DDInter pairs, "
            f"found {len(rows):,}"
        )
    return partners, {
        "mapped_positive_pair_count": len(symmetric_pairs),
        "self_pairs": 0,
        "duplicate_symmetric_pairs": 0,
        "all_endpoints_in_candidate_vocabulary": True,
        "canonical_node_order": True,
        "bidirectional_partner_sets_constructed": True,
    }


def build_tasks(
    cohort: list[dict[str, str]], node_to_local: dict[int, int]
) -> dict[int, list[tuple[dict[str, str], str, int]]]:
    tasks: dict[int, list[tuple[dict[str, str], str, int]]] = defaultdict(list)
    for row in cohort:
        local_a = node_to_local[int(row["PrimeKG_node_A"])]
        local_b = node_to_local[int(row["PrimeKG_node_B"])]
        tasks[local_a].append((row, "A_to_B", local_b))
        tasks[local_b].append((row, "B_to_A", local_a))
    return tasks


def evaluate(
    cohort: list[dict[str, str]], embeddings: np.ndarray, relation: np.ndarray,
    node_ids: np.ndarray, packed_mask: np.ndarray, metadata: list[dict[str, str]],
    partner_sets: dict[int, set[int]], node_to_local: dict[int, int],
) -> list[dict[str, object]]:
    weighted_candidates = embeddings * relation
    tasks = build_tasks(cohort, node_to_local)
    output: list[dict[str, object]] = []

    for query_number, (query_local, query_tasks) in enumerate(sorted(tasks.items()), start=1):
        # Exactly matches the verified runtime scoring expression.
        scores = embeddings[query_local] @ weighted_candidates.T
        if scores.shape != (CANDIDATE_COUNT,) or not np.isfinite(scores).all():
            raise ValueError("Invalid score vector")

        known = np.unpackbits(
            packed_mask[query_local], count=CANDIDATE_COUNT, bitorder="big"
        ).astype(bool, copy=False)
        base_filter = known.copy()
        base_filter[query_local] = True
        ddinter_partners = partner_sets.get(query_local, set())
        if ddinter_partners:
            base_filter[np.fromiter(ddinter_partners, dtype=np.int64)] = True
        base_scores = scores[~base_filter]
        sorted_base_scores = np.sort(base_scores)
        unique_base_scores, unique_base_counts = np.unique(base_scores, return_counts=True)
        tie_lookup = {
            float(score): int(count)
            for score, count in zip(unique_base_scores.tolist(), unique_base_counts.tolist())
        }

        for row, direction, target_local in query_tasks:
            if target_local not in ddinter_partners:
                raise ValueError("Current target missing from DDInter-positive filter universe")
            if bool(known[target_local]):
                raise ValueError("Current target unexpectedly present in PrimeKG-known mask")
            target_score = np.float32(scores[target_local])
            greater_count = int(
                sorted_base_scores.size
                - np.searchsorted(sorted_base_scores, target_score, side="right")
            )
            rank = 1 + greater_count
            tied_base_candidates = tie_lookup.get(float(target_score), 0)
            target_tie_count = 1 + tied_base_candidates
            unique_available_scores = len(tie_lookup) + (0 if tied_base_candidates else 1)
            number_filtered = int(base_filter.sum()) - 1  # Restore current target.
            if number_filtered < 0 or rank > CANDIDATE_COUNT - number_filtered:
                raise ValueError("Rank is outside the target-restored candidate space")

            if direction == "A_to_B":
                query_name, query_id = row["Drug_A"], row["DrugBank_ID_A"]
                target_name, target_id = row["Drug_B"], row["DrugBank_ID_B"]
            else:
                query_name, query_id = row["Drug_B"], row["DrugBank_ID_B"]
                target_name, target_id = row["Drug_A"], row["DrugBank_ID_A"]

            output.append(
                {
                    "DDInter_ID_A": row["DDInter_ID_A"],
                    "Drug_A": row["Drug_A"],
                    "DrugBank_ID_A": row["DrugBank_ID_A"],
                    "DDInter_ID_B": row["DDInter_ID_B"],
                    "Drug_B": row["Drug_B"],
                    "DrugBank_ID_B": row["DrugBank_ID_B"],
                    "severity": row["severity"],
                    "query_direction": direction,
                    "query_drug": query_name,
                    "query_drugbank_id": query_id,
                    "query_node": int(node_ids[query_local]),
                    "target_drug": target_name,
                    "target_drugbank_id": target_id,
                    "target_node": int(node_ids[target_local]),
                    "raw_target_score": float(target_score),
                    "rank": rank,
                    "number_filtered": number_filtered,
                    "available_candidates_after_filtering": CANDIDATE_COUNT - number_filtered,
                    "target_tie_count": target_tie_count,
                    "tied_competitor_count": target_tie_count - 1,
                    "unique_available_scores": unique_available_scores,
                }
            )
        if query_number % 250 == 0 or query_number == len(tasks):
            print(f"Scored {query_number:,}/{len(tasks):,} unique query drugs")
    return output


def validate_results(
    cohort: list[dict[str, str]], result_rows: list[dict[str, object]]
) -> dict[str, object]:
    expected_queries = 2 * len(cohort)
    if len(result_rows) != expected_queries:
        raise ValueError(f"Expected {expected_queries:,} query rows, found {len(result_rows):,}")
    pair_directions: Counter[tuple[str, str]] = Counter()
    for row in result_rows:
        pair_key = (str(row["DDInter_ID_A"]), str(row["DDInter_ID_B"]))
        pair_directions[("|".join(pair_key), str(row["query_direction"]))] += 1
        rank = int(row["rank"])
        if rank < 1 or rank > CANDIDATE_COUNT:
            raise ValueError("Rank outside 1..4,278")
        if int(row["query_node"]) == int(row["target_node"]):
            raise ValueError("Self-query escaped input validation")
        if not math.isfinite(float(row["raw_target_score"])):
            raise ValueError("NaN or infinite target score")
    if len(pair_directions) != expected_queries or any(count != 1 for count in pair_directions.values()):
        raise ValueError("Each original pair must appear exactly once in each direction")
    severity_pairs = Counter(row["severity"] for row in cohort)
    severity_queries = Counter(str(row["severity"]) for row in result_rows)
    for severity in SEVERITIES:
        if severity_queries[severity] != 2 * severity_pairs[severity]:
            raise ValueError("Severity query counts do not reconstruct pair counts")
    return {
        "directional_rows": len(result_rows),
        "every_pair_appears_once_in_each_direction": True,
        "all_ranks_within_1_and_4278": True,
        "no_target_accidentally_filtered": True,
        "all_scores_finite": True,
        "severity_counts_reconstruct_pairs": True,
    }


def write_csv(path: Path, fields: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    args = parse_args()
    output = args.output_dir.resolve()
    expected_outputs = [
        output / "ddinter_g3_seed44_per_query.csv",
        output / "ddinter_g3_seed44_overall_metrics.json",
        output / "ddinter_g3_seed44_severity_metrics.csv",
        output / "ddinter_g3_seed44_sensitivity_metrics.json",
        output / "ddinter_g3_seed44_tie_diagnostics.json",
        output / "EVALUATION_NOTES.md",
        output / "SHA256SUMS.sha256",
    ]

    input_hashes = verify_hashes()
    embeddings, relation, node_ids, packed_mask, metadata = load_runtime()
    node_to_local = {int(node): index for index, node in enumerate(node_ids.tolist())}
    cohort = read_csv(COHORT)
    input_verification = verify_cohort(cohort, node_to_local, packed_mask)
    partner_sets, filter_verification = ddinter_partner_sets(node_to_local)
    runtime_manifest = json.loads(RUNTIME_MANIFEST.read_text(encoding="utf-8"))
    if (
        runtime_manifest["graph"] != "G3"
        or int(runtime_manifest["seed"]) != 44
        or int(runtime_manifest["best_epoch"]) != 499
    ):
        raise ValueError("Runtime model identity differs from G3 seed 44 epoch 499")

    verification = {
        "cohort": input_verification,
        "mapped_positive_filter_universe": filter_verification,
        "input_hashes_sha256": input_hashes,
        "runtime_model_identity": "G3 seed 44 epoch 499",
    }
    print(json.dumps(verification, indent=2))
    if args.verify_inputs_only:
        return

    if any(path.exists() for path in expected_outputs):
        raise FileExistsError("Pilot outputs already exist; refusing to overwrite them")
    output.mkdir(parents=True, exist_ok=True)

    result_rows = evaluate(
        cohort, embeddings, relation, node_ids, packed_mask, metadata,
        partner_sets, node_to_local,
    )
    output_verification = validate_results(cohort, result_rows)
    ranks = np.array([int(row["rank"]) for row in result_rows], dtype=np.int32)
    overall = metrics(ranks)

    severity_rows: list[dict[str, object]] = []
    for severity in SEVERITIES:
        indices = [i for i, row in enumerate(result_rows) if row["severity"] == severity]
        severity_ranks = ranks[np.array(indices, dtype=np.int64)]
        pair_count = sum(row["severity"] == severity for row in cohort)
        severity_rows.append(
            {
                "severity": severity,
                "pair_count": pair_count,
                "directional_query_count": len(indices),
                **metrics(severity_ranks),
            }
        )

    known_indices = [i for i, row in enumerate(result_rows) if row["severity"] != "Unknown"]
    known_ranks = ranks[np.array(known_indices, dtype=np.int64)]
    known_pair_count = sum(row["severity"] != "Unknown" for row in cohort)
    sensitivity = {
        "subset": "Known severity: Major + Moderate + Minor",
        "severity_is_not_a_class_label": True,
        "pair_count": known_pair_count,
        "directional_query_count": len(known_indices),
        **metrics(known_ranks),
    }

    tie_counts = np.array([int(row["target_tie_count"]) for row in result_rows], dtype=np.int32)
    unique_counts = np.array(
        [int(row["unique_available_scores"]) for row in result_rows], dtype=np.int32
    )
    tied_queries = int(np.sum(tie_counts > 1))
    tie_diagnostics = {
        "ranking_convention": "optimistic strict rank: 1 + count(filtered candidate score > target score)",
        "target_tie_count_definition": "Number of target-restored available candidates with raw score exactly equal to the target score, including the target itself.",
        "directional_query_count": len(result_rows),
        "queries_with_target_score_ties": tied_queries,
        "proportion_with_target_score_ties": tied_queries / len(result_rows),
        "queries_without_tied_competitors": int(np.sum(tie_counts == 1)),
        "maximum_target_tie_count": int(tie_counts.max()),
        "mean_target_tie_count": float(tie_counts.mean()),
        "minimum_unique_available_scores": int(unique_counts.min()),
        "maximum_unique_available_scores": int(unique_counts.max()),
        "mean_unique_available_scores": float(unique_counts.mean()),
        "target_tie_count_histogram": {
            str(value): int(count)
            for value, count in zip(*np.unique(tie_counts, return_counts=True))
        },
    }

    overall_document = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "experiment": "G3 seed-44 DDInter external-ranking pilot",
        "interpretation_scope": "Secondary external robustness pilot; not a full G0-G3 comparison.",
        "evaluated_set": "DDInter interactions absent from the PrimeKG snapshot used for training/evaluation.",
        "model": {
            "graph": "G3", "seed": 44, "best_epoch": 499,
            "candidate_count": CANDIDATE_COUNT,
            "decoder": "DistMult-style raw ranking score; not a probability",
        },
        "input_hashes_sha256": input_hashes,
        "input_verification": input_verification,
        "filtering": {
            "query_self": True,
            "complete_primekg_known_positive_partners": True,
            "all_other_mapped_ddinter_positive_partners": True,
            "current_target_restored": True,
        },
        "ranking_convention": "1 + number of available candidates with score strictly greater than target score",
        "pair_count": len(cohort),
        "directional_query_count": len(result_rows),
        "metrics": overall,
        "output_verification": output_verification,
    }

    per_query_fields = [
        "DDInter_ID_A", "Drug_A", "DrugBank_ID_A", "DDInter_ID_B", "Drug_B",
        "DrugBank_ID_B", "severity", "query_direction", "query_drug",
        "query_drugbank_id", "query_node", "target_drug", "target_drugbank_id",
        "target_node", "raw_target_score", "rank", "number_filtered",
        "available_candidates_after_filtering", "target_tie_count",
        "tied_competitor_count", "unique_available_scores",
    ]
    severity_fields = [
        "severity", "pair_count", "directional_query_count", "MRR", "Hits@1",
        "Hits@5", "Hits@10", "MeanRank", "MedianRank", "MinRank", "MaxRank",
    ]
    write_csv(output / "ddinter_g3_seed44_per_query.csv", per_query_fields, result_rows)
    write_csv(output / "ddinter_g3_seed44_severity_metrics.csv", severity_fields, severity_rows)
    (output / "ddinter_g3_seed44_overall_metrics.json").write_text(
        json.dumps(overall_document, indent=2) + "\n", encoding="utf-8"
    )
    (output / "ddinter_g3_seed44_sensitivity_metrics.json").write_text(
        json.dumps(sensitivity, indent=2) + "\n", encoding="utf-8"
    )
    (output / "ddinter_g3_seed44_tie_diagnostics.json").write_text(
        json.dumps(tie_diagnostics, indent=2) + "\n", encoding="utf-8"
    )

    notes = f"""# G3 seed-44 DDInter external-ranking pilot

This pilot evaluates **DDInter interactions absent from the PrimeKG snapshot used for
training/evaluation**. It does not claim that the interactions are newly discovered or
clinically novel. It uses one graph and one seed and is not a full G0-G3 comparison.

## Model and score

- Graph: G3
- Seed: 44
- Best epoch: 499
- Candidates: 4,278 drugs
- Decoder: `query_embedding @ (candidate_embeddings * ddi_relation).T`
- Raw outputs are ranking scores, not probabilities or confidence values.

## Filtering and rank

For both directions of every pair, the evaluator filters the query drug, every complete
PrimeKG-known positive partner, and every other mapped DDInter-positive partner, then
restores the current target. Rank is `1 + count(score > target_score)`, matching the
project's optimistic strict-rank convention. Equal-scoring candidates do not outrank the
target; ties are reported separately.

## Cohort

- Symmetric pairs: {len(cohort):,}
- Directional queries: {len(result_rows):,}
- All targets absent from complete PrimeKG-known mask: yes
- Severity is descriptive stratification only, not a class label.

No training, retraining, graph encoding, threshold tuning, probability conversion, or
checkpoint modification was performed.
"""
    (output / "EVALUATION_NOTES.md").write_text(notes, encoding="utf-8")

    generated = sorted(
        path for path in output.iterdir()
        if path.is_file() and path.name != "SHA256SUMS.sha256"
    )
    (output / "SHA256SUMS.sha256").write_text(
        "\n".join(f"{sha256(path)}  {path.name}" for path in generated) + "\n",
        encoding="ascii",
    )
    print(json.dumps(overall_document, indent=2))
    print(json.dumps(tie_diagnostics, indent=2))


if __name__ == "__main__":
    main()
