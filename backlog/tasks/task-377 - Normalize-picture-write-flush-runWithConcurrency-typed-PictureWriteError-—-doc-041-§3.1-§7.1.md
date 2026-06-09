---
id: TASK-377
title: >-
  Normalize picture-write flush: runWithConcurrency + typed PictureWriteError —
  doc-041 §3.1/§7.1
status: Done
assignee: []
created_date: '2026-06-03 09:08'
updated_date: '2026-06-09 08:33'
labels:
  - enhancement
  - save-transaction
  - mass-storage
  - error-handling
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
  - packages/podkit-core/src/sync/engine/error-handling.ts
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: medium
ordinal: 103000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`doc-041 §3.1` documents three inconsistent failure shapes within one `MassStorageAdapter.save()`. The picture-write stage is the outlier: `Promise.all` (fail-fast, unbounded concurrency, no typed error). Tag writes use `runWithConcurrency` + `TagWriteError` aggregation.

## Scope

1. Refactor Stage 3 (`mass-storage-adapter.ts:1173`) to mirror the tag-write pattern:
   - `runWithConcurrency` with documented cap.
   - All writes settle before throw.
   - Per-file failures aggregated into a new typed `PictureWriteError extends Error` with `causes`.
2. Update the executor's error categorizer (`sync/engine/error-handling.ts`) to match on `instanceof PictureWriteError` and classify as `copy` — drops the fragile path-in-message heuristic for this case.
3. Decide map-clear-vs-throw order: doc-041 §7.1 argues for clear-before-throw (matches tag writes; rely on rescan for retry). Document the choice.
4. Update the two pinning tests landed in TASK-142 follow-up (`save() rejects when a picture write fails`, `save() leaves pendingPictureWrites populated on failure`) to assert the new shape — these are the canaries that locked the OLD behaviour.

## Why deferred

Doc-041 §3.1 lays out the case; the test pinning is in place; this is the actual refactor. Pairs naturally with TASK-371 (mass-storage non-OGG embed) since both touch the picture-write path.

## Reference

- `doc-041` §3.1, §3.3, §3.5, §7.1
- `mass-storage-adapter.test.ts` "Save-failure behaviour pinning (doc-041 §4.2)" describe block
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Closed by TASK-381 (commit 7bf7127d, 2026-06-06)

TASK-381's sync-engine error+warning unification landed every scope item:

1. **Stage 3 normalized** — `mass-storage-adapter.ts:1463-1485` flushes `pendingPictureWrites` via `runWithConcurrency` + collect-and-aggregate + clear-before-throw, throwing `PictureWriteError` with per-file `causes`. Shape mirrors the tag-write stage at `:1427-1453`.

2. **Categorizer instanceof-based** — `sync/engine/error-handling.ts:103-108` reads `error.category` off `CategorizedSyncError` directly. The substring path-keyword heuristic is gone.

3. **Clear-before-throw decided + documented** — adapter.ts:1473 clears the map before throw; relies on rescan for retry. Captured in doc-041 §3.5 (CLOSED note) and `documents/architecture/sync/save-transactions.md §save-stage-asymmetries-intentional`.

4. **TASK-142 follow-up pinning tests updated** — `mass-storage-adapter.test.ts:2415` `save() aggregates per-file picture-write failures into PictureWriteError` and `:2454` `save() clears pendingPictureWrites before throw — rescan drives retry, not in-adapter` assert the new shape (settled-all proof + second-save no-refire proof).

Doc-041 line 515-516 explicitly names TASK-377's scope as closed: "Picture-write `Promise.all` → `runWithConcurrency` normalization + typed `PictureWriteError`~~ — closed by TASK-381".

## Follow-ups identified during closure (filed as TASK-413)

Reviewing the landed shape surfaced four cleanups not in scope here:
1. Flush-stage triplicate boilerplate → `flushPending<K,V>` helper.
2. Pending-map re-key duplication in `relocateTrack` / `replaceTrackFile` → `rekeyPendingWrites` helper.
3. Aggregate errors (`TagWriteError`/`PictureWriteError`/`SidecarWriteError`/`MoveError`) fold errno into message strings → carry per-cause errno so `ENOSPC` routes to `'space'` (no retry) instead of `'copy'` (1 wasted retry).
4. 220-line `save()` with five flush stages → split per-stage private methods for legibility.

Filed as TASK-413.
<!-- SECTION:FINAL_SUMMARY:END -->
