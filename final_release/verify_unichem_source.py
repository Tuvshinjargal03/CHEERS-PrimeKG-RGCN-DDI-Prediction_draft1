"""Offline verification of frozen UniChem cross-reference evidence, not molecular identity.

The reviewed provenance directory pins each local snapshot. Portable checkouts may
omit raw files; --require-source makes their absence a failure. Never fetch data.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat

PROJECT_DIR = Path(__file__).resolve().parents[1]
PROVENANCE_ROOT = PROJECT_DIR / "final_release/source_provenance/unichem"
RAW_ROOT = PROJECT_DIR / "data/downloads/unichem"
URL = "https://ftp.ebi.ac.uk/pub/databases/chembl/UniChem/data/wholeSourceMapping/src_id1/src1src2.txt.gz"
FILENAME = "src1src2.txt.gz"
MAX_COMPRESSED = 8 * 1024 * 1024
MAX_DECOMPRESSED = 64 * 1024 * 1024
MAX_METADATA = 1024 * 1024
HEADER = "From src:'1'\tTo src:'2'"
SOURCE_FIELDS = ("sourceID", "name", "nameLabel", "nameLong", "srcReleaseNumber",
                 "srcReleaseDate", "lastUpdated", "UCICount")
HTTP_FIELDS = {"Content-Length", "Last-Modified", "ETag", "Content-Encoding", "Accept-Ranges",
               "Content-Type", "Content-Range", "Transfer-Encoding"}
LIMITATIONS = {
    "evidence_type": "unichem_reported_cross_reference",
    "contains_full_inchi": False, "contains_inchikey": False, "contains_uci": False,
    "independent_molecular_identity_proven": False, "connectivity_search_used": False,
    "cheers_entities_mapped": False, "cryptographically_tied_to_chembl37": False,
    "source_metadata_proves_pair_generation_state": False,
    "public_mapping_redistribution": "deferred_pending_licensing_review",
}
CHEMBL37 = {
    "release": 37,
    "archive_sha256": "33c203740555f96067710cdfc1c3c55d890660e5908ec5cbf5817492c290d281",
    "sqlite_sha256": "4be13df3b68e25dcd0bff44bf094033b5aebe98f415acdc8c1cdf380e0c15142",
}
PARSER = {"schema": "unichem.source1-source2.tsv", "version": 1, "header": HEADER,
          "columns": ["chembl_id", "drugbank_id"], "encoding": "UTF-8 (ASCII identifiers)",
          "newline": "LF", "final_newline_required": True,
          "duplicates": "preserved and counted", "blank_or_comment_lines": "rejected"}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def same(actual, expected, message):
    # JSON representation distinguishes booleans from integers in schema fields.
    require(json.dumps(actual, sort_keys=True) == json.dumps(expected, sort_keys=True), message)


def directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink(), f"Nonregular directory: {path}")


def file_bytes(path, limit):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink(), f"Nonregular file: {path}")
    require(0 < info.st_size <= limit, f"File size limit: {path.name}")
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    require(len(data) == info.st_size, f"File changed/size limit: {path.name}")
    return data


def fingerprint(data):
    return {"byte_size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def check_fingerprint(value):
    require(set(value) == {"byte_size", "sha256"}, "Fingerprint schema mismatch")
    require(type(value["byte_size"]) is int and value["byte_size"] > 0, "Invalid byte size")
    require(isinstance(value["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", value["sha256"]),
            "Invalid SHA-256")


def utc(value):
    require(isinstance(value, str) and value.endswith("Z"), "UTC timestamp required")
    parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    require(parsed.utcoffset().total_seconds() == 0, "Timestamp is not UTC")
    return parsed


def check_headers(headers):
    require(set(headers) == HTTP_FIELDS, "HTTP header schema mismatch")
    require(all(value is None or isinstance(value, str) for value in headers.values()), "Invalid header type")
    length = headers["Content-Length"]
    require(isinstance(length, str) and re.fullmatch(r"[0-9]+", length) and int(length) > 0,
            "Invalid HTTP Content-Length")
    require(headers["Content-Encoding"] in (None, "identity"), "Unexpected HTTP encoding")
    require(headers["Content-Range"] is None and headers["Transfer-Encoding"] is None,
            "Unexpected HTTP framing")


def check_transfer(transfer, url, size, start, end, mapping=False):
    require(set(transfer) == {"url", "status", "headers", "preflight_headers", "started_utc", "completed_utc"},
            "Transfer schema mismatch")
    require(transfer["url"] == url and type(transfer["status"]) is int and transfer["status"] == 200,
            "Source URL/status mismatch")
    require(start <= utc(transfer["started_utc"]) <= utc(transfer["completed_utc"]) <= end,
            "Transfer timestamps outside acquisition interval")
    check_headers(transfer["headers"])
    require(int(transfer["headers"]["Content-Length"]) == size, "HTTP size mismatch")
    if mapping:
        preflight = transfer["preflight_headers"]
        check_headers(preflight)
        require(re.fullmatch(r'"[^"\r\n]+"', preflight["ETag"] or ""), "Missing strong ETag")
        for key in ("ETag", "Last-Modified", "Content-Length"):
            require(preflight[key] == transfer["headers"][key], "Rolling representation mismatch")
    else:
        require(transfer["preflight_headers"] is None, "Unexpected API preflight")


def parse_mapping(compressed):
    """Independently count rows without normalizing or selecting identifiers."""
    require(0 < len(compressed) <= MAX_COMPRESSED, "Compressed size limit")
    with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as stream:
        payload = stream.read(MAX_DECOMPRESSED + 1)
    require(len(payload) <= MAX_DECOMPRESSED, "Decompressed size limit")
    require(payload.endswith(b"\n") and b"\r" not in payload, "Invalid newline convention")
    rows = payload.decode("utf-8", errors="strict").split("\n")
    require(rows.pop() == "" and rows.pop(0) == HEADER, "Wrong header/orientation")
    pairs = []
    for line in rows:
        cells = line.split("\t")
        require(len(cells) == 2, "Malformed column count")
        require(re.fullmatch(r"CHEMBL[0-9]+", cells[0]) is not None, "Invalid ChEMBL ID")
        require(re.fullmatch(r"DB[0-9]{5}", cells[1]) is not None, "Invalid DrugBank ID")
        pairs.append(tuple(cells))
    require(len(pairs) > 0, "Empty mapping")
    unique = set(pairs)
    left_counts = Counter(left for left, right in unique)
    right_counts = Counter(right for left, right in unique)
    return {
        "gzip_valid": True, "decompressed": fingerprint(payload), "parser": PARSER,
        "statistics": {
            "data_row_count": len(pairs), "unique_chembl_ids": len(left_counts),
            "unique_drugbank_ids": len(right_counts), "exact_duplicate_pair_count": len(pairs) - len(unique),
            "chembl_ids_with_multiple_drugbank_mappings": sum(n > 1 for n in left_counts.values()),
            "drugbank_ids_with_multiple_chembl_mappings": sum(n > 1 for n in right_counts.values()),
            "malformed_row_count": 0, "blank_line_count": 0, "comment_line_count": 0,
        },
    }


def verify_snapshot(provenance_dir, raw_root=RAW_ROOT, require_source=False):
    directory(provenance_dir)
    snapshot = provenance_dir.name
    require(re.fullmatch(r"[0-9]{8}T[0-9]{12}Z-[0-9a-f]{16}", snapshot), "Invalid snapshot ID")
    metadata = json.loads(file_bytes(provenance_dir / "acquisition_metadata.json", MAX_METADATA))
    require(set(metadata) == {"schema", "version", "snapshot_id", "acquisition_started_utc",
        "acquisition_completed_utc", "upstream", "local_verification", "limitations",
        "local_chembl_reference", "provenance_files"}, "Acquisition schema fields mismatch")
    require(metadata["schema"] == "cheers.unichem-pair-acquisition" and type(metadata["version"]) is int
            and metadata["version"] == 1 and metadata["snapshot_id"] == snapshot, "Acquisition schema mismatch")
    start, end = utc(metadata["acquisition_started_utc"]), utc(metadata["acquisition_completed_utc"])
    require(start <= end, "Acquisition timestamp order")
    same(metadata["limitations"], LIMITATIONS, "Scientific limitations mismatch")
    same(metadata["local_chembl_reference"], CHEMBL37, "Pinned ChEMBL 37 reference mismatch")
    upstream = metadata["upstream"]
    require(set(upstream) == {"filename", "mutable_url", "publisher_sha256", "transfer", "compressed"},
            "Upstream schema mismatch")
    require(upstream["filename"] == FILENAME and upstream["mutable_url"] is True
            and upstream["publisher_sha256"] is None, "Upstream identity/claims mismatch")
    check_fingerprint(upstream["compressed"])
    require(upstream["compressed"]["byte_size"] <= MAX_COMPRESSED, "Compressed size limit")
    require(snapshot == start.strftime("%Y%m%dT%H%M%S%fZ") + "-" + upstream["compressed"]["sha256"][:16],
            "Snapshot ID does not match acquisition time/hash")
    check_transfer(upstream["transfer"], URL, upstream["compressed"]["byte_size"], start, end, mapping=True)
    verification = metadata["local_verification"]
    require(set(verification) == {"gzip_valid", "decompressed", "parser", "statistics"}, "Verification schema")
    require(verification["gzip_valid"] is True, "Missing gzip verification")
    check_fingerprint(verification["decompressed"])
    require(verification["decompressed"]["byte_size"] <= MAX_DECOMPRESSED, "Decompressed size limit")
    same(verification["parser"], PARSER, "Parser schema mismatch")
    expected_stat_keys = {"data_row_count", "unique_chembl_ids", "unique_drugbank_ids",
        "exact_duplicate_pair_count", "chembl_ids_with_multiple_drugbank_mappings",
        "drugbank_ids_with_multiple_chembl_mappings", "malformed_row_count", "blank_line_count", "comment_line_count"}
    stats = verification["statistics"]
    require(set(stats) == expected_stat_keys and all(type(n) is int and n >= 0 for n in stats.values()),
            "Statistics schema mismatch")
    require(stats["data_row_count"] > 0 and all(stats[k] == 0 for k in
            ("malformed_row_count", "blank_line_count", "comment_line_count")), "Unexpected row observations")
    require(set(metadata["provenance_files"]) == {"source_metadata.json", "SOURCE_NOTICES.md"}, "Provenance filenames")
    documents = {}
    for name, expected in metadata["provenance_files"].items():
        check_fingerprint(expected)
        documents[name] = file_bytes(provenance_dir / name, MAX_METADATA)
        same(fingerprint(documents[name]), expected, "Provenance hash/size mismatch: " + name)
        require(b"\r" not in documents[name] and documents[name].endswith(b"\n"), "Provenance newline mismatch")
        documents[name].decode("utf-8", errors="strict")
    source_metadata = json.loads(documents["source_metadata.json"])
    require(set(source_metadata) == {"schema", "version", "snapshot_id", "sources"}, "Source schema fields")
    require(source_metadata["schema"] == "cheers.unichem-source-metadata"
            and type(source_metadata["version"]) is int and source_metadata["version"] == 1
            and source_metadata["snapshot_id"] == snapshot, "Source schema mismatch")
    sources = source_metadata["sources"]
    require(isinstance(sources, list) and len(sources) == 2, "Expected two source records")
    for source_id, source in zip((1, 2), sources):
        require(set(source) == {"filename", "fingerprint", "observation", "values"}, "Source record schema")
        require(source["filename"] == f"source_{source_id}.json", "Raw source filename")
        check_fingerprint(source["fingerprint"])
        require(source["fingerprint"]["byte_size"] <= MAX_METADATA, "Source response size limit")
        values = source["values"]
        require(set(values) == set(SOURCE_FIELDS), "Source values schema mismatch")
        require(type(values["sourceID"]) is int and values["sourceID"] == source_id
                and values["name"] == {1: "chembl", 2: "drugbank"}[source_id]
                and values["nameLabel"] == {1: "ChEMBL", 2: "DrugBank"}[source_id], "Source orientation mismatch")
        check_transfer(source["observation"], f"https://www.ebi.ac.uk/unichem/api/v1/sources/{source_id}",
                       source["fingerprint"]["byte_size"], start, end)
    # Validate committed provenance even when optional raw source is absent.
    raw_dir = raw_root / snapshot
    if not os.path.lexists(raw_dir):
        require(not require_source, "Required local UniChem snapshot missing")
        print(f"SKIP: raw UniChem snapshot absent: {snapshot}; committed provenance checked.")
        return False
    directory(raw_root)
    directory(raw_dir)
    compressed = file_bytes(raw_dir / FILENAME, MAX_COMPRESSED)
    same(fingerprint(compressed), upstream["compressed"], "Compressed hash/size mismatch")
    same(parse_mapping(compressed), verification, "Decompressed fingerprint/parser/statistics mismatch")
    for source_id, source in zip((1, 2), sources):
        raw = file_bytes(raw_dir / source["filename"], MAX_METADATA)
        same(fingerprint(raw), source["fingerprint"], "Raw source response hash/size mismatch")
        data = json.loads(raw)
        require(data.get("response") == "Success" and len(data.get("sources", [])) == 1, "Raw source response invalid")
        actual = data["sources"][0]
        require(all(key in actual for key in SOURCE_FIELDS), "Raw source fields missing")
        same({key: actual[key] for key in SOURCE_FIELDS}, source["values"], "Source metadata differs from raw response")
    print(f"PASS: {snapshot}: compressed and decompressed size/SHA-256, gzip, exact TSV orientation,")
    print("PASS: all row statistics, source responses, provenance and cross-reference limitations verified offline.")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-source", action="store_true", help="Fail if any expected local source is absent")
    args = parser.parse_args()
    directory(PROVENANCE_ROOT)
    snapshots = sorted(PROVENANCE_ROOT.iterdir())
    require(bool(snapshots), "No committed UniChem snapshots found")
    for snapshot in snapshots:
        verify_snapshot(snapshot, require_source=args.require_source)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
