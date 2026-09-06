# Grounded drug information

This revision changes only Drug cards. The existing frozen identity mapping,
disease definitions, gene metadata, model and graph data remain unchanged.

## Source strategy

1. Preserve the exact CHEERS DrugBank ID and frozen UniChem-to-ChEMBL assignment.
2. Only previously approved context mappings are eligible for therapeutic fields.
3. Join the complete ChEMBL InChIKey to the pinned FDA UNII archive. Require exactly
   one candidate across all FDA records, `INGREDIENT SUBSTANCE`, and `chemical`.
   Never select a first candidate, truncate the key, match names, or replace a
   salt/parent/active form. This bridge does not independently establish the
   original CHEERS entity's molecular identity.
4. Resolve the exact UNII in the FDA-authored DailyMed pharmacologic-class index.
   Use only explicitly marked `[EPC]` entries, preserving identifiers, document
   versions and effective dates. Do not convert MoA, CS or PE entries into EPCs.
   Render up to three distinct EPC labels; otherwise leave the class unavailable.
5. General use displays up to three exact MeSH indication names from ChEMBL 37
   records with `max_phase_for_ind=4` and a DailyMed, FDA or EMA reference. Exclude
   ClinicalTrials-only and ATC-only records. Sort distinct names by length, text,
   then identifier to prefer concise labels without rewriting or clinical ranking.
   These are selected source-listed indications, not an assertion of universal,
   current, formulation-independent approval. No arbitrary product label is
   selected or generalized. Labels have not been newly re-reviewed for each product.

The What field prefers EPC, falling back to the verified molecule type. Active
substance uses the matched FDA preferred name; otherwise it preserves the CHEERS
canonical entity label and does not claim active-moiety resolution. Unresolved,
review, biologic, salt/form, isotope and multicomponent cases retain existing
mapping safeguards and receive no new therapeutic fields. Missing fields remain
null and the interface shows a neutral fallback.

No indication prose, dosage, safety text, treatment recommendation, model-score
explanation or LLM-generated fact is included. No runtime network call is added.

## Frozen sources and reproduction

`SOURCE_MANIFEST.json` records exact archive URLs, retrieval intervals, sizes and
SHA-256 values. FDA UNII release: 2026-08-04. DailyMed is a rolling download frozen
at retrieval; individual indexing document dates are preserved in local provenance.
The original ChEMBL, inventory and mapping evidence fingerprints are also checked.

```text
python scripts/acquire_drug_information_sources.py
python scripts/build_drug_information.py
python final_release/verify_drug_information.py
python -O final_release/verify_drug_information.py
python final_release/test_drug_information.py
```

The acquisition helper verifies existing files without downloading again. A changed
rolling upstream archive fails its pinned fingerprint instead of silently updating
the snapshot. Retain the ignored raw archives: hashes cannot restore replaced data.
Interrupted downloads retain partials; publication is exclusive and hash-gated.
Reacquisition does not rewrite the original snapshot's retrieval timestamps.

Generated files are local only under `data/derived/entity_descriptions/`:
`drug_information.jsonl` (4,278 cards and field provenance) and
`DRUG_INFORMATION_MANIFEST.json`. The existing description artifacts remain
unchanged for reproducibility; Drug UI rendering uses the new structured card.
Build before starting the API, then verify. Present corrupt/incomplete bundles
fail closed; absent bundles render neutral fields and the canonical entity label.

## Attribution and redistribution boundary

Source: National Library of Medicine; National Institutes of Health;
U.S. Department of Health and Human Services. FDA is the author named in the
pharmacologic-class indexing documents. FDA UNII and DailyMed source references:

- https://precision.fda.gov/uniisearch/archive
- https://dailymed.nlm.nih.gov/dailymed/spl-resources-all-indexing-files.cfm
- https://dailymed.nlm.nih.gov/dailymed/webservices-help/v2/drugclasses_api.cfm
- https://dailymed.nlm.nih.gov/dailymed/about-dailymed.cfm
- https://www.nlm.nih.gov/web_policies.html#copyright
- https://chembl.gitbook.io/chembl-interface-documentation/frequently-asked-questions/drug-and-compound-questions

NLM distinguishes U.S. government works from protected third-party material.
Do not assume every label or referenced vocabulary is public domain. No product
label prose, DrugBank prose, RxNorm terms or ATC vocabulary is redistributed by
this revision. Raw archives and ALL drug-linked derived records stay local and
ignored; public bundling remains deferred for licensing review. Only source
provenance, code, tests and this CHEERS-authored methodology are commit candidates.

ChEMBL-derived portions retain release 37, record identifiers and CC BY-SA 3.0
obligations; see the existing tracked ChEMBL LICENSE/REQUIRED.ATTRIBUTION and
`final_release/entity_metadata_runtime/ENTITY_DESCRIPTIONS.md`. This does not
grant redistribution rights to every source component. Existing MONDO attribution
and disease artifacts are unchanged. No FDA/NLM endorsement is implied.
