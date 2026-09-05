"""Synthetic ChEMBL acquisition safety checks; never touch the real source."""
from contextlib import closing
import hashlib
import importlib.util
import io
import json
import sqlite3
from pathlib import Path
import tarfile
import tempfile
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "acquisition", Path(__file__).resolve().parents[1] / "scripts/acquire_chembl37_source.py")
acquisition = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(acquisition)


class AcquisitionSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chembl37-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.content = b"verified synthetic database"
        self.member = tarfile.TarInfo(acquisition.EXPECTED_SQLITE_MEMBER)
        self.member.size = len(self.content)
        self.archive = self.root / "fixture.tar.gz"
        with tarfile.open(self.archive, "w:gz") as archive:
            archive.addfile(self.member, io.BytesIO(self.content))
        with tarfile.open(self.archive, "r:gz") as archive:
            self.member = archive.getmembers()[0]
        self.destination = self.root / "chembl_37.db"
        self.partial = self.root / ".chembl_37.db.part"
        mocks = patch.multiple(acquisition, DESTINATION_DIR=self.root, ARCHIVE=self.archive,
                               EXPECTED_SQLITE_SIZE=len(self.content),
                               EXPECTED_SQLITE_SHA256=hashlib.sha256(self.content).hexdigest())
        mocks.start()
        self.addCleanup(mocks.stop)

    def test_same_size_wrong_hash_preserved(self):
        wrong = b"x" * len(self.content)
        self.destination.write_bytes(wrong)
        with self.assertRaisesRegex(RuntimeError, "SHA-256 mismatch"):
            acquisition.extract_database(self.member)
        self.assertEqual(self.destination.read_bytes(), wrong)

    def test_verified_reuse_skips_space_and_extraction(self):
        self.destination.write_bytes(self.content)
        with patch.object(acquisition.shutil, "disk_usage", side_effect=AssertionError("space queried")), \
                patch.object(acquisition.tarfile, "open", side_effect=AssertionError("archive opened")):
            result = acquisition.extract_database(self.member)
        self.assertEqual(result[0], self.destination)
        self.assertEqual(result[1], hashlib.sha256(self.content).hexdigest())

    def test_nonregular_target_rejected(self):
        self.destination.mkdir()
        with self.assertRaisesRegex(RuntimeError, "regular"):
            acquisition.extract_database(self.member)
        self.assertTrue(self.destination.is_dir())

    def test_new_extraction_verified(self):
        result = acquisition.extract_database(self.member)
        self.assertEqual(self.destination.read_bytes(), self.content)
        self.assertEqual(result[1], hashlib.sha256(self.content).hexdigest())
        self.assertFalse(self.partial.exists())

    def test_new_wrong_hash_not_published(self):
        with patch.object(acquisition, "EXPECTED_SQLITE_SHA256", "0" * 64):
            with self.assertRaisesRegex(RuntimeError, "SHA-256 mismatch"):
                acquisition.extract_database(self.member)
        self.assertFalse(self.destination.exists())
        self.assertEqual(self.partial.read_bytes(), self.content)

    def test_collision_does_not_overwrite(self):
        publish = acquisition.publish_verified
        def collide(partial, destination, snapshot):
            destination.write_bytes(b"collision")
            publish(partial, destination, snapshot)
        with patch.object(acquisition, "publish_verified", side_effect=collide):
            with self.assertRaises(FileExistsError):
                acquisition.extract_database(self.member)
        self.assertEqual(self.destination.read_bytes(), b"collision")
        self.assertEqual(self.partial.read_bytes(), self.content)

    def test_existing_partial_preserved(self):
        self.partial.write_bytes(b"interrupted")
        with self.assertRaisesRegex(RuntimeError, "Partial extraction"):
            acquisition.extract_database(self.member)
        self.assertEqual(self.partial.read_bytes(), b"interrupted")

    def test_insufficient_space_prevents_extraction(self):
        with patch.object(acquisition.shutil, "disk_usage", return_value=SimpleNamespace(free=0)):
            with self.assertRaisesRegex(RuntimeError, "Insufficient free space"):
                acquisition.extract_database(self.member)
        self.assertFalse(self.destination.exists())
        self.assertFalse(self.partial.exists())

    def test_verifier_invalid_present_archive_fails_in_both_modes(self):
        verifier = Path(__file__).with_name("verify_chembl37_source.py").resolve()
        metadata = self.root / "acquisition_metadata.json"
        metadata.write_text("{}", encoding="utf-8")
        code = (
            "import runpy,pathlib,sys; n=runpy.run_path(sys.argv[1]); "
            "g=n['main'].__globals__; "
            "g.update(ARCHIVE=pathlib.Path(sys.argv[2]),METADATA=pathlib.Path(sys.argv[3])); "
            "n['main']()"
        )
        for flags in ([], ["-O"]):
            result = subprocess.run([sys.executable, "-B", *flags, "-c", code,
                                     str(verifier), str(self.archive), str(metadata)],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Archive SHA-256 mismatch", result.stderr)
            self.assertNotIn("SKIP", result.stdout)

    def test_verifier_checks_recorded_evidence_in_both_modes(self):
        with closing(sqlite3.connect(self.destination)) as connection:
            connection.execute("CREATE TABLE version (name TEXT)")
            connection.execute("INSERT INTO version VALUES ('ChEMBL_37')")
            connection.commit()
        content = self.destination.read_bytes()
        member = tarfile.TarInfo(acquisition.EXPECTED_SQLITE_MEMBER)
        member.size = len(content)
        with tarfile.open(self.archive, "w:gz") as archive:
            archive.addfile(member, io.BytesIO(content))
        archive_hash = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        db_hash = hashlib.sha256(content).hexdigest()
        transfer = dict(mode="reused_archive", response_status=None, resume_offset=None,
                        last_modified=None, etag=None, content_length=None, content_range=None)
        metadata = dict(
            schema="cheers.chembl37-source-acquisition", version=3, source="ChEMBL",
            release="chembl_37", artifact=self.archive.name, official_url=acquisition.OFFICIAL_URL,
            expected_sha256=archive_hash, observed_sha256=archive_hash,
            observed_byte_size=self.archive.stat().st_size,
            expected_http_byte_size=self.archive.stat().st_size, license=acquisition.LICENSE,
            license_source_url=acquisition.PROVENANCE_FILES["LICENSE"],
            release_notes_url=acquisition.PROVENANCE_FILES["chembl_37_release_notes.txt"],
            retrieval_timestamp_utc=None, verification_timestamp_utc="2026-09-05T00:00:00Z",
            timestamp_semantics=acquisition.TIMESTAMP_SEMANTICS, acquisition_transfer=None,
            transfer=transfer, http_last_modified=None, http_etag=None, http_content_length=None,
            archive=dict(member_count=1, sqlite_member=member.name,
                         sqlite_member_uncompressed_byte_size=member.size),
            extracted_database=dict(filename=self.destination.name, byte_size=len(content),
                                    sha256=db_hash,
                                    version_evidence=acquisition.sqlite_version_evidence(self.destination)),
            provenance_files=[])
        for name, url in acquisition.PROVENANCE_FILES.items():
            data = ("synthetic " + name).encode()
            (self.root / name).write_bytes(data)
            metadata["provenance_files"].append(dict(filename=name, url=url,
                sha256=hashlib.sha256(data).hexdigest(), byte_size=len(data)))
        path = self.root / "acquisition_metadata.json"
        verifier = Path(__file__).with_name("verify_chembl37_source.py").resolve()
        code = (
            "import runpy,pathlib,sys; n=runpy.run_path(sys.argv[1]); g=n['main'].__globals__; "
            "p=pathlib.Path(sys.argv[2]); "
            "g.update(SOURCE_DIR=p,ARCHIVE=p/'fixture.tar.gz',METADATA=p/'acquisition_metadata.json',"
            "EXPECTED_SHA256=sys.argv[3],EXPECTED_SIZE=int(sys.argv[4]),"
            "EXPECTED_SQLITE_SHA256=sys.argv[5],EXPECTED_SQLITE_SIZE=int(sys.argv[6])); n['main']()"
        )
        for tamper in (False, True):
            if tamper:
                metadata["extracted_database"]["version_evidence"]["release_verified"] = False
            path.write_text(json.dumps(metadata), encoding="utf-8")
            for flags in ([], ["-O"]):
                result = subprocess.run([sys.executable, "-B", *flags, "-c", code, str(verifier),
                    str(self.root), archive_hash, str(self.archive.stat().st_size), db_hash,
                    str(len(content))], capture_output=True, text=True)
                if tamper:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("Recorded SQLite version evidence mismatch", result.stderr)
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("PASS: extracted SQLite", result.stdout)

    def test_unknown_retrieval_stays_unknown(self):
        previous = {"version": 2, "official_url": acquisition.OFFICIAL_URL,
                    "observed_sha256": acquisition.EXPECTED_SHA256,
                    "transfer": {"mode": "reused_archive"},
                    "retrieval_timestamp_utc": "2026-09-05T00:00:00Z"}
        fields = acquisition.timestamp_fields(previous, {"mode": "reused_archive"},
                                               "2026-09-06T00:00:00Z")
        self.assertIsNone(fields["retrieval_timestamp_utc"])
        self.assertIsNone(fields["acquisition_transfer"])
        self.assertEqual(fields["verification_timestamp_utc"], "2026-09-06T00:00:00Z")

    def test_known_acquisition_preserved(self):
        previous = {"version": 2, "official_url": acquisition.OFFICIAL_URL,
                    "observed_sha256": acquisition.EXPECTED_SHA256,
                    "transfer": {"mode": "fresh"},
                    "retrieval_timestamp_utc": "2026-09-05T00:00:00Z"}
        fields = acquisition.timestamp_fields(previous, {"mode": "reused_archive"},
                                               "2026-09-06T00:00:00Z")
        self.assertEqual(fields["retrieval_timestamp_utc"], previous["retrieval_timestamp_utc"])
        self.assertEqual(fields["acquisition_transfer"], previous["transfer"])
        previous.update(fields, version=3)
        again = acquisition.timestamp_fields(previous, {"mode": "reused_archive"},
                                              "2026-09-07T00:00:00Z")
        self.assertEqual(again["retrieval_timestamp_utc"], fields["retrieval_timestamp_utc"])
        self.assertEqual(again["acquisition_transfer"], fields["acquisition_transfer"])


if __name__ == "__main__":
    unittest.main()
