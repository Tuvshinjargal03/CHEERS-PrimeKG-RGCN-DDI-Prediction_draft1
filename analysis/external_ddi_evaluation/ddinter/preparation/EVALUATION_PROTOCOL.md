# DDInter external-evaluation protocol: proposal and executed pilot

This document preserves the original study design while distinguishing it from the
pilot that has now been executed and frozen. Preparation and evaluation perform no
training or retraining.

## Originally proposed protocol

The proposal was to retain DDInter pairs absent from the complete known-positive DDI
set in the project PrimeKG snapshot, evaluate both directions against the same 4,278
candidate drugs, and report MRR and Hits@1/5/10. For each query, the planned filtered
ranking removed self, complete PrimeKG-known partners, and other mapped DDInter-positive
partners, then restored the current target. Severity was planned as descriptive
stratification only.

The broader proposal also contemplated matched multi-seed G0-G3 evaluation after
additional checkpoints and split artifacts became available. Those broader comparisons
were not executed and are not claimed.

## Actual executed and frozen pilot

- Model/runtime: G3 seed 44, best epoch 499, verified NumPy export of the trained model.
- Frozen target cohort: 49,105 unique symmetric DDInter pairs and 98,210 directional
  queries.
- Mapping: conservative exact normalized-name fallback; no fuzzy matching and no
  collapsing of salts, formulations, combinations, or route-specific entities.
- Filtering: self, all complete PrimeKG-known positive partners, and every other mapped
  DDInter-positive partner; current target restored.
- Ranking: optimistic strict rank, `1 + count(available score > target score)`.
- Results: overall MRR/Hits@K/rank summaries, severity summaries, Unknown-excluded
  sensitivity analysis, and tie diagnostics in `../pilot/`.

Here, **PrimeKG-absent** is snapshot-relative. It does not mean newly discovered,
clinically novel, safe, unsafe, or a confirmed non-interaction. Raw scores are ranking
scores, not probabilities.

## Remaining limitations, not execution blockers

The completed pilot is scientifically usable as a descriptive single-seed robustness
analysis. It does not provide external G0/G1/G2 comparisons, multi-seed uncertainty, or
an authoritative identifier crosswalk. The 1,614 exact-name mappings have a tracked
lexical review record, but future authoritative mapping corrections would require an
evaluation-only rerun of affected cohorts; model retraining would not be required.
