# Relation-ablation five-seed study (v1)

This directory is the versioned publication release for the verified relation-level ranking extension. It combines historical seeds 42–44 with extension seeds 45–46, yielding five paired G0 baselines and 35 single-relation runs on one fixed split.

`statistics.json` and `analysis_input.json` are the authoritative full-precision artifacts. `reproduce_analysis.py` regenerates the publication tables, statistics, and figures from the input beside the script. Run it from any working directory with NumPy, SciPy, and Matplotlib installed.

The extension uses a validated explicit global incoming-edge mean, aggregating incoming messages across relations before transformation. This matches the historical mathematical operator within tested numerical tolerances; numerical agreement does not guarantee identical training trajectories.

The uncertainty intervals describe variation across five training seeds on one fixed split. They do not quantify split, dataset, or clinical uncertainty, and every pointwise 95% paired interval includes zero. The analysis was not preregistered.

This release contains ranking results only. Relation-level classification artifacts elsewhere in the repository cover seeds 42–44 and remain labeled as historical three-seed measurements.

Checkpoint binaries, graph tensors, server backup utilities, server-local paths, and backup archives are deliberately excluded.
