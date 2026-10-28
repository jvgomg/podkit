"""Exercise a compiled libgpod-roundtrip helper on temporary synthetic devices."""
import contextlib
import os
import plistlib
from pathlib import Path
import re
import resource
import signal
import sqlite3
import struct
import subprocess
import tempfile
import unittest
import zlib

from build import build, ROOT
from probe import HashAB, guid_bytes, verify_cbk, verify_cdb

CAPTURE = ROOT.parents[1] / "docs/sysinfo-captures/nano-7g-16gb-usb.xml"
POST_PROCESS = "com.apple.mobile.iTunes.SQLMusicLibraryPostProcessCommands"
# Firmware categories as iTunes writes them for a nano 7G: distinguished_kind
# (mhyp +0x52) -> (+0x50, rule 1 mask, rule 2 action, rule 2 mask).
CATEGORIES = {
    4: (4, 0x1021B1, 0x02000400, 0x208004),
    1: (0, 0x000C42, 0x02000400, 0x20A004),
    2: (2, 0x000402, 0x02000400, 0x20A004),
    3: (3, 0x000040, 0x02000400, 0x20A004),
    5: (5, 0x000008, 0x02000400, 0x20A004),
    7: (7, 0x000042, 0x00000800, 0x008000),
}
APPLE_COLUMNS = {
    "item": {"is_home_video", "is_tone", "is_book", "is_itunes_u", "is_digital_booklet",
             "chosen_by_auto_fill", "collection_description", "copyright"},
    "avformat_info": {"channels"},
    "video_info": {"is_hd"},
    "store_info": {"xid", "flavor"},
    "container": {"smart_evaluation_order"},
}


def rows(path, sql, params=()):
    with contextlib.closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as db:
        return db.execute(sql, params).fetchall()


def columns(path, table):
    return {row[1] for row in rows(path, f"PRAGMA table_info({table})")}


def category_slst(kind):
    """The SLst payload (big-endian) of a category's two media kind rules."""
    _, mask1, action2, mask2 = CATEGORIES[kind]
    out = b"SLst" + struct.pack(">III", 0x00010001, 2, 0) + bytes(120)
    for action, mask in ((0x400, mask1), (action2, mask2)):
        out += struct.pack(">II", 0x3C, action) + bytes(44) + struct.pack(">I", 0x44)
        out += struct.pack(">QQQQQQ", mask, 0, 1, mask, 0, 1) + bytes(20)
    return out


def post_process_commands():
    # The capture is not strictly valid XML elsewhere; take only this dictionary.
    text = CAPTURE.read_text()
    start = text.index("<dict>", text.index(f"<key>{POST_PROCESS}</key>"))
    depth = 0
    for match in re.finditer(r"<dict>|</dict>", text[start:]):
        depth += 1 if match[0] == "<dict>" else -1
        if depth == 0:
            body = text[start:start + match.end()]
            break
    return plistlib.loads(f'<?xml version="1.0"?><plist version="1.0">{body}</plist>'.encode())


def read_cdb(path):
    """(header, uncompressed database) of an iTunesCDB or iTunesDB."""
    data = path.read_bytes()
    header = struct.unpack_from("<I", data, 4)[0]
    if path.name == "iTunesCDB":
        return data[:header], data[:header] + zlib.decompress(data[header:])
    return data[:header], data


def write_cdb(path, header, data):
    body = data[len(header):]
    if path.name == "iTunesCDB":
        body = zlib.compress(body)
    header = bytearray(header)
    struct.pack_into("<I", header, 8, len(header) + len(body))
    path.write_bytes(bytes(header) + body)


def mhsd_span(data, mhsd_type):
    offset = struct.unpack_from("<I", data, 4)[0]
    for _ in range(struct.unpack_from("<I", data, 0x14)[0]):
        total, kind = struct.unpack_from("<II", data, offset + 8)
        if kind == mhsd_type:
            return offset, offset + total
        offset += total
    raise AssertionError(f"no mhsd type {mhsd_type}")


def cdb_records(data, mhsd_type, magic):
    """(offset, header length) of each record in one mhsd."""
    start, _ = mhsd_span(data, mhsd_type)
    pos = start + struct.unpack_from("<I", data, start + 4)[0]
    count = struct.unpack_from("<I", data, pos + 8)[0]
    pos += struct.unpack_from("<I", data, pos + 4)[0]
    records = []
    for _ in range(count):
        assert data[pos:pos + 4] == magic, data[pos:pos + 4]
        records.append((pos, struct.unpack_from("<I", data, pos + 4)[0]))
        pos += struct.unpack_from("<I", data, pos + 8)[0]
    return records


def mhod_payload(data, record, mhod_type):
    pos, hlen = record
    pos += hlen
    for _ in range(struct.unpack_from("<I", data, record[0] + 12)[0]):
        size, total, kind = struct.unpack_from("<III", data, pos + 4)
        if kind == mhod_type:
            return data[pos + size:pos + total]
        pos += total
    return None


class LibgpodRoundtripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helper = Path(os.environ["LIBGPOD_ROUNDTRIP"]).resolve()
        if not cls.helper.is_file():
            raise FileNotFoundError(cls.helper)
        cls.build_dir = tempfile.TemporaryDirectory()
        cls.hasher = HashAB(build(Path(cls.build_dir.name) / "hashab.so"))
        cls.commands = post_process_commands()

    @classmethod
    def tearDownClass(cls):
        cls.build_dir.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.mount = Path(self.temp.name)
        self.control = self.mount / "iPod_Control"
        self.bundle = self.control / "iTunes/iTunes Library.itlp"
        for name in ("Device", "Artwork", "iTunes", "Music/F00"):
            (self.control / name).mkdir(parents=True)
        (self.control / "Music/F00/TEST.mp3").write_bytes(bytes(32000))

    def db(self, name):
        return self.bundle / f"{name}.itdb"

    def setup_nano(self, guid="0123456789ABCDEF"):
        # Keep the device's unusual plist arrays verbatim, including AlbumArt2.
        capture = re.sub(r"(<key>FireWireGUID</key>\s*<string>)[^<]+",
                         lambda m: m[1] + guid, CAPTURE.read_text())
        (self.control / "Device/SysInfoExtended").write_text(capture)
        (self.control / "Device/SysInfo").write_text("ModelNumStr: MD480\n")

    def setup_synthetic(self, model, db_version, commands=None):
        # Synthetic capabilities: no Nano 5/6 SysInfoExtended capture is available.
        properties = {"FireWireGUID": "0123456789ABCDEF", "SQLiteDB": True, "DBVersion": db_version}
        if commands is not None:
            properties[POST_PROCESS] = commands
        (self.control / "Device/SysInfoExtended").write_bytes(plistlib.dumps(properties))
        (self.control / "Device/SysInfo").write_text(f"ModelNumStr: {model}\n")

    def run_helper(self, operation, success=True, preexec_fn=None):
        result = subprocess.run([str(self.helper), str(self.mount), operation],
                                capture_output=True, text=True, preexec_fn=preexec_fn)
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

    def check_schema(self):
        """iTunes' columns and version markers."""
        library = self.db("Library")
        for table, names in APPLE_COLUMNS.items():
            self.assertLessEqual(names, columns(library, table), table)
        self.assertEqual(rows(library, "PRAGMA user_version"), [(26,)])
        self.assertEqual(rows(self.db("Genius"), "PRAGMA user_version"), [(2,)])
        self.assertEqual(rows(library, "SELECT * FROM version_info"), [(1, 1, 117, 0, 0, 1109, 1)])

    def check_categories(self):
        """The firmware's categories in SQLite and the CDB; returns {kind: pid}."""
        library = self.db("Library")
        found = rows(library, "SELECT distinguished_kind, pid, is_hidden, parent_pid, smart_is_folder, "
                              "smart_is_dynamic, smart_is_filtered, smart_is_genius, smart_is_limited, "
                              "smart_limit_kind, smart_evaluation_order, smart_criteria "
                              "FROM container WHERE distinguished_kind != 0")
        self.assertEqual(sorted(row[0] for row in found), sorted(CATEGORIES))
        pids = {}
        for kind, pid, *flags, criteria in found:
            self.assertEqual(flags, [1, 0, 0, 1, 1, 0, 0, 2, 7], kind)
            self.assertEqual(criteria, category_slst(kind), kind)
            pids[kind] = pid
        # The firmware evaluates the rules itself: no members.
        self.assertEqual(rows(library, "SELECT count(*) FROM item_to_container WHERE container_pid IN "
                                       "(SELECT pid FROM container WHERE distinguished_kind != 0)"), [(0,)])
        self.assertEqual(rows(library, "SELECT media_kinds FROM container WHERE distinguished_kind = 4"),
                         rows(library, "SELECT media_kinds FROM container WHERE distinguished_kind = 0 "
                                       "AND is_hidden = 1"))
        self.assertEqual(sorted(rows(self.db("Dynamic"), "SELECT container_pid FROM container_ui")),
                         sorted(rows(library, "SELECT pid FROM container")))
        # The CDB keeps each category's kind at mhyp +0x52 and the same rules.
        _, data = read_cdb(self.control / "iTunes/iTunesCDB")
        cdb = {}
        for record in cdb_records(data, 5, b"mhyp"):
            type50, kind = struct.unpack_from("<HH", data, record[0] + 0x50)
            cdb[kind] = (type50, struct.unpack_from("<q", data, record[0] + 0x1C)[0],
                         mhod_payload(data, record, 51))
        self.assertEqual(cdb, {kind: (CATEGORIES[kind][0], pids[kind], category_slst(kind))
                               for kind in CATEGORIES})
        return pids

    def drop_categories(self, kinds):
        """Remove dataset 5 playlists from the iTunesCDB by category kind."""
        path = self.control / "iTunes/iTunesCDB"
        header, data = read_cdb(path)
        start, end = mhsd_span(data, 5)
        records = cdb_records(data, 5, b"mhyp")
        mhlp = start + struct.unpack_from("<I", data, start + 4)[0]
        body = bytearray(data[start:mhlp + struct.unpack_from("<I", data, mhlp + 4)[0]])
        kept = [data[pos:pos + struct.unpack_from("<I", data, pos + 8)[0]] for pos, _ in records
                if struct.unpack_from("<H", data, pos + 0x52)[0] not in kinds]
        struct.pack_into("<I", body, mhlp - start + 8, len(kept))
        body += b"".join(kept)
        struct.pack_into("<I", body, 8, len(body))
        write_cdb(path, header, data[:start] + bytes(body) + data[end:])

    def test_nano_6_create_resave_delete(self):
        self.setup_synthetic("MC526", 5, self.commands)
        for operation, count in (("create", 1), ("resave", 1), ("delete", 0)):
            self.run_helper(operation)
            self.check_library(count)
            self.check_schema()
            self.check_categories()

    def test_nano_7_create_resave_delete(self):
        self.setup_nano()
        pids = None
        for operation, count in (("create", 1), ("resave", 1), ("resave", 1), ("delete", 0)):
            self.run_helper(operation)
            self.check_library(count)
            self.check_schema()
            pids = pids or self.check_categories()
            self.assertEqual(self.check_categories(), pids, operation)

    def test_nano_7_adds_missing_categories(self):
        # Categories a library lacks are added with iTunes' rules; the others
        # keep their pids. Music gets the master playlist's media kinds, here
        # audio (1) and a movie (2).
        self.setup_nano()
        self.run_helper("create")
        pids = self.check_categories()
        self.drop_categories({2, 7})
        self.run_helper("add")
        self.assertEqual({kind: pid for kind, pid in self.check_categories().items() if kind not in (2, 7)},
                         {kind: pid for kind, pid in pids.items() if kind not in (2, 7)})
        self.assertEqual(rows(self.db("Library"), "SELECT media_kinds FROM container "
                                                  "WHERE distinguished_kind = 4"), [(3,)])

    def test_nano_7_dataset5_header_fields(self):
        # +0x50, +0x52 and +0x54 are kept as read, independently of each other.
        self.setup_nano()
        self.run_helper("create")
        path = self.control / "iTunes/iTunesCDB"
        header, data = read_cdb(path)
        data = bytearray(data)
        changed = {4: (4, 4, 9), 2: (0, 2, 0), 7: (7, 7, 0)}
        expected = {}
        for offset, _ in cdb_records(bytes(data), 5, b"mhyp"):
            kind = struct.unpack_from("<H", data, offset + 0x52)[0]
            if kind in changed:
                struct.pack_into("<HHI", data, offset + 0x50, *changed[kind])
            expected[kind] = struct.unpack_from("<HHI", data, offset + 0x50)
        write_cdb(path, header, bytes(data))
        self.assertEqual(expected[1], (0, 1, 0))
        self.run_helper("resave")
        _, data = read_cdb(path)
        self.assertEqual({struct.unpack_from("<H", data, offset + 0x52)[0]:
                          struct.unpack_from("<HHI", data, offset + 0x50)
                          for offset, _ in cdb_records(data, 5, b"mhyp")}, expected)
        self.assertEqual(sorted(rows(self.db("Library"), "SELECT distinguished_kind FROM container "
                                                         "WHERE distinguished_kind != 0")),
                         [(kind,) for kind in sorted(CATEGORIES)])

    def snapshot(self):
        files = {path.name: path.read_bytes() for path in self.bundle.iterdir()}
        files["iTunesCDB"] = (self.control / "iTunes/iTunesCDB").read_bytes()
        return files

    def test_nano_post_process_commands_are_required(self):
        sets, sql = self.commands["UserVersionCommandSets"], self.commands["SQLCommands"]
        named_26 = [26 if name == "FakePragmaITunes26" else name for name in sets["25"]["Commands"]]
        cases = {
            "none": None,
            "only set 26": dict(self.commands, UserVersionCommandSets={"26": sets["26"]}),
            "missing command": dict(self.commands, SQLCommands={
                key: value for key, value in sql.items() if key != "FakePragmaITunes26"}),
            "failing command": dict(self.commands, SQLCommands=dict(
                sql, CreateIsHomeVideo="ALTER TABLE no_such_table ADD COLUMN x INTEGER;")),
            "non-string command": dict(self.commands, UserVersionCommandSets=dict(
                sets, **{"25": dict(sets["25"], Commands=named_26)})),
        }
        self.setup_synthetic("MC526", 5, self.commands)
        self.run_helper("create")
        library = self.snapshot()
        for name, commands in cases.items():
            with self.subTest(name):
                self.setup_synthetic("MC526", 5, commands)
                result = self.run_helper("resave", success=False)
                self.assertIn("post-process commands", result.stderr)
                self.assertEqual(self.snapshot(), library)

    def test_nano_runs_the_first_genre_count_command(self):
        # Set 25 lists AddGenreMapCompilationCount twice; only the repeat is skipped.
        sql = dict(self.commands["SQLCommands"])
        sql["AddGenreMapCompilationCount"] += "CREATE TABLE genre_count_added (x INTEGER);"
        self.setup_synthetic("MC526", 5, dict(self.commands, SQLCommands=sql))
        self.run_helper("create")
        self.assertEqual(rows(self.db("Library"), "SELECT name FROM sqlite_master "
                                                  "WHERE name = 'genre_count_added'"),
                         [("genre_count_added",)])

    def test_nano_failed_insert_or_commit_fails_the_write(self):
        # A playlist with the master playlist's pid breaks a key; a file size
        # limit makes the COMMIT of Library.itdb fail, as on a full disk.
        self.setup_nano()
        self.run_helper("create")
        library = self.snapshot()
        limit = self.db("Library").stat().st_size + 65536

        def full_disk():
            signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
            resource.setrlimit(resource.RLIMIT_FSIZE, (limit, limit))

        for operation, preexec_fn, generated in (("clash", None, "Dynamic.itdb"),
                                                 ("grow", full_disk, "Library.itdb")):
            with self.subTest(operation):
                result = self.run_helper(operation, success=False, preexec_fn=preexec_fn)
                self.assertIn(f"during {generated} generation", result.stderr)
                self.assertEqual(self.snapshot(), library)

    def test_nano_5g_keeps_libgpod_layout(self):
        # SQLite with HASH72 instead of HashAB: none of the nano 6G/7G layout.
        self.setup_nano()
        self.run_helper("create")
        path = self.control / "iTunes/iTunesCDB"
        _, nano_7 = read_cdb(path)
        path.unlink()
        self.setup_synthetic("MC027", 4, self.commands)
        (self.control / "Device/HashInfo").write_bytes(
            b"HASHv0" + bytes.fromhex("0123456789ABCDEF").ljust(20, b"\0") + bytes(range(28)))
        self.run_helper("create")
        header, data = read_cdb(path)
        self.assertEqual(cdb_records(data, 5, b"mhyp"), [])
        # The nano 7G categories, parsed and written by a Nano 5G: libgpod's
        # header (+0x52 = +0x50, +0x54 = 1 for Rentals) and no SQLite rows.
        start, end = mhsd_span(data, 5)
        categories = slice(*mhsd_span(nano_7, 5))
        write_cdb(path, header, data[:start] + nano_7[categories] + data[end:])
        self.run_helper("resave")
        _, data = read_cdb(path)
        headers = [struct.unpack_from("<HHI", data, offset + 0x50)
                   for offset, _ in cdb_records(data, 5, b"mhyp")]
        self.assertEqual(sorted(headers), sorted((type50, type50, int(type50 == 7))
                                                 for type50, *_ in CATEGORIES.values()))
        library = self.db("Library")
        self.assertEqual(rows(library, "SELECT count(*), max(distinguished_kind), "
                                       "count(smart_criteria) FROM container"), [(2, 0, 0)])
        self.assertIn("date_backed_up", columns(library, "item"))
        for table, names in APPLE_COLUMNS.items():
            self.assertFalse(names & columns(library, table), table)
        self.assertEqual(rows(library, "PRAGMA user_version"), [(0,)])
        self.assertEqual(rows(self.db("Genius"), "PRAGMA user_version"), [(0,)])
        self.assertEqual(rows(library, "SELECT major, minor FROM version_info"), [(2, 48)])

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
