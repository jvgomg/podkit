---
id: TASK-417
title: flushMoves vanished-track ref uses wrong map key (always misses)
status: Done
assignee: []
created_date: '2026-06-09 10:02'
updated_date: '2026-06-09 15:41'
labels:
  - bug
  - mass-storage
  - save-transaction
  - warning-sink
dependencies: []
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.test.ts
priority: low
ordinal: 132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`MassStorageAdapter.flushMoves()` (formerly the inline move loop in `save()`) accumulates ENOENT-skipped relocates into a `vanished` array. To build a track ref (artist/title/album) for each skipped move, it constructs `trackRefByPath` keyed by track `filePath`, then looks up `trackRefByPath.get(newPath)`.

But `pendingMoves` is `Map<oldPath, newPath>` — and `trackRefByPath` is `Map<filePath, ref>` where `filePath` is the track's CURRENT path. The current path at flush time is `oldPath` (the move hasn't fired yet). The lookup keys on `newPath`, which won't exist in the map.

Result: every ENOENT-vanished relocate falls through to the `{ artist: 'Unknown Artist', title: 'Unknown Track' }` sentinel. The warning emits "X track(s) skipped relocate" without the artist/title detail.

## Reproduction

A planned relocate where the source file vanishes between plan and save (external delete) — the resulting Warning's `tracks[]` entries always show "Unknown Artist / Unknown Track" instead of the real metadata.

Test coverage today: `relocateTrack()` "skips move gracefully when source file is missing" exercises the code path but does not assert the warning's track ref contents — which is why the bug went unnoticed.

## Scope

1. Fix the key lookup at `packages/podkit-core/src/device/mass-storage-adapter.ts` `flushMoves()`: use `oldPath` not `newPath`.
2. Strengthen the existing "skips move gracefully" test to assert the warning's track refs carry the real artist/title.
3. Confirm against `save() — WarningSink emit sites` test at `mass-storage-adapter.test.ts:1307` that the existing relocate-warning coverage exercises the fixed path.

## Provenance

Bug pre-dates TASK-416 (which extracted `flushMoves` from the old inline `save()` body) — caught by the TASK-416 mid-impl sonnet review as a pre-existing issue. Filed separately so the TASK-416 PR stays a pure structural refactor + ENOSPC routing.

## References

- `packages/podkit-core/src/device/mass-storage-adapter.ts` — `flushMoves()`
- `packages/podkit-core/src/device/mass-storage-adapter.test.ts:1112` ("skips move gracefully when source file is missing")
- `packages/podkit-core/src/device/mass-storage-adapter.test.ts:1307` ("save() — WarningSink emit sites")
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #2 "skips move gracefully when source file is missing" test gains an assertion on the warning's track refs (no "Unknown Artist / Unknown Track" fallback for known tracks)
- [x] #2 #3 No regression on existing relocate / move tests
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Outcome

Original AC#1 premise was wrong. Investigation found that `relocateTrack` synchronously updates `this.tracks[index]` to `withPath(finalPath)` before `flushMoves` runs, so the in-memory track's `filePath` already equals `newPath` at flush time. The lookup `trackRefByPath.get(newPath)` hits. The existing `save() — WarningSink emit sites` test already asserts the warning carries real artist/title/album and passes — proving no bug exists. AC#1 removed.

## What was done instead

Three real issues found nearby were addressed in a single refactor:

1. **Dead code**: `lookupTrackRef` private method never called by production. Deleted.
2. **Hollow test**: "memoizes track lookup to avoid O(N²) scans" spied on the dead method, giving false confidence. Replaced with "captured ref survives downstream mutation of the in-memory track" that pins snapshot semantics.
3. **Fragile design**: `pendingMoves: Map<oldPath, newPath>` required a flush-time lookup against mutable `this.tracks` — asymmetric with `replaceTrackFile`'s warning site which captures `track.artist/title/album` directly. Changed to `Map<oldPath, { newPath, trackRef }>`; ref captured eagerly at `relocateTrack` time. `flushMoves` ENOENT branch pushes `entry.trackRef` directly. Memo + sentinel fallback gone.

Also strengthened "skips move gracefully when source file is missing" test (AC#2) with the missing artist/title/album assertion. Updated `documents/architecture/sync/save-transactions.md` to note TASK-417 superseded the TASK-392 lazy-memo approach.

## Files touched

- `packages/podkit-core/src/device/mass-storage-adapter.ts` — pendingMoves type, relocateTrack capture, flushMoves simplified, lookupTrackRef deleted
- `packages/podkit-core/src/device/mass-storage-adapter.test.ts` — strengthened "skips move gracefully", new "captured ref survives mutation" test, reshaped N-track test
- `documents/architecture/sync/save-transactions.md` — note on supersession

Provenance: original bug report came from a sonnet mid-impl review during TASK-416 that misread the relocate/flush data flow. Subsequent investigation + user-directed refactor (worktree `task-417-capture-ref-at-plan`).
<!-- SECTION:FINAL_SUMMARY:END -->
