---
id: TASK-376
title: Atomic on-file writes (helper + retrofit) — doc-041 §3.4/§7.2
status: Done
assignee: []
created_date: '2026-06-03 09:08'
updated_date: '2026-06-07 10:04'
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
modified_files:
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.integration.test.ts
  - documents/architecture/sync/save-transactions.md
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
  - test-packages/e2e-vm-tests/src/matrix/README.md
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 writeTags uses atomicWriteFileWithSync — DONE: BufferFileAbstraction feeds taglib an in-memory stream seeded with the original file bytes; after save() the mutated buffer lands via atomicWriteFileWithSync
- [x] #2 writePicture uses atomicWriteFileWithSync — DONE: same BufferFileAbstraction pattern
- [x] #3 SIGKILL simulation (rename failure): original file body unchanged, no .podkit-tmp debris — DONE: pinned by two integration tests in mass-storage-tag-writer.integration.test.ts
- [x] #4 No .podkit-tmp on success for either method — DONE: pinned by two integration tests
- [x] #5 typecheck passes — DONE
- [x] #6 unit tests pass — DONE: 2908 pass, 0 fail
- [x] #7 doc-041 §3.4 flipped to CLOSED — DONE
- [x] #8 save-transactions.md §4 Convention 2 updated to reflect all three stages atomic — DONE
- [x] #9 matrix README row 2 updated — DONE
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Retrofitted TagLibTagWriter.writeTags and writePicture to use atomicWriteFileWithSync.

Mechanism: introduced BufferFileAbstraction and BufferStream classes (IFileAbstraction + IStream backed by a growing Buffer). writeTags/writePicture now read the source file into a Buffer, feed taglib a BufferFileAbstraction so all I/O is in-memory, call file.save(), then call atomicWriteFileWithSync(filePath, abstraction.getWriteBuffer()). No intermediate temp file is needed — taglib's mutations go to the buffer; the atomic helper's own .podkit-tmp is the only on-disk transient.

node-taglib-sharp does not expose a memory-backed stream; the IStream interface is implemented by the new BufferStream class. The Stream class only wraps file descriptors via createAsRead/createAsReadWrite.

Tests added: four integration tests in mass-storage-tag-writer.integration.test.ts under "atomic write contract" — no .podkit-tmp on success (writeTags + writePicture), and rename-failure pins original file unchanged + no .podkit-tmp for both methods. All 2908 unit tests pass.

Docs: save-transactions.md §4 Convention 2 updated to say all three mutation stages use atomicWriteFileWithSync. §6 Open Work entry removed. doc-041 §3.4 flipped to CLOSED. §9 Recently closed updated. Matrix README row 2 updated from "integrity gap" to "closed by TASK-376 + debris cleaned by TASK-375".
<!-- SECTION:FINAL_SUMMARY:END -->
