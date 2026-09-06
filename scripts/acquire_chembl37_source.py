"""Acquire and verify the exact ChEMBL 37 SQLite source distribution."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import sys
import tarfile
import urllib.error
import urllib.request
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath, PureWindowsPath


PROJECT_DIR = Path(__file__).resolve().parents[1]
RELEASE = "chembl_37"
ARTIFACT = "chembl_37_sqlite.tar.gz"
OFFICIAL_URL = (
    "https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/releases/"
    f"{RELEASE}/{ARTIFACT}"
)
EXPECTED_SHA256 = "33c203740555f96067710cdfc1c3c55d890660e5908ec5cbf5817492c290d281"
EXPECTED_HTTP_BYTE_SIZE = 5_764_252_857
EXPECTED_SQLITE_MEMBER = "chembl_37/chembl_37_sqlite/chembl_37.db"
EXPECTED_SQLITE_SIZE = 30_480_314_368
# Independently hashed from the SQLite member of the pinned official archive.
EXPECTED_SQLITE_SHA256 = "4be13df3b68e25dcd0bff44bf094033b5aebe98f415acdc8c1cdf380e0c15142"
TIMESTAMP_SEMANTICS = (
    "retrieval_timestamp_utc is the recorded acquisition completion time, preserved on reuse; "
    "null means the original acquisition time is unknown. verification_timestamp_utc is "
    "the completion time of local verification. transfer describes this run; "
    "acquisition_transfer preserves known original HTTP acquisition information."
)
DESTINATION_DIR = PROJECT_DIR / "data/downloads/chembl" / RELEASE
ARCHIVE = DESTINATION_DIR / ARTIFACT
PARTIAL = DESTINATION_DIR / f".{ARTIFACT}.part"
METADATA = DESTINATION_DIR / "acquisition_metadata.json"
LICENSE = "CC BY-SA 3.0"
RELEASE_BASE_URL = OFFICIAL_URL.rsplit("/", 1)[0]
PROVENANCE_FILES = {
    "LICENSE": f"{RELEASE_BASE_URL}/LICENSE",
    "REQUIRED.ATTRIBUTION": f"{RELEASE_BASE_URL}/REQUIRED.ATTRIBUTION",
    "chembl_37_release_notes.txt": f"{RELEASE_BASE_URL}/chembl_37_release_notes.txt",
}
BLOCK_SIZE = 8 * 1024 * 1024


def sha256_and_size(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(BLOCK_SIZE), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def safe_member(member: tarfile.TarInfo) -> bool:
    path = PurePosixPath(member.name.replace("\\", "/"))
    return (not path.is_absolute() and ".." not in path.parts
            and not PureWindowsPath(member.name).drive and ":" not in member.name)


def inspect_archive(path: Path) -> tuple[list[tarfile.TarInfo], tarfile.TarInfo]:
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
    unsafe = [member.name for member in members if not safe_member(member)]
    if unsafe:
        raise RuntimeError(f"Unsafe archive member path(s): {unsafe[:5]}")
    special = [member.name for member in members if not (member.isfile() or member.isdir())]
    if special:
        raise RuntimeError(f"Unsupported archive member type(s): {special[:5]}")
    databases = [
        member for member in members
        if member.isfile() and PurePosixPath(member.name).suffix.casefold() in {".db", ".sqlite", ".sqlite3"}
    ]
    if len(databases) != 1:
        raise RuntimeError(f"Expected exactly one SQLite member, found {[m.name for m in databases]}")
    if (databases[0].name != EXPECTED_SQLITE_MEMBER
            or databases[0].size != EXPECTED_SQLITE_SIZE):
        raise RuntimeError("Unexpected ChEMBL 37 SQLite member identity/size")
    return members, databases[0]


def regular_snapshot(path: Path):
    """lstat also rejects dangling links; never follow a partial-file symlink."""
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or path.is_symlink():
        raise RuntimeError(f"Expected a regular nonsymlink file: {path}")
    return info


def unchanged(path: Path, before, handle=None) -> None:
    current = regular_snapshot(path)
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    candidates = [current]
    if handle is not None:
        candidates.append(os.fstat(handle.fileno()))
    if any(any(getattr(item, key) != getattr(before, key) for key in fields)
           for item in candidates):
        raise RuntimeError(f"File changed unexpectedly: {path}")


@contextmanager
def acquisition_lock(partial: Path):
    # Exclusive creation prevents cooperating downloaders from sharing a partial.
    # A forced kill can leave a stale lock: fail closed; never auto-remove it.
    lock = partial.with_name(partial.name + ".lock")
    try:
        handle = lock.open("xb")
    except FileExistsError as exc:
        raise RuntimeError(
            f"Acquisition lock exists: {lock}. If no acquisition is running, "
            "inspect and remove this lock explicitly before retrying."
        ) from exc
    try:
        with handle:
            handle.write(f"pid={os.getpid()}\n".encode("ascii"))
            handle.flush()
            yield
    finally:
        lock.unlink()


def single_header(response, name: str) -> str | None:
    values = response.headers.get_all(name, [])
    if len(values) > 1:
        raise RuntimeError(f"Multiple {name} headers are not accepted")
    return values[0].strip() if values else None


def validate_response(response, offset: int, expected_size: int) -> dict:
    status = response.status
    wanted_status = 206 if offset else 200
    if status != wanted_status:
        raise RuntimeError(
            f"Expected HTTP {wanted_status}, received {status}; "
            "safe transfer refused (partial will not be restarted)."
        )
    content_range = single_header(response, "Content-Range")
    content_length = single_header(response, "Content-Length")
    encoding = single_header(response, "Content-Encoding")
    content_type = single_header(response, "Content-Type")
    transfer_encoding = single_header(response, "Transfer-Encoding")
    if encoding is not None and encoding.casefold() != "identity":
        raise RuntimeError(f"Unexpected Content-Encoding: {encoding}")
    if content_type and content_type.casefold().startswith("multipart/"):
        raise RuntimeError("Multipart responses are not accepted")
    if transfer_encoding is not None:
        if transfer_encoding.casefold() != "chunked" or content_length is not None:
            raise RuntimeError("Unsupported or conflicting HTTP body framing")
    if offset:
        match = re.fullmatch(r"bytes ([0-9]+)-([0-9]+)/([0-9]+)", content_range or "")
        if not match or tuple(map(int, match.groups())) != (
            offset, expected_size - 1, expected_size
        ):
            raise RuntimeError(f"Invalid Content-Range for offset {offset}: {content_range!r}")
    elif content_range is not None:
        raise RuntimeError("Unexpected Content-Range on fresh transfer")
    if content_length is not None:
        if (not re.fullmatch(r"[0-9]+", content_length)
                or int(content_length) != expected_size - offset):
            raise RuntimeError(f"Incorrect response Content-Length: {content_length!r}")
    return {
        "mode": "resumed" if offset else "fresh",
        "response_status": status,
        "resume_offset": offset,
        "last_modified": single_header(response, "Last-Modified"),
        "etag": single_header(response, "ETag"),
        # For 206 this is the remaining BODY length, never the full archive size.
        "content_length": content_length,
        "content_range": content_range,
    }


def publish_verified(partial: Path, archive: Path, snapshot) -> None:
    unchanged(partial, snapshot)
    # Same-directory hard-link creation atomically refuses an existing destination
    # on NTFS/POSIX filesystems. No replace/rename fallback: unsupported filesystems
    # fail closed. A crash between link and unlink leaves two verified names.
    os.link(partial, archive)
    partial.unlink()


def download_archive(*, url: str, archive: Path, partial: Path,
                     expected_size: int, expected_sha256: str,
                     opener=None, block_size: int = BLOCK_SIZE) -> tuple[str, int, dict, bool]:
    """Fixture parameters keep tests small without changing production pins."""
    if opener is None:
        opener = urllib.request.urlopen
    try:
        with acquisition_lock(partial):
            local_headers = {
                "mode": "local_completed_partial", "response_status": None,
                "resume_offset": None, "last_modified": None, "etag": None,
                "content_length": None, "content_range": None,
            }
            if os.path.lexists(archive):
                before = regular_snapshot(archive)
                digest_text, size = sha256_and_size(archive)
                unchanged(archive, before)
                if digest_text != expected_sha256 or size != expected_size:
                    raise RuntimeError("Existing archive is invalid and will not be replaced")
                local_headers["mode"] = "reused_archive"
                return digest_text, size, local_headers, True

            before = regular_snapshot(partial) if os.path.lexists(partial) else None
            offset = before.st_size if before is not None else 0
            if before is not None and before.st_nlink != 1:
                raise RuntimeError("Partial has multiple hard links; refusing to modify it")
            if offset > expected_size:
                raise RuntimeError(f"Partial exceeds expected size: {offset} > {expected_size}")
            digest = hashlib.sha256()
            observed_size = 0
            if before is not None:
                with partial.open("rb") as source:
                    unchanged(partial, before, source)
                    for block in iter(lambda: source.read(block_size), b""):
                        observed_size += len(block)
                        if observed_size > offset:
                            raise RuntimeError("Partial grew while hashing")
                        digest.update(block)
                    unchanged(partial, before, source)
                if observed_size != offset:
                    raise RuntimeError("Partial byte count changed while hashing")

            headers = local_headers
            if offset < expected_size:
                request_headers = {
                    "User-Agent": "CHEERS-pinned-ChEMBL37-acquisition/1.0",
                    "Accept-Encoding": "identity",
                }
                if offset:
                    request_headers["Range"] = f"bytes={offset}-"
                request = urllib.request.Request(url, headers=request_headers)
                try:
                    response = opener(request, timeout=120)
                except urllib.error.HTTPError as exc:
                    exc.close()
                    raise RuntimeError(
                        f"HTTP {exc.code}: safe transfer refused; partial preserved"
                    ) from exc
                with response:
                    headers = validate_response(response, offset, expected_size)
                    if before is not None:
                        unchanged(partial, before)
                    # r+b never creates/truncates an existing partial. Its descriptor
                    # is checked before seeking to the validated append position.
                    with partial.open("r+b" if before is not None else "xb") as output:
                        if before is not None:
                            unchanged(partial, before, output)
                        identity = os.fstat(output.fileno())
                        output.seek(offset)
                        try:
                            for block in iter(lambda: response.read(block_size), b""):
                                if len(block) > expected_size - observed_size:
                                    raise RuntimeError("Response exceeds permitted archive size")
                                written = output.write(block)
                                if written != len(block):
                                    raise RuntimeError("Short file write; partial must be rehashed")
                                digest.update(block)
                                observed_size += written
                            if observed_size != expected_size:
                                raise RuntimeError(
                                    f"Premature EOF: {observed_size} of {expected_size} bytes"
                                )
                        except (Exception, KeyboardInterrupt):
                            try:
                                output.flush()
                                os.fsync(output.fileno())
                            except OSError as sync_error:
                                print(f"WARNING: could not sync progress: {sync_error}", file=sys.stderr)
                            raise
                        output.flush()
                        os.fsync(output.fileno())
                        after = regular_snapshot(partial)
                        if ((after.st_dev, after.st_ino) != (identity.st_dev, identity.st_ino)
                                or after.st_size != expected_size):
                            raise RuntimeError("Partial identity/size changed during transfer")
                        unchanged(partial, after, output)
                    # Closing a writable handle can update timestamps on Windows.
                    before = regular_snapshot(partial)

            digest_text = digest.hexdigest()
            unchanged(partial, before)
            if observed_size != expected_size or before.st_size != expected_size:
                raise RuntimeError("Final archive byte-size mismatch; partial preserved")
            if digest_text != expected_sha256:
                raise RuntimeError(
                    f"SHA-256 mismatch: expected {expected_sha256}, observed {digest_text}; "
                    "partial preserved; explicit user action required"
                )
            if headers["mode"] == "local_completed_partial":
                with partial.open("r+b") as output:
                    unchanged(partial, before, output)
                    output.flush()
                    os.fsync(output.fileno())
                unchanged(partial, before)
            publish_verified(partial, archive, before)
            return digest_text, observed_size, headers, False
    except (Exception, KeyboardInterrupt):
        try:
            if os.path.lexists(partial):
                print(f"Partial preserved at {partial}: {partial.lstat().st_size:,} on-disk bytes",
                      file=sys.stderr)
        except OSError as report_error:
            print(f"Could not inspect preserved partial: {report_error}", file=sys.stderr)
        raise


def acquire_archive() -> tuple[str, int, dict, bool]:
    return download_archive(
        url=OFFICIAL_URL, archive=ARCHIVE, partial=PARTIAL,
        expected_size=EXPECTED_HTTP_BYTE_SIZE, expected_sha256=EXPECTED_SHA256,
    )


def extract_database(member: tarfile.TarInfo) -> tuple[Path, str, int]:
    if (not safe_member(member) or not member.isfile()
            or member.name != EXPECTED_SQLITE_MEMBER or member.size != EXPECTED_SQLITE_SIZE):
        raise RuntimeError("Unexpected ChEMBL 37 SQLite member")
    destination = DESTINATION_DIR / PurePosixPath(member.name).name
    partial = DESTINATION_DIR / f".{destination.name}.part"
    with acquisition_lock(partial):
        if os.path.lexists(destination):
            before = regular_snapshot(destination)
            digest, size = sha256_and_size(destination)
            unchanged(destination, before)
            if size != EXPECTED_SQLITE_SIZE or digest != EXPECTED_SQLITE_SHA256:
                raise RuntimeError("Existing SQLite size/SHA-256 mismatch; file preserved")
            return destination, digest, size
        if os.path.lexists(partial):
            raise RuntimeError(f"Partial extraction already exists: {partial.name}; inspect explicitly")
        required_bytes = EXPECTED_SQLITE_SIZE + 1024 * 1024 * 1024
        free_bytes = shutil.disk_usage(DESTINATION_DIR).free
        if free_bytes < required_bytes:
            raise RuntimeError(
                f"Insufficient free space for safe extraction: need {required_bytes:,}, have {free_bytes:,}"
            )
        # Preserve partials on interruption/error; never auto-delete or resume them.
        with tarfile.open(ARCHIVE, "r:gz") as archive:
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError(f"Could not read database member {member.name}")
            with source, partial.open("xb") as output:
                shutil.copyfileobj(source, output, length=BLOCK_SIZE)
                output.flush()
                os.fsync(output.fileno())
        before = regular_snapshot(partial)
        digest, size = sha256_and_size(partial)
        unchanged(partial, before)
        if size != EXPECTED_SQLITE_SIZE or digest != EXPECTED_SQLITE_SHA256:
            raise RuntimeError("Extracted SQLite size/SHA-256 mismatch; partial preserved")
        publish_verified(partial, destination, before)
        return destination, digest, size


def sqlite_version_evidence(path: Path) -> dict:
    uri = path.resolve().as_uri() + "?mode=ro&immutable=1"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite quick_check failed: {integrity}")
        tables = {
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        version_tables = sorted(name for name in tables if "version" in name.casefold())
        evidence: dict[str, object] = {
            "sqlite_quick_check": integrity,
            "version_tables": version_tables,
            "release_verified": False,
        }
        for table in version_tables:
            quoted = '"' + table.replace('"', '""') + '"'
            columns = [row[1] for row in connection.execute(f"PRAGMA table_info({quoted})")]
            rows = connection.execute(f"SELECT * FROM {quoted} LIMIT 20").fetchall()
            evidence[table] = {"columns": columns, "rows": rows}
            if any(str(value) == "37" or str(value).casefold() == RELEASE for row in rows for value in row):
                evidence["release_verified"] = True
        if not evidence["release_verified"]:
            raise RuntimeError("SQLite version evidence did not identify ChEMBL release 37")
        return evidence


def acquire_provenance(previous: dict | None = None) -> list[dict]:
    results = []
    for filename, url in PROVENANCE_FILES.items():
        destination = DESTINATION_DIR / filename
        partial = DESTINATION_DIR / f".{filename}.part"
        if os.path.lexists(destination):
            before = regular_snapshot(destination)
            digest, size = sha256_and_size(destination)
            unchanged(destination, before)
            record = {"filename": filename, "url": url, "sha256": digest, "byte_size": size}
            known = next((item for item in (previous or {}).get("provenance_files", [])
                          if item["filename"] == filename), None)
            if size == 0 or (known is not None and record != known):
                raise RuntimeError(f"Existing provenance mismatch: {filename}; file preserved")
            results.append(record)
            continue
        request = urllib.request.Request(
            url, headers={"User-Agent": "CHEERS-pinned-ChEMBL37-acquisition/1.0"}
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response, partial.open("xb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            digest, size = sha256_and_size(partial)
            os.replace(partial, destination)
            results.append({"filename": filename, "url": url, "sha256": digest, "byte_size": size})
        except Exception:
            partial.unlink(missing_ok=True)
            raise
    return results


def write_metadata(value: dict) -> None:
    partial = DESTINATION_DIR / f".{METADATA.name}.part"
    partial.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    os.replace(partial, METADATA)


def timestamp_fields(previous: dict | None, transfer: dict, now: str) -> dict:
    """Version 2 reuse timestamps cannot establish original acquisition time."""
    retrieval = None
    original_transfer = None
    if previous:
        if (previous.get("official_url") != OFFICIAL_URL
                or previous.get("observed_sha256") != EXPECTED_SHA256):
            raise RuntimeError("Previous acquisition metadata source identity mismatch")
        if previous.get("version") == 3:
            retrieval = previous["retrieval_timestamp_utc"]
            original_transfer = previous["acquisition_transfer"]
        elif previous.get("version") == 2:
            if previous["transfer"]["mode"] in {"fresh", "resumed"}:
                retrieval = previous["retrieval_timestamp_utc"]
                original_transfer = previous["transfer"]
        else:
            raise RuntimeError("Unsupported previous acquisition metadata version")
    if transfer["mode"] in {"fresh", "resumed"}:
        retrieval, original_transfer = now, transfer.copy()
    return {
        "retrieval_timestamp_utc": retrieval,
        "verification_timestamp_utc": now,
        "timestamp_semantics": TIMESTAMP_SEMANTICS,
        "acquisition_transfer": original_transfer,
    }


def main() -> None:
    DESTINATION_DIR.mkdir(parents=True, exist_ok=True)
    previous = None
    if os.path.lexists(METADATA):
        regular_snapshot(METADATA)
        previous = json.loads(METADATA.read_text(encoding="utf-8"))
    observed_sha256, observed_size, headers, reused = acquire_archive()
    members, database_member = inspect_archive(ARCHIVE)
    database, database_sha256, database_size = extract_database(database_member)
    version_evidence = sqlite_version_evidence(database)
    provenance = acquire_provenance(previous)
    metadata = {
        "schema": "cheers.chembl37-source-acquisition",
        "version": 3,
        "source": "ChEMBL",
        "release": RELEASE,
        "artifact": ARTIFACT,
        "official_url": OFFICIAL_URL,
        "expected_sha256": EXPECTED_SHA256,
        "observed_sha256": observed_sha256,
        "observed_byte_size": observed_size,
        "expected_http_byte_size": EXPECTED_HTTP_BYTE_SIZE,
        **timestamp_fields(previous, headers, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")),
        "http_last_modified": headers["last_modified"],
        "http_etag": headers["etag"],
        "http_content_length": headers["content_length"],
        "transfer": headers,
        "license": LICENSE,
        "license_source_url": PROVENANCE_FILES["LICENSE"],
        "release_notes_url": PROVENANCE_FILES["chembl_37_release_notes.txt"],
        "archive": {
            "member_count": len(members),
            "sqlite_member": database_member.name,
            "sqlite_member_uncompressed_byte_size": database_member.size,
        },
        "extracted_database": {
            "filename": database.name,
            "byte_size": database_size,
            "sha256": database_sha256,
            "version_evidence": version_evidence,
        },
        "provenance_files": provenance,
    }
    write_metadata(metadata)
    print(f"PASS: {'reused' if reused else 'acquired'} verified {ARTIFACT}")
    print(f"Archive bytes: {observed_size:,}")
    print(f"Archive SHA-256: {observed_sha256}")
    print(f"Members: {len(members):,}")
    print(f"SQLite member: {database_member.name} ({database_member.size:,} bytes)")
    print(f"Extracted database: {database.name} SHA-256={database_sha256}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("INTERRUPTED: acquisition stopped; archive partial progress is preserved.", file=sys.stderr)
        raise SystemExit(130) from None
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
