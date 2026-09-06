# UniChem source notices

UniChem (EMBL-EBI) is used as an offline cross-reference source. A row means
UniChem reports a ChEMBL identifier cross-referenced to a DrugBank identifier.
The raw mapping and raw API responses are not redistributed in this repository.
The repository records acquisition provenance and verification methodology.
Public redistribution of a derived DrugBank-ChEMBL mapping is intentionally
deferred pending a later licensing review. No license for such redistribution
is inferred from access to the service or its software license.

ChEMBL 37 remains the pinned structured metadata source. Source metadata is
observed at acquisition time; it does not establish that the rolling pair file
was generated from the same metadata state or is cryptographically tied to
ChEMBL 37. Later B.3B-3 work must check candidate IDs against that local release.

The pair file has no full InChI, InChIKey, or UCI. CHEERS does not independently
reproduce UniChem's structural identity calculation. No Connectivity Search,
CHEERS mapping, drug facts, descriptions, or clinical/DDI claims are included.

The URL is mutable. Local SHA-256 values fingerprint the bytes retrieved over
HTTPS; they are not publisher-provided checksums. Retain the ignored snapshot
to reproduce verification: a hash cannot restore a superseded upstream file.
Each invocation creates a new snapshot. Failures preserve ignored .attempt-*
directories/partials for explicit inspection; no automatic resume or deletion.
Incomplete directories without acquisition_metadata.json are not valid releases.
Verification is read-only and does not change original acquisition timestamps.

Attribution and references:
- UniChem: https://chembl.gitbook.io/unichem
- Downloads: https://chembl.gitbook.io/unichem/downloads
- Source metadata: https://chembl.gitbook.io/unichem/api/sources
- Chambers et al. (2013), UniChem: a unified chemical structure cross-referencing
  and identifier tracking system. https://doi.org/10.1186/1758-2946-5-3
- Chambers et al. (2014), UniChem: extension of InChI-based compound mapping to
  salt, connectivity and stereochemistry layers. https://doi.org/10.1186/s13321-014-0043-5
  This paper describes UniChem data as CC-BY; current mapping redistribution
  and source-database conditions still require review.
- EMBL-EBI terms: https://www.ebi.ac.uk/about/terms-of-use/
- DrugBank terms: https://trust.drugbank.com/drugbank-trust-center/terms-of-use
