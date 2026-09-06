"""Freeze a rolling UniChem pair file as cross-reference evidence only.

No resume or replacement: failures preserve ignored .attempt-* directories.
The committed manifest is published last, only after all inputs validate.
Each invocation acquires a new snapshot; use the offline verifier for reuse.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.parse
import urllib.request
import uuid

PROJECT_DIR = Path(__file__).resolve().parents[1]
RAW_ROOT = PROJECT_DIR / "data/downloads/unichem"
PROVENANCE_ROOT = PROJECT_DIR / "final_release/source_provenance/unichem"
URL = "https://ftp.ebi.ac.uk/pub/databases/chembl/UniChem/data/wholeSourceMapping/src_id1/src1src2.txt.gz"
FILENAME = "src1src2.txt.gz"
SOURCE_URLS = {i: f"https://www.ebi.ac.uk/unichem/api/v1/sources/{i}" for i in (1, 2)}
HEADER = "From src:'1'\tTo src:'2'"
MAX_COMPRESSED = 8 * 1024 * 1024
MAX_DECOMPRESSED = 64 * 1024 * 1024
MAX_METADATA = 1024 * 1024
HTTP_FIELDS = ("Content-Length", "Last-Modified", "ETag", "Content-Encoding", "Accept-Ranges",
               "Content-Type", "Content-Range", "Transfer-Encoding")
SOURCE_FIELDS = ("sourceID", "name", "nameLabel", "nameLong", "srcReleaseNumber",
                 "srcReleaseDate", "lastUpdated", "UCICount")
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
NOTICES = """# UniChem source notices

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
"""


def require(value, message):
    if not value:
        raise RuntimeError(message)


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fingerprint(data):
    return {"byte_size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def regular_file(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink(), f"Nonregular file: {path}")


def parse_mapping(compressed):
    require(0 < len(compressed) <= MAX_COMPRESSED, "Compressed size limit")
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as handle:
        raw = handle.read(MAX_DECOMPRESSED + 1)
    require(len(raw) <= MAX_DECOMPRESSED, "Decompression size limit")
    text = raw.decode("utf-8", errors="strict")
    require(text.endswith("\n") and "\r" not in text, "Expected LF and final newline")
    lines = text[:-1].split("\n")
    require(lines[0] == HEADER, "Wrong header/orientation")
    pairs = Counter()
    left, right = defaultdict(set), defaultdict(set)
    for number, line in enumerate(lines[1:], 2):
        fields = line.split("\t")
        require(len(fields) == 2, f"Malformed column count at line {number}")
        chembl, drugbank = fields
        require(re.fullmatch(r"CHEMBL[0-9]+", chembl), f"Invalid ChEMBL ID at line {number}")
        require(re.fullmatch(r"DB[0-9]{5}", drugbank), f"Invalid DrugBank ID at line {number}")
        pairs[(chembl, drugbank)] += 1
        left[chembl].add(drugbank)
        right[drugbank].add(chembl)
    require(bool(pairs), "Empty mapping")
    statistics = {
        "data_row_count": sum(pairs.values()), "unique_chembl_ids": len(left),
        "unique_drugbank_ids": len(right),
        "exact_duplicate_pair_count": sum(count - 1 for count in pairs.values()),
        "chembl_ids_with_multiple_drugbank_mappings": sum(len(v) > 1 for v in left.values()),
        "drugbank_ids_with_multiple_chembl_mappings": sum(len(v) > 1 for v in right.values()),
        "malformed_row_count": 0, "blank_line_count": 0, "comment_line_count": 0,
    }
    return {"gzip_valid": True, "decompressed": fingerprint(raw),
            "parser": PARSER.copy(), "statistics": statistics}


def response_headers(response):
    headers = {}
    for name in HTTP_FIELDS:
        values = response.headers.get_all(name, [])
        require(len(values) <= 1, f"Duplicate HTTP header: {name}")
        headers[name] = values[0].strip() if values else None
    require(headers["Content-Encoding"] in (None, "identity"), "Unexpected HTTP encoding")
    require(headers["Content-Range"] is None, "Unexpected range response")
    require(headers["Transfer-Encoding"] is None, "Unexpected transfer framing")
    length = headers["Content-Length"]
    require(isinstance(length, str) and re.fullmatch(r"[0-9]+", length), "Missing/invalid Content-Length")
    return headers


class RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("HTTP redirects are not accepted for frozen source acquisition")


def fetch(url, partial, *, opener=None, preflight=False, limit=MAX_METADATA):
    """No redirects, no resume; partials belong to this exclusive attempt."""
    require(urllib.parse.urlsplit(url).scheme == "https", "HTTPS source URL required")
    opener = opener or urllib.request.build_opener(RejectRedirects()).open
    started = utc_now()
    observed = None
    request_headers = {"Accept-Encoding": "identity", "User-Agent": "CHEERS-UniChem-snapshot/1.0"}
    if preflight:
        with opener(urllib.request.Request(url, headers=request_headers, method="HEAD"), timeout=60) as response:
            require(response.status == 200 and response.geturl() == url, "HEAD status/URL mismatch")
            observed = response_headers(response)
            require(0 < int(observed["Content-Length"]) <= limit, "HEAD size limit")
        etag = observed["ETag"]
        require(isinstance(etag, str) and re.fullmatch(r'"[^"\r\n]+"', etag), "Strong ETag required for rolling source")
        request_headers["If-Match"] = etag
    with opener(urllib.request.Request(url, headers=request_headers), timeout=60) as response:
        require(response.status == 200 and response.geturl() == url, "GET status/URL mismatch")
        headers = response_headers(response)
        expected = int(headers["Content-Length"])
        require(0 < expected <= limit, "Response size limit")
        if observed is not None:
            for key in ("ETag", "Last-Modified", "Content-Length"):
                require(headers[key] == observed[key], f"Rolling source changed: {key}")
        with partial.open("xb") as output:
            total = 0
            try:
                while block := response.read(64 * 1024):
                    require(total + len(block) <= expected, "Response exceeds Content-Length")
                    require(output.write(block) == len(block), "Short write")
                    total += len(block)
                require(total == expected, "Premature EOF; partial preserved")
            finally:
                output.flush()
                os.fsync(output.fileno())
    return {"url": url, "status": 200, "headers": headers, "preflight_headers": observed,
            "started_utc": started, "completed_utc": utc_now()}


def source_values(raw, source_id):
    data = json.loads(raw)
    require(data.get("response") == "Success" and len(data.get("sources", [])) == 1,
            "Invalid source response")
    source = data["sources"][0]
    require(type(source.get("sourceID")) is int and source["sourceID"] == source_id,
            "Wrong source ID")
    require(source.get("name") == {1: "chembl", 2: "drugbank"}[source_id], "Wrong source name")
    require(source.get("nameLabel") == {1: "ChEMBL", 2: "DrugBank"}[source_id], "Wrong source label")
    require(all(key in source for key in SOURCE_FIELDS), "Missing source metadata fields")
    return {key: source[key] for key in SOURCE_FIELDS}


def publish_file(source, destination):
    regular_file(source)
    os.link(source, destination)  # Atomic no-overwrite, including dangling symlink collisions.
    source.unlink()


def write_exclusive(path, data):
    with path.open("xb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def acquire(*, raw_root=RAW_ROOT, provenance_root=PROVENANCE_ROOT, opener=None):
    started = utc_now()
    raw_root.mkdir(parents=True, exist_ok=True)
    attempt = raw_root / (".attempt-" + uuid.uuid4().hex)
    attempt.mkdir()
    try:
        mapping_part = attempt / (FILENAME + ".part")
        transfer = fetch(URL, mapping_part, opener=opener, preflight=True, limit=MAX_COMPRESSED)
        compressed = mapping_part.read_bytes()
        compressed_info = fingerprint(compressed)
        verification = parse_mapping(compressed)
        sources = []
        for source_id, url in SOURCE_URLS.items():
            filename = f"source_{source_id}.json"
            path = attempt / (filename + ".part")
            observation = fetch(url, path, opener=opener)
            raw = path.read_bytes()
            sources.append({"filename": filename, "fingerprint": fingerprint(raw),
                            "observation": observation, "values": source_values(raw, source_id)})
        completed = utc_now()
        timestamp = datetime.fromisoformat(started.replace("Z", "+00:00"))
        snapshot = timestamp.strftime("%Y%m%dT%H%M%S%fZ") + "-" + compressed_info["sha256"][:16]
        source_metadata = {"schema": "cheers.unichem-source-metadata", "version": 1,
                           "snapshot_id": snapshot, "sources": sources}
        source_bytes = json_bytes(source_metadata)
        notices_bytes = NOTICES.encode("utf-8")
        metadata = {
            "schema": "cheers.unichem-pair-acquisition", "version": 1, "snapshot_id": snapshot,
            "acquisition_started_utc": started, "acquisition_completed_utc": completed,
            "upstream": {"filename": FILENAME, "mutable_url": True,
                         "publisher_sha256": None, "transfer": transfer, "compressed": compressed_info},
            "local_verification": verification, "limitations": LIMITATIONS.copy(),
            "local_chembl_reference": CHEMBL37.copy(),
            "provenance_files": {"source_metadata.json": fingerprint(source_bytes),
                                 "SOURCE_NOTICES.md": fingerprint(notices_bytes)},
        }
        # All network, gzip, parser and source-identity checks precede publication.
        raw_destination = raw_root / snapshot
        provenance_root.mkdir(parents=True, exist_ok=True)
        provenance_destination = provenance_root / snapshot
        require(not os.path.lexists(raw_destination) and not os.path.lexists(provenance_destination),
                "Snapshot already exists; refusing overwrite")
        raw_destination.mkdir()  # Exclusive directory reservations; collisions fail closed.
        provenance_destination.mkdir()
        for filename in (FILENAME, "source_1.json", "source_2.json"):
            publish_file(attempt / (filename + ".part"), raw_destination / filename)
        for filename, content in (("source_metadata.json", source_bytes), ("SOURCE_NOTICES.md", notices_bytes),
                                  ("acquisition_metadata.json", json_bytes(metadata))):
            write_exclusive(provenance_destination / filename, content)
        attempt.rmdir()
        return metadata
    except BaseException:
        print(f"FAILED: incomplete acquisition preserved under {attempt}; no automatic resume.", file=sys.stderr)
        raise


if __name__ == "__main__":
    try:
        result = acquire()
        print("PASS: frozen UniChem cross-reference snapshot", result["snapshot_id"])
        print(json.dumps(result, indent=2))
    except (Exception, KeyboardInterrupt) as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
