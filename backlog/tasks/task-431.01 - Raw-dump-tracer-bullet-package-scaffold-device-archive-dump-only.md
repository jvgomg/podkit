---
id: TASK-431.01
title: Raw dump tracer bullet (package scaffold + device archive --dump-only)
status: Done
assignee: []
created_date: '2026-06-22 11:01'
updated_date: '2026-06-22 15:36'
labels:
  - feature
  - ipod
  - archive
  - cli
dependencies: []
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 155000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First vertical slice. Scaffold the new leaf package `@podkit/ipod-archive` (build like `devices-ipod`: `bun build` + `tsc --emitDeclarationOnly`, turbo `build`) and wire a thin `podkit device archive` CLI subcommand supporting `--dump-only`. Implement `VolumeClassifier` (whitelist/junk/foreign), `RawDumper` (streaming copy hashing through sha256, emitting `manifest.sha256`), output-dir naming `<deviceName>-<serial>-<timestamp>` with graceful degradation (serial → FireWireGUID → volume-label/timestamp), and `runDump` orchestrator.

Demoable: run against a real/dummy iPod → a read-only `raw dump/` mirror with manifest; macOS junk and foreign files skipped (not copied).

Note: per the SQLite spike outcome (Branch A), the CLI now ships **Bun-only**, so Bun runtime APIs are permitted throughout the package. `node:fs`/`node:crypto` streaming remains a reasonable choice for the copy+hash but is no longer required for Node compatibility.

Spec: doc-047 (Stage 1 — raw dump; Packaging & boundaries).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `@podkit/ipod-archive` package builds and is depended on by podkit-cli
- [x] #2 `podkit device archive --dump-only` produces a dump dir mirroring the iPod whitelist with a `manifest.sha256` verifiable by `shasum -c`
- [x] #3 macOS junk (._*, .DS_Store, .Spotlight-V100, .fseventsd, .Trashes) and foreign files are skipped and recorded, not copied
- [x] #4 Output dir named <deviceName>-<serial>-<timestamp>, degrading gracefully when serial absent
- [x] #5 VolumeClassifier unit-tested (whitelist/junk/foreign incl. clean stock-iPod case); RawDumper integration-tested (manifest + failures-recorded)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the stage-1 raw-dump slice.

NEW PACKAGE `@podkit/ipod-archive` (packages/ipod-archive/), scaffolded exactly like devices-ipod (bun build src/index.ts + tsc --emitDeclarationOnly; turbo generic `build`; test:unit/typecheck/clean; bunfig retry=2; version 0.0.0). Leaf deps only: @podkit/device-types, @podkit/ipod-firmware, @podkit/libgpod-node (all workspace:*). No @podkit/core, no @podkit/ipod-db. pngjs NOT added (unused this slice). Build externals match the firmware sibling (koffi/usb + the two native-ish workspace deps).

Modules (src/):
- volume-classifier.ts — pure `classifyEntries(names) -> {copy, junk, foreign}` (+ isWhitelistEntry/isJunkEntry, case-insensitive whitelist for FAT32). Whitelist: iPod_Control, Calendars, Contacts, Notes. Junk: ._*, .DS_Store, .Spotlight-V100, .fseventsd, .Trashes, .TemporaryItems, .apdisk. Thin directory-read wrapper lives in run-dump.ts (readTopLevelEntries via opendir).
- raw-dumper.ts — `dump(srcRoot, entriesToCopy, destDir) -> {manifest, failures}`. Recursive copy via node:fs streams, hashing through SHA-256 in the SAME read pass (read.on('data') tee'd into createHash while piping to the write stream). Emits manifest.sha256 (shasum -c compatible: `<hex>  <relpath>`, two spaces, POSIX separators, sorted, trailing newline). Per-file failures recorded, never thrown. Symlinks skipped+recorded (lstat, never followed). Empty dirs recreated (tree shape preserved). Zero-byte files copied+hashed.
- output-naming.ts — `buildOutputDirName(identity, now?)` -> `<deviceName>-<identityToken>-<timestamp>`. Degrades serial -> firewireGuid -> volumeLabel -> timestamp-only. sanitizeSegment() targets the worst-case (Windows) FS: replaces <>:"/\|?* space hyphen, collapses, strips leading/trailing dots/spaces/underscores. formatTimestamp() = UTC YYYYMMDD-HHMMSS. Dedupes label when it equals the device name. Timestamp always appended so the name is never empty.
- run-dump.ts — `runDump(volumeRoot, destDir, opts) -> DumpResult`. classify -> read identity (readSysInfoExtended from @podkit/ipod-firmware; never throws, null when absent) -> build dir name -> rawDump into `<named>/raw dump/` -> return {outputDir, rawDumpDir, manifestPath, identity, classification, manifest, failures}. deviceName/volumeLabel are CLI inputs (leaf must not read podkit config); volumeLabel defaults to basename(volumeRoot).
- errors.ts — typed `IpodArchiveError` with stable `code` (VOLUME_NOT_READABLE | DEST_NOT_WRITABLE), preserves cause. No console/stderr anywhere in the package.
- index.ts — barrel re-exporting everything.

ON-DISK LAYOUT CHOSEN:
  <destDir>/<deviceName>-<identity>-<timestamp>/
    raw dump/
      iPod_Control/...  Calendars/ Contacts/ Notes/   (mirrored whitelist trees)
      manifest.sha256                                  (shasum -c run from `raw dump/`)
The named directory is the self-contained archive root; later slices add an `archive/` sibling to `raw dump/` inside it (matching the PRD's two-artifact model). Junk + foreign entries are classified out and surfaced in DumpResult.classification but NOT copied.

CLI: packages/podkit-cli/src/commands/device/archive.ts — thin `archiveSubcommand` (commander). Positional `[path]` (output dir, defaults to cwd), `--dump-only`, `--from-dump <path>`. Default + `--dump-only` run the dump; `--from-dump` is a clearly-marked stub that fails with ARCHIVE_NOT_IMPLEMENTED (needs no device). Device resolution reuses the existing flow exactly (resolveDeviceArg + getDeviceIdentity + resolveDevicePath, requireMounted, existsSync guard) — same as eject/music. iPod-only gate: rejects resolvedDevice.config.type !== 'ipod' with IPOD_ONLY (path mode = assumed iPod, gate passes). Output via OutputContext only (out.result dual-mode JSON/text, out.success/print/warn) — no console/stderr. runDump injected via deps seam for testing. Registered in device/index.ts; runner re-exported. Added DeviceArchiveOutput to output-types.ts and ARCHIVE_NOT_IMPLEMENTED/ARCHIVE_DUMP_FAILED to error-codes.ts. podkit-cli now depends on @podkit/ipod-archive (workspace:*).

TESTS:
- volume-classifier.test.ts (unit): whitelist/junk/foreign incl. the clean stock-iPod case (zero foreign), user-foreign case, disjoint-partition invariant, empty volume, case-insensitivity.
- output-naming.test.ts (unit): sanitisation, timestamp, full degradation ladder, dedup, never-empty.
- raw-dumper.integration.test.ts: nested trees + zero-byte file copied byte-identical with correct hashes; manifest format + actual `shasum -c`/`sha256sum -c` verification (skips if neither binary present); missing-entry failure; unreadable-file (chmod 000, skipped as root) recorded without aborting + sibling still copied; symlink skipped+recorded.
- run-dump.integration.test.ts: full `<name>/raw dump/` layout + manifest + classification buckets + foreign/junk not copied; timestamp-only degradation; typed-error on non-directory volume.
- podkit-cli/src/commands/device-archive.unit.test.ts: command surface (registered, [path] arg, --dump-only/--from-dump options); --from-dump stub -> ARCHIVE_NOT_IMPLEMENTED; DEVICE_NOT_RESOLVED; happy-path delegation to injected runDump -> dump success envelope (path mode); iPod-only gate rejects a mass-storage device.

QUALITY GATES (all pass): bun install (workspace linked); `bun run build --filter @podkit/ipod-archive` and `--filter podkit`; `bun run typecheck --filter @podkit/ipod-archive --filter podkit`; `bun run lint` (oxlint + CLI stderr-write conventions check); `bun run test --filter @podkit/ipod-archive` (35 pass). Also re-ran device.test.ts + device-music-video.unit.test.ts + device-archive.unit.test.ts (52 pass) to confirm no regression in the device command tree.

DECISIONS / NON-DEVIATIONS:
- Used node:fs/node:crypto streams (portable, simple) rather than Bun.* APIs — permitted either way; kept it simple.
- Symlinks treated as recorded failures (not silently skipped) so they stay visible in the eventual report; an iPod data tree has no legitimate symlinks.
- lstat (not dirent.isDirectory) used for type decisions so symlinks are never followed and DT_UNKNOWN filesystems are handled.
- Manifest sorted for deterministic/diff-friendly output.

STUBBED FOR LATER SLICES: stage-2 transform (DumpLoader/ArchivePathPlanner/ArtworkDecoder/TagWriter/LibraryDbWriter/PlaylistWriter/ArchiveReport), `--from-dump`, pngjs/node-taglib-sharp/bun:sqlite deps, and the README/report generation. DumpResult already carries classification (junk/foreign) + failures so the report stage can consume them without re-reading the volume.

Code-review fixes applied post-implementation (no status change):

1. TEST SCRIPTS WIRED — bunfig.toml: added `pathIgnorePatterns = ["**/*.integration.test.ts"]` (mirroring podkit-cli/libgpod-node pattern). package.json: added `test:integration` script `bun test --pass-with-no-tests --path-ignore-patterns= .integration.` (same pattern as podkit-cli, since ipod-archive integration tests use only tmp dirs — no gpod-tests-parallel needed). `bun run test:unit` now runs 25 tests across output-naming.test.ts + volume-classifier.test.ts; `bun run test:integration` runs 11 tests across run-dump.integration.test.ts + raw-dumper.integration.test.ts.

2. DEST_NOT_WRITABLE TYPED ERROR — run-dump.ts: wrapped the `mkdir(rawDumpDir, { recursive: true })` call before handing off to rawDump so an EACCES/ENOENT on the destination directory is caught and rethrown as `IpodArchiveError('DEST_NOT_WRITABLE', ...)` with the original cause preserved. Per-file failures inside RawDumper remain collected, not thrown. New integration test in run-dump.integration.test.ts asserts the typed error and code are thrown when dest is chmod 555.

3. REMOVE toUpperCase — archive.ts line 138: `resolvedDevice?.name?.toUpperCase() || volumeLabel` → `resolvedDevice?.name || volumeLabel` so a user-configured device name passes through as-is.

4. BARE INVOCATION TEST — device-archive.unit.test.ts: added `it('delegates to runDump ... (bare invocation — no flags)')` passing `{}` as options, confirming the default path runs the dump and emits stage:'dump'.

5. .apdisk JUNK TEST — volume-classifier.test.ts: added `expect(isJunkEntry('.apdisk')).toBe(true)` to the 'flags well-known Apple artefacts' test suite.

6. --from-dump STUB MESSAGE — archive.ts line 79: changed printText from 'run the raw dump with: podkit device archive --dump-only' to 'run the raw dump with: podkit device archive' (bare command is sufficient and correct for this slice).

All quality gates re-verified: build OK, typecheck OK (both packages), lint 0 warnings/errors, test:unit 25 pass, test:integration 11 pass.
<!-- SECTION:NOTES:END -->
