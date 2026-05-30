---
id: TASK-364
title: Atomic file/manifest writes to prevent partial-write P1 storage leaks
status: To Do
assignee: []
created_date: '2026-05-30 17:46'
labels:
  - sync
  - mass-storage
  - reliability
  - tech-debt
dependencies: []
priority: medium
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
- [ ] #1 `copyTrackFile` writes to a sibling temp path and renames on success.
- [ ] #2 Transcode and optimized-copy FFmpeg outputs go to temp paths and rename on success.
- [ ] #3 Manifest writes use temp + rename.
- [ ] #4 Operation order: file fully fsynced/renamed before manifest reflects it.
- [ ] #5 Integration test simulating a SIGKILL between file write and manifest update verifies no .podkit-tmp debris and no manifest entry for the half-written file.
- [ ] #6 The three pinning tests in orphans-mass-storage.test.ts "adapter-failure debris" describe block stay green (they document the detection gap; this task closes the production gap that creates the debris in the first place).
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
