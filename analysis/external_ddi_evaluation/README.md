# External DDI evaluation package

## Research question

How does the trained G3 model behave on drug-drug interaction pairs from other
datasets that are absent from the PrimeKG snapshot used for training and internal
evaluation?

This package consolidates two approved exploratory G3 seed-44 ranking pilots. Frozen
cohorts and scientific result artifacts remain byte-preserved. Evaluator scripts and
documentation may evolve for portability and reproducibility, with original and current
hashes recorded in `COPY_PROVENANCE.json`. It does not contain a new training run.

## Compact Git package and full local archive

The complete raw and per-query package remains on this workstation. Git tracks a
compact reporting and reproducibility subset containing the frozen target cohorts,
methodology, evaluator scripts, aggregate summaries, figure, diagnostic summaries, and
provenance documentation. It now also tracks the compact two-column DDInter positive
filter universe required for exact filtered ranking. Four large intermediate/per-query
CSV files remain in their existing package paths locally but are excluded by the
package-local `.gitignore`.

Their paths, sizes, SHA256 values, purposes, and evaluator requirements are recorded in
`LOCAL_ARCHIVE_INVENTORY.json`. The full-package manifest continues to record them. No
scientific result or raw local artifact was deleted to create the compact Git subset.

## Dataset roles

### DDInter: primary external robustness benchmark

- 160,235 unique symmetric source pairs;
- 138,358 pairs with both endpoints conservatively mapped;
- 49,105 mapped pairs retained after removing complete PrimeKG-known positives;
- 98,210 directional ranking queries;
- exact normalized-name fallback mapping, not fuzzy mapping;
- treated as the primary external robustness benchmark.

The retained rows are **DDInter interactions absent from the PrimeKG snapshot**.
“PrimeKG-absent” is snapshot-relative and does not mean clinically novel or newly
discovered.

### Kaggle: DrugBank-derived source-consistency control

- 191,135 unique symmetric source pairs;
- 188,271 pairs with both endpoints conservatively mapped;
- 38,510 mapped pairs retained after removing complete PrimeKG-known positives;
- 77,020 directional ranking queries;
- exact normalized-name mapping only;
- DrugBank-derived source-consistency control, **not independent validation**.

The retained rows are **Kaggle/DrugBank-derived interactions absent from the
PrimeKG snapshot**.

## Shared evaluation protocol

- Model: G3, seed 44, best epoch 499;
- candidate vocabulary: the same 4,278 PrimeKG drugs used internally;
- relation-aware DistMult-style DDI score:
  `query_embedding @ (candidate_embeddings * ddi_relation).T`;
- raw scores are ranking scores, not probabilities or confidence values;
- every retained pair is evaluated in both directions;
- filtered candidates include the query itself, all complete PrimeKG-known positive
  partners, and all other mapped positive partners from the evaluated source;
- the current target is restored after filtering;
- optimistic strict rank: `1 + count(score > target_score)`;
- metrics: MRR, Hits@1, Hits@5, Hits@10, mean rank, and median rank.

No severity field is used in scoring. DDInter severity is descriptive stratification
only. No threshold tuning, model encoding, training, or retraining occurs in this
package-building step.

### Dependencies for evaluator reruns

The tracked Git package contains the exact DDInter target cohort and the complete
138,358-pair filtering universe in
`ddinter/preparation/ddinter_mapped_positive_filter_pairs.csv`. The evaluator therefore
does not require the 40 MiB local-only mapped-pair review. It resolves package paths
relative to its own location and accepts `--output-dir` for a fresh reproduction run;
`--verify-inputs-only` verifies cohort, filter, runtime, checkpoint, and vocabulary
invariants without scoring or writing outputs.

Assuming the documented original external source data and verified project
runtime/checkpoint are available, the tracked Git package contains everything required
to reconstruct the exact external ranking and filtering protocol. The large
`ddinter/preparation/ddinter_mapped_pair_review.csv` is preserved locally and
hash-recorded for detailed mapping audits, but it is no longer an evaluator input.
The saved per-query CSVs are local archival outputs and are not required to rerun either
experiment.

The Kaggle evaluator accepts the hash-pinned source CSV used for the pilot through
`--kaggle-source`; the source is not described as authoritative. It verifies that source
reconstruction yields the tracked 38,510-pair cohort before any scoring. Its local-only
per-query CSV is not an evaluator input. Both evaluators default fresh output to ignored
`reproduction_run/` directories, refuse overwrite, and provide no-write verification.

A GitHub checkout contains the evaluator code, exact frozen target cohorts, DDInter
filtering universe, aggregate results, and integrity records. An exact rerun additionally
requires the hash-pinned external source download(s), documented lightweight G3 runtime,
and G3 seed-44 checkpoint. Those large source/runtime artifacts are not embedded here.

## External source provenance and mapping review

`SOURCE_PROVENANCE.json` records the DDInter download page, all eight raw partition
filenames and hashes, and the Kaggle dataset page/local CSV hash. Exact download dates
and source versions were not recorded and are explicitly `not recorded`; filesystem
timestamps are not treated as retrieval evidence. DDInter partitions overlap and are
deduplicated as symmetric pairs.

`ddinter/preparation/ddinter_exact_name_mapping_review.csv` is a row-level lexical review
of all 1,614 retained exact-name mappings. Every mapped DDInter and PrimeKG name is equal
after normalization; 14 parenthetical/comma names received focused lexical attention,
seven form/origin qualifiers were detected and preserved identically on both sides, and
no obvious suspicious lexical case or qualifier collapse was found. This is not
authoritative pharmacological identity validation.

## Results

| Cohort | Scope | Pairs | Queries | MRR | Hits@1 | Hits@5 | Hits@10 | Mean rank | Median rank |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| PrimeKG internal | G3 five-seed mean | — | — | 0.534209 | 0.486290 | 0.580468 | 0.618074 | unavailable | unavailable |
| Kaggle source-consistency | G3 seed-44 pilot | 38,510 | 77,020 | 0.016237 | 0.006219 | 0.017437 | 0.027253 | 1,142.573 | 792 |
| DDInter external robustness | G3 seed-44 pilot | 49,105 | 98,210 | 0.012088 | 0.003442 | 0.012249 | 0.021383 | 1,113.255 | 776 |

Internal PrimeKG performance is substantially higher than either PrimeKG-absent
cohort. Kaggle has somewhat higher MRR and Hits@K than DDInter, while DDInter has
slightly better mean and median rank. Both pilots show a large transfer gap relative
to the internal benchmark. This pattern is consistent with substantial dataset and
distribution shift, but it does not establish a causal explanation.

As descriptive context, uniform-random ranking over each query's already-recorded
filtered candidate count gives expected MRR 0.002695 and Hits@10 0.003121 for DDInter,
and expected MRR 0.002693 and Hits@10 0.003118 for Kaggle. The observed values are
higher, but remain weak relative to the internal benchmark. These baselines do not
create a statistical-significance claim.

The machine-readable source of this table is
`comparison/external_evaluation_summary.csv` and its JSON equivalent. The SVG figure
uses those same full-precision values. Internal mean and median rank are not fabricated.

## Limitations and interpretation boundary

- Only G3 seed 44 was evaluated externally.
- There is no external G0, G1, or G2 comparison.
- There is no across-seed uncertainty estimate for either pilot.
- DDInter mapping uses an exact-name fallback rather than an authoritative identifier
  crosswalk.
- Kaggle is DrugBank-derived and is not independent external validation.
- “PrimeKG-absent” is relative to the specific PrimeKG snapshot.
- DDInter and PrimeKG may still share upstream biomedical evidence.
- Internal and pilot metrics are descriptive, not statistically interchangeable.
- The results do not establish statistical significance, clinical novelty, clinical
  failure, safety, danger, or risk.
- No conclusion can be drawn about whether G3 is externally better or worse than G0,
  G1, or G2 because those models were not evaluated here.

## Package layout and provenance

```text
analysis/external_ddi_evaluation/
├── README.md
├── build_external_evaluation_package.py
├── COPY_PROVENANCE.json
├── EXTERNAL_EVALUATION_SHA256SUMS.sha256
├── LOCAL_ARCHIVE_INVENTORY.json
├── ddinter/
│   ├── preparation/   # frozen outputs plus evolved reproducibility tooling
│   └── pilot/         # frozen DDInter results plus evolved evaluator
├── kaggle/
│   └── pilot/         # frozen Kaggle results plus evolved evaluator
└── comparison/
    ├── external_evaluation_summary.csv
    ├── external_evaluation_summary.json
    ├── external_rank_summary.csv
    └── external_evaluation_comparison.svg
```

`COPY_PROVENANCE.json` maps every consolidated file to its original local analysis path.
Immutable raw/result artifacts retain byte-identical status. Intentionally evolved
evaluator/documentation files retain original hashes and separately record current
hashes plus the reason for change. `EXTERNAL_EVALUATION_SHA256SUMS.sha256` covers every
package file except itself, including hash-recorded local archives when present.

`ddinter/preparation/DDINTER_MAPPED_POSITIVE_FILTER_PROVENANCE.json` documents the
derivation and exact set equivalence of the compact tracked filter file against the
local-only mapped-pair review.

The local-only files are intentionally not duplicated elsewhere. Their omission from a
GitHub checkout removes query-level and detailed intermediate audit tables, not the
inputs required by the DDInter evaluator, methodology, frozen cohorts, evaluator
implementations, aggregate metrics, diagnostic summaries, figure, or provenance needed
to understand and report the experiment. DDInter remains the primary external
robustness benchmark; Kaggle remains the DrugBank-derived source-consistency control.
Both are G3 seed-44 pilots, and no external G0/G1/G2 comparison is claimed.
