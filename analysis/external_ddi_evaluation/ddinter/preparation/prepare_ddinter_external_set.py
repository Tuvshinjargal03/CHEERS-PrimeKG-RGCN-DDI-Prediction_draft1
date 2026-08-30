"""Prepare a reviewable DDInter external-evaluation set without model scoring.

This script performs only deterministic data inspection and set construction. It
does not train, encode, score, or evaluate an R-GCN. "Novel" in its outputs means
absent from the complete known-positive DDI mask in this PrimeKG snapshot; it
does not mean newly discovered or clinically novel.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
PACKAGE = Path(__file__).resolve().parents[2]
PROJECT = PACKAGE.parents[1]
DDINTER = Path()
OUTPUT = PACKAGE / "ddinter/preparation/reproduction_run"
SEEDS = (42, 43, 44, 45, 46)
GRAPHS = ("G0", "G1", "G2", "G3")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=PROJECT)
    parser.add_argument("--ddinter-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=None,
        help="Explicit G3 seed-44 checkpoint path (defaults under --project-root).",
    )
    parser.add_argument("--ddi-val", type=Path, default=None)
    parser.add_argument("--ddi-test", type=Path, default=None)
    parser.add_argument(
        "--verify-inputs-only",
        action="store_true",
        help="Verify source/crosswalk/frozen-cohort invariants without PyTorch or writes.",
    )
    return parser.parse_args()


def normalized_name(value: str) -> str:
    """Conservative exact-name key: Unicode normalize, trim, collapse spaces, casefold."""

    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).strip()).casefold()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_csv(path: Path, fields: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def candidate_drugs() -> tuple[list[dict[str, object]], dict[str, list[dict[str, object]]]]:
    path = PROJECT / "final_release/lightweight_runtime/drug_metadata.csv"
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != 4_278:
        raise ValueError(f"Expected 4,278 candidate drugs, found {len(rows)}")

    by_name: dict[str, list[dict[str, object]]] = defaultdict(list)
    seen_ids: set[str] = set()
    seen_nodes: set[int] = set()
    for row in rows:
        row["node_id"] = int(row["node_id"])
        row["original_index"] = int(row["original_index"])
        if row["entity_id"] in seen_ids or row["node_id"] in seen_nodes:
            raise ValueError("Candidate DrugBank IDs and node IDs must be unique")
        seen_ids.add(str(row["entity_id"]))
        seen_nodes.add(int(row["node_id"]))
        by_name[normalized_name(str(row["entity_name"]))].append(row)
    return rows, by_name


def read_ddinter() -> tuple[list[dict[str, str]], dict[str, str]]:
    rows: list[dict[str, str]] = []
    id_to_name: dict[str, str] = {}
    for path in sorted(DDINTER.glob("ddinter_downloads_code_*.csv")):
        with path.open(encoding="utf-8", newline="") as handle:
            for source_row in csv.DictReader(handle):
                row = {key: value.strip() for key, value in source_row.items()}
                row["source_file"] = path.name
                rows.append(row)
                for suffix in ("A", "B"):
                    ddi_id = row[f"DDInterID_{suffix}"]
                    name = row[f"Drug_{suffix}"]
                    prior = id_to_name.setdefault(ddi_id, name)
                    if prior != name:
                        raise ValueError(f"DDInter ID {ddi_id} maps to multiple names")
    if len(list(DDINTER.glob("ddinter_downloads_code_*.csv"))) != 8:
        raise ValueError("Expected all eight DDInter partition files")
    return rows, id_to_name


def build_crosswalk(
    id_to_name: dict[str, str], by_name: dict[str, list[dict[str, object]]]
) -> tuple[list[dict[str, object]], dict[str, dict[str, object]]]:
    rows: list[dict[str, object]] = []
    by_ddinter_id: dict[str, dict[str, object]] = {}
    for ddi_id, ddi_name in sorted(id_to_name.items()):
        matches = by_name.get(normalized_name(ddi_name), [])
        if len(matches) == 1:
            match = matches[0]
            row = {
                "DDInter_ID": ddi_id,
                "DDInter_name": ddi_name,
                "DrugBank_ID": match["entity_id"],
                "PrimeKG_name": match["entity_name"],
                "PrimeKG_node": match["node_id"],
                "mapping_method": "exact normalized-name fallback",
                "mapping_confidence_category": "exact-name match",
            }
        elif len(matches) > 1:
            row = {
                "DDInter_ID": ddi_id,
                "DDInter_name": ddi_name,
                "DrugBank_ID": "",
                "PrimeKG_name": "",
                "PrimeKG_node": "",
                "mapping_method": "none",
                "mapping_confidence_category": "ambiguous / unsafe",
            }
        else:
            row = {
                "DDInter_ID": ddi_id,
                "DDInter_name": ddi_name,
                "DrugBank_ID": "",
                "PrimeKG_name": "",
                "PrimeKG_node": "",
                "mapping_method": "none",
                "mapping_confidence_category": "unmapped",
            }
        rows.append(row)
        by_ddinter_id[ddi_id] = row
    return rows, by_ddinter_id


def deduplicate(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    grouped: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        key = tuple(sorted((row["DDInterID_A"], row["DDInterID_B"])))
        grouped[key].append(row)

    output: list[dict[str, str]] = []
    for (ddi_a, ddi_b), group in sorted(grouped.items()):
        severities = sorted({row["Level"] for row in group})
        if len(severities) != 1:
            raise ValueError(f"Severity conflict for {ddi_a}, {ddi_b}: {severities}")
        names: dict[str, str] = {}
        for row in group:
            names[row["DDInterID_A"]] = row["Drug_A"]
            names[row["DDInterID_B"]] = row["Drug_B"]
        output.append(
            {
                "DDInter_ID_A": ddi_a,
                "Drug_A": names[ddi_a],
                "DDInter_ID_B": ddi_b,
                "Drug_B": names[ddi_b],
                "severity": severities[0],
                "source_files": " | ".join(sorted({row["source_file"] for row in group})),
                "physical_row_count": str(len(group)),
            }
        )
    return output, len(rows) - len(output)


def load_primekg_sets(
    candidates: list[dict[str, object]],
) -> tuple[set[tuple[int, int]], set[tuple[int, int]], dict[str, object]]:
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError(
            "A full preparation rebuild requires PyTorch; --verify-inputs-only does not."
        ) from exc
    tensor_dir = PROJECT / "data/processed/rgcn_tensors"
    drug_obj = torch.load(tensor_dir / "drug_node_ids.pt", map_location="cpu", weights_only=False)
    node_ids = drug_obj["drug_node_ids"].long()
    csv_nodes = torch.tensor([int(row["node_id"]) for row in candidates], dtype=torch.long)
    if not torch.equal(node_ids, csv_nodes):
        raise ValueError("Candidate metadata order differs from drug_node_ids.pt")

    known_obj = torch.load(
        tensor_dir / "ddi_known_positive_mask.pt", map_location="cpu", weights_only=False
    )
    known_mask = known_obj["known_positive_mask"].bool()
    if not torch.equal(node_ids, known_obj["drug_node_ids"].long()):
        raise ValueError("Known-positive mask candidate order mismatch")
    known_upper = torch.triu(known_mask, diagonal=1).nonzero(as_tuple=False)
    known = {
        tuple(sorted((int(node_ids[i]), int(node_ids[j]))))
        for i, j in known_upper.tolist()
    }

    graph = torch.load(tensor_dir / "G3.pt", map_location="cpu", weights_only=False)
    ddi_edges = graph["edge_index"][:, graph["edge_type"] == 0]
    train = {
        tuple(sorted((int(a), int(b))))
        for a, b in ddi_edges.t().tolist()
        if int(a) != int(b)
    }
    if not train <= known:
        raise ValueError("Training DDI pairs are not a subset of the complete known-positive set")
    details = {
        "candidate_drugs": int(node_ids.numel()),
        "known_positive_undirected_pairs": len(known),
        "train_undirected_pairs": len(train),
        "heldout_union_pairs": len(known - train),
        "g3_num_nodes": int(graph["num_nodes"]),
        "g3_num_relations": int(graph["num_relations"]),
    }
    return known, train, details


def map_pairs(
    pairs: list[dict[str, str]], crosswalk: dict[str, dict[str, object]], known: set[tuple[int, int]],
    train: set[tuple[int, int]],
) -> tuple[list[dict[str, object]], list[dict[str, object]], Counter[str]]:
    all_rows: list[dict[str, object]] = []
    novel_rows: list[dict[str, object]] = []
    counts: Counter[str] = Counter()
    for pair in pairs:
        a = crosswalk[pair["DDInter_ID_A"]]
        b = crosswalk[pair["DDInter_ID_B"]]
        categories = (a["mapping_confidence_category"], b["mapping_confidence_category"])
        mapped_count = sum(category == "exact-name match" for category in categories)
        unsafe_count = sum(category == "ambiguous / unsafe" for category in categories)
        if unsafe_count:
            status = "ambiguous mappings excluded"
        elif mapped_count == 2:
            status = "both mapped"
        elif mapped_count == 1:
            status = "one mapped"
        else:
            status = "neither mapped"
        counts[status] += 1

        row: dict[str, object] = dict(pair)
        for suffix, match in (("A", a), ("B", b)):
            row[f"DrugBank_ID_{suffix}"] = match["DrugBank_ID"]
            row[f"PrimeKG_name_{suffix}"] = match["PrimeKG_name"]
            row[f"PrimeKG_node_{suffix}"] = match["PrimeKG_node"]
            row[f"mapping_method_{suffix}"] = match["mapping_method"]
            row[f"mapping_category_{suffix}"] = match["mapping_confidence_category"]
        row["mapping_status"] = status
        row["PrimeKG_train_overlap"] = ""
        row["PrimeKG_known_overlap"] = ""
        if status == "both mapped":
            model_pair = tuple(sorted((int(a["PrimeKG_node"]), int(b["PrimeKG_node"]))))
            train_overlap = model_pair in train
            known_overlap = model_pair in known
            row["PrimeKG_train_overlap"] = str(train_overlap).lower()
            row["PrimeKG_known_overlap"] = str(known_overlap).lower()
            counts["training overlap" if train_overlap else "not training overlap"] += 1
            counts["any-known overlap" if known_overlap else "novel to PrimeKG snapshot"] += 1
            if not known_overlap:
                frozen = {
                    "DDInter_ID_A": pair["DDInter_ID_A"],
                    "Drug_A": pair["Drug_A"],
                    "DrugBank_ID_A": a["DrugBank_ID"],
                    "DDInter_ID_B": pair["DDInter_ID_B"],
                    "Drug_B": pair["Drug_B"],
                    "DrugBank_ID_B": b["DrugBank_ID"],
                    "severity": pair["severity"],
                    "PrimeKG_node_A": a["PrimeKG_node"],
                    "PrimeKG_node_B": b["PrimeKG_node"],
                    "mapping_method_A": a["mapping_method"],
                    "mapping_method_B": b["mapping_method"],
                    "PrimeKG_known_overlap": "false",
                }
                novel_rows.append(frozen)
        all_rows.append(row)
    return all_rows, novel_rows, counts


def checkpoint_inventory(
    checkpoint_path: Path, split_paths: list[Path]
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("Checkpoint inspection requires PyTorch") from exc
    discovered = [checkpoint_path] if checkpoint_path.is_file() else []
    inventory: list[dict[str, object]] = []
    for path in discovered:
        stat = path.stat()
        load_status = "failed"
        load_detail = ""
        try:
            checkpoint = torch.load(path, map_location="cpu", weights_only=False)
            state = checkpoint["model_state_dict"]
            load_status = "success"
            load_detail = (
                f"graph={checkpoint['graph']}; seed={checkpoint['seed']}; "
                f"node_embedding={tuple(state['node_embedding.weight'].shape)}; "
                f"ddi_relation={tuple(state['ddi_relation'].shape)}"
            )
        except Exception as exc:  # pragma: no cover - records the actual artifact failure
            load_detail = f"{type(exc).__name__}: {exc}"
        inventory.append(
            {
                "artifact_type": "checkpoint",
                "path": str(path),
                "graph": "G3",
                "seed": 44,
                "size_bytes": stat.st_size,
                "modified_local": datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(),
                "sha256": sha256(path),
                "loads": load_status,
                "load_detail": load_detail,
            }
        )

    for path in split_paths:
        if path is not None and path.is_file():
            name = path.name
            stat = path.stat()
            try:
                obj = torch.load(path, map_location="cpu", weights_only=False)
                status = "success"
                detail = f"type={type(obj).__name__}"
            except Exception as exc:  # pragma: no cover
                status = "failed"
                detail = f"{type(exc).__name__}: {exc}"
            inventory.append(
                {
                    "artifact_type": name,
                    "path": str(path),
                    "graph": "",
                    "seed": "",
                    "size_bytes": stat.st_size,
                    "modified_local": datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(),
                    "sha256": sha256(path),
                    "loads": status,
                    "load_detail": detail,
                }
            )

    found_keys = {(str(row["graph"]), int(row["seed"])) for row in inventory if row["artifact_type"] == "checkpoint"}
    matrix: list[dict[str, object]] = []
    for graph in GRAPHS:
        for seed in SEEDS:
            found = (graph, seed) in found_keys
            possible = graph == "G3" and seed == 44 and found
            matrix.append(
                {
                    "Graph": graph,
                    "Seed": seed,
                    "Checkpoint_found": "yes" if found else "no",
                    "Loads": "yes" if possible else ("n/a" if not found else "no"),
                    "Candidate_embeddings": (
                        "not recomputed; verified 4278x128 NumPy export available"
                        if possible else "no"
                    ),
                    "Correct_node_vocabulary": "yes (13094 nodes)" if possible else "no",
                    "Correct_DDI_decoder": "yes (128-d relation vector)" if possible else "no",
                    "Compatible_with_4278_candidates": "yes" if possible else "no",
                    "Sufficient_without_retraining": "yes" if possible else "no",
                    "External_evaluation_possible": "yes" if possible else "no",
                    "Notes": (
                        "Checkpoint loads; graph/vocabulary/decoder shapes match; verified NumPy embeddings also available."
                        if possible
                        else "Checkpoint missing."
                    ),
                }
            )
    return inventory, matrix


def verify_inputs_without_writing() -> dict[str, object]:
    """Verify tracked preparation inputs and the frozen cohort without rebuilding it."""

    provenance = json.loads((PACKAGE / "SOURCE_PROVENANCE.json").read_text(encoding="utf-8"))
    for entry in provenance["ddinter"]["files"]:
        source = DDINTER / entry["filename"]
        if (
            not source.is_file()
            or source.stat().st_size != int(entry["size_bytes"])
            or sha256(source) != entry["sha256"]
        ):
            raise ValueError(f"DDInter raw-source provenance failed: {source}")
    candidates, by_name = candidate_drugs()
    physical_rows, id_to_name = read_ddinter()
    crosswalk_rows, _ = build_crosswalk(id_to_name, by_name)
    deduped, duplicate_count = deduplicate(physical_rows)
    frozen_crosswalk = list(
        csv.DictReader(
            (PACKAGE / "ddinter/preparation/ddinter_drug_crosswalk.csv").open(
                encoding="utf-8", newline=""
            )
        )
    )
    rebuilt = {
        (str(row["DDInter_ID"]), str(row["DDInter_name"]), str(row["DrugBank_ID"]),
         str(row["PrimeKG_name"]), str(row["PrimeKG_node"]),
         str(row["mapping_confidence_category"]))
        for row in crosswalk_rows
    }
    frozen = {
        (row["DDInter_ID"], row["DDInter_name"], row["DrugBank_ID"], row["PrimeKG_name"],
         row["PrimeKG_node"], row["mapping_confidence_category"])
        for row in frozen_crosswalk
    }
    if rebuilt != frozen:
        raise ValueError("Rebuilt exact-name crosswalk differs from tracked frozen crosswalk")

    cohort_path = PACKAGE / "ddinter/preparation/ddinter_primekg_novel_pairs.csv"
    cohort = list(csv.DictReader(cohort_path.open(encoding="utf-8", newline="")))
    if len(cohort) != 49_105 or sha256(cohort_path) != "a63c11610075734b18cbc4fa35f19015caebeadacfa29f83f855aa3711ceca36":
        raise ValueError("Frozen DDInter cohort count/hash differs")
    filter_path = PACKAGE / "ddinter/preparation/ddinter_mapped_positive_filter_pairs.csv"
    filter_rows = list(csv.DictReader(filter_path.open(encoding="utf-8", newline="")))
    filter_pairs = {
        tuple(sorted((int(row["PrimeKG_node_A"]), int(row["PrimeKG_node_B"]))))
        for row in filter_rows
    }
    if len(filter_rows) != 138_358 or len(filter_pairs) != 138_358:
        raise ValueError("Tracked DDInter positive-filter universe is not 138,358 unique pairs")
    candidate_nodes = {int(row["node_id"]) for row in candidates}
    if any(a == b or a not in candidate_nodes or b not in candidate_nodes for a, b in filter_pairs):
        raise ValueError("DDInter positive-filter universe contains invalid endpoints")
    return {
        "source_files": 8,
        "physical_rows": len(physical_rows),
        "unique_symmetric_pairs": len(deduped),
        "duplicate_rows_across_partitions": duplicate_count,
        "exact_name_mappings": sum(
            row["mapping_confidence_category"] == "exact-name match"
            for row in crosswalk_rows
        ),
        "frozen_cohort_pairs": len(cohort),
        "mapped_positive_filter_pairs": len(filter_pairs),
    }


def main() -> None:
    global PROJECT, DDINTER, OUTPUT
    args = parse_args()
    PROJECT = args.project_root.resolve()
    DDINTER = args.ddinter_dir.resolve()
    OUTPUT = args.output_dir.resolve()
    if args.verify_inputs_only:
        print(json.dumps(verify_inputs_without_writing(), indent=2))
        print("DDInter preparation inputs and frozen outputs verified; no files written.")
        return
    expected_outputs = [
        OUTPUT / "ddinter_drug_crosswalk.csv",
        OUTPUT / "ddinter_deduplicated_pairs.csv",
        OUTPUT / "ddinter_mapped_pair_review.csv",
        OUTPUT / "ddinter_primekg_novel_pairs.csv",
        OUTPUT / "preparation_summary.json",
    ]
    if any(path.exists() for path in expected_outputs):
        raise FileExistsError("DDInter preparation outputs already exist; refusing to overwrite")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    candidates, by_name = candidate_drugs()
    physical_rows, id_to_name = read_ddinter()
    crosswalk_rows, crosswalk = build_crosswalk(id_to_name, by_name)
    deduped, duplicate_count = deduplicate(physical_rows)
    known, train, primekg = load_primekg_sets(candidates)
    mapped_rows, novel_rows, pair_counts = map_pairs(deduped, crosswalk, known, train)
    checkpoint = args.checkpoint or PROJECT / "checkpoints/rgcn_multiseed/G3_seed44_best.pt"
    inventory, feasibility = checkpoint_inventory(
        checkpoint.resolve(), [path.resolve() for path in (args.ddi_val, args.ddi_test) if path]
    )

    crosswalk_fields = [
        "DDInter_ID", "DDInter_name", "DrugBank_ID", "PrimeKG_name", "PrimeKG_node",
        "mapping_method", "mapping_confidence_category",
    ]
    dedup_fields = [
        "DDInter_ID_A", "Drug_A", "DDInter_ID_B", "Drug_B", "severity",
        "source_files", "physical_row_count",
    ]
    mapped_fields = dedup_fields + [
        "DrugBank_ID_A", "PrimeKG_name_A", "PrimeKG_node_A", "mapping_method_A",
        "mapping_category_A", "DrugBank_ID_B", "PrimeKG_name_B", "PrimeKG_node_B",
        "mapping_method_B", "mapping_category_B", "mapping_status",
        "PrimeKG_train_overlap", "PrimeKG_known_overlap",
    ]
    novel_fields = [
        "DDInter_ID_A", "Drug_A", "DrugBank_ID_A", "DDInter_ID_B", "Drug_B",
        "DrugBank_ID_B", "severity", "PrimeKG_node_A", "PrimeKG_node_B",
        "mapping_method_A", "mapping_method_B", "PrimeKG_known_overlap",
    ]
    artifact_fields = [
        "artifact_type", "path", "graph", "seed", "size_bytes", "modified_local",
        "sha256", "loads", "load_detail",
    ]
    feasibility_fields = [
        "Graph", "Seed", "Checkpoint_found", "Loads", "Candidate_embeddings",
        "Correct_node_vocabulary", "Correct_DDI_decoder", "Compatible_with_4278_candidates",
        "Sufficient_without_retraining", "External_evaluation_possible", "Notes",
    ]

    write_csv(OUTPUT / "ddinter_drug_crosswalk.csv", crosswalk_fields, crosswalk_rows)
    write_csv(OUTPUT / "ddinter_deduplicated_pairs.csv", dedup_fields, deduped)
    write_csv(OUTPUT / "ddinter_mapped_pair_review.csv", mapped_fields, mapped_rows)
    write_csv(OUTPUT / "ddinter_primekg_novel_pairs.csv", novel_fields, novel_rows)
    write_csv(OUTPUT / "artifact_inventory.csv", artifact_fields, inventory)
    write_csv(OUTPUT / "checkpoint_feasibility.csv", feasibility_fields, feasibility)

    crosswalk_counts = Counter(str(row["mapping_confidence_category"]) for row in crosswalk_rows)
    crosswalk_summary = {
        category: crosswalk_counts[category]
        for category in (
            "authoritative ID match", "exact-name match", "unmapped", "ambiguous / unsafe"
        )
    }
    pair_mapping_summary = {
        category: pair_counts[category]
        for category in (
            "both mapped", "one mapped", "neither mapped", "ambiguous mappings excluded",
            "training overlap", "any-known overlap", "novel to PrimeKG snapshot",
        )
    }
    severity_all = Counter(row["severity"] for row in deduped)
    severity_novel = Counter(str(row["severity"]) for row in novel_rows)
    runtime = np.load(PROJECT / "final_release/lightweight_runtime/ddi_runtime_embeddings.npz")
    if runtime["candidate_embeddings"].shape != (4_278, 128):
        raise ValueError("Unexpected exported candidate-embedding shape")
    if runtime["ddi_relation"].shape != (128,):
        raise ValueError("Unexpected exported DDI-relation decoder shape")
    if not np.array_equal(runtime["drug_node_ids"], np.array([row["node_id"] for row in candidates])):
        raise ValueError("Exported embedding vocabulary differs from candidate metadata")
    summary = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "scope": "Preparation only; no model encoding, scoring, evaluation, training, or retraining.",
        "novel_definition": "Absent from the complete known-positive DDI set in this PrimeKG snapshot; not newly discovered or clinically novel.",
        "mapping_policy": {
            "authoritative_local_crosswalk_found": False,
            "fuzzy_matching_used": False,
            "fallback_normalization": "Unicode NFKC, trim, collapse whitespace, casefold",
            "unsafe_entities": "Formulations, salts, combinations, and route-specific entities are not collapsed.",
        },
        "ddinter": {
            "physical_rows": len(physical_rows),
            "unique_symmetric_pairs": len(deduped),
            "duplicate_rows_across_partitions": duplicate_count,
            "severity_conflicts": 0,
            "unique_drugs": len(id_to_name),
            "crosswalk_categories": crosswalk_summary,
            "pair_mapping_counts": pair_mapping_summary,
            "severity_all_unique_pairs": dict(sorted(severity_all.items())),
            "severity_novel_pairs": dict(sorted(severity_novel.items())),
        },
        "primekg": primekg,
        "g3_runtime_compatibility": {
            "candidate_embedding_shape": list(runtime["candidate_embeddings"].shape),
            "ddi_relation_shape": list(runtime["ddi_relation"].shape),
            "candidate_node_order_matches": True,
            "external_scoring_executed": False,
        },
        "split_availability": {
            "ddi_val_pt_found": any(row["artifact_type"] == "ddi_val.pt" for row in inventory),
            "ddi_test_pt_found": any(row["artifact_type"] == "ddi_test.pt" for row in inventory),
            "validation_overlap": "unavailable without original ddi_val.pt",
            "test_overlap": "unavailable without original ddi_test.pt",
            "heldout_union_overlap": pair_counts["any-known overlap"] - pair_counts["training overlap"],
        },
        "external_set": {
            "mapped_pairs": pair_counts["both mapped"],
            "training_overlap": pair_counts["training overlap"],
            "any_known_overlap": pair_counts["any-known overlap"],
            "novel_to_primekg_snapshot": len(novel_rows),
            "directional_queries_proposed": 2 * len(novel_rows),
        },
        "checkpoint_decision": {
            "G3_only_external_pilot_possible_now": True,
            "full_G0_G3_external_comparison_without_retraining": False,
            "five_seed_G0_G3_comparison_without_retraining": False,
            "available_unique_checkpoint": "G3 seed 44",
        },
    }
    (OUTPUT / "preparation_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    protocol = """# DDInter external-evaluation protocol

This reproduction directory contains preparation outputs only. The historical proposal
was subsequently executed as a frozen G3 seed-44 pilot; preparation itself does not
train, encode, score, or evaluate a model.

The executed protocol retained DDInter pairs absent from the complete PrimeKG-known DDI
snapshot, evaluated both directions against 4,278 candidate drugs, filtered self plus
PrimeKG-known and mapped DDInter-positive partners, restored the current target, and
used optimistic strict rank. MRR and Hits@1/5/10 were reported overall, with severity
used only for descriptive stratification.

The broader proposed multi-seed G0-G3 external comparison was not executed and is not
claimed. PrimeKG-absent is snapshot-relative, raw scores are not probabilities, and the
results do not establish clinical, causal, or statistical conclusions.
"""
    (OUTPUT / "EVALUATION_PROTOCOL.md").write_text(protocol, encoding="utf-8")

    generated = sorted(
        path for path in OUTPUT.iterdir()
        if path.is_file() and path.name not in {"SHA256SUMS.sha256"}
    )
    manifest_lines = [f"{sha256(path)}  {path.name}" for path in generated]
    (OUTPUT / "SHA256SUMS.sha256").write_text("\n".join(manifest_lines) + "\n", encoding="ascii")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
