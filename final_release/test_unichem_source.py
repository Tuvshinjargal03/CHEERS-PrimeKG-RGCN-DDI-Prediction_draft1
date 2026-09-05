"""Small offline fixtures for UniChem acquisition and independent verification."""
from contextlib import redirect_stdout
from email.message import Message
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parents[1]
A = load("acquisition", ROOT / "scripts/acquire_unichem_source.py")
V = load("verification", ROOT / "final_release/verify_unichem_source.py")
VALID = b"From src:'1'\tTo src:'2'\nCHEMBL1\tDB00001\nCHEMBL1\tDB00002\nCHEMBL2\tDB00001\nCHEMBL1\tDB00001\n"


class Response(io.BytesIO):
    def __init__(self, url, body, *, length=None, etag='"fixture"', status=200):
        super().__init__(body)
        self.url, self.status = url, status
        self.headers = Message()
        self.headers["Content-Length"] = str(len(body) if length is None else length)
        self.headers["ETag"] = etag
        self.headers["Last-Modified"] = "Sat, 29 Aug 2026 19:50:14 GMT"
        self.headers["Accept-Ranges"] = "bytes"

    def geturl(self):
        return self.url


def opener_for(mapping=None, change_etag=False, short=False, bad_source=False):
    compressed = gzip.compress(VALID, mtime=0) if mapping is None else mapping
    def opener(request, timeout):
        url = request.full_url
        if url == A.URL:
            if request.get_method() == "HEAD":
                return Response(url, b"", length=len(compressed))
            if request.get_header("If-match") != '"fixture"':
                raise RuntimeError("Conditional request missing")
            return Response(url, compressed[:-5] if short else compressed, length=len(compressed),
                            etag='"changed"' if change_etag else '"fixture"')
        source_id = int(url.rsplit("/", 1)[1])
        values = dict(sourceID=source_id, name={1: "chembl", 2: "drugbank"}[source_id],
                      nameLabel={1: "ChEMBL", 2: "DrugBank"}[source_id],
                      nameLong={1: "ChEMBL", 2: "DrugBank"}[source_id], srcReleaseNumber="odd-verbatim-value",
                      srcReleaseDate=None, lastUpdated="2026-09-01", UCICount=123)
        if bad_source:
            values["sourceID"] = 99
        body = json.dumps({"response": "Success", "sources": [values]}).encode()
        return Response(url, body)
    return opener


class ParserTests(unittest.TestCase):
    def test_valid_duplicates_one_to_many_many_to_one(self):
        for module in (A, V):
            result = module.parse_mapping(gzip.compress(VALID))
            self.assertEqual(result["statistics"], {
                "data_row_count": 4, "unique_chembl_ids": 2, "unique_drugbank_ids": 2,
                "exact_duplicate_pair_count": 1, "chembl_ids_with_multiple_drugbank_mappings": 1,
                "drugbank_ids_with_multiple_chembl_mappings": 1,
                "malformed_row_count": 0, "blank_line_count": 0, "comment_line_count": 0})

    def test_invalid_rows(self):
        variants = {
            "wrong header": VALID.replace(b"From src:", b"Wrong src:", 1),
            "reversed orientation": VALID.replace(b"From src:'1'\tTo src:'2'", b"From src:'2'\tTo src:'1'"),
            "extra column": VALID.replace(b"CHEMBL2\tDB00001", b"CHEMBL2\tDB00001\textra"),
            "missing column": VALID.replace(b"CHEMBL2\tDB00001", b"CHEMBL2"),
            "bad ChEMBL": VALID.replace(b"CHEMBL2", b"chembl2"),
            "bad DrugBank": VALID.replace(b"DB00002", b"DB123456"),
            "blank line": VALID + b"\n", "comment": VALID + b"#comment\n",
            "CRLF": VALID.replace(b"\n", b"\r\n"), "missing final newline": VALID[:-1],
            "BOM": b"\xef\xbb\xbf" + VALID, "invalid UTF-8": VALID + b"\xff\n",
        }
        for label, payload in variants.items():
            for module in (A, V):
                with self.subTest(label=label, module=module.__name__):
                    with self.assertRaises((RuntimeError, UnicodeError)):
                        module.parse_mapping(gzip.compress(payload))

    def test_corrupt_and_truncated_gzip(self):
        compressed = gzip.compress(VALID)
        corrupted = bytearray(compressed)
        corrupted[-8] ^= 1
        for data in (b"not gzip", compressed[:-5], bytes(corrupted)):
            for module in (A, V):
                with self.assertRaises((OSError, EOFError, RuntimeError)):
                    module.parse_mapping(data)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="unichem-synthetic-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.raw, self.provenance = self.root / "raw", self.root / "provenance"

    def acquire(self, **kwargs):
        metadata = A.acquire(raw_root=self.raw, provenance_root=self.provenance, opener=opener_for(**kwargs))
        return self.provenance / metadata["snapshot_id"], metadata

    def verify(self, path, require_source=True):
        with redirect_stdout(io.StringIO()):
            return V.verify_snapshot(path, self.raw, require_source)

    def test_full_snapshot(self):
        path, metadata = self.acquire()
        self.assertTrue(self.verify(path))
        source = json.loads((path / "source_metadata.json").read_text())
        self.assertEqual(source["sources"][0]["values"]["srcReleaseNumber"], "odd-verbatim-value")
        self.assertFalse(metadata["limitations"]["independent_molecular_identity_proven"])

    def test_download_failures_never_publish(self):
        for options in ({"change_etag": True}, {"short": True}, {"bad_source": True}, {"mapping": b"bad gzip"}):
            with self.subTest(options=options):
                with self.assertRaises((RuntimeError, OSError)):
                    self.acquire(**options)
                self.assertFalse(self.provenance.exists())
                self.assertFalse(list(self.raw.glob("*/src1src2.txt.gz")))
        self.assertTrue(list(self.raw.glob(".attempt-*/*.part")))

    def test_no_overwrite_publication(self):
        source, destination = self.root / "part", self.root / "final"
        source.write_bytes(b"new")
        destination.write_bytes(b"original")
        with self.assertRaises(FileExistsError):
            A.publish_file(source, destination)
        self.assertEqual(destination.read_bytes(), b"original")
        self.assertEqual(source.read_bytes(), b"new")

    def test_http_url_rejected_before_request(self):
        def forbidden(*args, **kwargs):
            self.fail("Insecure request reached opener")
        with self.assertRaisesRegex(RuntimeError, "HTTPS"):
            A.fetch("http://example.invalid/source", self.root / "part", opener=forbidden)
        self.assertFalse((self.root / "part").exists())

    def test_redirect_rejected_before_following(self):
        handler = A.RejectRedirects()
        request = A.urllib.request.Request(A.URL)
        for target in ("http://example.invalid/source", "https://example.invalid/source"):
            with self.subTest(target=target), self.assertRaisesRegex(RuntimeError, "redirects"):
                handler.redirect_request(request, None, 302, "Found", Message(), target)

    def test_snapshot_collision(self):
        from unittest.mock import patch
        with patch.object(A, "utc_now", return_value="2026-09-05T00:00:00.000000Z"):
            path, metadata = self.acquire()
            before = (path / "acquisition_metadata.json").read_bytes()
            with self.assertRaisesRegex(RuntimeError, "Snapshot already exists"):
                self.acquire()
            self.assertEqual((path / "acquisition_metadata.json").read_bytes(), before)
            self.assertTrue(self.verify(path))

    def test_metadata_hash_size_statistics_and_limitations(self):
        path, metadata = self.acquire()
        manifest = path / "acquisition_metadata.json"
        for field in ("hash", "size", "statistics", "limitations", "chembl"):
            changed = json.loads(json.dumps(metadata))
            if field == "hash":
                changed["local_verification"]["decompressed"]["sha256"] = "0" * 64
            elif field == "size":
                changed["local_verification"]["decompressed"]["byte_size"] += 1
            elif field == "statistics":
                changed["local_verification"]["statistics"]["exact_duplicate_pair_count"] = 0
            elif field == "limitations":
                changed["limitations"]["contains_uci"] = True
            else:
                changed["local_chembl_reference"]["release"] = 38
            manifest.write_bytes(A.json_bytes(changed))
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.verify(path)

    def test_changed_raw_and_nonregular(self):
        path, metadata = self.acquire()
        raw = self.raw / metadata["snapshot_id"] / A.FILENAME
        original = raw.read_bytes()
        for data in (original + b"x", b"x" * len(original)):
            raw.write_bytes(data)
            with self.assertRaises(RuntimeError):
                self.verify(path)
        raw.unlink()
        raw.mkdir()
        with self.assertRaisesRegex(RuntimeError, "Nonregular"):
            self.verify(path)

    def test_symlink_rejected_when_permitted(self):
        target, link = self.root / "target", self.root / "link"
        target.write_bytes(b"source")
        try:
            link.symlink_to(target)
        except OSError as exc:
            self.skipTest(f"Platform cannot create symlink: {exc}")
        with self.assertRaises(RuntimeError):
            V.file_bytes(link, 100)
        with self.assertRaises(RuntimeError):
            A.publish_file(link, self.root / "published")

    def test_optional_absence_and_required_absence(self):
        path, metadata = self.acquire()
        missing = self.root / "absent"
        with redirect_stdout(io.StringIO()):
            self.assertFalse(V.verify_snapshot(path, missing, False))
        with self.assertRaisesRegex(RuntimeError, "Required local"):
            V.verify_snapshot(path, missing, True)
        # A present but incomplete snapshot must fail even without --require-source.
        raw = self.raw / metadata["snapshot_id"] / A.FILENAME
        raw.unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify(path, False)

    def test_verifier_normal_and_optimized_offline(self):
        path, metadata = self.acquire()
        code = (
            "import runpy,sys,pathlib,socket; "
            "socket.socket=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('network forbidden')); "
            "n=runpy.run_path(sys.argv[1]); n['verify_snapshot'](pathlib.Path(sys.argv[2]),"
            "pathlib.Path(sys.argv[3]),True)"
        )
        for valid in (True, False):
            if not valid:
                raw = self.raw / metadata["snapshot_id"] / A.FILENAME
                raw.write_bytes(b"corrupted")
            for flags in ([], ["-O"]):
                result = subprocess.run([sys.executable, "-B", *flags, "-c", code,
                    str(ROOT / "final_release/verify_unichem_source.py"), str(path), str(self.raw)],
                    capture_output=True, text=True)
                if valid:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("PASS", result.stdout)
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertNotIn("SKIP", result.stdout)


if __name__ == "__main__":
    unittest.main()
