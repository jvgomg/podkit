---
id: doc-047
title: 'PRD: iPod Archive Command (device archive)'
type: specification
created_date: '2026-06-22 08:44'
updated_date: '2026-06-22 13:28'
tags:
  - prd
  - ipod
  - archive
  - export
  - cli
---
## Problem Statement

I have iPods that are dying, and iPods I've been given second-hand, that hold data I care about — not just the music files, but the listening history (play counts, ratings, last-played, skip counts, date-added) that exists nowhere else. Before I wipe or lose one of these devices, I want to pull **everything** off it: the actual playable tracks, organised so I can browse them by directory, plus all the metadata in a form I can do something useful with later. I also want, for each device I archive, a human-readable index telling me what the device was (model, serial, capacity), when I dumped it, and some quick stats — so when I have a shelf of these dumps I can tell at a glance what each one is.

Today podkit can sync *to* an iPod and list what's on one (`device music --format json`), but it cannot extract a self-contained, browsable, future-proof archive of a device. The obfuscated on-disk filenames (`F23/ABCD.m4a`) and the iTunesDB-only history make a plain `cp -r` useless for this purpose.

## Solution

A new non-interactive CLI command, `podkit device archive [path]`, that archives a single connected iPod in two stages:

1. **Raw dump** — a near-byte-for-byte, read-only copy of the iPod's data, checksummed on the way out. This is the lossless source of truth.
2. **Podkit archive** — a transform that reads *only the raw dump* (never the live device) and produces a browsable, playable, human- and machine-readable archive: a renamed directory tree of audio with embedded artwork, a SQLite catalogue of all metadata, M3U playlists, and human-readable README + machine-readable report files.

Because stage 2 is a pure function of the stage 1 dump, the transform can be re-run and improved later without the device present (`--from-dump <path>`), and a dump-only run is also possible (`--dump-only`). The happy path is a single command that runs both stages.

The feature is **iPod-only** for now (mass-storage devices are out of scope) and lives in a new standalone leaf package, keeping it out of podkit-core and podkit-cli internals.

## User Stories

1. As an iPod owner with a dying device, I want to copy all of its data off in one command, so that I preserve it before the hardware fails.
2. As someone given a second-hand iPod, I want to archive everything on it before wiping it, so that I don't lose the previous owner's library or my ability to inspect it.
3. As an archivist, I want the raw dump to be a near-byte-for-byte copy held read-only, so that I always retain a lossless source of truth independent of any later processing.
4. As an archivist, I want every dumped file checksummed into a manifest, so that years later I can prove the archive is intact and detect corruption.
5. As a user, I want the command to be non-interactive, so that I can run it unattended and script it.
6. As a user, I want the archive transform to read only from the raw dump, so that I can re-run or improve the transform later without needing the iPod again.
7. As a user, I want to run only the dump step (`--dump-only`), so that I can quickly get data off a failing device and process it later.
8. As a user, I want to run only the transform step from an existing dump (`--from-dump`), so that I can regenerate the archive after improving the tooling.
9. As a user, I want the output written to a clearly named directory (`<deviceName>-<serial>-<timestamp>`), so that I can keep many dumps side by side and tell them apart.
10. As a user, I want sensible directory naming even when the serial is unavailable, so that the command never fails just because a stock iPod lacks SysInfoExtended.
11. As a user, I want my extracted tracks renamed from their real metadata and organised as `Music/<AlbumArtist>/<Album>/## Title.ext`, so that I can browse my music by directory in any file manager.
12. As a user, I want compilation albums grouped under `Music/Compilations/<Album>/`, so that various-artist albums stay together instead of scattering.
13. As a user, I want podcasts, audiobooks, music videos, TV shows, and movies extracted into their own top-level trees, so that non-music content is organised separately and sensibly.
14. As a user, I want tracks with missing metadata to fall back to `Unknown Artist/Unknown Album`, so that nothing is silently dropped.
15. As a user, I want filename collisions resolved by appending the track's database id, so that two same-named tracks never overwrite each other.
16. As a user, I want filenames sanitised for portability (bad characters, length caps, reserved names), so that the archive copies cleanly onto Windows, macOS, and Linux filesystems.
17. As a user, I want each extracted audio file to be a lossless copy of the original (never re-encoded), so that no quality is lost in archival.
18. As a user, I want the real metadata written into each extracted file's tags, so that the files are self-describing in any player.
19. As a user, I want the largest available album artwork embedded into each track as well as written as a `cover.png` in each album folder, so that the archive looks right when browsing and in players.
20. As a user, I want tracks without artwork simply skipped (no placeholder), so that the archive only contains real art.
21. As a user, I want all device metadata captured in a SQLite database mapping each track to its exported file path, so that I can query, analyse, or later reconstruct the library.
22. As a user, I want the SQLite catalogue to preserve play counts, ratings, last-played, skip counts, date-added, and every other field as stored on the device, so that the irreplaceable listening history survives.
23. As a user, I want my playlists exported as `.m3u8` files referencing the extracted tracks, so that any player can load them.
24. As a user, I want the master/library playlist skipped (it's just "everything"), so that the Playlists folder only holds meaningful playlists.
25. As a user, I want smart-playlist rules preserved in the SQLite catalogue, so that the playlist's definition isn't lost even though M3U can't express it.
26. As a user, I want a human-readable README at the archive root with model, serial, capacity, generation, dump date, podkit version, and library stats, so that I can identify a dump at a glance.
27. As a user, I want a report listing every file that was skipped or failed (foreign files, junk, tracks with no audio, tracks with no artwork, copy/transform errors), so that I know exactly what was and wasn't archived and can handle anything manually.
28. As a user, I want user-added "foreign" files on the iPod volume detected and reported (not copied), so that I'm told about them and can grab them manually.
29. As a user, I want macOS filesystem junk and iPod system noise excluded from the dump, so that the archive contains iPod data, not artefacts of my having mounted it on a Mac.
30. As a user with a shelf of archives, I want each archive fully self-contained, so that I can move or back up a single directory and have everything.
31. As a developer, I want the archival logic in its own package with deep, isolated modules, so that the path-planning and classification logic is unit-testable without a device.
32. As a developer, I want the CLI command to be a thin shell over the package, so that the archival behaviour is reusable and testable independently of Commander wiring.

## Implementation Decisions

### Packaging & boundaries
- New standalone **leaf package `@podkit/ipod-archive`**. Depends on `@podkit/libgpod-node` (all DB/metadata reads), `@podkit/ipod-firmware` (SysInfoExtended serial/identity), and `@podkit/device-types` (shared types). It must **not** depend on `@podkit/core`, and **not** on `@podkit/ipod-db`. `podkit-core` must not depend on it.
- The CLI subcommand `podkit device archive` lives in podkit-cli; **podkit-cli depends on `@podkit/ipod-archive`** and the command is a **thin shell**: resolve the device mountpoint (or take `--from-dump`), then delegate to the package. It does not need the full core-loading surface that other device subcommands use.
- Package build mirrors existing leaf packages (`devices-ipod` convention): `bun build src/index.ts` + `tsc --emitDeclarationOnly`, orchestrated by turbo's generic `build` task. No tsup.
- Stage 2 is **fully in-process** — no subprocess, no ffmpeg. Metadata via libgpod-node's N-API binding; artwork decode is pure-TS (see below); PNG encode via `pngjs`; tag/cover write via `node-taglib-sharp`.
- **`@podkit/ipod-archive` is a deliberately Bun-targeted leaf** (per the resolved SQLite spike / ADR-021). It is the one package besides the CLI binary that need not be Node-compatible, which is what lets it use `bun:sqlite` directly.

### Reading the dump — libgpod-node, with artwork decode ported in-package
- All track / playlist / smart-playlist / album / device-identity reads go through **`@podkit/libgpod-node`**. `Database.open(dumpDir)` calls libgpod's `itdb_parse()` with no device gate, so it opens a copied dump tree directly. libgpod-node's `Track` already exposes `mediaType`, `seasonNumber`, `episodeNumber`, `movieFlag`, `tvShow`, plus play counts, ratings, last-played, skip count, date-added, `dbid`, and the colon-separated `ipodPath`. **There is therefore no prerequisite ipod-db change** (the media-type fields that an ipod-db-based design would have needed already exist on libgpod-node's `Track`).
- **Artwork is the one thing libgpod-node cannot do** — its artwork surface is write/capability-only and exposes no way to read thumbnail pixels out of the ArtworkDB/`.ithmb`. Rather than take an ipod-db dependency for this, the new package **ports the artwork-decode logic in-house**: parse the dumped `ArtworkDB`, locate the largest thumbnail for a track (matched by `dbid`), read the bytes from the matching `F*.ithmb`, and decode the stored pixel format (RGB565 / RGB555 / RGB888) to RGBA, cropping padding. (The algorithm is well-understood prior art in ipod-db's `artworkdb/` decoder; reimplement it, do not import it.)
- Device identity for the directory name / README: model, generation, capacity come from libgpod-node's device capabilities (resolved from the dump's SysInfo when present). Serial number is not a first-class libgpod-node field — read it from `SysInfoExtended` via `@podkit/ipod-firmware`. Serial is frequently absent on stock/dying iPods, so identity must degrade gracefully.

### Command surface
- `podkit device archive [path]` — non-interactive. Output directory created in the current working directory unless `path` is given.
- `--dump-only` — run stage 1 only.
- `--from-dump <path>` — run stage 2 only, against an existing dump; no device required.
- Output directory name: `<deviceName>-<serial>-<timestamp>`. `deviceName` = configured podkit device name if the volume matches a known device, else the volume label. Naming **degrades gracefully** when serial is unavailable: serial → FireWireGUID → volume-label/timestamp-only. Names are sanitised.

### Stage 1 — raw dump
- Native `node:fs` streaming copy (read stream → write stream), hashing each file through `node:crypto` sha256 **during** the copy (single read), emitting a `manifest.sha256` (compatible with `shasum -c`).
- Prefer `node:fs` streams over `Bun.write`/`Bun.file` for the dump copy — they behave identically under Bun dev and the compiled binary, and keep the dumper portable. (The SQLite catalogue, by contrast, deliberately uses `bun:sqlite` — see the resolved spike below.)
- Copies the iPod whitelist: `iPod_Control/*` (including `iTunes/` with `iTunesDB` and `Play Counts`, `Artwork/ArtworkDB` + `Artwork/F*.ithmb`, `Device/SysInfo*`, `Music/F00..F49`) plus root `Calendars`, `Contacts`, `Notes`.
- **Skips and records** macOS junk (`._*`, `.DS_Store`, `.Spotlight-V100/`, `.fseventsd/`, `.Trashes/`) and **foreign files** (anything outside the iPod whitelist — user-added files). Foreign files are not copied; their paths are listed in the report for manual handling.
- The dump is treated as read-only after creation.

### Stage 2 — podkit archive (pure function of the dump)
- A `DumpLoader` opens the dump via libgpod-node `Database.open(dumpDir)` and reads identity (serial/family via ipod-firmware from `SysInfoExtended`, model/generation/capacity from libgpod-node).
- Directory tree:
  - `Music/<AlbumArtist>/<Album>/## Title.ext`
  - `Music/Compilations/<Album>/## Title.ext` (compilation flag set)
  - `Podcasts/<Show>/Title.ext`
  - `Audiobooks/<Author?>/Title.ext`
  - `Video/Movies/Title.ext`, `Video/TV Shows/<Show>/Season NN/## Title.ext`, `Video/Music Videos/Title.ext`
  - `Playlists/<name>.m3u8` (relative paths; master playlist skipped)
  - `library.sqlite`, `README.md`, `report.md`, `report.json`, plus a `cover.png` per album folder.
- Track → dumped-audio mapping uses the track's `ipodPath` (`:iPod_Control:Music:Fnn:XXXX.ext`), converting `:` → `/` and joining under the dump root. A **null/empty `ipodPath`** routes the track to the report's "no audio" bucket rather than failing.
- Filenames are renamed from DB metadata. Sanitisation targets the worst-case (portable) filesystem: Windows-reserved characters, trailing dots/spaces, reserved device names, length caps, NFC normalisation. Collisions append the track dbid. Missing artist/album → `Unknown Artist`/`Unknown Album`.
- Audio extraction is **lossless**: copy the file, then write tags + embed cover **in place** via `node-taglib-sharp` (already proven in the mass-storage tag writer). No re-encode, no container remux.
- Artwork: the in-package `ArtworkDecoder` yields the largest thumbnail as RGBA. Encode that RGBA to PNG via `pngjs`, embed it in the track tags, and also write it as `cover.png` in the album folder. Tracks without artwork are skipped (no placeholder).
- `library.sqlite` is the parsed, queryable view (the raw `iTunesDB` in the dump remains the lossless source of truth — **no raw blobs** stored in SQLite). Proposed tables: `device` (model/serial/capacity/generation/dump_date/podkit_version), `tracks` (all DB fields + `exported_path` + `dump_path`), `playlists`, `playlist_items` (ordered, per-item timestamp), `albums`, `artwork` (track→image, width/height/format), `smart_playlist_rules`, and `schema_version`.

### CLI distribution & runtime (RESOLVED — see ADR-021)
> **Update (2026-06-22, ADR-021):** The dual-channel framing below is superseded. The `podkit` CLI now ships **only** as a Bun `--compile` binary; the npm CLI channel (`npm i -g podkit` / `npx podkit`) is dropped. The *libraries* (`@podkit/core` and the other `@podkit/*` packages) stay Node-compatible and npm-published; only the CLI app and the `@podkit/ipod-archive` leaf are Bun-targeted. Mechanical conversion is tracked in TASK-431.10.

Original (now-historical) framing: the `podkit` CLI shipped through two channels with two runtimes: (1) **npm** (`npm i -g podkit`) installs `dist/main.js`, built `bun build --target node` with a `#!/usr/bin/env node` shebang → runs under **Node ≥20**; (2) a **standalone binary** (`bun build --compile`, used by Docker/releases/brew) → embeds the **Bun** runtime. That dual-runtime constraint is what originally ruled out `bun:sqlite` and motivated the spike.

### SPIKE — SQLite strategy (RESOLVED: Branch A, `bun:sqlite` — ADR-021)
> **Resolved (2026-06-22, TASK-431.02 → ADR-021):** Branch A. The CLI ships only as a Bun `--compile` binary and `@podkit/ipod-archive` uses the built-in **`bun:sqlite`** — zero dependency, no native staging, no wasm payload, no musl/glibc prebuild burden. Branch B (better-sqlite3 / sql.js) was evaluated and not needed once the CLI is accepted as Bun-only. `LibraryDbWriter` (TASK-431.06) is unblocked. The original options are retained below for context.

The `library.sqlite` deliverable forced a runtime decision. It was resolved with a time-boxed spike whose outcome was one of two branches:

- **Branch A — make the CLI a Bun-only binary.** Drop the npm/Node distribution channel so the CLI ships *only* as a `bun --compile` binary (Docker/releases/brew). `bun:sqlite` becomes usable (zero deps, built in). Refines ADR-001's distribution clause (libraries stay Node-compatible; only the CLI app changes) — assessed blast radius beyond the SQLite angle. **← chosen.**
- **Branch B — keep dual-channel distribution and use a Node-safe driver.** `better-sqlite3` (native addon; ships via prebuilds for npm and stages a `.node` into the compiled binary exactly like `libgpod-node` + `usb` already do — one extra line in `compile.sh`), or `sql.js` (pure wasm; no native build, no `compile.sh` change, ~1MB payload, builds in memory then writes the file).

### Modules (deep, isolation-first)
- `VolumeClassifier` — `classify(volumeRoot) → { copy, junk, foreign }`. Pure; whitelist + junk + foreign classification.
- `ArchivePathPlanner` — `plan(track, collisionState) → relPath`. Pure; media-type routing, compilations, sanitisation, length caps, collision handling, Unknown fallbacks. Net-new (no sanitisation prior art in the repo).
- `DumpLoader` — `(dumpDir) → { db, identity }`. Opens the dump via libgpod-node + reads identity (ipod-firmware for serial).
- `ArtworkDecoder` — `(dumpDir) → (dbid) → RGBA | null`. In-package ArtworkDB + `.ithmb` parse + pixel-format decode (ported, not imported).
- `RawDumper` — `dump(files, dest) → { manifest, failures }`. Streaming copy + sha256 + manifest.
- `RgbaToPng` — thin RGBA→PNG encoder (pngjs).
- `TagWriter` — `write(src, dest, meta, coverPng?)`. Copy + taglib tag/cover write.
- `LibraryDbWriter` — `write(db, pathMap, dest)`. Builds `library.sqlite` via `bun:sqlite` (driver decided by the resolved spike).
- `PlaylistWriter` — `write(playlists, pathMap, dir)`. M3U8, master skipped.
- `ArchiveReport` — accumulates skips/failures → `report.md` + `report.json`.
- Two orchestrator entry points exposed by the package: `runDump(volumeRoot, destDir)` (classify → dump → manifest) and `runTransform(dumpDir, destDir)` (load → plan → extract → tag → db → playlist → readme → report). `--from-dump` maps to `runTransform` alone; `--dump-only` to `runDump` alone; the default runs both.

## Testing Decisions

Good tests here assert **external behaviour** — the shape of the produced tree, the contents of the manifest/report, the rows in the SQLite catalogue, the resolved relative paths — not internal call sequences. The two genuinely deep, IO-free modules carry the most coverage; IO-bound modules get focused integration tests against fixtures; the command gets one end-to-end smoke.

- **Unit (pure, heavy coverage):**
  - `ArchivePathPlanner` — media-type routing (music/compilation/podcast/audiobook/movie/TV/music-video), sanitisation, length caps, cross-platform reserved names, collision→append-dbid, `Unknown Artist/Album` fallbacks, null `ipodPath` handling.
  - `VolumeClassifier` — whitelist vs junk vs foreign over fixture directory trees, including the "nothing foreign on a stock iPod" case.
- **Integration (fixture-backed):**
  - `DumpLoader` — opens a fixture dump directory via libgpod-node and surfaces identity, including the SysInfoExtended-absent / null-serial degradation.
  - `ArtworkDecoder` — fixture `ArtworkDB` + `.ithmb` → RGBA of expected dimensions for a known track; no-artwork → null. Validate against a couple of pixel formats.
  - `RawDumper` — copies a fixture tree to a temp dir, verifies manifest entries and `shasum -c` compatibility, and records failures without aborting.
  - `RgbaToPng` — RGBA buffer → valid PNG of expected dimensions.
  - `TagWriter` — copy a tiny fixture `m4a`, write tags + embed cover, read them back and assert.
  - `LibraryDbWriter` — open the produced `library.sqlite` and assert the device row, track fields (including play counts/ratings), playlist items ordering, and smart-playlist rules. (Uses `bun:sqlite` per the resolved spike.)
  - `PlaylistWriter` — assert emitted `.m3u8` content and that the master playlist is skipped.
  - `ArchiveReport` — assert the markdown + JSON enumerate foreign/junk/no-audio/no-artwork/failure buckets.
- **End-to-end (one smoke):** run `device archive` against a fixture/dummy iPod (and a `--from-dump` run against a fixture dump) and assert the top-level archive structure, README presence, and report contents.

Prior art to follow: libgpod-node's own read tests and the gpod-testing fixtures (`packages/libgpod-node`, `test-packages/gpod-testing`), ipod-db's `artworkdb/` decoder as the reference algorithm for `ArtworkDecoder` (reimplemented, not imported), the existing tag-writing in the mass-storage tag writer (`node-taglib-sharp` usage), the sha256/stream helpers used by artwork hashing, and the device-subcommand test patterns under `packages/podkit-cli`. Test runner is Bun (`bun run test --filter @podkit/ipod-archive`).

## Out of Scope

- **Mass-storage / non-iPod devices.** iPod-only for this PRD.
- **Re-import / restore onto an iPod.** The archive is lossless and structured enough to reconstruct a library in principle, but pushing data back onto a device is not built now.
- **Dying-device resilience features** — no retry logic, bad-sector recovery, or resumable partial dumps in this version. Read failures are recorded and the run fails loud; the user re-runs.
- **Interactive prompts.** The command never prompts; foreign files and anomalies are reported, not negotiated.
- **Photos, full Notes/Calendars/Contacts processing.** Their directories are dump-copied (when present in the whitelist) but not parsed, transformed, or catalogued.
- **Full-resolution artwork.** iPods only retain downsized thumbnails; the archive embeds the largest available thumbnail, not original art (which is gone).
- **Original-art recovery, lyrics, chapters, and DRM handling** beyond what the existing parser already surfaces.

## Further Notes

- The unique archival value is the **iTunesDB-only listening history** (play counts, ratings, last-played, skip counts, date-added). Audio files usually already carry their own embedded tags; the dump + SQLite catalogue exist primarily to rescue what the files alone cannot reconstruct.
- The two-stage split (raw dump → transform) is the design spine: the dump is the immutable lossless artifact; the transform is an improvable, re-runnable, device-free convenience layer. Keep that boundary clean — stage 2 must never touch the live device.
- **Read path = libgpod-node only**, with one carve-out: libgpod-node has no artwork-pixel read API, so the package ports the `.ithmb`/ArtworkDB decode itself rather than depend on the early-stage ipod-db. No ipod-db dependency, no ipod-db prerequisite change.
- Test device used during design: a Family-9 iPod, firmware 8.1.3, 63 `.m4a` tracks across `F00–F05`, with stock (non-foreign) Notes/Contacts sample files and a present `SysInfoExtended`. Real stock/dying devices may lack `SysInfoExtended` entirely — hence the serial-degradation requirement.
- Naming: the two artifacts are the **raw dump** and the **podkit archive**; the command is `podkit device archive`.
- **Blocking spike (RESOLVED — ADR-021):** the SQLite strategy resolved to Branch A (Bun-only CLI; `@podkit/ipod-archive` uses `bun:sqlite`). `LibraryDbWriter` (TASK-431.06) is unblocked. The mechanical CLI-to-Bun-only conversion is tracked in TASK-431.10.
