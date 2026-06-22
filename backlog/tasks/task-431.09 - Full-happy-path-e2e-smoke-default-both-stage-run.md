---
id: TASK-431.09
title: Full happy-path + e2e smoke (default both-stage run)
status: Done
assignee: []
created_date: '2026-06-22 11:03'
updated_date: '2026-06-22 21:09'
labels:
  - feature
  - ipod
  - archive
  - e2e
dependencies:
  - TASK-431.01
  - TASK-431.03
  - TASK-431.04
  - TASK-431.05
  - TASK-431.06
  - TASK-431.07
  - TASK-431.08
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 163000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final integration slice. Wire the default `podkit device archive` happy path to run both stages in sequence (dump → transform) producing the complete archive directory (`raw dump/` + archive tree + library.sqlite + Playlists + README + report). Add an end-to-end smoke test running the command against a dummy/fixture iPod, plus a `--from-dump` run against a fixture dump, asserting the top-level structure, README presence, and report contents. Confirm the thin-CLI / deep-package boundary holds (command logic is delegated, not embedded).

Spec: doc-047 (orchestrators runDump/runTransform; testing — e2e smoke; stories 31-32).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Default `podkit device archive` runs dump then transform, producing the full archive in one invocation
- [x] #2 E2E smoke passes against a dummy/fixture iPod and a `--from-dump` fixture dump
- [x] #3 Top-level archive structure, README, and report asserted by the e2e test
- [x] #4 CLI command remains a thin shell delegating to @podkit/ipod-archive
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Final integration slice — wired the bare `podkit device archive` to run BOTH stages.

**Package: `runArchive` orchestrator** (`packages/ipod-archive/src/run-archive.ts`)
- Thin composition: `runDump(volumeRoot, destDir, dumpOpts)` then `runTransform(dump.outputDir, { podkitVersion, now, dumpReport: dump.report })`.
- Passing the dump's `outputDir` lands `archive/` beside `raw dump/` inside the same named dir → one self-contained `<name>-<id>-<timestamp>/`.
- Threads `dump.report` (stage-1 buckets) into the transform so the archive's `report.{md,json}` cover BOTH stages (stage-1 section populated, not the "not available" placeholder).
- Shares the injected clock between the dir-name timestamp and the catalogue `dump_date`.
- Returns `ArchiveResult { outputDir, dump, transform }`. Exported from `index.ts`. Leaf-package clean (no core/ipod-db).

**CLI wiring** (`packages/podkit-cli/src/commands/device/archive.ts`)
- Bare invocation → `runArchive` (both stages); `--dump-only` → `runDump`; `--from-dump` → `runTransform` (unchanged, device-free). Command stays a thin shell: resolves device context, delegates, formats output. Split into `runBothStages` / `runDumpStage` / `runTransformStage` with a shared `printDumpBuckets` helper.
- New `stage: 'both'` success envelope (`DeviceArchiveBothSuccess` in output-types.ts) carrying both stages' paths + counts.
- `DeviceArchiveDeps` gains an injectable `runArchive`.

**Changeset**: `.changeset/device-archive-command.md` — `"podkit": minor` (additive new command).

**Tests**
- Integration (binary-free, real audio): `packages/ipod-archive/src/run-archive.integration.test.ts` — gpod-testing fixture iPod (music album + podcast + manual playlist + planted foreign file), runs `runArchive`, asserts the full self-contained tree: `raw dump/iPod_Control/...` + `manifest.sha256`; `archive/Music/.../NN Title.ext` real byte-lossless copies; `archive/library.sqlite` (openable; device row w/ injected version + dump_date, 3 track rows); `archive/Playlists/My Mix.m3u8`; `README.md`; unified `report.{md,json}` with the planted foreign file proving stage-1 buckets are real.
- E2E smoke (built binary): `test-packages/e2e-tests/src/commands/device-archive.test.ts` — (1) bare both-stages via `-d <fixture iPod> device archive <dest>` asserting `stage:'both'`, the self-contained dir, manifest, README, library.sqlite, and the two-stage report; (2) `--from-dump` against the dump produced by `--dump-only`. NOTE: the dummy iPod target adds metadata-only tracks (no audio body), so binary-level coverage asserts structure/README/report but NOT the audio-extraction Music tree — that needs libgpod-node track copying unreachable from the host harness, and is covered at the integration level by run-archive.integration.test.ts.
- CLI unit (`device-archive.unit.test.ts`): updated the bare-invocation test to inject `runArchive` and assert the `stage:'both'` envelope (+ that `runDump` is NOT called on the bare path); `--dump-only`/`--from-dump` delegation tests unchanged.

**Quality gates (all pass)**: build (@podkit/ipod-archive + podkit), typecheck both (+ e2e-tests), `bun run lint`, `test:unit`/`test:integration` for ipod-archive, `test:unit --filter podkit`, and the new e2e smoke (`IPOD_TARGET=dummy`).

**Consolidated-review fixes (post-completion)**

Six correctness/coherence fixes applied after the initial implementation, found in a consolidated review pass. Status unchanged (Done); all quality gates re-passed.

1. **Double-bucketing fix** (`src/run-transform.ts` line ~285): moved `noArtwork.push(...)` from before `writeTrack` into the success branch (after `written += 1`). A track with no artwork that fails extraction now appears only in `failures`, not in both `failures` and `noArtwork`. Test added to `run-transform.integration.test.ts`: asserts `result.noArtwork` does not contain a missing-source track.

2. **Orphan stage-1 report suppressed** (`src/run-dump.ts` line ~65, ~191; `src/run-archive.ts` line ~82): added `skipReport?: boolean` to `RunDumpOptions`; wrapped the `report.{md,json}` writes in `if (!opts.skipReport)`; `runArchive` passes `skipReport: true` so no misleading stage-1-only report lands at the root when both stages run. Test added to `run-archive.integration.test.ts`: asserts `outputDir/report.md` and `outputDir/report.json` do NOT exist (only `outputDir/archive/report.{md,json}`).

3. **Clock captured once** (`src/run-archive.ts` line ~80): `const now = opts.now ?? new Date()` computed once at the top of `runArchive` and threaded into both stages, so the dir-name timestamp (stage 1) and catalogue `dump_date` (stage 2) are always identical even on a large iPod.

4. **Album composite-key separator** (`src/library-db-writer.ts` line ~414): changed the key from `${album ?? ' '}${albumArtist ?? ' '}` to `${album ?? ''}\x1f${albumArtist ?? ''}` using U+001F (ASCII unit separator) to prevent collisions between e.g. `(album='A ', albumArtist='B')` and `(album='A', albumArtist=' B')`. Comment updated to match.

5. **`writeAlbums` sort uses `compareStable`** (`src/library-db-writer.ts` line ~423): replaced both `localeCompare` calls with `compareStable` (the locale-independent code-point comparator the rest of the package uses). `compareStable` exported from `src/archive-report.ts` and imported in `src/library-db-writer.ts`.

6. **Comment-only notes** (`packages/podkit-cli/src/commands/device/archive.ts`): added a comment on the iPod-only gate noting path-discovered devices pass through and are validated by `loadDump`'s `DUMP_NOT_READABLE`; added a comment near the `--from-dump` path noting `loadDump` accepts either a named dump dir or a bare iPod root.

**Quality gates (all pass)**: build, typecheck, lint, 161 unit + 47 integration tests (@podkit/ipod-archive), 1734 CLI unit tests.

UX fix (QA follow-up): `podkit device archive` device-selection rework in `packages/podkit-cli/src/commands/device/archive.ts`. Two bugs fixed: (1) with no device connected the command printed a confusing iPod-only message; (2) it gated on the configured DEFAULT device rather than the connected iPod. New flow: `--from-dump` unchanged; with explicit `--device` honour it via the existing resolver + iPod-only gate (only thrown for a genuine non-iPod); without `--device` AUTO-DETECT via `core.discoverConnectedDevices` (ignoring any configured default). Auto-detect outcomes: exactly one mounted iPod → archive it at `block.mountPoint`; multiple → MULTIPLE_IPODS; an unmounted/usb-only iPod → IPOD_NOT_MOUNTED (hint: `device scan --mount`); a non-iPod device only → IPOD_ONLY with primary 'No iPod found' message + iPod-only caveat secondary; nothing connected → NO_DEVICE_FOUND; unsupported platform → NO_DEVICE_FOUND advising `--device <path>`. Added a `discoverConnectedDevices` DI seam to `DeviceArchiveDeps` (mirrors DeviceScanDeps). New error codes NO_DEVICE_FOUND + IPOD_NOT_MOUNTED in `device/error-codes.ts`. Extended `device-archive.unit.test.ts` (15 tests): no-device→NO_DEVICE_FOUND (asserts NOT the iPod-only message), mass-storage-only→IPOD_ONLY, single mounted iPod→runDump at detected mount, multiple→MULTIPLE_IPODS, usb-only iPod→IPOD_NOT_MOUNTED, unsupported device→IPOD_ONLY, unsupported platform→NO_DEVICE_FOUND, plus the existing explicit path/name flows. Gates green: build + typecheck + lint + 1740 unit tests.

UX enhancement (progress + device-meta output): added live progress, a device-meta block, and a single destination path to `podkit device archive` human output; removed the per-artifact path lines (raw dump / archive / README / report) from HUMAN text (JSON envelope unchanged).

**Package (`@podkit/ipod-archive`) — `onProgress` event channel.** New `src/progress-events.ts` exports a discriminated `ArchiveProgressEvent` union: `dump:start{outputDir,deviceName,serialNumber?}` | `dump:file{copied}` | `dump:done{fileCount}` | `transform:start{identity,stats}` | `transform:track{done,total,title?}` | `transform:done{written}`, plus `ArchiveProgressCallback` and `TransformStats` (total/songs/movies/podcasts/audiobooks/musicVideos/tvShows/playlists; songs folds music+compilation). `onProgress?` added to `RunDumpOptions`/`RunTransformOptions`/`RunArchiveOptions` (threaded to both stages by `runArchive`); side-effect-only, deterministic (no wall-clock), return values/on-disk output unchanged. `raw-dumper.ts` `dump`/`dumpTree` gained an `onFile?: () => void` invoked per successfully-copied file (failures do not increment). `run-transform.ts` now materialises the track set ONCE (`db.getTracks().map(h => db.getTrack(h))`) and reads `db.getPlaylists()` once before the loop — both the stats breakdown and the extraction loop consume the same array (no double-iteration); emits `transform:start` (with `computeTransformStats`), `transform:track` per track, `transform:done`. Exported from `index.ts`.

**CLI (`device/archive.ts`).** New `makeArchiveProgress(out, mode)` returns the renderer or `undefined` under `--json`/`--quiet` (no events plumbed, JSON stdout stays pure). Human output new shape: ONE destination header at start (`Archiving iPod "<name>" → <outputDir>` on `dump:start`; `Building archive → <dir>` for `--from-dump`), live `Dumping…  N files copied` (TTY: overwrite via `out.progress`; non-TTY: a single `Dumping...` line) → `✓ raw dump — N files`, a device-meta line (`<modelName> (<cap> GB) · <modelNumber> · serial <serial>`, unknown fields omitted) + library line (`N songs · M movies · …`, nonzero categories only) on `transform:start`, a determinate `formatOverallLine(done,total,'tracks')` bar on `transform:track` (TTY only), and `✓ archive — N tracks extracted + tagged` at the end. Removed the `raw dump:`/`archive:`/`README:`/`report:`/`manifest:` path prints from all three human summaries; kept the foreign/no-audio/no-artwork/failure notes. Progress writes go to the stderr sink, milestones via `out.print`/`success` to stdout — `--json` stdout verified clean.

**Tests.** New `packages/ipod-archive/src/progress-events.integration.test.ts` (gpod-testing fixture seeded with 2 songs + movie + podcast + a no-audio track + a playlist): asserts `runDump` start→file(s)→done with a strictly rising 1..N count == manifest length; `runTransform` start (stats: total 5, songs 3, movies 1, podcasts 1, playlists ≥2) → track(s) (done 1..5, constant total) → done, and that `written` (4) < walked (5) so per-track events are independent of extraction; `runArchive` threads one ordered stream across both stages; omitting `onProgress` is a no-op. Extended `device-archive.unit.test.ts`: bare/`--dump-only` human paths print the destination header + device-meta + library + milestone lines and NOT README:/report:/raw dump:/archive:/manifest:; `--json` envelope still carries outputDir/rawDumpDir/archiveDir/readmePath/reportMarkdownPath/reportJsonPath/manifestPath with zero stdout/stderr text leak; `--quiet` passes no `onProgress` and writes nothing.

**Quality gates (all pass):** `bun run build --filter @podkit/ipod-archive --filter podkit`; `bun run typecheck --filter @podkit/ipod-archive --filter podkit`; `bun run lint` (incl. CLI stderr-writes check); `bun run test:unit --filter @podkit/ipod-archive` (161 pass); `bun run test:integration --filter @podkit/ipod-archive` (51 pass); `bun run test:unit --filter podkit` (0 fail). graphify graph updated.

Files changed: packages/ipod-archive/src/{progress-events.ts (new), raw-dumper.ts, run-dump.ts, run-transform.ts, run-archive.ts, index.ts, progress-events.integration.test.ts (new)}; packages/podkit-cli/src/commands/device/archive.ts; packages/podkit-cli/src/commands/device-archive.unit.test.ts. Not committed (per request).
<!-- SECTION:NOTES:END -->
