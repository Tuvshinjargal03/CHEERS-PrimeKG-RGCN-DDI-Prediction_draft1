"""Evaluate a verified lightweight model on the frozen DDInter cohort."""

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


PROJECT = Path(__file__).resolve().parents[3]
COHORT = PROJECT / "analysis/external_ddi_evaluation/ddinter/preparation/ddinter_primekg_novel_pairs.csv"
MAPPED_POSITIVE_FILTER = PROJECT / "analysis/external_ddi_evaluation/ddinter/preparation/ddinter_mapped_positive_filter_pairs.csv"

# The historical pilot recorded the pre-normalization cohort hash. The tracked
# package deliberately uses canonical LF bytes; COPY_PROVENANCE.json records
# that scientific values are unchanged and identifies this current hash.
COHORT_SHA256 = "b2a79538655b1499dfd8a9b0418bc9c6d110dca15f032412b56f40f748e5e49a"
MAPPED_POSITIVE_FILTER_SHA256 = "1af413b3c23ac08d8966252c86069dc7ab01cf75f578ce6b4f8536bede46b64a"
CANDIDATE_COUNT = 4_278
EXPECTED_PAIRS = 49_105
EXPECTED_MAPPED_POSITIVE_PAIRS = 138_358
SEVERITIES = ("Major", "Moderate", "Minor", "Unknown")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-spec", type=Path, required=True)
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="New directory for result files; existing paths are refused.",
    )
    parser.add_argument(
        "--verify-inputs-only",
        action="store_true",
        help="Verify every input and protocol invariant without scoring or writing.",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def project_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else PROJECT / path


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, fields: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def lower_median(values: np.ndarray) -> int:
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


def load_spec(path: Path) -> dict[str, object]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    required = {
        "schema_version", "model_label", "result_prefix", "graph", "seed",
        "best_epoch", "candidate_embeddings", "ddi_relation",
        "candidate_node_ids", "known_positive_mask", "drug_metadata",
        "runtime_manifest", "checkpoint",
    }
    missing = sorted(required - set(spec))
    if missing:
        raise ValueError(f"Model spec is missing required fields: {missing}")
    if int(spec["schema_version"]) != 1:
        raise ValueError("Unsupported model-spec schema version")
    prefix = str(spec["result_prefix"])
    if not prefix or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for character in prefix):
        raise ValueError("result_prefix must contain only letters, numbers, '_' or '-'")
    return spec


def verify_hash(path: Path, expected: str, label: str) -> str:
    actual = sha256(path)
    if actual != expected:
        raise ValueError(f"{label} hash mismatch: expected {expected}, found {actual}")
    return actual


def load_and_verify_runtime(spec: dict[str, object]) -> tuple[
    np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[dict[str, str]], dict[str, str]
]:
    entries = {
        "candidate_embeddings": spec["candidate_embeddings"],
        "ddi_relation": spec["ddi_relation"],
        "candidate_node_ids": spec["candidate_node_ids"],
        "known_positive_mask": spec["known_positive_mask"],
        "drug_metadata": spec["drug_metadata"],
        "runtime_manifest": spec["runtime_manifest"],
        "checkpoint": spec["checkpoint"],
    }
    paths = {name: project_path(str(entry["path"])) for name, entry in entries.items()}
    hashes = {
        name: verify_hash(paths[name], str(entry["sha256"]), name)
        for name, entry in entries.items()
    }

    embedding_entry = entries["candidate_embeddings"]
    relation_entry = entries["ddi_relation"]
    node_entry = entries["candidate_node_ids"]
    with np.load(paths["candidate_embeddings"], allow_pickle=False) as exported:
        embeddings = exported[str(embedding_entry["key"])].copy()
    with np.load(paths["ddi_relation"], allow_pickle=False) as exported:
        relation = exported[str(relation_entry["key"])].copy()
    with np.load(paths["candidate_node_ids"], allow_pickle=False) as exported:
        node_ids = exported[str(node_entry["key"])].copy()
    mask_entry = entries["known_positive_mask"]
    with np.load(paths["known_positive_mask"], allow_pickle=False) as exported:
        packed_mask = exported[str(mask_entry["key"])].copy()
        num_drugs = int(exported[str(mask_entry["count_key"])][0])
    metadata = read_csv(paths["drug_metadata"])

    if embeddings.shape != (CANDIDATE_COUNT, 128) or embeddings.dtype != np.float32:
        raise ValueError("Candidate embeddings have unexpected shape or dtype")
    if relation.shape != (128,) or relation.dtype != np.float32:
        raise ValueError("DDI relation has unexpected shape or dtype")
    if node_ids.shape != (CANDIDATE_COUNT,) or len(set(node_ids.tolist())) != CANDIDATE_COUNT:
        raise ValueError("Candidate node IDs are invalid")
    if not np.array_equal(node_ids, np.sort(node_ids)):
        raise ValueError("Candidate node IDs are not in canonical sorted order")
    if packed_mask.shape != (CANDIDATE_COUNT, (CANDIDATE_COUNT + 7) // 8):
        raise ValueError("Packed known-positive mask has unexpected shape")
    if num_drugs != CANDIDATE_COUNT or len(metadata) != CANDIDATE_COUNT:
        raise ValueError("Runtime candidate counts differ")
    metadata_nodes = np.array([int(row["node_id"]) for row in metadata], dtype=node_ids.dtype)
    if not np.array_equal(metadata_nodes, node_ids):
        raise ValueError("Metadata and candidate node order differ")

    manifest = json.loads(paths["runtime_manifest"].read_text(encoding="utf-8"))
    expected_identity = (str(spec["graph"]), int(spec["seed"]), int(spec["best_epoch"]))
    manifest_identity = (
        str(manifest["graph"]), int(manifest["seed"]), int(manifest["best_epoch"])
    )
    if manifest_identity != expected_identity:
        raise ValueError(
            f"Runtime identity {manifest_identity} differs from model spec {expected_identity}"
        )
    if int(manifest["candidate_drugs"]) != CANDIDATE_COUNT:
        raise ValueError("Runtime manifest candidate count differs")
    if int(manifest["embedding_dimension"]) != 128:
        raise ValueError("Runtime manifest embedding dimension differs")
    return embeddings, relation, node_ids, packed_mask, metadata, hashes


def verify_cohort(
    cohort: list[dict[str, str]], node_to_local: dict[int, int], packed_mask: np.ndarray
) -> dict[str, object]:
    if len(cohort) != EXPECTED_PAIRS:
        raise ValueError(f"Expected {EXPECTED_PAIRS:,} pairs, found {len(cohort):,}")
    symmetric_pairs: set[tuple[int, int]] = set()
    severity_counts: Counter[str] = Counter()
    for row in cohort:
        if row["PrimeKG_known_overlap"].casefold() != "false":
            raise ValueError("Cohort contains a PrimeKG-known overlap flag")
        if row["severity"] not in SEVERITIES:
            raise ValueError(f"Unexpected severity: {row['severity']}")
        node_a = int(row["PrimeKG_node_A"])
        node_b = int(row["PrimeKG_node_B"])
        if node_a not in node_to_local or node_b not in node_to_local:
            raise ValueError("Cohort endpoint is outside the candidate vocabulary")
        if node_a == node_b:
            raise ValueError("Self-pair found in cohort")
        pair = tuple(sorted((node_a, node_b)))
        if pair in symmetric_pairs:
            raise ValueError("Duplicate symmetric cohort pair found")
        symmetric_pairs.add(pair)
        severity_counts[row["severity"]] += 1
        local_a = node_to_local[node_a]
        local_b = node_to_local[node_b]
        known_a = np.unpackbits(packed_mask[local_a], count=CANDIDATE_COUNT, bitorder="big")
        if bool(known_a[local_b]):
            raise ValueError("Cohort pair is present in the PrimeKG-known mask")
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
    partners: dict[int, set[int]] = defaultdict(set)
    symmetric_pairs: set[tuple[int, int]] = set()
    rows = read_csv(MAPPED_POSITIVE_FILTER)
    for row in rows:
        node_a = int(row["PrimeKG_node_A"])
        node_b = int(row["PrimeKG_node_B"])
        if node_a == node_b or node_a > node_b:
            raise ValueError("DDInter-positive filter pairs are not canonical")
        if node_a not in node_to_local or node_b not in node_to_local:
            raise ValueError("DDInter-positive filter endpoint is outside the vocabulary")
        pair = (node_a, node_b)
        if pair in symmetric_pairs:
            raise ValueError("Duplicate symmetric DDInter-positive filter pair found")
        symmetric_pairs.add(pair)
        local_a = node_to_local[node_a]
        local_b = node_to_local[node_b]
        partners[local_a].add(local_b)
        partners[local_b].add(local_a)
    if len(rows) != EXPECTED_MAPPED_POSITIVE_PAIRS:
        raise ValueError(f"Expected {EXPECTED_MAPPED_POSITIVE_PAIRS:,} mapped pairs")
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
    node_ids: np.ndarray, packed_mask: np.ndarray,
    partner_sets: dict[int, set[int]], node_to_local: dict[int, int],
) -> list[dict[str, object]]:
    weighted_candidates = embeddings * relation
    tasks = build_tasks(cohort, node_to_local)
    output: list[dict[str, object]] = []
    for query_number, (query_local, query_tasks) in enumerate(sorted(tasks.items()), start=1):
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
            number_filtered = int(base_filter.sum()) - 1
            if number_filtered < 0 or rank > CANDIDATE_COUNT - number_filtered:
                raise ValueError("Rank is outside the target-restored candidate space")
            if direction == "A_to_B":
                query_name, query_id = row["Drug_A"], row["DrugBank_ID_A"]
                target_name, target_id = row["Drug_B"], row["DrugBank_ID_B"]
            else:
                query_name, query_id = row["Drug_B"], row["DrugBank_ID_B"]
                target_name, target_id = row["Drug_A"], row["DrugBank_ID_A"]
            output.append({
                "DDInter_ID_A": row["DDInter_ID_A"], "Drug_A": row["Drug_A"],
                "DrugBank_ID_A": row["DrugBank_ID_A"], "DDInter_ID_B": row["DDInter_ID_B"],
                "Drug_B": row["Drug_B"], "DrugBank_ID_B": row["DrugBank_ID_B"],
                "severity": row["severity"], "query_direction": direction,
                "query_drug": query_name, "query_drugbank_id": query_id,
                "query_node": int(node_ids[query_local]), "target_drug": target_name,
                "target_drugbank_id": target_id, "target_node": int(node_ids[target_local]),
                "raw_target_score": float(target_score), "rank": rank,
                "number_filtered": number_filtered,
                "available_candidates_after_filtering": CANDIDATE_COUNT - number_filtered,
                "target_tie_count": target_tie_count,
                "tied_competitor_count": target_tie_count - 1,
                "unique_available_scores": unique_available_scores,
            })
        if query_number % 250 == 0 or query_number == len(tasks):
            print(f"Scored {query_number:,}/{len(tasks):,} unique query drugs")
    return output


def validate_results(
    cohort: list[dict[str, str]], result_rows: list[dict[str, object]]
) -> dict[str, object]:
    expected_queries = 2 * len(cohort)
    if len(result_rows) != expected_queries:
        raise ValueError(f"Expected {expected_queries:,} query rows")
    identities = Counter(
        (str(row["DDInter_ID_A"]), str(row["DDInter_ID_B"]), str(row["query_direction"]))
        for row in result_rows
    )
    if len(identities) != expected_queries or any(count != 1 for count in identities.values()):
        raise ValueError("Each pair must appear exactly once in each direction")
    if any(not 1 <= int(row["rank"]) <= CANDIDATE_COUNT for row in result_rows):
        raise ValueError("Rank outside candidate range")
    if any(int(row["query_node"]) == int(row["target_node"]) for row in result_rows):
        raise ValueError("Self-query escaped input validation")
    if any(not math.isfinite(float(row["raw_target_score"])) for row in result_rows):
        raise ValueError("Non-finite target score")
    severity_pairs = Counter(row["severity"] for row in cohort)
    severity_queries = Counter(str(row["severity"]) for row in result_rows)
    if any(severity_queries[value] != 2 * severity_pairs[value] for value in SEVERITIES):
        raise ValueError("Severity query counts do not reconstruct pair counts")
    return {
        "directional_rows": len(result_rows),
        "every_pair_appears_once_in_each_direction": True,
        "all_ranks_within_1_and_4278": True,
        "no_target_accidentally_filtered": True,
        "all_scores_finite": True,
        "severity_counts_reconstruct_pairs": True,
    }


def main() -> None:
    args = parse_args()
    spec_path = args.model_spec.resolve()
    output = args.output_dir.resolve()
    spec = load_spec(spec_path)
    prefix = str(spec["result_prefix"])

    verify_hash(COHORT, COHORT_SHA256, "canonical cohort")
    verify_hash(MAPPED_POSITIVE_FILTER, MAPPED_POSITIVE_FILTER_SHA256, "mapped-positive filter")
    embeddings, relation, node_ids, packed_mask, _metadata, runtime_hashes = load_and_verify_runtime(spec)
    node_to_local = {int(node): index for index, node in enumerate(node_ids.tolist())}
    cohort = read_csv(COHORT)
    cohort_verification = verify_cohort(cohort, node_to_local, packed_mask)
    partner_sets, filter_verification = ddinter_partner_sets(node_to_local)
    verification = {
        "model_identity": {
            "label": spec["model_label"], "graph": spec["graph"],
            "seed": int(spec["seed"]), "best_epoch": int(spec["best_epoch"]),
        },
        "cohort": cohort_verification,
        "mapped_positive_filter_universe": filter_verification,
        "input_hashes_sha256": {
            "cohort": COHORT_SHA256,
            "mapped_positive_filter": MAPPED_POSITIVE_FILTER_SHA256,
            **runtime_hashes,
        },
    }
    print(json.dumps(verification, indent=2))
    if args.verify_inputs_only:
        return
    if output.exists():
        raise FileExistsError(f"Output path already exists; refusing overwrite: {output}")
    output.mkdir(parents=True)

    result_rows = evaluate(
        cohort, embeddings, relation, node_ids, packed_mask, partner_sets, node_to_local
    )
    output_verification = validate_results(cohort, result_rows)
    ranks = np.array([int(row["rank"]) for row in result_rows], dtype=np.int32)
    overall = metrics(ranks)
    severity_rows: list[dict[str, object]] = []
    for severity in SEVERITIES:
        indices = [i for i, row in enumerate(result_rows) if row["severity"] == severity]
        severity_ranks = ranks[np.array(indices, dtype=np.int64)]
        severity_rows.append({
            "severity": severity,
            "pair_count": sum(row["severity"] == severity for row in cohort),
            "directional_query_count": len(indices),
            **metrics(severity_ranks),
        })
    known_indices = [i for i, row in enumerate(result_rows) if row["severity"] != "Unknown"]
    sensitivity = {
        "subset": "Known severity: Major + Moderate + Minor",
        "severity_is_not_a_class_label": True,
        "pair_count": sum(row["severity"] != "Unknown" for row in cohort),
        "directional_query_count": len(known_indices),
        **metrics(ranks[np.array(known_indices, dtype=np.int64)]),
    }
    tie_counts = np.array([int(row["target_tie_count"]) for row in result_rows], dtype=np.int32)
    unique_counts = np.array([int(row["unique_available_scores"]) for row in result_rows], dtype=np.int32)
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
        "experiment": f"{spec['model_label']} DDInter external-ranking reproduction",
        "interpretation_scope": "Evaluator reproduction only; raw ranking metrics are not clinical validation.",
        "model": {
            "label": spec["model_label"], "graph": spec["graph"],
            "seed": int(spec["seed"]), "best_epoch": int(spec["best_epoch"]),
            "candidate_count": CANDIDATE_COUNT,
            "decoder": "DistMult-style raw ranking score; not a probability",
        },
        "input_hashes_sha256": verification["input_hashes_sha256"],
        "input_verification": cohort_verification,
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
    outputs = {
        "per_query": output / f"{prefix}_per_query.csv",
        "overall": output / f"{prefix}_overall_metrics.json",
        "severity": output / f"{prefix}_severity_metrics.csv",
        "sensitivity": output / f"{prefix}_sensitivity_metrics.json",
        "ties": output / f"{prefix}_tie_diagnostics.json",
    }
    write_csv(outputs["per_query"], per_query_fields, result_rows)
    write_csv(outputs["severity"], severity_fields, severity_rows)
    outputs["overall"].write_text(json.dumps(overall_document, indent=2) + "\n", encoding="utf-8")
    outputs["sensitivity"].write_text(json.dumps(sensitivity, indent=2) + "\n", encoding="utf-8")
    outputs["ties"].write_text(json.dumps(tie_diagnostics, indent=2) + "\n", encoding="utf-8")

    evaluator_path = Path(__file__).resolve()
    output_hashes = {name: sha256(path) for name, path in outputs.items()}
    reproduction_manifest = {
        "schema_version": 1,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "purpose": "Generic-evaluator G3 reproduction; not a new scientific result.",
        "evaluator": {"path": str(evaluator_path.relative_to(PROJECT)), "sha256": sha256(evaluator_path)},
        "model_spec": {"path": str(spec_path.relative_to(PROJECT)), "sha256": sha256(spec_path)},
        "model_identity": verification["model_identity"],
        "input_hashes_sha256": verification["input_hashes_sha256"],
        "protocol": {
            "score": "query_embedding @ (candidate_embeddings * ddi_relation).T",
            "rank": "1 + count(available candidate score > target score)",
            "both_pair_directions": True,
            "query_self_filtered": True,
            "primekg_known_positive_partners_filtered": True,
            "mapped_ddinter_positive_partners_filtered": True,
            "current_target_restored": True,
            "threshold_or_calibration": False,
        },
        "pair_count": len(cohort),
        "directional_query_count": len(result_rows),
        "metrics": overall,
        "outputs_sha256": output_hashes,
    }
    manifest_path = output / f"{prefix}_reproduction_manifest.json"
    manifest_path.write_text(json.dumps(reproduction_manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(overall_document, indent=2))
    print(f"Reproduction manifest: {manifest_path}")


if __name__ == "__main__":
    main()
