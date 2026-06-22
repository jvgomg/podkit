---
id: TASK-431.03
title: Transform tracer bullet — music tree + tags (--from-dump)
status: Done
assignee: []
created_date: '2026-06-22 11:02'
updated_date: '2026-06-22 16:14'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.01
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 157000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second vertical slice — the stage-2 tracer bullet. Add `--from-dump <path>` and the `runTransform` orchestrator (pure function of the dump; never touches the live device). Implement `DumpLoader` (open dump via libgpod-node `Database.open(dumpDir)` + identity via ipod-firmware SysInfoExtended for serial, libgpod-node for model/generation/capacity, degrading when absent), `ArchivePathPlanner` for the **music case only** (`Music/<AlbumArtist>/<Album>/## Title.ext`, sanitisation, length caps, collision→append-dbid, Unknown fallbacks, null-ipodPath → no-audio), and `TagWriter` (copy audio losslessly, write text tags in place via node-taglib-sharp — no artwork yet).

Demoable: a dump → browsable `Music/` tree of tagged, lossless audio files. Can run off a fixture dump (soft-depends on the raw-dump slice for real e2e).

Spec: doc-047 (Stage 2; Reading the dump; ArchivePathPlanner; TagWriter).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `podkit device archive --from-dump <path>` produces a Music/<AlbumArtist>/<Album>/## Title.ext tree from a dump without touching a device
- [x] #2 Audio files are byte-lossless copies with text tags written from the DB (no re-encode)
- [x] #3 DumpLoader opens via libgpod-node and surfaces identity, degrading when serial/SysInfoExtended absent
- [x] #4 ArchivePathPlanner handles sanitisation, length caps, collision→append-dbid, Unknown Artist/Album, null ipodPath→no-audio
- [x] #5 ArchivePathPlanner unit-tested (music cases); DumpLoader + TagWriter integration-tested against a fixture dump
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Stage-2 tracer bullet implemented in @podkit/ipod-archive (leaf package — depends only on libgpod-node, ipod-firmware, device-types, node-taglib-sharp, node:*).

New modules:
- src/sanitize.ts — shared segment sanitiser factored out of stage-1 output-naming. Two policies over one core: sanitizeSegment (underscore-collapsing, for the dir-name token) and sanitizePathSegment (space-preserving, for the browsable Music/ tree). Both apply NFC normalisation, reserved-char + control-char replacement, trailing-dot/space stripping, Windows reserved-device-name guarding (CON/PRN/…→ _CON), and a 200-byte per-segment cap (code-point-safe). output-naming.ts now imports/re-exports sanitizeSegment from here (no duplication).
- src/ipod-path.ts — centralised ipodPath ':'→'/' conversion (resolveDumpAudioPath, ipodPathExtension, ipodPathBasename, ipodPathToRelativeSegments). null/empty/colon-only → null.
- src/archive-path-planner.ts — pure, IO-free planPath(track, collisionState) → relPath|null. Music layout only this slice: Music/<AlbumArtist>/<Album>/<NN> <Title>.<ext>. AlbumArtist = albumArtist||artist||"Unknown Artist"; Album = album||"Unknown Album"; Title = title||source basename||"Unknown Title"; NN zero-padded (omitted when no track number); ext from ipodPath. Collisions append " [<dbid>]" before the ext, with a counter fallback ( (2), (3), …) so a dbid-suffixed name that itself collides still resolves uniquely. Deterministic regardless of order.
- src/tag-writer.ts — writeTrack(srcFile, destFile, meta): streamed lossless byte copy (no transcode/remux) + in-place node-taglib-sharp text tags (title/artist/album/albumArtist/genre/trackNumber/discNumber/year/comment). When meta has no textual fields the tag step is skipped so the copy stays byte-identical. meta.cover is accepted and ignored (reserved for the artwork slice — signature is forward-compatible). Guards a null createFromPath handle.
- src/dump-loader.ts — loadDump(dumpDir) → { db, identity, ipodRoot }. Resolves the iPod root (dumpDir itself if it holds iPod_Control, else dumpDir/"raw dump"), opens via libgpod-node Database.open(), reads serial/firewire/familyId via ipod-firmware readSysInfoExtended (degrades to undefined when SysInfoExtended absent) and model/generation/capacity via libgpod device capabilities. Throws IpodArchiveError('DUMP_NOT_READABLE') when no iPod_Control is found or libgpod can't parse. Closes the db if identity reading throws.
- src/run-transform.ts — runTransform(dumpDir, opts) → TransformResult { archiveDir, ipodRoot, written, noAudio[], failures[], identity }. PURE function of the dump — never opens a device. loadDump → mkdir archive/ → per track: planPath (null → noAudio bucket) → resolveDumpAudioPath → writeTrack into archive/<relPath>; per-track failures collected (missing source/tag errors) without aborting. db.close() in finally.

Path resolution:
- Dump→iPod-root: loadDump accepts the named archive dir (containing "raw dump/") OR a bare dir containing iPod_Control, and opens THAT dir with libgpod.
- Archive output: <dumpDir>/archive (since the loader anchors the iPod root to dumpDir or dumpDir/"raw dump", dumpDir is always the anchor). For a stage-1 named dir that places archive/ beside "raw dump/"; for a bare iPod root it lands inside. opts.outputDir overrides. Documented that dumpDir should be the named dir, not the "raw dump/" subdir.

CLI (packages/podkit-cli/src/commands/device/archive.ts): --from-dump now runs runTransform with NO device resolution (device-free) and prints archive location / tracks written / no-audio count / failures. Removed the ARCHIVE_NOT_IMPLEMENTED stub + error code; added ARCHIVE_TRANSFORM_FAILED. output-types gained a stage:'transform' success variant. runTransform is injectable via DeviceArchiveDeps for tests. Default (no flags) still runs dump only — "run both stages" deferred to 431.09.

Tests:
- Unit (exhaustive): archive-path-planner.test.ts (layout, NN padding, no-track-number, ext derivation + lowercasing, Unknown fallbacks, sanitisation incl. reserved chars/names/trailing dots/length cap/NFC, collision → dbid + counter determinism, null/colon-only ipodPath → null); ipod-path.test.ts; sanitize.test.ts (both policies).
- Integration (gpod-testing createTestIpod + libgpod copyTrackToDevice to seed real audio with real ipodPath; one metadata-only track → null ipodPath): run-transform.integration.test.ts asserts the Music/<AlbumArtist>/<Album>/NN Title.ext tree, that audio is not re-encoded (taglib audio properties equal source), tags read back match the DB, no-audio bucketing, archive-beside-raw-dump placement, DumpLoader identity degradation + DUMP_NOT_READABLE. Plus a dedicated writeTrack test proving empty-meta copy is byte-identical and parent dirs are created. Fixtures resolved via import.meta.dir (machine-independent).
- CLI unit (device-archive.unit.test.ts): --from-dump delegates to injected runTransform without resolving a device; transform failure → ARCHIVE_TRANSFORM_FAILED.

Quality gates (all pass): bun install; bun run build / typecheck --filter @podkit/ipod-archive --filter podkit; bun run lint (oxlint + stderr-write check); test:unit (66) + test:integration (17) --filter @podkit/ipod-archive.

A sonnet review pass was run; addressed: double-collision counter fallback, db-close-on-identity-error, null taglib handle guard, hardcoded fixture path → import.meta.dir, composer/grouping scope comment, dumpDir contract docs.

Stubbed for later slices: artwork/cover embedding (meta.cover reserved, hook in place), media-type routing (podcasts/audiobooks/video/compilations — all audio currently routed through the music layout), composer/grouping/BPM tag fields, the report/README/playlist/sqlite stages, and the default "run both stages" path (431.09).

Code-review fixes applied (post-implementation hardening pass):

**Fix 1 — Path-traversal hardening (ipod-path.ts)**
- `ipodPathToRelativeSegments`: now drops any segment equal to `.` or `..`, or containing a `/` or `\`. Crafted dumps with `:..:..:etc:passwd`-style paths can no longer escape the dump root at the segment level.
- `resolveDumpAudioPath`: added a `path.resolve` containment check after `join` — resolved path must equal `ipodRoot` or start with `ipodRoot + sep`; if it escapes, returns null.
- Unit tests added in `ipod-path.test.ts`: traversal filtering in `ipodPathToRelativeSegments` (`.`/`..`/separator-bearing segments), containment check in `resolveDumpAudioPath`.

**Fix 2 — M4A lossless coverage (run-transform.integration.test.ts)**
- Added `expect(readAudioProps(secondDest)).toEqual(readAudioProps(M4A))` to the main integration test (alongside the existing MP3 assertion).
- Added a standalone `writeTrack > M4A: copies losslessly and writes tags into MP4 atoms` test in the `writeTrack` describe block.

**Fix 3 — Missing-source-file failure test (run-transform.integration.test.ts)**
- New integration test: seeds two tracks, deletes the on-disk audio file for one of them, asserts `result.failures.length === 1` + `result.written === 1` (the surviving track wrote successfully; the run was not aborted).

**Fix 4 — `resolveArchiveDir` JSDoc clarity (run-transform.ts)**
- Removed the misleading 'inferred from the loader-resolved iPodRoot' phrase from the JSDoc. New wording: 'dumpDir is always the anchor — archive/ lands beside raw dump/ for a named stage-1 dir, or inside a bare iPod root'. Behaviour unchanged.

**Fix 5 — Dead `noAudio` guard replaced (run-transform.ts ~line 159)**
- The `sourcePath === null` branch after a non-null `planPath` was unreachable by normal paths, but now legitimately fires for path-traversal escapes (fix 1). Replaced the `noAudio.push()` with a `failures.push()` carrying the raw `ipodPath` and a descriptive `'ipodPath resolves outside the dump root (path-traversal guard)'` error. Also updated `TransformFailure.sourcePath` JSDoc.

**Fix 6 — Comment-only (sanitize.ts + tag-writer.ts)**
- `sanitize.ts` line where `trimmed` is computed: added a comment explaining the deliberate leading-underscore strip and why it applies to both whitespace policies.
- `tag-writer.ts` at `file.save()`: added a note that taglib `save()` is synchronous blocking I/O (acceptable for sequential batch archive; flagged for future readers if parallelised).

**Fix 7 — Planner `segmentOr` fallback chain test (archive-path-planner.test.ts)**
- New describe `planPath — segmentOr fallback chain`: test that `albumArtist: ':::'` (sanitises entirely to empty) with a valid `artist` produces `Music/<artist>/...`, confirming the `segmentOr` chain skips the empty result and falls through to artist.

Quality gates after fixes: `bun run build --filter @podkit/ipod-archive` ✓; `bunx tsc --noEmit` ✓; `bun run lint` (0 warnings/errors) ✓; `test:unit` 71 pass / 0 fail ✓; `test:integration` 19 pass / 0 fail ✓.
<!-- SECTION:NOTES:END -->
