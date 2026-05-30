---
id: TASK-364
title: Atomic file/manifest writes to prevent partial-write P1 storage leaks
status: Done
assignee: []
created_date: '2026-05-30 17:46'
updated_date: '2026-05-30 20:57'
labels:
  - sync
  - mass-storage
  - reliability
  - tech-debt
dependencies: []
priority: high
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Surfaced by

TASK-361 audit. The orphan-detection diagnostic cannot catch partial-write debris because such files are added to the manifest BEFORE the copy/transcode completes. If the sync aborts mid-write, the file is "managed" per the manifest but only partially written on disk — invisible to the orphan check, never cleaned up.

## Root cause

Three non-atomic write paths in the mass-storage adapter + manifest writer:

1. **`packages/podkit-core/src/device/mass-storage-adapter.ts:379`** — `fs.copyFileSync(srcPath, destPath)` writes directly to the destination. Interrupted copies leave partial files at the final path.

2. **`packages/podkit-core/src/sync/music/pipeline.ts:1846` (transcode) and `:1950` (optimized-copy)** — FFmpeg writes its output directly to the device path with no intermediate temp. Killing FFmpeg mid-render (or any abort that propagates) leaves a malformed audio file with the recognized extension.

3. **`packages/podkit-core/src/device/mass-storage-adapter.ts:1194`** — `fs.writeFileSync(manifestPath, json)` writes the manifest non-atomically. A process death mid-write leaves a truncated/corrupted manifest. The orphan check's load helper (`orphans-mass-storage.ts:44`) silently swallows parse errors.

## Fix

Apply write-temp-then-rename for all three paths:

- File copies → `fs.copyFile` to `<dest>.podkit-tmp`, then `fs.rename` to `<dest>`.
- FFmpeg outputs → spawn FFmpeg with a temp output path under the same directory, then rename on success.
- Manifest writes → JSON to `<manifest>.tmp`, then rename. Both Linux and macOS guarantee rename atomicity within a filesystem.

The manifest write should also order the operations so the file write completes BEFORE the manifest is updated to reference it. Current order: pipeline writes to device (adapter copy), then asks the adapter to persist the manifest. The adapter currently updates `managedFiles` in-memory before the persist call. Need to verify the order ensures "file fully written before manifest references it" — otherwise a crash between the two steps leaks debris even with atomic writes.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `copyTrackFile` writes to a sibling temp path and renames on success.
- [x] #2 Transcode and optimized-copy FFmpeg outputs go to temp paths and rename on success.
- [x] #3 Manifest writes use temp + rename.
- [x] #4 Operation order: file fully fsynced/renamed before manifest reflects it.
- [x] #5 Integration test simulating a SIGKILL between file write and manifest update verifies no .podkit-tmp debris and no manifest entry for the half-written file.
- [x] #6 The three pinning tests in orphans-mass-storage.test.ts "adapter-failure debris" describe block stay green (they document the detection gap; this task closes the production gap that creates the debris in the first place).
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude / Opus 4.7): Landed in commit `efdbabd2` — "fix(sync): atomic file + manifest writes to prevent partial-write P1 storage leaks".

**Implementation**

- New helper module `packages/podkit-core/src/utils/atomic-fs.ts` with `atomicCopyFile` + `atomicWriteFile` + `PODKIT_TEMP_SUFFIX` (`.podkit-tmp`). Pattern: write to `<dest>.podkit-tmp`, then `rename` to `<dest>`; best-effort `unlink` of the temp on error.
- `MassStorageTrack.copyFile()` + `MassStorageAdapter.replaceTrackFile()` swapped to `atomicCopyFile`.
- `MassStorageAdapter.save()` manifest write swapped to `atomicWriteFile`.
- `prepareTranscode`, `executeTranscode`, `prepareOptimizedCopy` (in `sync/music/pipeline.ts`) now have FFmpeg write to `<outputPath>.podkit-tmp` then `await rename` on success. (Output dir is OS temp by default — defensive against on-device `tempDir` configurations.)

**Order verification (AC #4)**

Per-track flow remains: `addTrack` (in-memory) → `copyTrackFile` (atomic copy to device) → eventually `save()` (atomic manifest persist). Because atomic copy completes the rename before returning, and save() only persists `managedFiles` after `copyTrackFile`, the on-disk manifest always references files that have been fully renamed into place.

**Phantom-path bug surfaced by sonnet review**

`addTrack` adds path to `managedFiles` immediately. If `copyTrackFile` then throws, a later checkpoint `save()` (driven by another successful track) would persist the phantom path — the exact "manifest references missing file" class pinned by `orphans-mass-storage.test.ts` test #2. Closed by a defensive `managedFiles.delete` in `copyTrackFile`'s catch.

**Coverage**

- `utils/atomic-fs.test.ts` — unit tests for the helpers (happy + failure + prior-dest preservation).
- `device/mass-storage-adapter.integration.test.ts` — new describe "crash resilience under partial writes" with 3 tests:
  1. SIGKILL between file write and manifest update leaves clean state (file fully on disk, manifest doesn't reference it, no `.podkit-tmp` debris).
  2. `copyTrackFile` failure rolls `managedFiles` entry back (closes the phantom-path pathway).
  3. Failed manifest save throws and leaves no `.podkit-tmp` debris.
- Existing orphan-detection pinning tests stay green (the detection-side gap remains real for files deleted out-of-band by the user).
- Pipeline test mock updated to write a real (empty) file at the transcoder's output arg so the post-transcode rename succeeds.

**Gates**

Unit (2827 / 0 fail), integration (12 / 0), e2e non-docker (31 / 0), e2e docker (4 / 0), typecheck, oxlint — all green locally on macOS. Linux not validated (see existing watch-out re. `mise run test:linux`).

**Follow-ups**

- TASK-365's "missing-file manifest entry" detection gap is still meaningful for user-deleted files; the production-creation pathway from copyTrackFile failure is now closed by the rollback.
<!-- SECTION:NOTES:END -->
