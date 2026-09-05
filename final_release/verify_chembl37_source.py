"""Independently verify the ignored, pinned ChEMBL 37 SQLite source."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import tarfile
from contextlib import closing
from datetime import datetime
from pathlib import Path, PurePosixPath, PureWindowsPath


PROJECT_DIR = Path(__file__).resolve().parents[1]
SOURCE_DIR = PROJECT_DIR / "data/downloads/chembl/chembl_37"
ARCHIVE = SOURCE_DIR / "chembl_37_sqlite.tar.gz"
METADATA = SOURCE_DIR / "acquisition_metadata.json"
EXPECTED_SHA256 = "33c203740555f96067710cdfc1c3c55d890660e5908ec5cbf5817492c290d281"
EXPECTED_SIZE = 5_764_252_857
EXPECTED_URL = "https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/releases/chembl_37/chembl_37_sqlite.tar.gz"
EXPECTED_SQLITE_MEMBER = "chembl_37/chembl_37_sqlite/chembl_37.db"
EXPECTED_SQLITE_SIZE = 30_480_314_368
EXPECTED_SQLITE_SHA256 = "4be13df3b68e25dcd0bff44bf094033b5aebe98f415acdc8c1cdf380e0c15142"
TIMESTAMP_SEMANTICS = (
    "retrieval_timestamp_utc is the recorded acquisition completion time, preserved on reuse; "
    "null means the original acquisition time is unknown. verification_timestamp_utc is "
    "the completion time of local verification. transfer describes this run; "
    "acquisition_transfer preserves known original HTTP acquisition information."
)
BLOCK_SIZE = 8 * 1024 * 1024


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def require_file(path: Path) -> None:
    require(not path.is_symlink() and path.is_file(), f"Missing or nonregular file: {path}")


def sha256_and_size(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(BLOCK_SIZE), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def main() -> None:
    # Raw source is optional in portable checkouts; a present invalid source always fails.
    if not os.path.lexists(ARCHIVE):
        print(f"SKIP: raw ChEMBL 37 source absent at {ARCHIVE.relative_to(PROJECT_DIR).as_posix()}.")
        return
    require_file(ARCHIVE)
    require_file(METADATA)
    digest, size = sha256_and_size(ARCHIVE)
    require(digest == EXPECTED_SHA256, f"Archive SHA-256 mismatch: {digest}")
    require(size == EXPECTED_SIZE, f"Archive byte-size mismatch: {size}")

    with tarfile.open(ARCHIVE, "r:gz") as archive:
        members = archive.getmembers()
    for member in members:
        path = PurePosixPath(member.name.replace("\\", "/"))
        require(not path.is_absolute() and ".." not in path.parts
                and not PureWindowsPath(member.name).drive and ":" not in member.name,
                f"Unsafe member: {member.name}")
        require(member.isfile() or member.isdir(), f"Unsupported member type: {member.name}")
    databases = [
        member for member in members
        if member.isfile() and PurePosixPath(member.name).suffix.casefold() in {".db", ".sqlite", ".sqlite3"}
    ]
    require(len(databases) == 1, f"Expected one SQLite member, found {[m.name for m in databases]}")
    database_member = databases[0]
    require(database_member.name == EXPECTED_SQLITE_MEMBER
            and database_member.size == EXPECTED_SQLITE_SIZE, "Unexpected SQLite member identity/size")

    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    expected_fields = {
        "schema": "cheers.chembl37-source-acquisition", "version": 3,
        "source": "ChEMBL", "release": "chembl_37", "artifact": ARCHIVE.name,
        "official_url": EXPECTED_URL, "expected_sha256": EXPECTED_SHA256,
        "observed_sha256": digest, "observed_byte_size": size,
        "expected_http_byte_size": EXPECTED_SIZE, "license": "CC BY-SA 3.0",
        "license_source_url": EXPECTED_URL.rsplit("/", 1)[0] + "/LICENSE",
        "release_notes_url": EXPECTED_URL.rsplit("/", 1)[0] + "/chembl_37_release_notes.txt",
    }
    for key, expected in expected_fields.items():
        require(metadata.get(key) == expected, f"Incorrect acquisition metadata: {key}")
    require(metadata["timestamp_semantics"] == TIMESTAMP_SEMANTICS, "Incorrect timestamp semantics")
    def utc_timestamp(value):
        require(isinstance(value, str), "Timestamp must be a UTC string")
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(timestamp.utcoffset() is not None and timestamp.utcoffset().total_seconds() == 0,
                "Timestamp must include UTC timezone")
        return timestamp
    verified_at = utc_timestamp(metadata["verification_timestamp_utc"])
    retrieved_at = metadata["retrieval_timestamp_utc"]
    original_transfer = metadata["acquisition_transfer"]
    if retrieved_at is None:
        require(original_transfer is None, "Unknown acquisition time must not invent acquisition transfer")
    else:
        require(utc_timestamp(retrieved_at) <= verified_at, "Acquisition time follows verification")
        require(isinstance(original_transfer, dict)
                and original_transfer.get("mode") in {"fresh", "resumed"},
                "Known acquisition time requires HTTP acquisition evidence")
    require(metadata["archive"]["member_count"] == len(members), "Archive member count mismatch")
    require(metadata["archive"]["sqlite_member"] == database_member.name, "SQLite member mismatch")
    require(metadata["archive"]["sqlite_member_uncompressed_byte_size"] == database_member.size,
            "SQLite member size mismatch")

    transfer = metadata["transfer"]
    for key in ("last_modified", "etag", "content_length"):
        require(metadata["http_" + key] == transfer[key], f"Inconsistent HTTP metadata: {key}")
    if transfer["mode"] in {"fresh", "resumed"}:
        require(retrieved_at is not None and original_transfer == transfer,
                "HTTP acquisition must record its acquisition time/transfer")
    for transfer in [metadata["transfer"]] + ([original_transfer] if original_transfer is not None else []):
        mode = transfer["mode"]
        require(mode in {"fresh", "resumed", "local_completed_partial", "reused_archive"},
                "Unknown transfer mode")
        if mode in {"fresh", "resumed"}:
            offset = transfer["resume_offset"]
            require(type(offset) is int and 0 <= offset < EXPECTED_SIZE, "Invalid resume offset")
            require((mode == "fresh") == (offset == 0), "Transfer mode/offset mismatch")
            require(transfer["response_status"] == (200 if offset == 0 else 206), "HTTP status mismatch")
            if offset:
                content_range = transfer["content_range"]
                match = re.fullmatch(r"bytes ([0-9]+)-([0-9]+)/([0-9]+)", content_range or "")
                require(match is not None and tuple(map(int, match.groups())) == (
                    offset, EXPECTED_SIZE - 1, EXPECTED_SIZE
                ), "Transfer Content-Range mismatch")
            else:
                require(transfer["content_range"] is None, "Unexpected fresh-transfer Content-Range")
            length = transfer["content_length"]
            if length is not None:
                require(isinstance(length, str) and length.isascii() and length.isdecimal()
                        and int(length) == EXPECTED_SIZE - offset, "Response body length mismatch")
        else:
            require(all(transfer[key] is None for key in (
                "response_status", "resume_offset", "last_modified", "etag", "content_length", "content_range"
            )), "Local acquisition must not invent HTTP response information")

    provenance = metadata["provenance_files"]
    require(len(provenance) == 3 and {item["filename"] for item in provenance} == {
        "LICENSE", "REQUIRED.ATTRIBUTION", "chembl_37_release_notes.txt"
    }, "Incorrect required provenance files")
    for item in provenance:
        path = SOURCE_DIR / item["filename"]
        require_file(path)
        require(item["url"] == EXPECTED_URL.rsplit("/", 1)[0] + "/" + item["filename"],
                f"Incorrect provenance URL: {item['filename']}")
        file_digest, file_size = sha256_and_size(path)
        require(file_digest == item["sha256"] and file_size == item["byte_size"] and file_size > 0,
                f"Provenance hash/size mismatch: {item['filename']}")

    extracted = metadata.get("extracted_database")
    # B.3B-1 acquisition always extracts SQLite; missing metadata is not optional.
    require(isinstance(extracted, dict) and bool(extracted), "Extracted database metadata is required")
    if extracted:
        require(extracted["filename"] == PurePosixPath(database_member.name).name,
                "Extracted filename must match the archived SQLite basename")
        database = SOURCE_DIR / extracted["filename"]
        require_file(database)
        database_digest, database_size = sha256_and_size(database)
        require(database_digest == extracted["sha256"] == EXPECTED_SQLITE_SHA256, "Extracted database metadata hash mismatch")
        require(database_size == extracted["byte_size"] == database_member.size == EXPECTED_SQLITE_SIZE,
                "Extracted database size mismatch")
        # Stream the member from the independently pinned archive. A metadata hash
        # alone could incorrectly bless an unrelated, same-size local database.
        archived_digest = hashlib.sha256()
        archived_size = 0
        with tarfile.open(ARCHIVE, "r:gz") as archive:
            source = archive.extractfile(database_member)
            require(source is not None, "SQLite archive member cannot be read")
            with source:
                for block in iter(lambda: source.read(BLOCK_SIZE), b""):
                    archived_digest.update(block)
                    archived_size += len(block)
        require(archived_size == database_size and archived_digest.hexdigest() == database_digest,
                "Extracted SQLite does not match the pinned archive member")
        uri = database.resolve().as_uri() + "?mode=ro&immutable=1"
        with closing(sqlite3.connect(uri, uri=True)) as connection:
            require(connection.execute("PRAGMA quick_check").fetchone()[0] == "ok",
                    "SQLite quick_check failed")
            tables = {
                row[0] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            version_tables = sorted(name for name in tables if "version" in name.casefold())
            found_37 = False
            evidence = {"sqlite_quick_check": "ok", "version_tables": version_tables,
                        "release_verified": False}
            for table in version_tables:
                quoted = '"' + table.replace('"', '""') + '"'
                columns = [row[1] for row in connection.execute(f"PRAGMA table_info({quoted})")]
                rows = connection.execute(f"SELECT * FROM {quoted} LIMIT 20").fetchall()
                evidence[table] = {"columns": columns, "rows": [list(row) for row in rows]}
                found_37 = found_37 or any(
                    str(value) == "37" or str(value).casefold() == "chembl_37"
                    for row in rows for value in row
                )
            evidence["release_verified"] = found_37
            require(extracted["version_evidence"] == evidence, "Recorded SQLite version evidence mismatch")
            require(found_37, "Extracted database does not independently identify release 37.")

    print("PASS: pinned ChEMBL 37 archive SHA-256 and byte size verified.")
    print(f"PASS: {len(members):,} safe archive members; SQLite member {database_member.name}.")
    print("PASS: acquisition metadata and provenance files verified.")
    if extracted:
        print("PASS: extracted SQLite validity, SHA-256, size, and release 37 evidence verified.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
