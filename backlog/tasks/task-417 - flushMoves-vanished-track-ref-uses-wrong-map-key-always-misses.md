---
id: TASK-417
title: flushMoves vanished-track ref uses wrong map key (always misses)
status: To Do
assignee: []
created_date: '2026-06-09 10:02'
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
- [ ] #1 #1 `flushMoves()` uses `oldPath` (not `newPath`) when looking up the vanished track ref; warning emits real artist/title
- [ ] #2 #2 "skips move gracefully when source file is missing" test gains an assertion on the warning's track refs (no "Unknown Artist / Unknown Track" fallback for known tracks)
- [ ] #3 #3 No regression on existing relocate / move tests
<!-- AC:END -->
