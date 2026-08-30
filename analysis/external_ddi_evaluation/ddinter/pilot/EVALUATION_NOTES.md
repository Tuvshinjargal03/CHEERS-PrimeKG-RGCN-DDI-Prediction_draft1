# G3 seed-44 DDInter external-ranking pilot

This pilot evaluates **DDInter interactions absent from the PrimeKG snapshot used for
training/evaluation**. It does not claim that the interactions are newly discovered or
clinically novel. It uses one graph and one seed and is not a full G0-G3 comparison.

## Model and score

- Graph: G3
- Seed: 44
- Best epoch: 499
- Candidates: 4,278 drugs
- Decoder: `query_embedding @ (candidate_embeddings * ddi_relation).T`
- Raw outputs are ranking scores, not probabilities or confidence values.

## Filtering and rank

For both directions of every pair, the evaluator filters the query drug, every complete
PrimeKG-known positive partner, and every other mapped DDInter-positive partner, then
restores the current target. Rank is `1 + count(score > target_score)`, matching the
project's optimistic strict-rank convention. Equal-scoring candidates do not outrank the
target; ties are reported separately.

## Cohort

- Symmetric pairs: 49,105
- Directional queries: 98,210
- All targets absent from complete PrimeKG-known mask: yes
- Severity is descriptive stratification only, not a class label.

No training, retraining, graph encoding, threshold tuning, probability conversion, or
checkpoint modification was performed.
