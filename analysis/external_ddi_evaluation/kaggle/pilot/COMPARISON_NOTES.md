# Kaggle/DrugBank-derived source-consistency control

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

- PrimeKG internal G3 five-seed mean MRR: 0.534209
- DDInter G3 seed-44 pilot MRR: 0.012088
- Kaggle G3 seed-44 pilot MRR: 0.016237

The three cohorts are descriptively informative but not statistically interchangeable.
No causal, clinical, or multi-seed generalization claim is made. No training, graph
encoding, threshold tuning, or probability conversion was performed.
