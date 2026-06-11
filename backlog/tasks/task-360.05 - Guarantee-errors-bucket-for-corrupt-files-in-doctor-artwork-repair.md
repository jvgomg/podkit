---
id: TASK-360.05
title: Guarantee 'errors' bucket for corrupt files in doctor artwork repair
status: Done
assignee: []
created_date: '2026-05-28 21:28'
updated_date: '2026-06-11 07:43'
labels:
  - doctor
  - artwork
dependencies: []
references:
  - test-packages/e2e-tests/src/features/doctor-artwork-repair.test.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`features/doctor-artwork-repair.test.ts:487-517` documents that a corrupt source file's categorisation is non-deterministic. `AlbumArtworkCache` short-circuits per-album: if a sibling track in the same album scans successfully first, the cache returns success for the corrupt track too. The corrupt file lands in `matched` instead of `errors`, depending on iteration order.

The test only asserts `matched + noSource + noArtwork + errors === 3`, not which bucket each lands in.

## Decision

Guarantee `errors` bucket for any corrupt file. Users should be able to point at the bad file from doctor output. Scan each track's source file independently for error detection before applying the album-cache success short-circuit for the artwork lookup itself.

## References

- test-packages/e2e-tests/src/features/doctor-artwork-repair.test.ts:487-517
- packages/podkit-core/src/artwork/repair.ts:275-280
- packages/podkit-core/src/artwork/album-cache.ts:167-215
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Per-track source-file validity check runs before `AlbumArtworkCache` short-circuit applies; corrupt/unreadable files always land in a deterministic bucket (`noSource` when the directory adapter drops them at scan time, `errors` when corruption surfaces between scan and extract)
- [x] #2 Tighten `doctor-artwork-repair.test.ts:487-517`: precise per-bucket counts replace the sum-only assertion; static-corruption scenario asserts `matched=2, noSource=1, errors=0` with a comment explaining why static corruption lands in `noSource` (adapter parse-failure semantics)
- [x] #3 Performance: album-cache lookup behaviour preserved for healthy tracks (no regression); extra work is bounded to a per-track readability check (stat + 16-byte magic probe)
- [x] #4 Doctor JSON output surfaces the corrupt file path + reason taxonomy (`missing | unreadable | truncated | badMagic`) in the per-check details so a user can act on it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation summary

Added a per-track source-file validity probe and wired it into `rebuildArtworkDatabase` BEFORE the album-cache lookup. The corrupt file's `path` + structured `reason` now surface in the doctor JSON output's `details.errorDetails`.

## Files

- **New**: `packages/podkit-core/src/artwork/source-validity.ts` — `checkSourceFileValidity(path): { ok: true } | { ok: false, reason: 'missing' | 'unreadable' | 'truncated' | 'badMagic' }`. Sync stat + open + 16-byte magic-byte read. Magic-byte set: FLAC `fLaC`, OGG/Opus `OggS`, MP3 (ID3v2 `ID3` or raw MPEG sync `0xFF 0xEx`), MP4/M4A/AAC `....ftyp`, WAV `RIFF`+`WAVE`, AIFF/AIFC `FORM`+`AIFF`/`AIFC`. Matches the directory adapter's `DEFAULT_EXTENSIONS` set.
- **New**: `packages/podkit-core/src/artwork/source-validity.test.ts` — unit tests covering each reason + each supported magic.
- **Edit**: `packages/podkit-core/src/artwork/repair.ts` — gate runs after `getArtworkSourcePath` and before the `artworkCache.get` call. On failure: clears the sync-tag art= hash, increments `progress.errors`, pushes `{artist, title, error, path, reason}` to `errorDetails`, and `continue`s. `checkSourceFileValidity` is injected via `RebuildDependencies` (default = real impl) so unit tests with fake paths can stub it.
- **Edit**: `packages/podkit-core/src/artwork/repair.test.ts` — added `source-file validity gate (TASK-360.05)` describe block that uses REAL temp files with `fLaC` magic + a `NOT_A_VALID_FLAC_FILE` corrupt sibling. Verifies (a) the corrupt file lands in `errors` with `reason: 'badMagic'`, (b) the two healthy siblings still extract via the album cache (one extract call for both), and (c) a missing-source-path bucket as `errors` with `reason: 'missing'`.
- **Edit**: `packages/podkit-core/src/diagnostics/checks/artwork-matrix.test.ts` — `makeCollectionTrack` now writes a real FLAC-header stub file to a temp dir so the validity probe accepts it (existing AC#7/#8 used fake `/music/...` paths).
- **Edit**: `packages/podkit-core/src/index.ts` — re-exports `checkSourceFileValidity`, `SourceValidityReason`, `SourceValidityResult`, `RebuildErrorDetail`.
- **Edit**: `test-packages/e2e-tests/src/features/doctor-artwork-repair.test.ts` — `RepairOutput` type now includes `path` + `reason` on errorDetails. The corrupt-source-file test replaces its sum-only assertion with precise per-bucket counts (see architectural note below).

## JSON schema change

`details.errorDetails[*]` (artwork-rebuild repair) now optionally carries:
- `path?: string` — absolute source-file path (when the failure is localised)
- `reason?: 'missing' | 'unreadable' | 'truncated' | 'badMagic'` — validity-probe outcome

`artist`, `title`, `error` remain. Backward-compatible: consumers that don't read `path`/`reason` continue to work.

## Architectural finding (AC#2 caveat)

The task's expected bucket for the e2e corrupt-source scenario was `errors=1, noSource=0`. The directory adapter currently drops parse-failed files from its source index at scan time (`music-metadata` throws on the invalid FLAC preamble; the adapter catches and emits a warning). Consequently, the corrupt file's iPod track has NO matching source entry when the repair runs — it falls into `noSource`, never reaching the validity gate.

The validity gate I added IS exercised by adjacent scenarios where the source IS in the index but the file becomes invalid between scan and extraction (e.g. a Subsonic stream-to-temp-file download yields a truncated blob; a directory file is replaced/deleted post-scan). The unit tests in `repair.test.ts > source-file validity gate (TASK-360.05)` cover this with real temp files.

The e2e test now asserts the realistic outcome: `matched=2, noSource=1, noArtwork=0, errors=0` with a long architectural comment documenting why. AC#2 (precise per-bucket counts, no more sum-only assertion) is met; the specific bucket the corrupt file lands in is `noSource` rather than `errors` for the static-corruption scenario.

To put the static-corruption scenario into `errors`, the directory adapter would need to retain failed-parse files as stub tracks with correlable metadata (a behaviour change outside this task's scope; would touch the scan contract and matching layer).

## AC status

- AC#1: per-track validity gate runs before album-cache — DONE for the in-index path. Out-of-index path requires adapter changes (see above).
- AC#2: precise per-bucket counts replace sum assertion — DONE. Bucket is `noSource` due to adapter behaviour, not `errors`.
- AC#3: album-cache lookup preserved for healthy tracks — DONE; verified by `extractCount === 1` for two healthy siblings.
- AC#4: corrupt file `path` + `reason` surfaced in JSON details — DONE for the in-index path.

## Quality gates

- `bun run test:unit --filter @podkit/core` — 3130 pass, 5 skip, 0 fail.
- `bun run test:unit --filter podkit` — 1407 pass, 0 fail.
- `bun run build` — all 19 packages cached.
- `bun run lint` — 0 warnings, 0 errors.
- `tsc --noEmit` against podkit-core + e2e-tests — clean.

2026-06-10: Architectural finding accepted — static corruption (file invalid on disk at scan time) is dropped by the directory adapter's `music-metadata` parser and lands in `noSource`, not `errors`. Decision: `noSource` is the correct semantic (file is not a usable source). The validity gate fires for transient corruption (changed between scan and extract, Subsonic stream truncation) and is covered by unit tests. AC#2 wording updated to reflect deterministic-bucket-per-scenario.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a per-track source-file validity probe (stat + 16-byte magic-byte header check) that runs before `AlbumArtworkCache` short-circuits. Corrupt or unreadable files lose their non-deterministic "inherit from sibling" cache behaviour and land in a deterministic bucket with a structured reason (`missing | unreadable | truncated | badMagic`).

`details.errorDetails[*]` in doctor's JSON output gains optional `path` and `reason` fields so users can act on specific bad files. Backward-compatible.

Magic-byte set covers FLAC, OGG/Opus, MP3 (ID3 and bare MPEG sync), MP4/M4A/AAC, WAV, AIFF/AIFC — matched against the directory adapter's `DEFAULT_EXTENSIONS`.

Album-cache speedup preserved for healthy tracks. Pinned by `extractCount === 1` across two healthy album siblings in the new test.

Architectural finding (accepted): the static-corruption e2e scenario (file overwritten with garbage on disk before sync) is dropped by the directory adapter's `music-metadata` parser at scan time. The corrupt file never reaches the validity gate — it lands in `noSource`, not `errors`. The team-lead decision was that `noSource` is semantically correct ("no usable source"); the validity gate covers the transient class of corruption (Subsonic stream truncation, files replaced/deleted between scan and extract), unit-tested directly.

E2E test updated to assert the realistic outcome (`matched=2, noSource=1, errors=0`) with a comment explaining the adapter behaviour. AC#2 wording was amended mid-implementation to reflect deterministic-bucket-per-scenario.

Landed in commit `785ad57a`. Changeset: `doctor-source-validity-probe.md` (patch, podkit + @podkit/core).

Follow-up worth noting (not filed): doctor's human-readable output doesn't surface the new `path` / `reason` fields — currently JSON-only. Worth a small task if you want them visible without `--json`.
<!-- SECTION:FINAL_SUMMARY:END -->
