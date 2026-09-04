"""Acquire the exact pinned MONDO source artifact used by CHEERS Phase B.3A."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
RELEASE = "v2026-09-01"
RELEASE_COMMIT = "d50a5d1"
ARTIFACT = "mondo-base.obo"
EXPECTED_SHA256 = "b617457ad70f5eba773700eecf013e59e752096bd57f88821876c3150e148dd6"
SOURCE_URL = (
    "https://github.com/monarch-initiative/mondo/releases/download/"
    f"{RELEASE}/{ARTIFACT}"
)
DESTINATION_DIR = PROJECT_DIR / "data/downloads/mondo" / RELEASE
DESTINATION = DESTINATION_DIR / ARTIFACT
METADATA = DESTINATION_DIR / "acquisition_metadata.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    DESTINATION_DIR.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{ARTIFACT}.", suffix=".tmp", dir=DESTINATION_DIR
    )
    os.close(file_descriptor)
    temporary = Path(temporary_name)
    request = urllib.request.Request(
        SOURCE_URL,
        headers={"User-Agent": "CHEERS-pinned-MONDO-acquisition/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        observed_sha256 = sha256(temporary)
        if observed_sha256 != EXPECTED_SHA256:
            raise RuntimeError(
                "Pinned MONDO SHA-256 mismatch: "
                f"expected {EXPECTED_SHA256}, observed {observed_sha256}"
            )
        byte_size = temporary.stat().st_size
        os.replace(temporary, DESTINATION)
        retrieved_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        metadata = {
            "schema": "cheers.mondo-source-acquisition",
            "version": 1,
            "source": "Mondo Disease Ontology",
            "release": RELEASE,
            "release_commit": RELEASE_COMMIT,
            "artifact": ARTIFACT,
            "url": SOURCE_URL,
            "expected_sha256": EXPECTED_SHA256,
            "observed_sha256": observed_sha256,
            "byte_size": byte_size,
            "retrieved_at": retrieved_at,
        }
        METADATA.write_bytes(
            (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        )
    finally:
        temporary.unlink(missing_ok=True)

    print(f"PASS: acquired {SOURCE_URL}")
    print(f"Path: {DESTINATION.relative_to(PROJECT_DIR).as_posix()}")
    print(f"Bytes: {byte_size:,}")
    print(f"SHA256: {observed_sha256}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        raise SystemExit(1) from exc
