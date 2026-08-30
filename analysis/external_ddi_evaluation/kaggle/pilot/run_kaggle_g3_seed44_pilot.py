"""Run the G3 seed-44 Kaggle/DrugBank-derived source-consistency pilot.

The script rebuilds the cohort from db_drug_interactions.csv, applies only
conservative exact normalized-name mapping, removes every pair present in the
complete PrimeKG known-positive snapshot, and evaluates both directions with
the verified G3 seed-44 NumPy runtime. It performs no training or graph encoding.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch


PROJECT = Path(r"D:\PNU\graduation\real\CHEERS_PrimeKG_RGCN_Final_App")
KAGGLE_SOURCE = Path(
    r"D:\PNU\graduation\all\datasets\ddi\kaggle\db_drug_interactions.csv"
)
OUTPUT = PROJECT / "analysis/kaggle_external_evaluation_pilot"
RUNTIME = PROJECT / "final_release/lightweight_runtime"
EMBEDDINGS = RUNTIME / "ddi_runtime_embeddings.npz"
KNOWN_MASK = RUNTIME / "known_positive_mask_packed.npz"
METADATA = RUNTIME / "drug_metadata.csv"
RUNTIME_MANIFEST = RUNTIME / "LIGHTWEIGHT_RUNTIME_MANIFEST.json"
CHECKPOINT = PROJECT / "checkpoints/rgcn_multiseed/G3_seed44_best.pt"
G3_GRAPH = PROJECT / "data/processed/rgcn_tensors/G3.pt"
DDINTER_RESULT = (
    PROJECT
    / "analysis/ddinter_external_evaluation_pilot/ddinter_g3_seed44_overall_metrics.json"
)

EXPECTED_HASHES = {
    "kaggle_source": "95d8399aa9c7479001f90400fbd91c6260cbfe517b22d5153a2b031f39b11328",
    "embeddings": "1bde47026e0d6fcfbb2de772b62280bd67df1fc7a3404672bfcdfc2b603de442",
    "known_mask": "c87cc2e0ab2eac70c2aa98fc995853bf5c6e97ef0ef7881568b550d924120d37",
    "metadata": "8020ae748baa567d08487c148ba851763fcac54601c183dd6803b587974d857b",
    "checkpoint": "d4df7c845fe65b175afdfdc8512fe466451029c682a2a34f9d52a84b35811d50",
    "g3_graph": "ee77876d767ac5d92e9657f3dd7c582e02598c2736feb124a3dfbe7d67ead5d3",
    "ddinter_result": "ee51e20a2805c0af0e66972fa4eac79c45fa18a2f5e62e71e030e2f1e9c75a7c",
}
CANDIDATE_COUNT = 4_278
INTERNAL_METRICS = {
    "MRR": 0.534209,
    "Hits@1": 0.486290,
    "Hits@5": 0.580468,
    "Hits@10": 0.618074,
}


def normalized_name(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).strip()).casefold()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def verify_hashes() -> dict[str, str]:
    paths = {
        "kaggle_source": KAGGLE_SOURCE,
        "embeddings": EMBEDDINGS,
        "known_mask": KNOWN_MASK,
        "metadata": METADATA,
        "checkpoint": CHECKPOINT,
        "g3_graph": G3_GRAPH,
        "ddinter_result": DDINTER_RESULT,
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


def load_runtime() -> tuple[
    np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[dict[str, str]]
]:
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
        raise ValueError("Known-positive mask shape is invalid")
    if num_drugs != CANDIDATE_COUNT or len(metadata) != CANDIDATE_COUNT:
        raise ValueError("Runtime candidate counts differ")
    metadata_nodes = np.array([int(row["node_id"]) for row in metadata], dtype=node_ids.dtype)
    if not np.array_equal(metadata_nodes, node_ids):
        raise ValueError("Metadata and embedding candidate order differ")
    known_matrix = np.unpackbits(
        packed_mask, axis=1, count=CANDIDATE_COUNT, bitorder="big"
    ).astype(bool, copy=False)
    if not np.array_equal(known_matrix, known_matrix.T):
        raise ValueError("Complete known-positive mask is not symmetric")
    return embeddings, relation, node_ids, known_matrix, metadata


def load_training_mask(node_ids: np.ndarray) -> np.ndarray:
    graph = torch.load(G3_GRAPH, map_location="cpu", weights_only=False)
    if int(graph["num_nodes"]) != 13_094 or int(graph["num_relations"]) != 15:
        raise ValueError("Unexpected G3 graph dimensions")
    ddi_edges = graph["edge_index"][:, graph["edge_type"] == 0].numpy()
    source_local = np.searchsorted(node_ids, ddi_edges[0])
    target_local = np.searchsorted(node_ids, ddi_edges[1])
    if not np.array_equal(node_ids[source_local], ddi_edges[0]):
        raise ValueError("Training source endpoint outside candidate vocabulary")
    if not np.array_equal(node_ids[target_local], ddi_edges[1]):
        raise ValueError("Training target endpoint outside candidate vocabulary")
    train = np.zeros((CANDIDATE_COUNT, CANDIDATE_COUNT), dtype=bool)
    train[source_local, target_local] = True
    if not np.array_equal(train, train.T):
        raise ValueError("Training DDI mask is not symmetric")
    if int(np.triu(train, 1).sum()) != 1_069_080:
        raise ValueError("Unexpected PrimeKG training-pair count")
    return train


def candidate_name_index(metadata: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    index: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in metadata:
        index[normalized_name(row["entity_name"])].append(row)
    return index


def rebuild_cohort(
    metadata: list[dict[str, str]], node_to_local: dict[int, int],
    known: np.ndarray, train: np.ndarray,
) -> tuple[list[dict[str, object]], dict[int, set[int]], dict[str, object]]:
    raw_rows = read_csv(KAGGLE_SOURCE)
    required = {"Drug 1", "Drug 2", "Interaction Description"}
    if not raw_rows or not required.issubset(raw_rows[0]):
        raise ValueError("Kaggle source schema is invalid")
    names: dict[str, str] = {}
    grouped: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in raw_rows:
        key_a = normalized_name(row["Drug 1"])
        key_b = normalized_name(row["Drug 2"])
        names.setdefault(key_a, row["Drug 1"].strip())
        names.setdefault(key_b, row["Drug 2"].strip())
        grouped[tuple(sorted((key_a, key_b)))].append(row)

    candidate_by_name = candidate_name_index(metadata)
    mapping: dict[str, dict[str, str] | None] = {}
    category_counts: Counter[str] = Counter()
    for key in sorted(names):
        matches = candidate_by_name.get(key, [])
        if len(matches) == 1:
            mapping[key] = matches[0]
            category_counts["exact-name match"] += 1
        elif len(matches) > 1:
            mapping[key] = None
            category_counts["ambiguous / unsafe"] += 1
        else:
            mapping[key] = None
            category_counts["unmapped"] += 1

    mapped_pairs: set[tuple[int, int]] = set()
    pair_status: Counter[str] = Counter()
    pair_records: list[dict[str, object]] = []
    self_pairs = 0
    for (key_a, key_b), rows in sorted(grouped.items()):
        if key_a == key_b:
            self_pairs += 1
            continue
        match_a = mapping[key_a]
        match_b = mapping[key_b]
        mapped_count = int(match_a is not None) + int(match_b is not None)
        status = ("both mapped" if mapped_count == 2 else "one mapped" if mapped_count == 1 else "neither mapped")
        pair_status[status] += 1
        if match_a is None or match_b is None:
            continue
        local_a = node_to_local[int(match_a["node_id"])]
        local_b = node_to_local[int(match_b["node_id"])]
        if local_a == local_b:
            raise ValueError("Mapped self-pair created by the exact-name crosswalk")
        local_pair = tuple(sorted((local_a, local_b)))
        if local_pair in mapped_pairs:
            raise ValueError("Multiple Kaggle name pairs collapsed to one model pair")
        mapped_pairs.add(local_pair)
        pair_records.append(
            {
                "Drug_A": names[key_a],
                "DrugBank_ID_A": match_a["entity_id"],
                "PrimeKG_node_A": int(match_a["node_id"]),
                "Drug_B": names[key_b],
                "DrugBank_ID_B": match_b["entity_id"],
                "PrimeKG_node_B": int(match_b["node_id"]),
                "mapping_method_A": "exact normalized-name",
                "mapping_method_B": "exact normalized-name",
                "source_row_count": len(rows),
                "unique_description_count": len({row["Interaction Description"] for row in rows}),
                "PrimeKG_train_overlap": bool(train[local_a, local_b]),
                "PrimeKG_known_overlap": bool(known[local_a, local_b]),
                "local_A": local_a,
                "local_B": local_b,
            }
        )

    if len(grouped) != 191_135:
        raise ValueError(f"Unexpected unique Kaggle pair count: {len(grouped)}")
    training_overlap = sum(bool(row["PrimeKG_train_overlap"]) for row in pair_records)
    known_overlap = sum(bool(row["PrimeKG_known_overlap"]) for row in pair_records)
    cohort = [row for row in pair_records if not bool(row["PrimeKG_known_overlap"])]
    partners: dict[int, set[int]] = defaultdict(set)
    for local_a, local_b in mapped_pairs:
        partners[local_a].add(local_b)
        partners[local_b].add(local_a)
    summary = {
        "physical_rows": len(raw_rows),
        "unique_symmetric_pairs": len(grouped),
        "duplicate_rows_beyond_unique_pairs": len(raw_rows) - len(grouped),
        "unique_drugs": len(names),
        "drug_mapping_categories": {
            "exact-name match": category_counts["exact-name match"],
            "unmapped": category_counts["unmapped"],
            "ambiguous / unsafe": category_counts["ambiguous / unsafe"],
        },
        "pair_mapping_categories": {
            "both mapped": pair_status["both mapped"],
            "one mapped": pair_status["one mapped"],
            "neither mapped": pair_status["neither mapped"],
        },
        "mapped_model_pairs": len(mapped_pairs),
        "self_pairs_excluded": self_pairs,
        "training_overlap": training_overlap,
        "complete_known_positive_overlap": known_overlap,
        "absent_from_complete_primekg_snapshot": len(cohort),
    }
    return cohort, partners, summary


def lower_median(values: np.ndarray) -> int:
    index = (values.size - 1) // 2
    return int(np.partition(values, index)[index])


def calculate_metrics(ranks: np.ndarray) -> dict[str, int | float]:
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


def evaluate(
    cohort: list[dict[str, object]], partners: dict[int, set[int]],
    embeddings: np.ndarray, relation: np.ndarray, node_ids: np.ndarray,
    known: np.ndarray,
) -> list[dict[str, object]]:
    tasks: dict[int, list[tuple[dict[str, object], str, int]]] = defaultdict(list)
    for row in cohort:
        local_a = int(row["local_A"])
        local_b = int(row["local_B"])
        tasks[local_a].append((row, "A_to_B", local_b))
        tasks[local_b].append((row, "B_to_A", local_a))
    weighted_candidates = embeddings * relation
    output: list[dict[str, object]] = []
    for query_number, (query_local, query_tasks) in enumerate(sorted(tasks.items()), start=1):
        scores = embeddings[query_local] @ weighted_candidates.T
        if scores.shape != (CANDIDATE_COUNT,) or not np.isfinite(scores).all():
            raise ValueError("Invalid candidate score vector")
        base_filter = known[query_local].copy()
        base_filter[query_local] = True
        kaggle_partners = partners.get(query_local, set())
        if kaggle_partners:
            base_filter[np.fromiter(kaggle_partners, dtype=np.int64)] = True
        base_scores = scores[~base_filter]
        sorted_base = np.sort(base_scores)
        unique_scores, unique_counts = np.unique(base_scores, return_counts=True)
        tie_lookup = {
            float(score): int(count)
            for score, count in zip(unique_scores.tolist(), unique_counts.tolist())
        }
        for row, direction, target_local in query_tasks:
            if target_local not in kaggle_partners:
                raise ValueError("Target missing from Kaggle-positive filtering universe")
            if bool(known[query_local, target_local]):
                raise ValueError("Evaluated target is present in complete PrimeKG-known mask")
            target_score = np.float32(scores[target_local])
            rank = 1 + int(
                sorted_base.size - np.searchsorted(sorted_base, target_score, side="right")
            )
            tied_base = tie_lookup.get(float(target_score), 0)
            number_filtered = int(base_filter.sum()) - 1
            if rank < 1 or rank > CANDIDATE_COUNT - number_filtered:
                raise ValueError("Rank outside target-restored candidate space")
            if direction == "A_to_B":
                query_name, query_id = row["Drug_A"], row["DrugBank_ID_A"]
                target_name, target_id = row["Drug_B"], row["DrugBank_ID_B"]
            else:
                query_name, query_id = row["Drug_B"], row["DrugBank_ID_B"]
                target_name, target_id = row["Drug_A"], row["DrugBank_ID_A"]
            output.append(
                {
                    "Drug_A": row["Drug_A"],
                    "DrugBank_ID_A": row["DrugBank_ID_A"],
                    "Drug_B": row["Drug_B"],
                    "DrugBank_ID_B": row["DrugBank_ID_B"],
                    "source_row_count": row["source_row_count"],
                    "unique_description_count": row["unique_description_count"],
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
                    "target_tie_count": 1 + tied_base,
                    "tied_competitor_count": tied_base,
                    "unique_available_scores": len(tie_lookup) + (0 if tied_base else 1),
                }
            )
        if query_number % 250 == 0 or query_number == len(tasks):
            print(f"Scored {query_number:,}/{len(tasks):,} unique query drugs")
    return output


def validate_results(
    cohort: list[dict[str, object]], rows: list[dict[str, object]]
) -> dict[str, object]:
    expected = 2 * len(cohort)
    if len(rows) != expected:
        raise ValueError(f"Expected {expected:,} rows, found {len(rows):,}")
    directions: Counter[tuple[str, str, str]] = Counter()
    for row in rows:
        pair = tuple(sorted((str(row["DrugBank_ID_A"]), str(row["DrugBank_ID_B"]))))
        directions[(pair[0], pair[1], str(row["query_direction"]))] += 1
        if not 1 <= int(row["rank"]) <= CANDIDATE_COUNT:
            raise ValueError("Rank outside 1..4,278")
        if int(row["query_node"]) == int(row["target_node"]):
            raise ValueError("Self-pair escaped validation")
        if not math.isfinite(float(row["raw_target_score"])):
            raise ValueError("NaN or infinite target score")
    if len(directions) != expected or any(count != 1 for count in directions.values()):
        raise ValueError("Every original pair must appear exactly once in each direction")
    return {
        "directional_rows": len(rows),
        "every_pair_appears_once_in_each_direction": True,
        "all_ranks_within_1_and_4278": True,
        "all_targets_absent_from_complete_primekg_known_mask": True,
        "no_target_accidentally_filtered": True,
        "all_scores_finite": True,
    }


def write_csv(path: Path, fields: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    expected_outputs = [
        OUTPUT / "kaggle_g3_seed44_cohort.csv",
        OUTPUT / "kaggle_g3_seed44_per_query.csv",
        OUTPUT / "kaggle_g3_seed44_overall_metrics.json",
        OUTPUT / "kaggle_g3_seed44_tie_diagnostics.json",
        OUTPUT / "COMPARISON_NOTES.md",
        OUTPUT / "SHA256SUMS.sha256",
    ]
    if any(path.exists() for path in expected_outputs):
        raise FileExistsError("Kaggle pilot outputs already exist; refusing to overwrite")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    input_hashes = verify_hashes()
    embeddings, relation, node_ids, known, metadata = load_runtime()
    node_to_local = {int(node): index for index, node in enumerate(node_ids.tolist())}
    train = load_training_mask(node_ids)
    if not np.all(~train | known):
        raise ValueError("PrimeKG training mask is not a subset of complete known positives")
    cohort, partners, cohort_summary = rebuild_cohort(metadata, node_to_local, known, train)
    if len(cohort) == 0:
        raise ValueError("PrimeKG-absent Kaggle cohort is empty")
    runtime_manifest = json.loads(RUNTIME_MANIFEST.read_text(encoding="utf-8"))
    if (
        runtime_manifest["graph"] != "G3"
        or int(runtime_manifest["seed"]) != 44
        or int(runtime_manifest["best_epoch"]) != 499
    ):
        raise ValueError("Runtime identity differs from G3 seed 44 epoch 499")
    print(json.dumps(cohort_summary, indent=2))

    result_rows = evaluate(cohort, partners, embeddings, relation, node_ids, known)
    output_verification = validate_results(cohort, result_rows)
    ranks = np.array([int(row["rank"]) for row in result_rows], dtype=np.int32)
    pilot_metrics = calculate_metrics(ranks)
    tie_counts = np.array([int(row["target_tie_count"]) for row in result_rows], dtype=np.int32)
    unique_counts = np.array(
        [int(row["unique_available_scores"]) for row in result_rows], dtype=np.int32
    )
    tied_queries = int(np.sum(tie_counts > 1))
    tie_diagnostics = {
        "ranking_convention": "optimistic strict rank: 1 + count(filtered candidate score > target score)",
        "target_tie_count_definition": "Number of target-restored available candidates exactly equal to the target score, including the target.",
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
    ddinter_document = json.loads(DDINTER_RESULT.read_text(encoding="utf-8"))
    ddinter_metrics = ddinter_document["metrics"]
    comparison = {
        "PrimeKG_internal_G3_five_seed_mean": INTERNAL_METRICS,
        "DDInter_external_G3_seed44_pilot": {
            name: ddinter_metrics[name] for name in INTERNAL_METRICS
        },
        "Kaggle_source_consistency_G3_seed44_pilot": {
            name: pilot_metrics[name] for name in INTERNAL_METRICS
        },
    }
    overall = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "experiment": "G3 seed-44 Kaggle/DrugBank-derived source-consistency ranking pilot",
        "interpretation_scope": "Source-consistency control, not independent external validation.",
        "evaluated_set": "Kaggle/DrugBank-derived interactions absent from the PrimeKG snapshot.",
        "model": {
            "graph": "G3", "seed": 44, "best_epoch": 499,
            "candidate_count": CANDIDATE_COUNT,
            "decoder": "DistMult-style raw ranking score; not a probability",
        },
        "input_hashes_sha256": input_hashes,
        "cohort_rebuild": cohort_summary,
        "filtering": {
            "query_self": True,
            "complete_primekg_known_positive_partners": True,
            "all_other_mapped_kaggle_positive_partners": True,
            "current_target_restored": True,
        },
        "ranking_convention": "1 + number of available candidates with score strictly greater than target score",
        "pair_count": len(cohort),
        "directional_query_count": len(result_rows),
        "metrics": pilot_metrics,
        "comparison_context": comparison,
        "output_verification": output_verification,
    }

    cohort_fields = [
        "Drug_A", "DrugBank_ID_A", "PrimeKG_node_A", "Drug_B", "DrugBank_ID_B",
        "PrimeKG_node_B", "mapping_method_A", "mapping_method_B", "source_row_count",
        "unique_description_count", "PrimeKG_train_overlap", "PrimeKG_known_overlap",
    ]
    per_query_fields = [
        "Drug_A", "DrugBank_ID_A", "Drug_B", "DrugBank_ID_B", "source_row_count",
        "unique_description_count", "query_direction", "query_drug", "query_drugbank_id",
        "query_node", "target_drug", "target_drugbank_id", "target_node",
        "raw_target_score", "rank", "number_filtered",
        "available_candidates_after_filtering", "target_tie_count",
        "tied_competitor_count", "unique_available_scores",
    ]
    write_csv(OUTPUT / "kaggle_g3_seed44_cohort.csv", cohort_fields, cohort)
    write_csv(OUTPUT / "kaggle_g3_seed44_per_query.csv", per_query_fields, result_rows)
    (OUTPUT / "kaggle_g3_seed44_overall_metrics.json").write_text(
        json.dumps(overall, indent=2) + "\n", encoding="utf-8"
    )
    (OUTPUT / "kaggle_g3_seed44_tie_diagnostics.json").write_text(
        json.dumps(tie_diagnostics, indent=2) + "\n", encoding="utf-8"
    )

    notes = f"""# Kaggle/DrugBank-derived source-consistency control

This G3 seed-44 pilot evaluates **Kaggle/DrugBank-derived interactions absent from the
PrimeKG snapshot**. Kaggle is not treated as independent external validation. The source
is DrugBank-derived, while version/snapshot and preprocessing differences can still
produce pairs absent from the PrimeKG snapshot.

## Controlled protocol

The model, 4,278-drug candidate vocabulary, DistMult-style decoder, bidirectional query
construction, strict optimistic rank, and complete PrimeKG-known filtering match the
DDInter pilot. Every other mapped Kaggle-positive partner is also filtered, and the
current target is restored. Raw scores are ranking scores, not probabilities.

## Results

- PrimeKG internal G3 five-seed mean MRR: {INTERNAL_METRICS['MRR']:.6f}
- DDInter G3 seed-44 pilot MRR: {ddinter_metrics['MRR']:.6f}
- Kaggle G3 seed-44 pilot MRR: {pilot_metrics['MRR']:.6f}

The three cohorts are descriptively informative but not statistically interchangeable.
No causal, clinical, or multi-seed generalization claim is made. No training, graph
encoding, threshold tuning, or probability conversion was performed.
"""
    (OUTPUT / "COMPARISON_NOTES.md").write_text(notes, encoding="utf-8")
    generated = sorted(
        path for path in OUTPUT.iterdir()
        if path.is_file() and path.name != "SHA256SUMS.sha256"
    )
    (OUTPUT / "SHA256SUMS.sha256").write_text(
        "\n".join(f"{sha256(path)}  {path.name}" for path in generated) + "\n",
        encoding="ascii",
    )
    print(json.dumps(overall, indent=2))
    print(json.dumps(tie_diagnostics, indent=2))


if __name__ == "__main__":
    main()
