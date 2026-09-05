# Drug and disease entity descriptions

Descriptions provide identification and general context only. They are not
R-GCN textual inputs, score or prediction explanations, DDI evidence, or clinical
guidance. Model, graph, candidate inventory, training and results are unchanged.

## Reproduction and verification

Use the existing verified source acquisitions; the builder never downloads.
Run the inventory, disease source, ChEMBL 37 and UniChem source verifiers first.
Then run:

```text
python scripts/build_entity_descriptions.py
python final_release/verify_entity_descriptions.py --require-source
python -O final_release/verify_entity_descriptions.py --require-source
python final_release/test_entity_descriptions.py
```

The builder checks exact frozen input fingerprints, including the full SQLite
SHA-256, and opens SQLite read-only with immutable mode. Outputs are deterministic
UTF-8/LF JSONL in canonical inventory order. Do not run generation concurrently
with the API: generation replaces derived outputs, then writes their manifests.
Interrupted/mismatched artifacts fail runtime fingerprint validation.

## Mapping and description policy

Exact DrugBank IDs are looked up in the frozen UniChem pair file. These are
UniChem-reported cross-references, not independently established molecular
identity, InChI equality, InChIKey equality or UCI identity. No name, synonym,
fuzzy or Connectivity Search fallback is performed.

Absent assignments are unresolved. Multiple assignments, missing ChEMBL records,
missing structure, non-small-molecule/unspecified types, missing hierarchy,
parent/active form differences, disconnected SMILES components and InChI isotope
layers require review. Component/isotope flags describe source representation;
they do not diagnose a salt, mixture, or identity error. No parent substitution
or entity-specific overrides occur. Approved means eligible for this limited
context template only, not regulatory approval or independent identity proof.

Approved drug descriptions report only ChEMBL's preferred name, when present,
and its molecule type. Max phase and first approval are retained in local audit
facts but never interpreted or presented as approval claims. Indications,
mechanisms, targets, bioactivity, dosing and safety fields are not extracted.

Approved ordinary MONDO definitions are copied without scientific rewriting.
Grouped, needs-review and unresolved disease identities retain their original
statuses and receive no generated definition. Source mapping is unchanged.

## Licensing and distribution

The exact DrugBank-to-ChEMBL linkage remains licensing-uncertain for public
redistribution. Therefore **all drug-linked generated data stays local** under
`data/derived/entity_descriptions/`, ignored by Git:

- `drug_mapping_evidence.jsonl`: exact assignments, source facts and decisions.
- `drug_descriptions.jsonl`: local optional runtime descriptions and provenance.
- `MANIFEST.json`: local fingerprints and counts.

Do not force-add these files, publish a bulk mapping, or bundle this local drug
runtime into a public deployment pending licensing review. A portable checkout
loads committed disease descriptions and existing gene metadata; drug nodes use
the neutral unavailable fallback until a permitted local runtime is generated.
No license is inferred from service access. No DrugBank or UniChem prose is copied.

ChEMBL-derived local facts and template adaptations retain ChEMBL IDs and release
37 and are designated CC BY-SA 3.0, including attribution/share-alike requirements:
https://creativecommons.org/licenses/by-sa/3.0/
The frozen license and requested attribution are already retained at
`data/downloads/chembl/chembl_37/LICENSE` and `REQUIRED.ATTRIBUTION` (tracked).
Attribution: Mendez et al., ChEMBL: towards direct deposition of bioassay data,
Nucleic Acids Research 47(D1):D930-D940 (2019), https://doi.org/10.1093/nar/gky1075.
Official licensing guidance:
https://chembl.gitbook.io/chembl-interface-documentation/frequently-asked-questions/general-questions

Committed `disease_descriptions.jsonl` is a selected/reformatted MONDO derivative
under CC BY 4.0. Definitions are unchanged; selection and presentation are CHEERS
modifications. See `DESCRIPTION_SOURCE_NOTICES.md` for release, source hash,
attribution and license. `DISEASE_DESCRIPTIONS_MANIFEST.json` contains only
portable disease/inventory provenance. No public drug cross-reference artifact
is created. Raw UniChem and ChEMBL files remain local and ignored.

## Runtime

`EntityMetadataStore` preserves the existing gene loader and merges optional
description stores by exact `(entity_type, entity_id)` keys. Lookup is O(1),
without trimming, case folding or name fallback. Missing optional bundles use
identity-only display; present but incomplete or invalid bundles fail closed.
The API enriches response copies for center and neighbor nodes, without changing
graph membership, filtering, ordering or scores. Only the Subgraph Explorer
details panel renders the new metadata, provenance and full scientific disclaimer.
