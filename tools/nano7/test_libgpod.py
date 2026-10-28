"""Exercise a compiled libgpod-roundtrip helper on temporary synthetic devices."""
import os
import plistlib
from pathlib import Path
import re
import sqlite3
import struct
import subprocess
import tempfile
import unittest

from build import build, ROOT
from probe import HashAB, guid_bytes, verify_cbk, verify_cdb


class LibgpodRoundtripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helper = Path(os.environ["LIBGPOD_ROUNDTRIP"]).resolve()
        if not cls.helper.is_file():
            raise FileNotFoundError(cls.helper)
        cls.build_dir = tempfile.TemporaryDirectory()
        cls.hasher = HashAB(build(Path(cls.build_dir.name) / "hashab.so"))

    @classmethod
    def tearDownClass(cls):
        cls.build_dir.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.mount = Path(self.temp.name)
        self.control = self.mount / "iPod_Control"
        for name in ("Device", "Artwork", "iTunes", "Music/F00"):
            (self.control / name).mkdir(parents=True)
        (self.control / "Music/F00/TEST.mp3").write_bytes(bytes(32000))

    def setup_nano(self, guid="0123456789ABCDEF"):
        # Keep the device's unusual plist arrays verbatim, including AlbumArt2.
        capture = (ROOT.parents[1] / "docs/sysinfo-captures/nano-7g-16gb-usb.xml").read_text()
        capture = re.sub(r"(<key>FireWireGUID</key>\s*<string>)[^<]+",
                         lambda m: m[1] + guid, capture)
        (self.control / "Device/SysInfoExtended").write_text(capture)
        (self.control / "Device/SysInfo").write_text("ModelNumStr: MD480\n")

    def run_helper(self, operation, success=True):
        result = subprocess.run([str(self.helper), str(self.mount), operation],
                                capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def check_library(self, count):
        bundle = self.control / "iTunes/iTunes Library.itlp"
        for name in ("Library", "Locations", "Dynamic", "Extras", "Genius"):
            with sqlite3.connect(f"file:{bundle / (name + '.itdb')}?mode=ro", uri=True) as db:
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
        guid = guid_bytes("0123456789ABCDEF")
        result = verify_cbk((bundle / "Locations.itdb").read_bytes(),
                            (bundle / "Locations.itdb.cbk").read_bytes(), guid, self.hasher)
        self.assertTrue(result["success"], result)
        cdb = verify_cdb((self.control / "iTunes/iTunesCDB").read_bytes(), guid, self.hasher)
        self.assertEqual((cdb["cdbScheme"], cdb["cdbHashAB"]), (3, True), cdb)
        with sqlite3.connect(f"file:{bundle / 'Library.itdb'}?mode=ro", uri=True) as db:
            self.assertEqual(db.execute("SELECT title FROM item").fetchall(),
                             [("Synthetic track",)] * count)

    def test_nano_6_create_resave_delete(self):
        # Synthetic capabilities: no Nano 6 SysInfoExtended capture is available.
        properties = {"FireWireGUID": "0123456789ABCDEF", "SQLiteDB": True, "DBVersion": 5}
        (self.control / "Device/SysInfoExtended").write_bytes(plistlib.dumps(properties))
        (self.control / "Device/SysInfo").write_text("ModelNumStr: MC526\n")
        for operation, count in (("create", 1), ("resave", 1), ("delete", 0)):
            self.run_helper(operation)
            self.check_library(count)

    def test_nano_7_create_resave_delete(self):
        self.setup_nano()
        for operation, count in (("create", 1), ("resave", 1), ("delete", 0)):
            self.run_helper(operation)
            self.check_library(count)

    def test_invalid_or_ios_guid_is_rejected(self):
        for guid in ("", "0123456789ABCDEG", "0123456789ABCDE", "01" * 20):
            with self.subTest(guid=guid):
                self.setup_nano(guid)
                result = self.run_helper("create", success=False)
                self.assertIn("GUID", result.stderr)

    def test_prefixed_guid(self):
        self.setup_nano("0x0123456789ABCDEF")
        self.run_helper("create")
        self.check_library(1)

    def test_video_5g_remains_unsigned(self):
        (self.control / "Device/SysInfo").write_text("ModelNumStr: MA002\n")
        self.run_helper("create")
        data = (self.control / "iTunes/iTunesDB").read_bytes()
        self.assertEqual(data[:4], b"mhbd")
        self.assertEqual(struct.unpack_from("<H", data, 0x30)[0], 0)
        self.assertFalse((self.control / "iTunes/iTunes Library.itlp").exists())


if __name__ == "__main__":
    unittest.main()
