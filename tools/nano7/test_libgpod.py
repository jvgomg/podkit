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
import time
import unittest
import zlib

from build import build, ROOT
from probe import HashAB, guid_bytes, verify_cbk, verify_cdb

CAPTURE = ROOT.parents[1] / "docs/sysinfo-captures/nano-7g-16gb-usb.xml"
MAC_EPOCH = 2082844800
CORE_DATA_EPOCH = 978307200
# The synthetic track's dates (libgpod-roundtrip.c)
MODIFIED, ADDED = 1784116800, 1768478400
POST_PROCESS = "com.apple.mobile.iTunes.SQLMusicLibraryPostProcessCommands"
TRACK_CHOICES = "audio_language, subtitle_language, audio_track_id, subtitle_track_id"
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


def host_offset(tz):
    """Seconds east of UTC of the zone tz now, as libgpod's host time conversion uses it."""
    saved = os.environ.get("TZ")
    os.environ["TZ"] = tz
    time.tzset()
    offset = time.localtime().tm_gmtoff
    if saved is None:
        del os.environ["TZ"]
    else:
        os.environ["TZ"] = saved
    time.tzset()
    return offset


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

    def run_helper(self, operation, success=True, preexec_fn=None, tz="Europe/Berlin"):
        result = subprocess.run([str(self.helper), str(self.mount), operation], capture_output=True,
                                text=True, preexec_fn=preexec_fn, env=dict(os.environ, TZ=tz))
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

    def stats(self, columns="play_count_user, play_count_recent, play_count_user_original", pid=None):
        return rows(self.db("Dynamic"), f"SELECT item_pid, {columns} FROM item_stats "
                                        "WHERE ? IS NULL OR item_pid = ? ORDER BY item_pid", (pid, pid))

    def set_stats(self, values, pid=None):
        """What the firmware records in Dynamic.itdb."""
        with contextlib.closing(sqlite3.connect(self.db("Dynamic"))) as db, db:
            db.execute(f"UPDATE item_stats SET {values} WHERE ? IS NULL OR item_pid = ?", (pid, pid))

    def cdb_track(self, offset, size="<I"):
        """A field of the first track in the iTunesCDB."""
        _, data = read_cdb(self.control / "iTunes/iTunesCDB")
        return struct.unpack_from(size, data, cdb_records(data, 1, b"mhit")[0][0] + offset)[0]

    def tzoffset(self):
        return struct.unpack_from("<i", read_cdb(self.control / "iTunes/iTunesCDB")[1], 0x6C)[0]

    def write_play_counts(self, plays, played, skips=0, skipped=0):
        """The firmware's report: one 0x28-byte entry per track, dates with the CDB's offset."""
        entry = struct.pack("<IIIIIII", plays, played, 0, 0, 0, skips, skipped) + bytes(12)
        (self.control / "iTunes/Play Counts").write_bytes(
            b"mhdp" + struct.pack("<III", 0x60, 0x28, 1) + bytes(0x50) + entry)

    def test_nano_7_plays_count_once(self):
        # Plays only in Dynamic.itdb count; a play in Dynamic.itdb and in
        # Play Counts (count - *_original) counts once, also on the next write.
        self.setup_nano()
        self.run_helper("create")
        self.set_stats("play_count_user = 5, play_count_recent = 5")
        self.run_helper("resave")
        (pid, *_), = self.stats()
        self.assertEqual(self.stats(), [(pid, 5, 5, 5)])
        played = MODIFIED + 3600
        self.set_stats(f"play_count_user = 7, play_count_recent = 7, date_played = {played - CORE_DATA_EPOCH}")
        self.write_play_counts(2, played + MAC_EPOCH + self.tzoffset())
        for _ in range(2):
            self.run_helper("resave")
            self.assertEqual(self.stats(), [(pid, 7, 7, 7)])
            self.assertEqual(self.stats("date_played"), [(pid, played - CORE_DATA_EPOCH)])
            self.assertEqual(self.cdb_track(0x50), 7)
            self.assertFalse((self.control / "iTunes/Play Counts").exists())

    def test_nano_7_play_counts_dates(self):
        # Without a Dynamic.itdb row, the Play Counts dates are the track's, in
        # Dynamic.itdb and in the iTunesCDB (which stores the host's local time);
        # 0 and "none" set no date.
        self.setup_nano()
        offset = host_offset("Europe/Berlin")
        played, skipped = MODIFIED + 3600, MODIFIED + 7200
        for case in ("dates", "zero and none"):
            with self.subTest(case):
                self.run_helper("create")
                self.db("Dynamic").unlink()
                fixed = MAC_EPOCH + self.tzoffset()
                if case == "dates":
                    report, dates = (played + fixed, skipped + fixed), (played, skipped)
                else:
                    report, dates = (0, CORE_DATA_EPOCH + fixed), (0, 0)
                self.write_play_counts(1, report[0], 1, report[1])
                self.run_helper("resave")
                self.assertEqual(self.stats("date_played, date_skipped")[0][1:],
                                 tuple(date and date - CORE_DATA_EPOCH for date in dates))
                self.assertEqual((self.cdb_track(0x58), self.cdb_track(0xA0)),
                                 tuple(date and date + MAC_EPOCH + offset for date in dates))

    def test_nano_7_later_reported_date_wins(self):
        # Dynamic.itdb and Play Counts report the same activity; where their
        # dates differ, the later one is kept.
        self.setup_nano()
        self.run_helper("create")
        older, newer = MODIFIED, MODIFIED + 3600
        self.set_stats(f"play_count_user = 1, date_played = {newer - CORE_DATA_EPOCH}, "
                       "skip_count_user = 1, date_skipped = 0")
        fixed = MAC_EPOCH + self.tzoffset()
        self.write_play_counts(1, older + fixed, 1, newer + fixed)
        self.run_helper("resave")
        self.assertEqual(self.stats("date_played, date_skipped")[0][1:],
                         (newer - CORE_DATA_EPOCH, newer - CORE_DATA_EPOCH))

    def test_nano_7_keeps_device_activity(self):
        self.setup_nano()
        self.run_helper("create")
        self.run_helper("add")
        first, second = (rows(self.db("Library"), "SELECT pid FROM item WHERE title = ?", (title,))[0][0]
                         for title in ("Synthetic track", "Second track"))
        defaults = self.stats(TRACK_CHOICES, second)
        self.assertEqual(self.stats("has_been_played", second), [(second, 0)])
        self.set_stats(f"skip_count_user = 2, skip_count_recent = 2, user_rating = 80, "
                       f"bookmark_time_ms = 2000, date_skipped = {MODIFIED - CORE_DATA_EPOCH}, "
                       "audio_language = 5, subtitle_language = 6, audio_track_id = 3, "
                       "subtitle_track_id = 4, has_been_played = 1", first)
        # The firmware marks a track as played when it is started, without
        # a count.
        self.set_stats("has_been_played = 1", second)
        columns = "skip_count_user, skip_count_recent, user_rating, bookmark_time_ms, date_skipped, "
        expected = self.stats(columns + TRACK_CHOICES + ", has_been_played")
        for _ in range(2):
            self.run_helper("resave")
            self.assertEqual(self.stats(columns + TRACK_CHOICES + ", has_been_played"), expected)
        # The iTunesCDB has the device's rating, bookmark and played mark,
        # and the other item keeps its own track choices.
        self.assertEqual((self.cdb_track(0x1F, "<B"), self.cdb_track(0x6C), self.cdb_track(0xB2, "<B")),
                         (80, 2000, 1))
        self.assertEqual(self.stats(TRACK_CHOICES, second), defaults)
        # Host edits win, also clearing to zero; the track choices stay.
        self.run_helper("rate")
        self.assertEqual(self.stats("user_rating, bookmark_time_ms", first), [(first, 60, 3000.0)])
        self.run_helper("clear")
        self.assertEqual(self.stats(columns + TRACK_CHOICES + ", has_been_played", first),
                         [(first, 0, 0, 0, 0.0, 0, 5, 6, 3, 4, 1)])
        self.assertEqual((self.cdb_track(0x1F, "<B"), self.cdb_track(0x6C)), (0, 0))
        self.set_stats("play_count_user = 4", second)
        self.run_helper("delete")
        self.assertEqual(self.stats(), [(second, 4, 0, 4)])
        self.assertEqual(self.stats("has_been_played"), [(second, 1)])

    def test_nano_7_dynamic_without_track_choices(self):
        # A Dynamic.itdb without the track choice columns has none to keep.
        self.setup_nano()
        self.run_helper("create")
        with contextlib.closing(sqlite3.connect(self.db("Dynamic"))) as db:
            for column in TRACK_CHOICES.split(", "):
                db.execute(f"ALTER TABLE item_stats DROP COLUMN {column}")
        self.run_helper("resave")
        self.assertEqual(len(self.stats(TRACK_CHOICES)), 1)

    def test_nano_7_dates_are_utc(self):
        # SQLite dates are exact UTC, whatever the host's time zone; unset
        # ones are 0, also where libgpod used to write -978307200 - offset.
        zones = ("Europe/Berlin", "UTC", "America/Los_Angeles", "Asia/Kolkata")
        if len({host_offset(tz) for tz in zones}) < len(zones):
            self.skipTest("the host has no time zone data")
        self.setup_nano()
        self.run_helper("create")
        self.set_stats(f"date_skipped = {-CORE_DATA_EPOCH - self.tzoffset()}")
        playlists = rows(self.db("Library"), "SELECT pid, date_created FROM container ORDER BY pid")
        for tz in zones:
            with self.subTest(tz):
                self.run_helper("resave", tz=tz)
                self.assertEqual(rows(self.db("Library"), "SELECT date_modified FROM item")
                                 + rows(self.db("Locations"), "SELECT date_created FROM location")
                                 + rows(self.db("Dynamic"), "SELECT date_played, date_skipped FROM item_stats"),
                                 [(MODIFIED - CORE_DATA_EPOCH,), (ADDED - CORE_DATA_EPOCH,), (0, 0)])
                self.assertEqual(rows(self.db("Library"), "SELECT pid, date_created FROM container "
                                                          "ORDER BY pid"), playlists)
        # An unset date added stays unset instead of becoming the date modified.
        with contextlib.closing(sqlite3.connect(self.db("Locations"))) as db, db:
            db.execute("UPDATE location SET date_created = 0")
        self.run_helper("resave")
        self.assertEqual(rows(self.db("Locations"), "SELECT date_created FROM location"), [(0,)])

    def test_nano_7_unreadable_dynamic_is_not_replaced(self):
        self.setup_nano()
        self.run_helper("create")
        self.db("Dynamic").write_bytes(b"not a database" * 100)
        before = {path.name: path.read_bytes() for path in self.bundle.iterdir()}
        result = self.run_helper("resave", success=False)
        self.assertIn("Dynamic.itdb", result.stderr)
        self.assertEqual({path.name: path.read_bytes() for path in self.bundle.iterdir()}, before)

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
