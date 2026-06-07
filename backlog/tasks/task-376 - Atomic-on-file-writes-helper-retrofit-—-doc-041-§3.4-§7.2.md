---
id: TASK-376
title: Atomic on-file writes (helper + retrofit) — doc-041 §3.4/§7.2
status: To Do
assignee: []
created_date: '2026-06-03 09:08'
updated_date: '2026-06-06 13:46'
labels:
  - enhancement
  - save-transaction
  - mass-storage
  - reliability
  - doctor
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: medium
ordinal: 102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Per `doc-041 §3.4`: tag-write, picture-write, and (future) sidecar-write all open the target file in-place via node-taglib-sharp. A SIGKILL mid-write CAN leave a torn file. Manifest writes are atomic (tmp + rename); on-file mutations are not.

## Scope

1. ~~Add a shared atomic-write helper~~ — **done in TASK-391**: `atomicWriteFileWithSync(dest, data)` now lives in `packages/podkit-core/src/utils/atomic-fs.ts`. Import and call it directly.
2. Retrofit `MassStorageTagWriter.writeTags` and `writePicture` to use `atomicWriteFileWithSync`. The wrapping pattern: read the final bytes node-taglib-sharp would write (or let it write to a tmp path), then call `atomicWriteFileWithSync` to fsync + rename. Decide based on taglib's API whether to intercept the bytes-to-write or wrap the whole write operation with a tmp target.
3. `podkit doctor` should clean orphan `<file>.podkit-tmp` files on the device (related to TASK-375).
4. Test: SIGKILL simulation (write half the file then throw before rename) → target file is unchanged → doctor cleanup removes the tmp.

## Why deferred

The helper is now available (TASK-391). Remaining work is the `writeTags`/`writePicture` retrofit — needs investigation of taglib's API to determine the wrapping pattern.

## Reference

- `doc-041` §3.4 (rough edge), §7.2 (principle), §4.2 ("Crash mid-tag-write" gap)
- `atomicWriteFileWithSync` in `packages/podkit-core/src/utils/atomic-fs.ts`
- `PODKIT_TEMP_SUFFIX` family (same debris extension, same doctor-visible pattern)
<!-- SECTION:DESCRIPTION:END -->
