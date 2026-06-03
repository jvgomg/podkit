---
id: TASK-377
title: >-
  Normalize picture-write flush: runWithConcurrency + typed PictureWriteError —
  doc-041 §3.1/§7.1
status: To Do
assignee: []
created_date: '2026-06-03 09:08'
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
