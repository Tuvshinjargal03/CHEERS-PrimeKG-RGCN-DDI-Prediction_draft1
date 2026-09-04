# Subgraph Explorer entity-description inventory

`entity_description_inventory.jsonl` freezes the exact 6,288 Drug and Disease identities that can currently appear in CHEERS Subgraph Explorer: 4,278 Drug entities and 2,010 Disease entities. It includes the candidate-center Drugs (also verified to be exactly the Drugs exposed by the training-only DDI neighborhood) and Disease support neighbors reachable from those candidates through the forward G3 context runtime. It excludes Gene/Protein entities and nodes that exist only in full G3.

The inventory is derived without identity normalization from:

- `final_release/lightweight_runtime/drug_metadata.csv`
- `final_release/g3_context_runtime/training_ddi_neighbors.npz`
- `final_release/g3_context_runtime/g3_drug_context.csv`

From the repository root, reproduce and verify it with:

```text
python scripts/build_entity_description_inventory.py
python final_release/verify_entity_description_inventory.py
```

The manifest records input and output SHA-256 values, counts, ordering, identity rules, and a syntax-only ambiguity audit.

This artifact contains entity identities only. It contains no generated biomedical descriptions and was not used as textual input to the R-GCN model.
