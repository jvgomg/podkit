---
id: TASK-391
title: >-
  Promote writeSidecarAtomically → utils/atomic-fs.ts generic helper (TASK-376
  prep)
status: Done
assignee: []
created_date: '2026-06-06 12:13'
updated_date: '2026-06-06 13:52'
labels:
  - refactor
  - save-transaction
  - atomic-write
  - prep-376
dependencies: []
references:
  - packages/podkit-core/src/utils/atomic-fs.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
modified_files:
  - packages/podkit-core/src/utils/atomic-fs.ts
  - packages/podkit-core/src/utils/atomic-fs.test.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
priority: low
ordinal: 108700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`writeSidecarAtomically` (mass-storage-adapter.ts neighbourhood) is the only **atomic on-file-write** path in podkit today — tmp + `fsync` + rename + cleanup-tmp-on-failure. The mechanism is general; the call site is bespoke to sidecar `cover.jpg`.

`utils/atomic-fs.ts` already hosts the sibling helpers (`atomicWriteFile` for strings/buffers without fsync; `atomicCopyFile` for byte-stream copies). The missing third member of the family is "atomic write of an in-memory buffer with fsync" — exactly what `writeSidecarAtomically` is.

## Why deferred

TASK-376 (atomic on-file writes for tag-write + picture-write) will need this exact helper. Promoting it now turns TASK-376 from "implement tmp+fsync+rename three more times" into "call the helper three more times" — one-line callsite changes per stage.

## Scope

1. Add `atomicWriteFileWithSync(dest: string, data: Buffer | Uint8Array): Promise<void>` to `utils/atomic-fs.ts`. Same `.podkit-tmp` suffix family (already in `KNOWN_DEBRIS_EXTENSIONS`).
2. Same contract as the existing `writeSidecarAtomically`: write tmp, fsync, rename, cleanup tmp on any failure (so a SIGKILL between tmp-create and rename doesn't leak — doctor will catch it as `.podkit-tmp` debris if it does).
3. Replace the body of `writeSidecarAtomically` with a single call to the helper (the sidecar wrapper can stay if it adds anything semantic, otherwise delete).
4. Unit tests in `atomic-fs.test.ts` mirror the existing sidecar-test shapes (already in `mass-storage-adapter.test.ts:2463`).
5. TASK-376 ACs simplify to "call helper from `writeTags`/`writePicture`".

## Not in scope

Retrofit of `writeTags`/`writePicture` — that's TASK-376's job. This task ships the helper.

## Trade-off

`atomicWriteFile` (existing) and `atomicWriteFileWithSync` (new) differ only in whether fsync runs. Tempting to merge into one function with an `fsync?: boolean` option. Don't — fsync is a meaningful semantic distinction (manifest write doesn't need it because re-derivable from FS walk; on-file writes do because the file IS the source of truth). Two named functions, two contracts. Comment the difference.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `atomicWriteFileWithSync(dest, data): Promise<void>` added to `utils/atomic-fs.ts` with tmp+fsync+rename+cleanup-on-failure contract
- [x] #2 `writeSidecarAtomically` body replaced by helper call (or function deleted if pure-wrapper)
- [x] #3 Unit tests in `atomic-fs.test.ts` cover happy path, rename-failure cleanup, write-failure cleanup
- [x] #4 Existing sidecar tests in `mass-storage-adapter.test.ts` still pass without modification
- [x] #5 Comment on helper explains the fsync vs no-fsync semantic distinction (vs `atomicWriteFile`)
- [x] #6 TASK-376 description updated to reference the helper as the retrofit primitive
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Promoted `writeSidecarAtomically`'s tmp+fsync+rename pattern into a generic helper `atomicWriteFileWithSync(dest, data): Promise<void>` in `utils/atomic-fs.ts`, sitting alongside the existing `atomicWriteFile` (no fsync, safe for re-derivable state) and `atomicCopyFile` (byte-stream).

**Helper design.** Single try/catch wraps the whole open → writeFile → fsync → close → rename sequence. On any failure path the catch runs: close the handle if still open (swallow secondary errors), unlink the tmp (swallow ENOENT for the open-failed case), rethrow the original error. JSDoc explicitly documents the fsync vs `atomicWriteFile` semantic distinction — manifest re-derivability vs file-as-source-of-truth.

**writeSidecarAtomically retained as wrapper** rather than inlined: it adds `mkdir({recursive: true})` for the album dir before delegating. Inlining would drag infrastructure detail into `save()` Stage 4 — the named wrapper documents intent.

**Tests** (3 in `atomic-fs.test.ts`): happy path + overwrite + rename failure + fsync failure (mocks `fs.promises.open` to wrap the real handle with a sync that rejects — real tmp is materialised on disk before the failure, so cleanup is genuinely exercised, not vacuously passed by failing at `open()`). Original `open()`-fails-pre-tmp test kept and renamed to document the no-tmp-yet branch.

**Reviewer-found bugs fixed (post-first-pass):**
- Initial worker submission had broken cleanup: the original two-try structure let writeFile/fsync errors propagate past the `finally { close }` without ever reaching the `try { rename } catch { unlink }` block — leaving `.podkit-tmp` debris. Restructured to single try/catch as above.
- Initial write-failure test pointed dest at a nonexistent subdir so `open()` threw before any tmp was created — test passed vacuously and failed to catch the cleanup bug. Replaced with the fsync-failure test that materialises a real tmp.
- Removed task-id references from two code comments per project conventions (atomic-fs.ts line 65, mass-storage-adapter.ts line 1416).

**TASK-376 description updated** to reference `atomicWriteFileWithSync` as the retrofit primitive; its scope shrinks to "call the helper from `writeTags`/`writePicture` instead of inlining tmp+fsync+rename three more times".

**Verification.** Typecheck 34/34 clean. Unit tests 2906 pass / 5 skip / 0 fail. Existing `mass-storage-adapter.test.ts` sidecar tests (lines 2342–2497) pass unmodified.
<!-- SECTION:FINAL_SUMMARY:END -->
