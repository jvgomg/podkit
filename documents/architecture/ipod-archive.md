---
title: iPod Archive
description: How `podkit device archive` extracts a self-contained, future-proof archive off an iPod — the two-stage raw-dump → transform design, the leaf `@podkit/ipod-archive` package, why the read path is libgpod-node-only with a ported artwork decoder, and the conventions a contributor must keep.
sidebar:
  order: 4
---

How podkit turns a connected iPod into a self-contained directory you can
browse, play, and query years later. The command exists because the
on-disk reality of an iPod is hostile to a plain `cp -r`: filenames are
obfuscated (`:iPod_Control:Music:F23:ABCD.m4a`), and the data that matters
most — play counts, ratings, last-played, skip counts, date-added — lives
only inside the `iTunesDB`, nowhere in the audio files. The archive rescues
both the playable files and that listening history.

## 1. Map

The feature is a standalone **leaf package, `@podkit/ipod-archive`**, plus a
thin `podkit device archive` CLI subcommand that delegates to it. The package
owns everything: the filesystem dump, the metadata read, the audio extraction,
artwork decoding, the SQLite catalogue, playlists, and the human/machine
reports. The CLI owns only device selection and terminal output.

Archiving runs in **two stages**:

1. **Raw dump** — a near-byte-for-byte, read-only copy of the iPod's
   whitelisted data, each file streamed through sha256 into a
   `manifest.sha256`. This is the lossless source of truth.
2. **Transform** — a *pure function of the dump* (it never reopens the
   device) that produces a browsable `archive/`: a renamed, media-type-routed
   audio tree with embedded artwork, a `library.sqlite` catalogue, `.m3u8`
   playlists, a `README.md`, and a `report.{md,json}`.

The two stages compose into one self-contained output directory,
`<deviceName>-<serial>-<timestamp>/`, holding `raw dump/` beside `archive/`.
Because stage 2 is pure over stage 1, the transform is re-runnable and
improvable without the device present (`--from-dump`), and a dump-only run is
also supported (`--dump-only`). A re-run refuses to write into an existing,
non-empty `archive/` (typed `ARCHIVE_ALREADY_EXISTS`) — the transform is a clean
build, not a merge, so the caller clears the old archive first.

The feature is **iPod-only**. Mass-storage devices have no `iTunesDB` and no
listening history to rescue, so they are out of scope.

## 2. Primitives

The package exposes **three orchestrators** and a set of deep, mostly-pure
modules behind them. The orchestrators are the public surface; the modules
are the testable seams.

- **`runDump(volumeRoot, destDir, opts) → DumpResult`** — stage 1. Classifies
  the volume's top-level entries, copies the iPod whitelist while hashing,
  writes the manifest, and (unless `skipReport`) writes a stage-1 report. The
  output directory name is computed *before* the copy, so the destination is
  known up front.
- **`runTransform(dumpDir, opts) → TransformResult`** — stage 2. Opens the
  dump via libgpod, plans a path per track, extracts + tags + embeds artwork,
  writes the catalogue, playlists, README, and report. Accepts an optional
  `dumpReport` so a full run folds stage-1 buckets into one unified report.
- **`runArchive(volumeRoot, destDir, opts) → ArchiveResult`** — the both-stages
  composition. Calls `runDump` then `runTransform(dump.outputDir, { dumpReport,
  skipReport: true on the dump })`, capturing the clock **once** so the
  directory-name timestamp and the catalogue's `dump_date` always agree.

The deep modules, in rough pipeline order:

- **`VolumeClassifier`** (`classifyEntries`) — pure. Splits the volume's
  top-level entries into `copy` (the iPod whitelist: `iPod_Control`,
  `Calendars`, `Contacts`, `Notes`), `junk` (hardcoded macOS noise —
  `.Spotlight-V100`, `.fseventsd`, `._*`, …), and `foreign` (anything else —
  user-added files). Foreign is reported; junk is silently excluded.
- **`RawDumper`** (`dump`) — streams each file through sha256 in a single read
  pass, emits a `shasum -c`-compatible `manifest.sha256`, and records per-file
  failures without aborting the run. Symlinks are recorded, never followed.
- **`DumpLoader`** (`loadDump`) — the bridge from a dump directory to a read
  surface. Opens the dump with libgpod-node `Database.open()` (which is
  filesystem-only — no device gate) and reads identity (serial via
  `@podkit/ipod-firmware` from `SysInfoExtended`; model/generation/capacity
  via libgpod). Returns `{ db, identity, ipodRoot }`.
- **`ArchivePathPlanner`** (`planPath`) — pure, the deepest module. Maps a
  track to its archive-relative path: media-type routing (Music /
  Music/Compilations / Podcasts / Audiobooks / Video/{Movies,TV Shows,Music
  Videos}), sanitisation for the worst-case (portable) filesystem,
  collision-resolution by appending `dbid`, and `Unknown Artist`/`Unknown
  Album` fallbacks. Returns `null` for a track with no audio path.
- **`ArtworkDecoder`** + **`RgbaToPng`** — the in-package iPod artwork stack
  (see §3). Parses the `ArtworkDB`, picks the largest thumbnail per `dbid`,
  decodes the stored pixel format (RGB565 / RGB555 / RGB888) from the `.ithmb`
  to RGBA, and encodes to PNG.
- **`TagWriter`** (`writeTrack`) — copies the audio file losslessly (byte copy,
  no transcode/remux), then writes text tags + embeds the PNG cover in place
  via `node-taglib-sharp`. Tagging is **two-tiered**: taglib is the fast
  in-process default (audio body stays byte-identical), but some real iPod MP3s
  defeat its parser — a large padding gap before the first audio frame ("MPEG
  audio header not found"), or a malformed ID3 frame it can't re-serialize
  ("Argument null"). For those, tagging falls back to ffmpeg (`retagWithFfmpeg`,
  `-c:a copy` — packets bit-exact, container rewritten by a more tolerant tool).
  If both fail the untouched byte copy is kept with its original on-device tags.
  The copy always precedes tagging, so a tag-write failure never loses audio and
  never orphans the file from the catalogue — `written` counts extracted audio,
  and `fallbackTagged` / `tagFailures` record how tagging went.
- **`LibraryDbWriter`** (`writeLibraryDb`) — builds `library.sqlite` with
  `bun:sqlite` (see §3) in a single transaction: `device`, `tracks` (every
  field + `exported_path` + `dump_path`), `playlists`, `playlist_items`,
  `albums`, `artwork`, `smart_playlist_rules`, `schema_version`.
- **`PlaylistWriter`** (`writePlaylists`) — emits `Playlists/<name>.m3u8` with
  relative paths, skipping the master/library playlist.
- **`ArchiveReport`** — accumulates the cross-stage buckets (foreign skipped,
  no-audio, no-artwork, extraction failures, tag failures) and renders `report.md` +
  `report.json`. Also produces the README via `computeLibraryStats` +
  `renderReadme`.
- **`ArchiveProgressEvent`** — a discriminated event union (`dump:start`,
  `dump:file`, `dump:done`, `transform:start` (carries device identity + a
  media-kind breakdown), `transform:track`, `transform:done`) emitted through
  an optional `onProgress` callback so the CLI can render live progress and a
  device-meta block without the package touching the terminal.

## 3. Responsibility boundaries

**Package vs CLI.** The package is a deep module; the CLI command is a thin
shell. The command resolves *which* iPod to archive and renders output — it
contains no archival logic. Device selection: with an explicit `--device`, it
honours the configured/path target (and only then enforces the iPod-only
gate); with no `--device`, it **auto-detects the connected iPod** via
`core.discoverConnectedDevices` (the same discovery `device scan` uses),
ignoring the configured default — because the archival use-case is a
second-hand or unconfigured iPod you just plugged in. Device-presence is the
primary error; the iPod-only caveat appears only when a non-iPod is actually
present.

**Firmware identity capture fails loudly, not silently.** Before stage 1 runs,
the CLI (which alone has `@podkit/core`, since the package stays a leaf) checks
whether the device already carries on-disk `SysInfoExtended`. If not — every
iPod shuffle, plus any device whose identity file is missing or corrupt — it
attempts a **read-only** live firmware inquiry so the dump still captures full
identity (serial, model number, capacity, colour). Three outcomes: *not
needed* (on-disk SysInfoExtended already covers it) and *no USB correlation*
(no live device maps to this volume — an unsupported platform, or a plain
directory handed to `--device <path>`) both proceed quietly, since neither is
something a retry or a flag could fix. A *capture that was attempted and
produced nothing* is different: the command stops with a typed error rather
than archiving with silently blank identity fields, unless the user passes
`--force`. Forcing past the gate still records the gap honestly — a note in
`README.md` and an `identity_capture_failed` / `identity_capture_failure_reason`
pair in the `device` row of `library.sqlite` — via a
`podkit-identity-unknown.txt` sidecar the dump stage writes alongside the
captured-SysInfoExtended sidecar (`device-identity.ts`).

**Read path is libgpod-node-only, with one carve-out.** All track / playlist /
smart-playlist / identity reads go through `@podkit/libgpod-node`. The package
does **not** depend on `@podkit/ipod-db` (the pure-TS parser) — the mature
native binding is the chosen read surface. The single exception is **artwork
pixels**: libgpod-node's artwork API is write/capability-only and cannot read
thumbnail pixels out of the `ArtworkDB`/`.ithmb`. Rather than take an ipod-db
dependency for that one thing, the package **ports** the ArtworkDB record
parser + `.ithmb` extractor + pixel-format decoders in-house (algorithm
reference: ipod-db's `artworkdb/`). The port is cross-validated byte-for-byte
against ipod-db's reference reader on real device data.

**The stage boundary is sacred.** Stage 2 reads only the dump, never the live
device. This is what makes the transform re-runnable and the dump the durable
artifact. Any change that has the transform reach back to hardware breaks the
contract.

**SQLite driver.** `library.sqlite` is written with `bun:sqlite`. This is only
viable because the CLI ships **Bun-only** (see [ADR-001](../../adr/adr-001-runtime.md),
reversed to drop the npm/Node distribution channel). bigint ids (`dbid`,
playlist ids) are stored as decimal **TEXT** to avoid i64 precision loss; the
catalogue stores no raw blobs — the raw `iTunesDB` in the dump remains the
lossless source of truth, and the catalogue is the convenient queryable view.

## 4. Conventions for new contributors

- **Keep the package a leaf.** Depend only on `@podkit/libgpod-node`,
  `@podkit/ipod-firmware`, and `@podkit/device-types`. Never import
  `@podkit/core` or `@podkit/ipod-db`. The CLI depends on the package, not the
  reverse.
- **Stage 2 stays pure over the dump.** New transform work reads `dumpDir`
  only. If you need something from the device, it belongs in stage 1 and must
  be captured in the dump.
- **Audio is never re-encoded.** Extraction is copy-then-tag-in-place. If you
  add a tag or artwork, it goes into the existing `node-taglib-sharp` write. The
  ffmpeg tag fallback is the one remux on this path, and it is still lossless
  (`-c:a copy` — packets bit-exact); no codec is ever run on the audio.
- **Pure modules stay pure.** `ArchivePathPlanner`, `VolumeClassifier`, the
  pixel decoders, the report renderers, and `computeLibraryStats` do no I/O
  and take an injected clock where time is involved. They carry the bulk of
  the unit tests.
- **Failures are isolated and reported, never thrown past the loop.** A bad
  file, a missing source, an undecodable thumbnail → a bucket in the report,
  not an aborted run. Use the typed `IpodArchiveError` for genuine
  preconditions (unreadable dump, unwritable destination).
- **The package never writes to the terminal.** It emits `ArchiveProgressEvent`
  through `onProgress`; the CLI does all terminal rendering through
  `OutputContext` (progress to the stderr sink, so `--json` stdout stays
  clean). This keeps the [no-`console`-in-libraries](./conventions.md) rule.
- **Counts must match what's archived.** When you surface a count (e.g.
  playlists in the progress meta), derive it from the same predicate that
  decides what gets written, so the meta never disagrees with the output.

## 5. Scope boundaries

What this subsystem does **not** cover:

- **Mass-storage / non-iPod devices.** iPod-only. The reader is libgpod.
- **Restore / re-import onto an iPod.** The archive is lossless enough to
  reconstruct a library in principle, but writing back to a device is the
  sync engine's concern, not this one.
- **Dying-device resilience.** No retries, bad-sector recovery, or resumable
  partial dumps. Read failures are recorded and the run fails loud; the user
  re-runs. (The PRD records this as a deliberate first-version scope cut.)
- **Full-resolution artwork.** iPods retain only downsized thumbnails; the
  archive embeds the largest available thumbnail, not original art (which is
  gone from the device).
- **Photos and the full Notes/Calendars/Contacts data model.** Those
  directories are dump-copied when present, but not parsed or catalogued.

## 6. Open work

- **Per-file dump progress is a running count, not a determinate bar.** The
  dump walk discovers files as it copies, so there is no upfront total. A
  pre-count walk would give a determinate bar at the cost of a second
  traversal — deliberately avoided to minimise reads on a failing device.
- **A track can be double-bucketed across runs of the data model only if a
  new failure path is added before the success branch.** The current
  ordering (record `noArtwork` only after a successful write) is correct;
  preserve it when extending the per-track loop.
- **The smart-playlist `match` operator is left NULL** on the catalogue's
  `playlists` row (libgpod's `getPlaylists` returns rows without it); the
  flattened `smart_playlist_rules` carry the durable predicate. Backfill if a
  read API surfaces it.

## 7. References

- **Spec / PRD:** [`backlog/docs/doc-047`](../../backlog/docs/doc-047%20-%20PRD-iPod-Archive-Command-device-archive.md)
  — the full requirements, decisions, module breakdown, and testing plan.
- **Decision:** [ADR-001](../../adr/adr-001-runtime.md) — the Bun-only
  distribution choice that makes `bun:sqlite` viable here.
- **Package:** `packages/ipod-archive/src/` — orchestrators (`run-dump.ts`,
  `run-transform.ts`, `run-archive.ts`), the deep modules, and their
  `*.test.ts` / `*.integration.test.ts` neighbours.
- **CLI:** `packages/podkit-cli/src/commands/device/archive.ts` — the thin
  shell (device selection, progress rendering, output envelope).
- **Read surface:** `packages/libgpod-node/src/database.ts` (metadata) and the
  in-package `src/artwork/` decoder (pixels).
- **User-facing doc:** [`docs/user-guide/devices/archive.md`](../../docs/user-guide/devices/archive.md).
