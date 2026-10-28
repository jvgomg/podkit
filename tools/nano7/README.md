# Nano HashAB checks

The iPod nano 6th and 7th generation sign `iTunesCDB` and
`iTunes Library.itlp/Locations.itdb.cbk` with HashAB. podkit's libgpod builds
link the vendored signer from `tools/prebuild/vendor/hashab` through
`tools/prebuild/libgpod-nano.patch` (see
[ADR-030](../../docs/adr/adr-030-native-nano-hashab.md)). Valid signatures
alone do not make a library acceptable to the nano 7th generation firmware;
the patch also gives the SQLite library iTunes' layout (see below), and podkit
syncs that generation. The nano 6th generation stays **read-only**: its writes
are covered only by synthetic tests.

These tools need Python 3.11+ and a C compiler, and no pip or npm packages.

## Signature checks

```sh
python3 tools/nano7/build.py
python3 tools/nano7/test_probe.py -v
python3 tools/nano7/probe.py tools/nano7/fixtures/Locations.itdb --guid 000a270024bd17a1
```

`build.py` compiles the vendored signer into `tools/nano7/build/` for the
Python checks only. The tests cover the 100 upstream reference vectors, a
byte-exact reproduction of the reference checksum book in `fixtures/`, nonce
handling, `iTunesCDB` normalisation and rejection of corrupted data or a wrong
GUID.

## libgpod roundtrip

Build the patched libgpod as usual, then run the roundtrip:

```sh
bash tools/libgpod-macos/build.sh all   # macOS; installs to $PREFIX (default ~/.local)
bash tools/nano7/test-libgpod.sh
```

`test-libgpod.sh` compiles `libgpod-roundtrip.c` with the same flag helpers as
`@podkit/libgpod-node` (`STATIC_DEPS_DIR` selects a prebuild dependency tree)
and lets libgpod create, reparse, resave and delete a synthetic track on
temporary devices: a nano 7th generation from
`docs/sysinfo-captures/nano-7g-16gb-usb.xml` and a nano 6th generation with
synthetic capabilities. It checks the integrity of the five SQLite databases,
both signatures, rejection of malformed or iOS-sized GUIDs, and an unsigned
`iTunesDB` for a 5th generation iPod.

For the nano 6th and 7th generation the checks also cover the six hidden
category containers the firmware browses (Music, Videos, Movies, TV Shows,
Audiobooks, Rentals) in `Library.itdb` and in the `iTunesCDB` dataset 5,
whose header fields are kept as read, and iTunes' schema level: its
additional columns, `user_version` 26 (`Library.itdb`) and 2
(`Genius.itdb`) and the `version_info` row. The device's SQLite post-process
command set 25 completes that schema. A missing set, a missing or failing
command, or an insert or commit that fails while the databases are generated
fails the write and leaves the library unchanged. A nano 5th generation keeps
libgpod's previous layout.

A write keeps what a nano 6th/7th generation recorded in `Dynamic.itdb`.
Plays, skips, ratings, bookmarks, recent counts and their dates become the
tracks' values when the library is opened, so changes the host makes
afterwards win; a play reported in both `Dynamic.itdb` and `Play Counts`
counts once, and where their dates differ the later one is kept. The chosen
audio and subtitle tracks, which libgpod does not represent, are carried over
for the items that remain. SQLite dates are exact UTC whatever the host's time
zone, and an unset one is 0; exact item and playlist dates need a readable
`Library.itdb` and `Locations.itdb`, otherwise the `iTunesCDB`'s local times
are used. A `Dynamic.itdb` that cannot be read stops the write. The checks
cover these cases.

## Checking a copied device library

A nano 7th generation synced by macOS carries no `SysInfoExtended` file, so
read it over USB (`inquireFirmwareDetailed` in `@podkit/ipod-firmware`) for its
`FireWireGUID`. Copy `iPod_Control/iTunes/iTunes Library.itlp/` and
`iPod_Control/iTunes/iTunesCDB` from the device and run the probe on the copy:

```sh
python3 tools/nano7/probe.py /path/to/copy/Locations.itdb --guid <16 hex digits> \
  --cdb /path/to/copy/iTunesCDB
```

The probe reads SQLite only from an in-memory copy, prints the schema,
integrity and signature results as JSON and exits with 0 or 1. It never
writes.

On a nano 7th generation (firmware 1.0.4), Apple's `iTunesCDB` and
`Locations.itdb.cbk` verify with libgpod's CDB normalisation (hashing scheme 3)
and the device GUID.
