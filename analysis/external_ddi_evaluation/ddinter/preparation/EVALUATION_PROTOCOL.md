# Proposed DDInter external-evaluation protocol

This directory contains preparation outputs only. No model was run for external scoring.

## Primary cohort

Use only rows in `ddinter_primekg_novel_pairs.csv`. Here, **novel** means absent from
the complete known-positive DDI set in this PrimeKG snapshot. It does not mean newly
discovered or clinically novel. The crosswalk uses no fuzzy matching. Exact normalized-
name matches are fallback mappings and should be reviewed before final freezing.

## Ranking queries

For each retained positive pair, evaluate both A-to-B and B-to-A. Rank against the same
4,278 candidate drugs used by the main experiment. For each query, filter all complete
PrimeKG-known positive partners, every other mapped DDInter-positive partner, and the
self candidate, then restore the target candidate before ranking.

Report MRR and Hits@1, Hits@5, and Hits@10 overall and separately for Major, Moderate,
Minor, and Unknown severity. Add a sensitivity analysis excluding Unknown. DDInter
severity is descriptive stratification only and must not be treated as a positive or
negative class.

## Fair comparison

Use the same frozen external pair list and filtering universe for every graph and seed.
Compute per-seed metrics, graph-level mean and sample standard deviation, and paired
per-seed graph differences. Do not claim statistical significance from five seeds alone.

## Remaining gates

1. Review or replace exact-name fallback mappings with an authoritative DDInter-to-
   DrugBank crosswalk where available.
2. Restore `ddi_val.pt` and `ddi_test.pt` to report split-specific overlap.
3. Restore the missing G0-G3 seed checkpoints for the intended comparison.
4. Re-hash and freeze the final reviewed crosswalk and pair cohort before evaluation.
