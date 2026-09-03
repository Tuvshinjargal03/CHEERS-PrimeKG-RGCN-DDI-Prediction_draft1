"""Validate the versioned relation-ablation publication data against raw runs."""

import json
import statistics
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
RELEASE = ROOT / "results/relation_ablation/five_seed_v1"
SEEDS = [42, 43, 44, 45, 46]


def close(left, right):
    return abs(left - right) < 1e-15


def main():
    raw = json.loads((RELEASE / "analysis_input.json").read_text())
    summary = json.loads((RELEASE / "statistics.json").read_text())
    by_run = {row["run"]: row for row in raw}

    assert len(raw) == len(by_run) == 40
    assert sum(row["graph"] != "G0" for row in raw) == 35

    baseline = [by_run[f"G0_seed{seed}"]["MRR"] for seed in SEEDS]
    assert close(statistics.mean(baseline), summary["baseline"]["mean_MRR"])
    assert close(statistics.stdev(baseline), summary["baseline"]["sd_MRR"])

    for relation in summary["relations"]:
        values = [
            by_run[f"{relation['graph']}_seed{seed}"]["MRR"]
            for seed in SEEDS
        ]
        deltas = [value - base for value, base in zip(values, baseline)]
        for index, per_seed in enumerate(relation["per_seed"]):
            assert per_seed["seed"] == SEEDS[index]
            assert close(per_seed["MRR"], values[index])
            assert close(per_seed["G0_MRR"], baseline[index])
            assert close(per_seed["delta"], deltas[index])
        assert close(statistics.mean(values), relation["mean_MRR"])
        assert close(statistics.stdev(values), relation["sd_MRR"])
        assert close(statistics.mean(deltas), relation["mean_delta"])
        assert close(statistics.stdev(deltas), relation["sd_delta"])
        assert relation["wins"] == sum(delta > 0 for delta in deltas)
        assert relation["ci95_low"] <= 0 <= relation["ci95_high"]

    top = max(summary["relations"], key=lambda row: row["mean_delta"])
    assert top["relation"] == "Target"
    assert top["mean_delta"] == 0.006766393212248434
    assert top["wins"] == 4

    from api.main import relation_analysis_results

    payload = relation_analysis_results()
    assert payload["study_version"] == "relation-five-seed-v1"
    assert len(payload["results"]) == len(payload["history"]["results"]) == 7
    assert payload["results"][0]["delta_mrr_mean"] == top["mean_delta"]
    print("Verified 40 raw records, 35 relation runs, and all paired summaries.")
    print("Verified the current and historical relation API payloads.")


if __name__ == "__main__":
    main()
