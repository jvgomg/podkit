---
id: TASK-390
title: >-
  Sidecar flush: Promise.allSettled → runWithConcurrency (EMFILE safety +
  symmetry)
status: Done
assignee: []
created_date: '2026-06-06 12:13'
updated_date: '2026-06-06 14:07'
labels:
  - enhancement
  - save-transaction
  - mass-storage
  - concurrency
  - doc-041
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - documents/architecture/sync/error-handling.md
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
modified_files:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.test.ts
  - documents/architecture/sync/error-handling.md
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: low
ordinal: 108500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`mass-storage-adapter.ts:1456` is the last asymmetric flush stage in `save()` — it uses bare `Promise.allSettled` with no concurrency cap. The other three stages (moves serial, tag writes capped, picture writes capped) all settle through `runWithConcurrency(..., DEFAULT_TAG_WRITE_CONCURRENCY=16)`.

doc-041 §3.1 + error-handling.md §7 explicitly note this as a follow-up. Discovered (again) during TASK-380 re-scoping.

## Why

- **EMFILE safety** on large libraries — N albums = N concurrent open file handles unbounded.
- **Symmetry** with tag-write + picture-write stages so the four save() stages share one shape.
- **Doc cleanup** — closes the last doc-041 §3.1 follow-up + error-handling.md §7 bullet.

## Scope

1. Replace `Promise.allSettled(...)` at `mass-storage-adapter.ts:1456` with `runWithConcurrency(entries.map(...), DEFAULT_TAG_WRITE_CONCURRENCY)`.
2. Existing aggregate-into-SidecarWriteError + clear-before-throw stays.
3. Add concurrency-cap unit test in `mass-storage-adapter.test.ts` (e.g. 100-album batch tracks max-in-flight via instrumented `writeSidecarAtomically` and asserts ≤ DEFAULT_TAG_WRITE_CONCURRENCY).
4. Remove the "still uses bare Promise.allSettled" line from `mass-storage-adapter.ts:1450`-area comment.
5. Remove the corresponding follow-up bullet from `error-handling.md §7` and the `Sidecar-write Promise.allSettled → runWithConcurrency normalization for EMFILE safety` entry from `doc-041 §9`.

## Not in scope

Atomic on-file writes — handled by TASK-376. Per-album-vs-per-file aggregation asymmetry — pinned (intentional) by TASK-380's matrix and documented in TASK-NEW-E.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `mass-storage-adapter.ts:1456` sidecar stage uses `runWithConcurrency(entries.map(...), DEFAULT_TAG_WRITE_CONCURRENCY)`
- [x] #2 Existing aggregate-into-`SidecarWriteError` + clear-before-throw semantics unchanged
- [x] #3 Unit test pins concurrency cap (max-in-flight ≤ DEFAULT_TAG_WRITE_CONCURRENCY=16)
- [x] #4 Stale comment at line 1450-area removed (`still uses bare Promise.allSettled`)
- [x] #5 `error-handling.md §7` sidecar bullet removed
- [x] #6 `doc-041 §9` future-task entry removed (`Sidecar-write Promise.allSettled → runWithConcurrency normalization`)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the sidecar flush stage's bare `Promise.allSettled` with `runWithConcurrency(thunks, DEFAULT_TAG_WRITE_CONCURRENCY)`, mirroring the picture-write stage exactly. All four `save()` flush stages now share one shape — settle-all + concurrency-capped + clear-before-throw + typed aggregate (`SidecarWriteError`). Closes the last doc-041 §3.1 follow-up and removes the corresponding bullets from error-handling.md §7 and doc-041 §9.

**Block comment rewrite** documents the final state: atomic write (tmp+fsync+rename via the TASK-391 helper), EMFILE safety via the concurrency cap, settle-all-before-inspect, clear-before-throw, per-album aggregation rationale (forward-pointer to save-transactions.md §save-stage-asymmetries from TASK-393).

**Concurrency-cap test** patches `fs.promises.rename` to track `inFlight` / `maxInFlight` across 50 simultaneous sidecar writes, yields via `setImmediate` to let concurrent renames all reach the counter before any finishes. Asserts `maxInFlight === 16` (cap hit, not exceeded) plus all 50 cover.jpg files materialise. **Reviewer nit applied** (lead): stale `Promise.allSettled` mechanism reference in the older partial-success test's comment (line 2529) reworded to name the public contract (`runWithConcurrency settles all writes before inspecting failures`) rather than the underlying mechanism.

**Doc updates.** error-handling.md §7 sidecar bullet removed (other bullets preserved). doc-041 §3.1 sidecar row updated from `Promise.allSettled / unbounded (TODO)` to `runWithConcurrency / 16-capped`; §9 entry moved from "Open tasks anchored here" to "Recently closed".

**Verification.** Typecheck 34/34 clean. Unit tests 2907 pass / 5 skip / 0 fail. Existing sidecar tests (mass-storage-adapter.test.ts lines 2342–2497, now 2352–2570 post-additions) pass unmodified.
<!-- SECTION:FINAL_SUMMARY:END -->
