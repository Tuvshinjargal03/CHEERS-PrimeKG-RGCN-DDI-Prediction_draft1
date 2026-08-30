"""Build documentation and figures from frozen external-pilot outputs.

This packaging script never trains, encodes, or scores a model. It verifies the
byte-preserved source copies, reads the already-saved metric JSON files, writes
comparison tables, renders a dependency-free SVG, and hashes the complete
package. Pilot metric values are never recomputed or changed.
"""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape


PROJECT = Path(__file__).resolve().parents[2]
PACKAGE = Path(__file__).resolve().parent
COMPARISON = PACKAGE / "comparison"
ARCHIVE_INVENTORY = PACKAGE / "LOCAL_ARCHIVE_INVENTORY.json"
ORIGINALS = {
    PROJECT / "analysis/ddinter_external_evaluation_preparation":
        PACKAGE / "ddinter/preparation",
    PROJECT / "analysis/ddinter_external_evaluation_pilot":
        PACKAGE / "ddinter/pilot",
    PROJECT / "analysis/kaggle_external_evaluation_pilot":
        PACKAGE / "kaggle/pilot",
}
INTERNAL = {
    "MRR": 0.534209,
    "Hits@1": 0.486290,
    "Hits@5": 0.580468,
    "Hits@10": 0.618074,
}
EXPECTED_DISPLAY = {
    "ddinter": {
        "MRR": 0.012088,
        "Hits@1": 0.003442,
        "Hits@5": 0.012249,
        "Hits@10": 0.021383,
        "MeanRank": 1113.255,
        "MedianRank": 776,
        "pairs": 49_105,
        "queries": 98_210,
    },
    "kaggle": {
        "MRR": 0.016237,
        "Hits@1": 0.006219,
        "Hits@5": 0.017437,
        "Hits@10": 0.027253,
        "MeanRank": 1142.573,
        "MedianRank": 792,
        "pairs": 38_510,
        "queries": 77_020,
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_preserved_copies() -> list[dict[str, object]]:
    provenance_path = PACKAGE / "COPY_PROVENANCE.json"
    if not all(source_dir.exists() for source_dir in ORIGINALS):
        if not provenance_path.exists():
            raise FileNotFoundError(
                "Original analysis directories and recorded copy provenance are both missing"
            )
        recorded = json.loads(provenance_path.read_text(encoding="utf-8"))
        entries = recorded["files"]
        archive_paths = {
            str(entry["original_relative_path"])
            for entry in json.loads(ARCHIVE_INVENTORY.read_text(encoding="utf-8"))["files"]
        }
        for entry in entries:
            copied = PROJECT / str(entry["package_path"])
            if not copied.is_file():
                relative = copied.relative_to(PACKAGE).as_posix()
                if relative in archive_paths:
                    continue
                raise FileNotFoundError(f"Required tracked package file is missing: {copied}")
            if copied.stat().st_size != int(entry["size_bytes"]):
                raise ValueError(f"Recorded package-copy size changed: {copied}")
            if sha256(copied) != str(entry["sha256"]):
                raise ValueError(f"Recorded package-copy hash changed: {copied}")
        return entries

    entries: list[dict[str, object]] = []
    for source_dir, copy_dir in ORIGINALS.items():
        source_files = sorted(path for path in source_dir.iterdir() if path.is_file())
        copy_files = sorted(path for path in copy_dir.iterdir() if path.is_file())
        if [path.name for path in source_files] != [path.name for path in copy_files]:
            raise ValueError(f"Copied file inventory differs for {source_dir}")
        for source in source_files:
            copied = copy_dir / source.name
            source_hash = sha256(source)
            copy_hash = sha256(copied)
            if source_hash != copy_hash or source.stat().st_size != copied.stat().st_size:
                raise ValueError(f"Copy is not byte-identical: {copied}")
            entries.append(
                {
                    "original_path": source.relative_to(PROJECT).as_posix(),
                    "package_path": copied.relative_to(PROJECT).as_posix(),
                    "size_bytes": copied.stat().st_size,
                    "sha256": copy_hash,
                    "byte_identical": True,
                }
            )
    return entries


def load_pilot_metrics() -> tuple[dict[str, object], dict[str, object]]:
    ddinter = json.loads(
        (PACKAGE / "ddinter/pilot/ddinter_g3_seed44_overall_metrics.json").read_text(
            encoding="utf-8"
        )
    )
    kaggle = json.loads(
        (PACKAGE / "kaggle/pilot/kaggle_g3_seed44_overall_metrics.json").read_text(
            encoding="utf-8"
        )
    )
    for key, document in (("ddinter", ddinter), ("kaggle", kaggle)):
        expected = EXPECTED_DISPLAY[key]
        for metric in ("MRR", "Hits@1", "Hits@5", "Hits@10"):
            if round(float(document["metrics"][metric]), 6) != expected[metric]:
                raise ValueError(f"{key} {metric} differs from approved value")
        if round(float(document["metrics"]["MeanRank"]), 3) != expected["MeanRank"]:
            raise ValueError(f"{key} mean rank differs from approved value")
        if int(document["metrics"]["MedianRank"]) != expected["MedianRank"]:
            raise ValueError(f"{key} median rank differs from approved value")
        if int(document["pair_count"]) != expected["pairs"]:
            raise ValueError(f"{key} pair count differs from approved value")
        if int(document["directional_query_count"]) != expected["queries"]:
            raise ValueError(f"{key} query count differs from approved value")
    return ddinter, kaggle


def summary_rows(
    ddinter: dict[str, object], kaggle: dict[str, object]
) -> list[dict[str, object]]:
    return [
        {
            "cohort": "PrimeKG internal",
            "role": "internal benchmark",
            "graph": "G3",
            "seed_scope": "five-seed mean (42-46)",
            "pairs": None,
            "directional_queries": None,
            "MRR": INTERNAL["MRR"],
            "Hits@1": INTERNAL["Hits@1"],
            "Hits@5": INTERNAL["Hits@5"],
            "Hits@10": INTERNAL["Hits@10"],
            "MeanRank": None,
            "MedianRank": None,
            "interpretation": "Internal five-seed mean; mean and median rank unavailable in the approved comparison context.",
        },
        {
            "cohort": "Kaggle source-consistency",
            "role": "DrugBank-derived source-consistency control",
            "graph": "G3",
            "seed_scope": "seed 44 pilot",
            "pairs": int(kaggle["pair_count"]),
            "directional_queries": int(kaggle["directional_query_count"]),
            "MRR": float(kaggle["metrics"]["MRR"]),
            "Hits@1": float(kaggle["metrics"]["Hits@1"]),
            "Hits@5": float(kaggle["metrics"]["Hits@5"]),
            "Hits@10": float(kaggle["metrics"]["Hits@10"]),
            "MeanRank": float(kaggle["metrics"]["MeanRank"]),
            "MedianRank": int(kaggle["metrics"]["MedianRank"]),
            "interpretation": "DrugBank-derived control; not independent external validation.",
        },
        {
            "cohort": "DDInter external robustness",
            "role": "primary external robustness benchmark",
            "graph": "G3",
            "seed_scope": "seed 44 pilot",
            "pairs": int(ddinter["pair_count"]),
            "directional_queries": int(ddinter["directional_query_count"]),
            "MRR": float(ddinter["metrics"]["MRR"]),
            "Hits@1": float(ddinter["metrics"]["Hits@1"]),
            "Hits@5": float(ddinter["metrics"]["Hits@5"]),
            "Hits@10": float(ddinter["metrics"]["Hits@10"]),
            "MeanRank": float(ddinter["metrics"]["MeanRank"]),
            "MedianRank": int(ddinter["metrics"]["MedianRank"]),
            "interpretation": "Primary external robustness pilot; exact-name fallback mapping.",
        },
    ]


def write_summary(rows: list[dict[str, object]]) -> None:
    csv_path = COMPARISON / "external_evaluation_summary.csv"
    json_path = COMPARISON / "external_evaluation_summary.json"
    if csv_path.exists() and json_path.exists():
        with csv_path.open("r", encoding="utf-8", newline="") as handle:
            existing = list(csv.DictReader(handle))
        existing_json = json.loads(json_path.read_text(encoding="utf-8"))
        if len(existing) != len(rows) or existing_json.get("rows") != rows:
            raise ValueError("Existing frozen comparison summaries differ from pilot metrics")
        return

    fields = list(rows[0])
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    document = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "source": "Frozen, previously verified pilot metric files; no scoring rerun.",
        "statistical_boundary": (
            "PrimeKG is a five-seed internal mean; Kaggle and DDInter are single-seed "
            "pilots. Values are descriptive and not statistically interchangeable."
        ),
        "rows": rows,
    }
    json_path.write_text(
        json.dumps(document, indent=2) + "\n", encoding="utf-8"
    )
    rank_rows = [row for row in rows if row["MeanRank"] is not None]
    with (COMPARISON / "external_rank_summary.csv").open(
        "w", encoding="utf-8", newline=""
    ) as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["cohort", "pairs", "directional_queries", "MeanRank", "MedianRank"],
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(rank_rows)


def render_svg(rows: list[dict[str, object]]) -> None:
    svg_path = COMPARISON / "external_evaluation_comparison.svg"
    if svg_path.exists():
        return

    metrics = ("MRR", "Hits@1", "Hits@5", "Hits@10")
    series = [
        ("PrimeKG internal", "#3568A8"),
        ("Kaggle source-consistency", "#E08B32"),
        ("DDInter external robustness", "#2A8C82"),
    ]
    by_name = {str(row["cohort"]): row for row in rows}
    width, height = 1440, 820
    main = {"x": 100, "y": 135, "w": 760, "h": 500, "max": 0.65}
    zoom = {"x": 960, "y": 135, "w": 390, "h": 500, "max": 0.03}
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#FFFFFF"/>',
        '<style>text{font-family:Arial,Helvetica,sans-serif;fill:#18212B}.title{font-size:28px;font-weight:700}.subtitle{font-size:16px;fill:#4B5563}.axis{font-size:14px;fill:#4B5563}.label{font-size:14px;font-weight:600}.value{font-size:12px;font-weight:600}.panel{font-size:18px;font-weight:700}.caption{font-size:14px;fill:#374151}</style>',
        '<text x="720" y="42" text-anchor="middle" class="title">G3 ranking performance across internal and PrimeKG-absent cohorts</text>',
        '<text x="720" y="72" text-anchor="middle" class="subtitle">MRR and filtered Hits@K; raw ranking metrics, not probabilities</text>',
    ]

    def panel_axes(panel: dict[str, float], maximum: float, ticks: list[float], title: str) -> None:
        x, y, w, h = panel["x"], panel["y"], panel["w"], panel["h"]
        parts.append(f'<text x="{x}" y="{y - 25}" class="panel">{escape(title)}</text>')
        parts.append(f'<line x1="{x}" y1="{y}" x2="{x}" y2="{y+h}" stroke="#263238" stroke-width="1.4"/>')
        parts.append(f'<line x1="{x}" y1="{y+h}" x2="{x+w}" y2="{y+h}" stroke="#263238" stroke-width="1.4"/>')
        for tick in ticks:
            ty = y + h - (tick / maximum) * h
            parts.append(f'<line x1="{x}" y1="{ty:.2f}" x2="{x+w}" y2="{ty:.2f}" stroke="#D7DDE3" stroke-width="1"/>')
            parts.append(f'<text x="{x-12}" y="{ty+5:.2f}" text-anchor="end" class="axis">{tick:.2f}</text>')

    panel_axes(main, main["max"], [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], "A. Full comparison")
    group_w = main["w"] / len(metrics)
    bar_w = 42
    offsets = (-bar_w - 7, 0, bar_w + 7)
    for metric_index, metric in enumerate(metrics):
        center = main["x"] + group_w * (metric_index + 0.5)
        parts.append(f'<text x="{center:.2f}" y="{main["y"]+main["h"]+28}" text-anchor="middle" class="label">{escape(metric)}</text>')
        for series_index, (name, color) in enumerate(series):
            value = float(by_name[name][metric])
            bar_h = value / main["max"] * main["h"]
            bx = center + offsets[series_index] - bar_w / 2
            by = main["y"] + main["h"] - bar_h
            parts.append(f'<rect x="{bx:.2f}" y="{by:.2f}" width="{bar_w}" height="{bar_h:.2f}" rx="3" fill="{color}"/>')
            parts.append(f'<text x="{bx+bar_w/2:.2f}" y="{max(main["y"]+12,by-6):.2f}" text-anchor="middle" class="value">{value:.3f}</text>')

    panel_axes(zoom, zoom["max"], [0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03], "B. External-pilot zoom")
    zoom_series = series[1:]
    zoom_group_w = zoom["w"] / len(metrics)
    zoom_bar_w = 34
    for metric_index, metric in enumerate(metrics):
        center = zoom["x"] + zoom_group_w * (metric_index + 0.5)
        parts.append(f'<text x="{center:.2f}" y="{zoom["y"]+zoom["h"]+28}" text-anchor="middle" class="label">{escape(metric)}</text>')
        for series_index, (name, color) in enumerate(zoom_series):
            value = float(by_name[name][metric])
            bar_h = value / zoom["max"] * zoom["h"]
            bx = center + (-20 if series_index == 0 else 20) - zoom_bar_w / 2
            by = zoom["y"] + zoom["h"] - bar_h
            parts.append(f'<rect x="{bx:.2f}" y="{by:.2f}" width="{zoom_bar_w}" height="{bar_h:.2f}" rx="3" fill="{color}"/>')
            parts.append(f'<text x="{bx+zoom_bar_w/2:.2f}" y="{by-6:.2f}" text-anchor="middle" class="value">{value:.3f}</text>')

    legend_x = 100
    for index, (name, color) in enumerate(series):
        x = legend_x + index * 350
        parts.append(f'<rect x="{x}" y="680" width="20" height="14" rx="2" fill="{color}"/>')
        parts.append(f'<text x="{x+30}" y="693" class="axis">{escape(name)}</text>')
    parts.extend(
        [
            '<text x="720" y="745" text-anchor="middle" class="caption">PrimeKG bars are the internal G3 five-seed mean; Kaggle and DDInter bars are G3 seed-44 pilots.</text>',
            '<text x="720" y="770" text-anchor="middle" class="caption">The cohorts are descriptively informative but not statistically equivalent; no single-seed error bars are shown.</text>',
            '</svg>',
        ]
    )
    svg_path.write_text(
        "\n".join(parts) + "\n", encoding="utf-8"
    )


def write_package_manifest() -> None:
    manifest = PACKAGE / "EXTERNAL_EVALUATION_SHA256SUMS.sha256"
    archive_paths = {
        PACKAGE / str(entry["original_relative_path"])
        for entry in json.loads(ARCHIVE_INVENTORY.read_text(encoding="utf-8"))["files"]
    }
    missing_archive = [path for path in archive_paths if not path.exists()]
    if missing_archive:
        if not manifest.exists():
            raise FileNotFoundError(
                "Full-package manifest cannot be created without local archive files"
            )
        return

    files = sorted(
        path
        for path in PACKAGE.rglob("*")
        if path.is_file()
        and path != manifest
        and "__pycache__" not in path.parts
        and path.suffix != ".pyc"
    )
    manifest.write_text(
        "\n".join(
            f"{sha256(path)}  {path.relative_to(PACKAGE).as_posix()}" for path in files
        )
        + "\n",
        encoding="ascii",
    )


def main() -> None:
    COMPARISON.mkdir(parents=True, exist_ok=True)
    provenance = verify_preserved_copies()
    ddinter, kaggle = load_pilot_metrics()
    rows = summary_rows(ddinter, kaggle)
    write_summary(rows)
    render_svg(rows)
    (PACKAGE / "COPY_PROVENANCE.json").write_text(
        json.dumps(
            {
                "verified_utc": datetime.now(timezone.utc).isoformat(),
                "all_copies_byte_identical": True,
                "file_count": len(provenance),
                "files": provenance,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    write_package_manifest()
    print(f"Verified {len(provenance)} byte-identical preserved files.")
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
