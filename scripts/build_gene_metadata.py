"""Retrieve and build the frozen CHEERS NCBI gene metadata artifact.

Retrieval is explicit (``--retrieve``) and uses the documented NCBI Datasets
v2 gene dataset-report endpoint. Normal builds are fully offline and read the
previously retrieved JSONL source from the ignored data/downloads directory.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


PROJECT_DIR = Path(__file__).resolve().parents[1]
CONTEXT_PATH = PROJECT_DIR / "final_release/g3_context_runtime/g3_drug_context.csv"
RAW_PATH = PROJECT_DIR / "data/downloads/ncbi/gene_dataset_reports.jsonl"
OUTPUT_DIR = PROJECT_DIR / "final_release/entity_metadata_runtime"
OUTPUT_PATH = OUTPUT_DIR / "gene_metadata.jsonl"
MANIFEST_PATH = OUTPUT_DIR / "GENE_METADATA_MANIFEST.json"
API_TEMPLATE = "https://api.ncbi.nlm.nih.gov/datasets/v2/gene/id/{gene_ids}/dataset_report"
DOCUMENTATION_URLS = [
    "https://www.ncbi.nlm.nih.gov/datasets/docs/v2/how-tos/genes/get-gene-metadata/",
    "https://www.ncbi.nlm.nih.gov/datasets/docs/v2/reference-docs/data-reports/gene/",
    "https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-api/",
    "https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/deprecated-apis/",
    "https://www.ncbi.nlm.nih.gov/home/about/policies/",
]
EXPECTED_GENE_COUNT = 3_094
MAPPING_RULE = (
    "Exact decimal NCBI GeneID only: CHEERS context_id == NCBI gene_id. "
    "No name, symbol, synonym, alias, fuzzy, or case-insensitive fallback."
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text(value):
    if value is None:
        return None
    normalized = " ".join(str(value).split())
    return normalized if normalized and normalized != "-" else None


def field(record, snake_name, camel_name=None):
    if snake_name in record:
        return record[snake_name]
    if camel_name and camel_name in record:
        return record[camel_name]
    return None


def load_project_genes(path: Path):
    by_node = {}
    by_id = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["context_group"] != "gene/protein" or row["context_source"] != "NCBI":
                continue
            gene_id = row["context_id"].strip()
            node_id = int(row["context_node_id"])
            if not gene_id.isascii() or not gene_id.isdigit():
                raise ValueError(f"Project GeneID is not numeric: {gene_id!r}.")
            identity = {
                "graph_node_id": node_id,
                "entity_id": gene_id,
                "entity_type": "gene/protein",
                "display_name": row["context_name"].strip(),
                "source": "NCBI",
            }
            if node_id in by_node and by_node[node_id] != identity:
                raise ValueError(f"Graph node {node_id} has inconsistent gene identity.")
            if gene_id in by_id and by_id[gene_id] != identity:
                raise ValueError(f"GeneID {gene_id} maps to multiple graph nodes.")
            by_node[node_id] = identity
            by_id[gene_id] = identity
    if len(by_node) != EXPECTED_GENE_COUNT or len(by_id) != EXPECTED_GENE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_GENE_COUNT} unique graph nodes and GeneIDs; "
            f"found {len(by_node)} and {len(by_id)}."
        )
    return [by_node[node_id] for node_id in sorted(by_node)]


def retrieve_reports(gene_ids, raw_path: Path, batch_size=50):
    reports = []
    for start in range(0, len(gene_ids), batch_size):
        batch = gene_ids[start : start + batch_size]
        url = (
            API_TEMPLATE.format(gene_ids=quote(",".join(batch), safe=","))
            + f"?page_size={batch_size}"
        )
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "CHEERS-PrimeKG-RGCN/2.3A (academic metadata export)",
            },
        )
        last_error = None
        for attempt in range(4):
            try:
                with urlopen(request, timeout=90) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                batch_reports = payload.get("reports")
                if not isinstance(batch_reports, list):
                    raise ValueError("NCBI response does not contain a reports list.")
                total_count = int(payload.get("total_count", len(batch_reports)))
                if len(batch_reports) < total_count:
                    raise ValueError(
                        "NCBI response is paginated and the requested page did not "
                        "contain the complete batch."
                    )
                reports.extend(batch_reports)
                last_error = None
                break
            except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt < 3:
                    time.sleep(2 ** attempt)
        if last_error is not None:
            raise RuntimeError(
                f"NCBI retrieval failed for batch beginning at index {start}: {last_error}"
            ) from last_error
        print(
            f"Retrieved {min(start + batch_size, len(gene_ids))}/{len(gene_ids)} "
            "project GeneIDs."
        )
        time.sleep(0.35)

    def report_key(report):
        gene = report.get("gene", report)
        gene_id = str(field(gene, "gene_id", "geneId") or "")
        query_ids = report.get("query") or gene.get("query") or []
        query_key = ",".join(str(value) for value in query_ids)
        return (int(gene_id) if gene_id.isdigit() else 10**20, query_key)

    raw_path.parent.mkdir(parents=True, exist_ok=True)
    with raw_path.open("w", encoding="utf-8", newline="\n") as handle:
        for report in sorted(reports, key=report_key):
            handle.write(json.dumps(report, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"Wrote {len(reports)} raw NCBI reports to {raw_path}.")


def load_source_reports(path: Path):
    exact = {}
    replacement_by_old = {}
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            report = json.loads(line)
            gene = report.get("gene", report)
            if not isinstance(gene, dict):
                raise ValueError(f"Raw source line {line_number} has no gene object.")
            gene_id = str(field(gene, "gene_id", "geneId") or "").strip()
            if not gene_id.isdigit():
                raise ValueError(f"Raw source line {line_number} has invalid GeneID.")
            if gene_id in exact:
                raise ValueError(f"Duplicate source GeneID: {gene_id}.")
            exact[gene_id] = gene
            replaced = field(gene, "replaced_gene_id", "replacedGeneId")
            if replaced is not None:
                old_id = str(replaced).strip()
                if old_id.isdigit():
                    if old_id in replacement_by_old and replacement_by_old[old_id] != gene_id:
                        raise ValueError(f"Conflicting replacements for GeneID {old_id}.")
                    replacement_by_old[old_id] = gene_id
    return exact, replacement_by_old


def aliases_from(gene):
    values = field(gene, "synonyms") or []
    if not isinstance(values, list):
        raise ValueError("NCBI synonyms must be a list.")
    normalized = {value for item in values if (value := text(item)) is not None}
    return sorted(normalized, key=lambda value: (value.casefold(), value))


def summary_from(gene):
    summaries = field(gene, "summary") or []
    if not isinstance(summaries, list):
        raise ValueError("NCBI summary must be a list.")
    for item in summaries:
        if not isinstance(item, dict):
            continue
        description = text(field(item, "description"))
        if description:
            return (
                description,
                text(field(item, "source")),
                text(field(item, "date")),
            )
    return None, None, None


def empty_metadata(replacement_gene_id=None):
    return {
        "matched": False,
        "ncbi_gene_id": None,
        "official_symbol": None,
        "official_full_name": None,
        "aliases": [],
        "taxonomy_id": None,
        "organism": None,
        "summary": None,
        "summary_source": None,
        "summary_date": None,
        "source_modified_date": None,
        "record_status": "merged" if replacement_gene_id else None,
        "replacement_gene_id": replacement_gene_id,
    }


def metadata_from(gene, project_gene_id):
    source_gene_id = str(field(gene, "gene_id", "geneId"))
    if source_gene_id != project_gene_id:
        raise ValueError("Attempted to attach non-exact NCBI metadata.")
    summary, summary_source, summary_date = summary_from(gene)
    taxonomy_id = field(gene, "tax_id", "taxId")
    return {
        "matched": True,
        "ncbi_gene_id": source_gene_id,
        "official_symbol": text(field(gene, "symbol")),
        "official_full_name": text(field(gene, "description")),
        "aliases": aliases_from(gene),
        "taxonomy_id": str(taxonomy_id) if taxonomy_id is not None else None,
        "organism": text(field(gene, "taxname")),
        "summary": summary,
        "summary_source": summary_source,
        "summary_date": summary_date,
        "source_modified_date": None,
        "record_status": None,
        "replacement_gene_id": None,
    }


def calculate_statistics(records, replacement_by_old):
    taxonomy = {}
    for record in records:
        metadata = record["metadata"]
        tax_id = metadata["taxonomy_id"]
        if tax_id:
            entry = taxonomy.setdefault(
                tax_id, {"organism": metadata["organism"], "count": 0}
            )
            if entry["organism"] != metadata["organism"]:
                raise ValueError(f"Taxonomy {tax_id} has inconsistent organism names.")
            entry["count"] += 1
    matched = sum(record["metadata"]["matched"] for record in records)
    return {
        "matched_count": matched,
        "unmatched_count": len(records) - matched,
        "taxonomy_counts": dict(sorted(taxonomy.items(), key=lambda item: int(item[0]))),
        "human_gene_count": sum(
            record["metadata"]["taxonomy_id"] == "9606" for record in records
        ),
        "nonhuman_gene_count": sum(
            record["metadata"]["taxonomy_id"] not in (None, "9606") for record in records
        ),
        "missing_taxonomy_count": sum(
            record["metadata"]["taxonomy_id"] is None for record in records
        ),
        "missing_official_symbol": sum(
            record["metadata"]["official_symbol"] is None for record in records
        ),
        "missing_official_full_name": sum(
            record["metadata"]["official_full_name"] is None for record in records
        ),
        "missing_aliases": sum(
            not record["metadata"]["aliases"] for record in records
        ),
        "missing_summary": sum(
            record["metadata"]["summary"] is None for record in records
        ),
        "project_name_symbol_mismatches": sum(
            record["metadata"]["matched"]
            and record["display_name"] != record["metadata"]["official_symbol"]
            for record in records
        ),
        "deprecated_or_merged_geneids": [
            {"project_gene_id": old_id, "replacement_gene_id": new_id}
            for old_id, new_id in sorted(
                replacement_by_old.items(), key=lambda item: int(item[0])
            )
            if any(record["entity_id"] == old_id for record in records)
        ],
    }


def build(project_genes, raw_path: Path, output_path: Path, manifest_path: Path):
    source_by_id, replacement_by_old = load_source_reports(raw_path)
    records = []
    for identity in project_genes:
        gene_id = identity["entity_id"]
        if gene_id in source_by_id:
            metadata = metadata_from(source_by_id[gene_id], gene_id)
        else:
            metadata = empty_metadata(replacement_by_old.get(gene_id))
        records.append({**identity, "metadata": metadata})

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    statistics = calculate_statistics(records, replacement_by_old)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    relative = lambda path: path.relative_to(PROJECT_DIR).as_posix()
    manifest = {
        "artifact_name": "CHEERS NCBI gene metadata",
        "artifact_version": "1.0.0",
        "schema_version": "1.0.0",
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "project_graph": "G3",
        "project_gene_count": len(records),
        "source_name": "NCBI Datasets v2 Gene dataset report",
        "source_release": "Live NCBI Datasets v2 report; retrieval-date snapshot",
        "source_urls": DOCUMENTATION_URLS + [API_TEMPLATE],
        "retrieval_date": now.date().isoformat(),
        "license_status": (
            "NCBI states it places no restrictions on molecular-data use or "
            "distribution, while noting that some submitted material may carry "
            "third-party rights; NCBI/NLM acknowledgment and disclaimer apply."
        ),
        "raw_input_files": [relative(raw_path)],
        "raw_input_sha256": {relative(raw_path): sha256(raw_path)},
        "project_context_file": relative(CONTEXT_PATH),
        "project_context_sha256": sha256(CONTEXT_PATH),
        "output_file": relative(output_path),
        "output_sha256": sha256(output_path),
        "mapping_rule": MAPPING_RULE,
        **statistics,
        "transformation_rules": [
            "Trim and collapse whitespace in presentation text.",
            "Normalize empty strings and '-' placeholders to null.",
            "Preserve CHEERS graph_node_id, entity_id, display_name, entity_type, and source.",
            "Deduplicate exact alias strings and sort aliases case-insensitively.",
            "Use the first non-empty NCBI summary in source order without rewriting it.",
            "Never replace a project GeneID; record an explicit replacement separately.",
        ],
        "scientific_scope": [
            "Metadata is supplemental entity context.",
            "Metadata was not textual input to R-GCN training.",
            "Metadata does not explain model scores.",
            "Metadata does not establish a DDI mechanism.",
            "Metadata is not clinical advice.",
        ],
    }
    with manifest_path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    return records, manifest


def print_report(records, manifest, output_path):
    print(f"TOTAL PROJECT GENES: {len(records)}")
    print(f"MATCHED EXACT GENEIDS: {manifest['matched_count']}")
    print(f"UNMATCHED: {manifest['unmatched_count']}")
    print(f"MATCH RATE: {manifest['matched_count'] / len(records) * 100:.2f}%")
    print("TAXONOMY DISTRIBUTION:")
    for tax_id, entry in manifest["taxonomy_counts"].items():
        print(f"  {tax_id} | {entry['organism']} | {entry['count']}")
    for key in (
        "human_gene_count", "nonhuman_gene_count", "missing_taxonomy_count",
        "missing_official_symbol", "missing_official_full_name", "missing_aliases",
        "missing_summary", "project_name_symbol_mismatches",
    ):
        print(f"{key.upper()}: {manifest[key]}")
    print(f"DEPRECATED / MERGED GENEIDS: {len(manifest['deprecated_or_merged_geneids'])}")
    print(f"ARTIFACT SIZE: {output_path.stat().st_size} bytes")
    by_id = {record["entity_id"]: record for record in records}
    for gene_id in ("1562", "7498", "6564"):
        record = by_id[gene_id]
        metadata = record["metadata"]
        summary = metadata["summary"]
        print(json.dumps({
            "display_name": record["display_name"],
            "gene_id": gene_id,
            "graph_node_id": record["graph_node_id"],
            "official_symbol": metadata["official_symbol"],
            "official_full_name": metadata["official_full_name"],
            "aliases": metadata["aliases"],
            "taxonomy_id": metadata["taxonomy_id"],
            "organism": metadata["organism"],
            "summary_available": summary is not None,
            "summary_preview": summary[:200] if summary else None,
        }, ensure_ascii=False, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--retrieve", action="store_true", help="Retrieve raw NCBI reports before building.")
    parser.add_argument("--raw", type=Path, default=RAW_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    args = parser.parse_args()
    project_genes = load_project_genes(CONTEXT_PATH)
    if args.retrieve:
        retrieve_reports([row["entity_id"] for row in project_genes], args.raw)
    if not args.raw.is_file():
        raise FileNotFoundError(
            f"Raw NCBI source not found: {args.raw}. Run with --retrieve first."
        )
    records, manifest = build(project_genes, args.raw, args.output, args.manifest)
    print_report(records, manifest, args.output)


if __name__ == "__main__":
    main()
