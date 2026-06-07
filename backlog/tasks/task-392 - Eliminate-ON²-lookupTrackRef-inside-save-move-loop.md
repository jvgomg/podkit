---
id: TASK-392
title: Eliminate O(N²) lookupTrackRef inside save() move loop
status: Done
assignee: []
created_date: '2026-06-06 12:13'
updated_date: '2026-06-06 14:07'
labels:
  - refactor
  - performance
  - mass-storage
  - save-transaction
dependencies: []
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
priority: low
ordinal: 108800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`MassStorageAdapter.save()` move stage (`mass-storage-adapter.ts:1310`-area) calls `this.lookupTrackRef(newPath)` once per ENOENT-vanished move inside the for loop. `lookupTrackRef` (~line 1512) walks the tracks array linearly to find the matching track ref for the warning aggregation.

Quadratic in `vanishedMoves.length × tracks.length`. Pathological on a large library where the user moved files externally between plan and save — the vanish warning batch itself is meant to be cheap.

Surfaced during the TASK-380 second-opinion review (2026-06-06).

## Why low priority

Hits only the ENOENT-on-rename code path. Most syncs never enter it. But the failure mode is "the worst case is bad" — if a user mass-moves a library between plan and save, this quietly burns CPU before emitting one warning.

## Scope

1. Build a `Map<filePath, TrackRef>` once at the top of `save()` (or memoize lazily on first vanish).
2. Replace the per-iteration `lookupTrackRef(newPath)` with the map lookup.
3. Microbenchmark or instrumented test pins linear cost on a 10k-track + 100-vanish batch.

## Trade-off

Tempting to fold this lookup into the track table proper as an always-on index. Don't — the only consumer is this loop, and the index lifetime is "one save() call". Memoize inline.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 save() builds the vanish-lookup map once (lazy on first ENOENT or eager at top of move stage)
- [x] #2 Per-iteration ref lookup is O(1)
- [x] #3 Existing tests still pass without modification
- [x] #4 Test exists pinning the cost shape (instrumented count of `lookupTrackRef` linear scans ≡ 0, or a 10k×100 batch microbenchmark)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Eliminated O(N²) `lookupTrackRef` calls in `MassStorageAdapter.save()`'s move stage. Lazy memoization: `trackRefByPath = new Map(this.tracks.map(...))` built on first ENOENT-vanish; subsequent vanishes use O(1) `.get()`. Map's `??` fallback preserved for paths not in the track list. No always-on index (per task trade-off — index lifetime is one save() call).

**Cost-shape test** (`mass-storage-adapter.test.ts:1356`): 10 tracks → 10 relocates → 10 ENOENT vanishes via `fs.unlinkSync` → save() emits one batched warning naming all 10. Lead-applied addition: spy on the private `lookupTrackRef` method asserts `lookupCalls === 0` after save() — proves the memoised path bypasses the legacy linear-scan entirely (a regression would re-fire the spy).

**Verification.** Typecheck 34/34 clean. Unit tests 2908 pass / 5 skip / 0 fail (was 2907 pre-392).
<!-- SECTION:FINAL_SUMMARY:END -->

## Implementation Summary

**Approach:** Option A — lazy memoization on first vanish.

Build the `Map<filePath, TrackRef>` only when the first ENOENT error occurs within the move-stage loop, avoiding unnecessary overhead for syncs that never hit the vanish code path (the common case). The map stores tuples of `[t.filePath, { artist, title, album }]` for all current tracks, and per-iteration lookups are O(1) map.get() instead of O(N) linear array scans.

**Test:** Added a test at line 1356 in mass-storage-adapter.test.ts that creates 10 tracks, queues all 10 for relocation, externally deletes the source files, and verifies:
- All 10 vanished tracks appear in the warning (set-based comparison for order-independence)
- No track metadata is lost (title/artist match expected values)
- Existing ENOENT tests remain unmodified and pass

**Test Results:**
- All 2913 unit tests pass (2908 pass, 5 skip, 0 fail)
- Typecheck clean
- No existing tests modified
