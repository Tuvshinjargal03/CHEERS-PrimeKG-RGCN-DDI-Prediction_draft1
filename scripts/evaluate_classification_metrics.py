"""Evaluate five-seed binary classification metrics for the CHEERS R-GCNs.

For each G0-G3 graph and seed 42-46, this script selects a decision threshold
using validation data only. The selected threshold maximizes validation F1 and
is then frozen before the held-out test pairs are scored. Model outputs are raw
ranking scores, not probabilities. Negative examples are fixed sampled
unobserved DDI pairs, not confirmed non-interactions.

The full evaluation requires graph tensors and checkpoints that may only be
available in the training workspace. Use ``--verify-only`` to print previously
generated result files without loading PyTorch artifacts or recomputing scores.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable, Sequence

if TYPE_CHECKING:
    import torch

    from src.rgcn_model import RGCNDDIModel


PROJECT_DIR = Path(__file__).resolve().parents[1]
GRAPHS = ("G0", "G1", "G2", "G3")
SEEDS = (42, 43, 44, 45, 46)
DEFAULT_OUTPUT_DIR = PROJECT_DIR / "results" / "classification_metrics_5seed"
TENSOR_DIR = PROJECT_DIR / "data" / "processed" / "rgcn_tensors"

PER_SEED_FILENAME = "classification_metrics_per_seed.csv"
SUMMARY_CSV_FILENAME = "classification_metrics_5seed_summary.csv"
SUMMARY_JSON_FILENAME = "classification_metrics_5seed_summary.json"
FROZEN_MANIFEST_FILENAME = "CLASSIFICATION_METRICS_5SEED_MANIFEST.sha256"

PER_SEED_FIELDS = (
    "Graph",
    "Seed",
    "Threshold",
    "Validation_F1",
    "TP",
    "FP",
    "TN",
    "FN",
    "Accuracy",
    "Precision",
    "Recall",
    "F1",
)

SUMMARY_FIELDS = (
    "Graph",
    "Accuracy_mean",
    "Accuracy_std",
    "Precision_mean",
    "Precision_std",
    "Recall_mean",
    "Recall_std",
    "F1_mean",
    "F1_std",
)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments."""

    parser = argparse.ArgumentParser(
        description=(
            "Evaluate validation-selected binary classification metrics for "
            "the existing five-seed G0-G3 R-GCN checkpoints."
        )
    )
    parser.add_argument(
        "--device",
        default=None,
        help="PyTorch device (default: cuda if available, otherwise cpu).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=(
            "Result directory (default: "
            "results/classification_metrics_5seed)."
        ),
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Print current result files without loading models or recomputing.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow the three result files to be regenerated if they exist.",
    )
    parser.add_argument(
        "--score-batch-size",
        type=int,
        default=131_072,
        help="Number of DDI pairs decoded per batch (default: 131072).",
    )
    return parser.parse_args(argv)


def resolve_output_dir(path: Path) -> Path:
    """Resolve a relative output path against the repository root."""

    return path if path.is_absolute() else PROJECT_DIR / path


def result_paths(output_dir: Path) -> tuple[Path, Path, Path]:
    """Return the three required output paths in display/write order."""

    return (
        output_dir / PER_SEED_FILENAME,
        output_dir / SUMMARY_CSV_FILENAME,
        output_dir / SUMMARY_JSON_FILENAME,
    )


def print_existing_results(output_dir: Path) -> None:
    """Print existing result files verbatim without recomputing anything."""

    paths = result_paths(output_dir)
    missing = [path for path in paths if not path.is_file()]
    if missing:
        formatted = "\n".join(f"  - {path}" for path in missing)
        raise FileNotFoundError(
            "--verify-only requires all three current result files. Missing:\n"
            f"{formatted}"
        )

    for index, path in enumerate(paths):
        if index:
            print()
        print(f"===== {path} =====")
        content = path.read_text(encoding="utf-8")
        print(content, end="")
        if not content.endswith("\n"):
            print()


def load_training_dependencies() -> None:
    """Import PyTorch and the R-GCN class only for a real evaluation run."""

    global torch, RGCNDDIModel

    import torch as torch_module

    # Keep the repository model import compatible with direct script execution.
    if str(PROJECT_DIR) not in sys.path:
        sys.path.insert(0, str(PROJECT_DIR))
    from src.rgcn_model import RGCNDDIModel as model_class

    torch = torch_module
    RGCNDDIModel = model_class


def checkpoint_path(graph: str, seed: int) -> Path:
    """Return the existing checkpoint path for one graph/seed combination."""

    if seed == 42:
        return PROJECT_DIR / "checkpoints" / "rgcn" / f"{graph}_best.pt"
    if seed in (43, 44):
        return (
            PROJECT_DIR
            / "checkpoints"
            / "rgcn_multiseed"
            / f"{graph}_seed{seed}_best.pt"
        )
    return (
        PROJECT_DIR
        / "checkpoints"
        / "rgcn_multiseed_extension_5seed"
        / f"{graph}_seed{seed}_best.pt"
    )


def required_input_paths() -> list[Path]:
    """List every graph, split, negative-pair, and checkpoint input."""

    paths = [TENSOR_DIR / f"{graph}.pt" for graph in GRAPHS]
    paths.extend(
        TENSOR_DIR / filename
        for filename in (
            "ddi_val.pt",
            "ddi_val_negatives.pt",
            "ddi_test.pt",
            "ddi_test_negatives.pt",
        )
    )
    paths.extend(
        checkpoint_path(graph, seed)
        for graph in GRAPHS
        for seed in SEEDS
    )
    return paths


def validate_inputs() -> None:
    """Fail before computation when the frozen evaluation inputs are absent."""

    missing = [path for path in required_input_paths() if not path.is_file()]
    if missing:
        formatted = "\n".join(f"  - {path}" for path in missing)
        raise FileNotFoundError(f"Required evaluation inputs are missing:\n{formatted}")


def validate_output_policy(output_dir: Path, overwrite: bool) -> None:
    """Refuse to overwrite any result unless the user supplied --overwrite."""

    frozen_manifest = output_dir / FROZEN_MANIFEST_FILENAME
    if frozen_manifest.exists():
        raise PermissionError(
            "The selected output directory contains the frozen SHA256 manifest:\n"
            f"  - {frozen_manifest}\n"
            "These frozen results must not be overwritten. Use a different "
            "--output-dir for a new reproduction run."
        )

    existing = [path for path in result_paths(output_dir) if path.exists()]
    if existing and not overwrite:
        formatted = "\n".join(f"  - {path}" for path in existing)
        raise FileExistsError(
            "Result files already exist and will not be overwritten:\n"
            f"{formatted}\nRe-run with --overwrite to regenerate all results."
        )


def resolve_device(requested: str | None) -> torch.device:
    """Choose CUDA by default when available, otherwise choose CPU."""

    name = requested or ("cuda" if torch.cuda.is_available() else "cpu")
    device = torch.device(name)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError(f"CUDA device requested but CUDA is unavailable: {name}")
    return device


def load_torch(path: Path, *, map_location: str | torch.device = "cpu") -> Any:
    """Load a trusted local PyTorch artifact across PyTorch API versions."""

    try:
        return torch.load(path, map_location=map_location, weights_only=False)
    except TypeError:
        return torch.load(path, map_location=map_location)


def extract_pair_index(obj: Any, path: Path) -> torch.Tensor:
    """Extract and validate a [2, N] pair-index tensor from a split artifact."""

    pair_index = obj.get("pair_index") if isinstance(obj, dict) else obj
    if not isinstance(pair_index, torch.Tensor):
        raise TypeError(f"{path} does not contain a tensor named pair_index")
    if pair_index.ndim != 2 or pair_index.shape[0] != 2:
        raise ValueError(
            f"{path} pair_index must have shape [2, N], got {tuple(pair_index.shape)}"
        )
    return pair_index.long().cpu()


def load_pairs(filename: str) -> torch.Tensor:
    """Load one fixed positive or sampled-unobserved DDI pair set."""

    path = TENSOR_DIR / filename
    return extract_pair_index(load_torch(path), path)


def instantiate_model(
    graph_data: dict[str, Any], checkpoint: dict[str, Any], device: torch.device
) -> RGCNDDIModel:
    """Instantiate the repository model using frozen graph/checkpoint metadata."""

    config = checkpoint.get("config", {})
    num_nodes = int(graph_data["num_nodes"])
    num_relations = int(graph_data["num_relations"])

    if "num_nodes" in config and int(config["num_nodes"]) != num_nodes:
        raise ValueError("Checkpoint num_nodes does not match the graph tensor")
    if "num_relations" in config and int(config["num_relations"]) != num_relations:
        raise ValueError("Checkpoint num_relations does not match the graph tensor")

    return RGCNDDIModel(
        num_nodes=num_nodes,
        num_relations=num_relations,
        embedding_dim=int(config.get("embedding_dim", 128)),
        hidden_dim=int(config.get("hidden_dim", 128)),
        dropout=float(config.get("dropout", 0.2)),
    ).to(device)


def score_pairs(
    model: RGCNDDIModel,
    embeddings: torch.Tensor,
    pair_index: torch.Tensor,
    device: torch.device,
    batch_size: int,
) -> torch.Tensor:
    """Decode raw model scores for pairs in bounded batches on the device."""

    scores: list[torch.Tensor] = []
    for start in range(0, pair_index.shape[1], batch_size):
        pairs = pair_index[:, start : start + batch_size].to(device)
        scores.append(model.decode(embeddings, pairs).detach().cpu())
    result = torch.cat(scores)
    if not bool(torch.isfinite(result).all()):
        raise ValueError("Model produced non-finite raw scores")
    return result


def select_f1_threshold(
    positive_scores: torch.Tensor, negative_scores: torch.Tensor
) -> tuple[float, float]:
    """Select a threshold using validation data only.

    Scores are sorted in descending order. F1 is evaluated only after the last
    item in each equal-score group so that every candidate corresponds exactly
    to the prediction rule ``score >= threshold``. ``torch.argmax`` selects the
    highest threshold if multiple candidates have the same maximum F1. No test
    score or test label is accepted by this function.
    """

    scores = torch.cat((positive_scores.float(), negative_scores.float()))
    labels = torch.cat(
        (
            torch.ones(positive_scores.numel(), dtype=torch.int64),
            torch.zeros(negative_scores.numel(), dtype=torch.int64),
        )
    )
    order = torch.argsort(scores, descending=True, stable=True)
    sorted_scores = scores[order]
    sorted_labels = labels[order]

    true_positives = torch.cumsum(sorted_labels, dim=0)
    predicted_positives = torch.arange(1, scores.numel() + 1, dtype=torch.int64)
    false_positives = predicted_positives - true_positives
    false_negatives = positive_scores.numel() - true_positives

    denominator = 2 * true_positives + false_positives + false_negatives
    f1 = (2 * true_positives).double() / denominator.double()

    group_ends = torch.ones(scores.numel(), dtype=torch.bool)
    group_ends[:-1] = sorted_scores[:-1] != sorted_scores[1:]
    candidate_indices = torch.nonzero(group_ends, as_tuple=False).flatten()
    best_candidate = torch.argmax(f1[candidate_indices])
    best_index = int(candidate_indices[best_candidate])

    return float(sorted_scores[best_index]), float(f1[best_index])


def classification_metrics(
    positive_scores: torch.Tensor,
    negative_scores: torch.Tensor,
    threshold: float,
) -> dict[str, int | float]:
    """Compute the held-out test confusion matrix and derived metrics."""

    positive_predictions = positive_scores >= threshold
    negative_predictions = negative_scores >= threshold

    tp = int(positive_predictions.sum())
    fn = int(positive_predictions.numel() - tp)
    fp = int(negative_predictions.sum())
    tn = int(negative_predictions.numel() - fp)

    total = tp + fp + tn + fn
    accuracy = (tp + tn) / total if total else 0.0
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    return {
        "TP": tp,
        "FP": fp,
        "TN": tn,
        "FN": fn,
        "Accuracy": accuracy,
        "Precision": precision,
        "Recall": recall,
        "F1": f1,
    }


def evaluate_one(
    graph: str,
    seed: int,
    graph_data: dict[str, Any],
    edge_index: torch.Tensor,
    edge_type: torch.Tensor,
    validation_positive_pairs: torch.Tensor,
    validation_negative_pairs: torch.Tensor,
    test_positive_pairs: torch.Tensor,
    test_negative_pairs: torch.Tensor,
    device: torch.device,
    score_batch_size: int,
) -> dict[str, int | float | str]:
    """Evaluate one checkpoint with a validation-selected frozen threshold."""

    path = checkpoint_path(graph, seed)
    checkpoint = load_torch(path)
    if not isinstance(checkpoint, dict) or "model_state_dict" not in checkpoint:
        raise TypeError(f"Checkpoint has no model_state_dict: {path}")
    if "graph" in checkpoint and checkpoint["graph"] != graph:
        raise ValueError(f"Checkpoint graph mismatch: {path}")
    if "seed" in checkpoint and int(checkpoint["seed"]) != seed:
        raise ValueError(f"Checkpoint seed mismatch: {path}")

    model = instantiate_model(graph_data, checkpoint, device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    with torch.no_grad():
        embeddings = model.encode(edge_index, edge_type)
        validation_positive_scores = score_pairs(
            model, embeddings, validation_positive_pairs, device, score_batch_size
        )
        validation_negative_scores = score_pairs(
            model, embeddings, validation_negative_pairs, device, score_batch_size
        )

        # Threshold selection is completed and frozen before either held-out
        # test class is scored. Test data never influences this choice.
        threshold, validation_f1 = select_f1_threshold(
            validation_positive_scores, validation_negative_scores
        )

        test_positive_scores = score_pairs(
            model, embeddings, test_positive_pairs, device, score_batch_size
        )
        test_negative_scores = score_pairs(
            model, embeddings, test_negative_pairs, device, score_batch_size
        )

    row: dict[str, int | float | str] = {
        "Graph": graph,
        "Seed": seed,
        "Threshold": threshold,
        "Validation_F1": validation_f1,
    }
    row.update(classification_metrics(test_positive_scores, test_negative_scores, threshold))
    return row


def aggregate_results(
    per_seed: Sequence[dict[str, int | float | str]],
) -> list[dict[str, str | float]]:
    """Aggregate means and sample standard deviations over five seeds."""

    summary: list[dict[str, str | float]] = []
    for graph in GRAPHS:
        graph_rows = [row for row in per_seed if row["Graph"] == graph]
        if len(graph_rows) != len(SEEDS):
            raise ValueError(f"Expected five seed rows for {graph}, got {len(graph_rows)}")

        item: dict[str, str | float] = {"Graph": graph}
        for metric in ("Accuracy", "Precision", "Recall", "F1"):
            values = [float(row[metric]) for row in graph_rows]
            item[f"{metric}_mean"] = math.fsum(values) / len(values)
            item[f"{metric}_std"] = statistics.stdev(values)
        summary.append(item)
    return summary


def write_csv(path: Path, fields: Iterable[str], rows: Iterable[dict[str, Any]]) -> None:
    """Write a UTF-8 CSV while retaining Python's full float representation."""

    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(fields), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_results(
    output_dir: Path,
    per_seed: list[dict[str, int | float | str]],
    summary: list[dict[str, str | float]],
    pair_counts: dict[str, int],
) -> None:
    """Write exactly the three requested classification result files."""

    output_dir.mkdir(parents=True, exist_ok=True)
    per_seed_path, summary_csv_path, summary_json_path = result_paths(output_dir)

    write_csv(per_seed_path, PER_SEED_FIELDS, per_seed)
    write_csv(summary_csv_path, SUMMARY_FIELDS, summary)

    document = {
        "seeds": list(SEEDS),
        "graphs": list(GRAPHS),
        "validation_positive_pairs": pair_counts["validation_positive_pairs"],
        "validation_negative_pairs": pair_counts["validation_negative_pairs"],
        "test_positive_pairs": pair_counts["test_positive_pairs"],
        "test_negative_pairs": pair_counts["test_negative_pairs"],
        "threshold_selection": (
            "maximize F1 on validation set separately for each graph/seed"
        ),
        "negative_class": (
            "sampled unobserved DDI pairs, not confirmed non-interactions"
        ),
        "per_seed": per_seed,
        "summary": summary,
    }
    with summary_json_path.open("w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, ensure_ascii=False, allow_nan=False)
        handle.write("\n")

    print("Wrote classification metrics:")
    for path in result_paths(output_dir):
        print(f"  - {path}")


def run_evaluation(
    output_dir: Path, device: torch.device, score_batch_size: int
) -> None:
    """Run all 20 existing graph/seed checkpoints and write aggregate results."""

    validation_positive_pairs = load_pairs("ddi_val.pt")
    validation_negative_pairs = load_pairs("ddi_val_negatives.pt")
    test_positive_pairs = load_pairs("ddi_test.pt")
    test_negative_pairs = load_pairs("ddi_test_negatives.pt")

    pair_counts = {
        "validation_positive_pairs": validation_positive_pairs.shape[1],
        "validation_negative_pairs": validation_negative_pairs.shape[1],
        "test_positive_pairs": test_positive_pairs.shape[1],
        "test_negative_pairs": test_negative_pairs.shape[1],
    }
    per_seed: list[dict[str, int | float | str]] = []

    print(f"Device: {device}")
    print("Raw scores are not probabilities.")
    print("Negatives are sampled unobserved DDI pairs, not confirmed non-interactions.")

    for graph in GRAPHS:
        graph_path = TENSOR_DIR / f"{graph}.pt"
        graph_data = load_torch(graph_path)
        if not isinstance(graph_data, dict):
            raise TypeError(f"Graph artifact must be a dictionary: {graph_path}")
        edge_index = graph_data["edge_index"].long().to(device)
        edge_type = graph_data["edge_type"].long().to(device)

        for seed in SEEDS:
            print(f"Evaluating {graph} seed {seed}...")
            row = evaluate_one(
                graph=graph,
                seed=seed,
                graph_data=graph_data,
                edge_index=edge_index,
                edge_type=edge_type,
                validation_positive_pairs=validation_positive_pairs,
                validation_negative_pairs=validation_negative_pairs,
                test_positive_pairs=test_positive_pairs,
                test_negative_pairs=test_negative_pairs,
                device=device,
                score_batch_size=score_batch_size,
            )
            per_seed.append(row)
            print(
                f"  threshold={float(row['Threshold']):.17g} "
                f"validation_F1={float(row['Validation_F1']):.17g} "
                f"test_F1={float(row['F1']):.17g}"
            )

        del edge_index, edge_type, graph_data
        if device.type == "cuda":
            torch.cuda.empty_cache()

    summary = aggregate_results(per_seed)
    write_results(output_dir, per_seed, summary, pair_counts)


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point."""

    args = parse_args(argv)
    output_dir = resolve_output_dir(args.output_dir)

    if args.verify_only:
        print_existing_results(output_dir)
        return 0

    if args.score_batch_size <= 0:
        raise ValueError("--score-batch-size must be positive")

    validate_output_policy(output_dir, args.overwrite)
    validate_inputs()
    load_training_dependencies()
    device = resolve_device(args.device)
    run_evaluation(output_dir, device, args.score_batch_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
