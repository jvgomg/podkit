import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from build import build, ROOT
from probe import (HashAB, cdb_sha1, guid_bytes, inspect_schema, make_cbk, signature_nonce,
                   verify_cbk, verify_cdb)


class NanoSigningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.library = build(Path(cls.temp.name) / "hashab.so")
        cls.hasher = HashAB(cls.library)
        cls.guid = bytes.fromhex("0123456789abcdef")
        with sqlite3.connect(":memory:") as db:
            db.execute("CREATE TABLE location (pid INTEGER, path TEXT)")
            db.execute("INSERT INTO location VALUES (1, 'F00/test.mp3')")
            cls.data = db.serialize()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_upstream_reference_vectors(self):
        vectors = json.loads((ROOT.parent / "prebuild/vendor/hashab/test-data.json").read_text())
        self.assertEqual(len(vectors), 100)
        for vector in vectors:
            with self.subTest(uuid=vector["uuid"]):
                self.assertEqual(self.hasher.sign(bytes.fromhex(vector["sha1"]),
                                                 bytes.fromhex(vector["uuid"])).hex(),
                                 vector["target"])

    def test_arbitrary_nonce_roundtrip(self):
        for nonce in (bytes(range(23)), bytes(reversed(range(23))), bytes([255]) * 23):
            cbk = make_cbk(self.data, self.guid, self.hasher, nonce)
            self.assertEqual(signature_nonce(cbk[:57]), nonce)
            self.assertTrue(verify_cbk(self.data, cbk, self.guid, self.hasher)["success"])

    def test_reference_database_byte_for_byte(self):
        data = (ROOT / "fixtures/Locations.itdb").read_bytes()
        expected = (ROOT / "fixtures/Locations.itdb.cbk").read_bytes()
        guid = bytes.fromhex("000a270024bd17a1")
        self.assertEqual(make_cbk(data, guid, self.hasher), expected)
        self.assertTrue(verify_cbk(data, expected, guid, self.hasher)["success"])
        self.assertEqual(inspect_schema(data)["integrity"], ["ok"])

    def test_rejects_corruption_and_wrong_device(self):
        cbk = make_cbk(self.data, self.guid, self.hasher)
        for offset in (3, 60, 80):
            damaged = bytearray(cbk)
            damaged[offset] ^= 1
            self.assertFalse(verify_cbk(self.data, bytes(damaged), self.guid,
                                        self.hasher)["success"])
        self.assertFalse(verify_cbk(self.data, cbk, bytes(8), self.hasher)["success"])
        damaged_data = bytearray(self.data)
        damaged_data[-1] ^= 1
        self.assertFalse(verify_cbk(bytes(damaged_data), cbk, self.guid,
                                    self.hasher)["success"])

    def test_rejects_invalid_inputs(self):
        for value in ("", "0" * 40, "z" * 16, "00 " * 8):
            with self.assertRaises(ValueError):
                guid_bytes(value)
        for data in (b"", b"x" * 1025):
            with self.assertRaises(ValueError):
                make_cbk(data, self.guid, self.hasher)
        with self.assertRaises(ValueError):
            self.hasher.sign(bytes(20), bytes(20))
        with self.assertRaises(ValueError):
            verify_cbk(self.data, bytes(77), self.guid, self.hasher)

    def signed_cdb(self):
        cdb = bytearray(0xF4 + 64)
        cdb[:4] = b"mhbd"
        cdb[0x18:0x20] = bytes(range(1, 9))  # db_id is excluded from the hash
        cdb[0x30] = 3
        cdb[0x32:0x46] = bytes([7]) * 20
        cdb[0xF4:] = bytes(range(64))
        cdb[0xAB:0xE4] = self.hasher.sign(cdb_sha1(cdb), self.guid)
        return cdb

    def test_cdb_signature_covers_unk_0x32(self):
        cdb = self.signed_cdb()
        result = verify_cdb(bytes(cdb), self.guid, self.hasher)
        self.assertEqual(result, {"cdbScheme": 3, "cdbHashAB": True})
        self.assertFalse(verify_cdb(bytes(cdb), bytes(8), self.hasher)["cdbHashAB"])
        for offset in (0x33, 0xF5):
            damaged = bytearray(cdb)
            damaged[offset] ^= 1
            self.assertFalse(verify_cdb(bytes(damaged), self.guid, self.hasher)["cdbHashAB"])
        with self.assertRaises(ValueError):
            cdb_sha1(b"mhbd" + bytes(16))

    def test_sqlite_integrity(self):
        report = inspect_schema(self.data)
        self.assertEqual(report["integrity"], ["ok"])
        self.assertEqual(report["schema"][0]["name"], "location")

    def test_cli_does_not_modify_input_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "Locations.itdb"
            cbk = Path(str(db) + ".cbk")
            db.write_bytes(self.data)
            cbk.write_bytes(make_cbk(self.data, self.guid, self.hasher))
            before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in Path(directory).iterdir()}
            command = [sys.executable, str(ROOT / "probe.py"), str(db),
                       "--library", str(self.library), "--guid", self.guid.hex()]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(json.loads(result.stdout)["success"])
            command[-1] = "00" * 8
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertFalse(json.loads(result.stdout)["success"])
            after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in Path(directory).iterdir()}
            self.assertEqual(before, after)

    def test_cli_requires_cdb_hashing_scheme_3(self):
        # The hash is computed with scheme 3, so it still matches when only the
        # stored scheme differs; the probe must reject that CDB anyway.
        cdb = self.signed_cdb()
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "Locations.itdb"
            db.write_bytes(self.data)
            Path(str(db) + ".cbk").write_bytes(make_cbk(self.data, self.guid, self.hasher))
            path = Path(directory) / "iTunesCDB"
            command = [sys.executable, str(ROOT / "probe.py"), str(db), "--library",
                       str(self.library), "--guid", self.guid.hex(), "--cdb", str(path)]
            for scheme, returncode in ((3, 0), (2, 1)):
                cdb[0x30] = scheme
                path.write_bytes(cdb)
                result = subprocess.run(command, capture_output=True, text=True)
                report = json.loads(result.stdout)
                self.assertEqual((result.returncode, report["cdbScheme"], report["cdbHashAB"]),
                                 (returncode, scheme, True))


if __name__ == "__main__":
    unittest.main()
