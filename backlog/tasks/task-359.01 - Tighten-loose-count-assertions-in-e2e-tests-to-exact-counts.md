---
id: TASK-359.01
title: Tighten loose count assertions in e2e tests to exact counts
status: Done
assignee:
  - claude
created_date: '2026-05-28 21:27'
updated_date: '2026-05-30 14:51'
labels:
  - testing
  - e2e
  - test-quality
dependencies: []
references:
  - test-packages/e2e-tests/src/features/artwork-sync-tags.test.ts
  - test-packages/e2e-tests/src/workflows/subsonic-sync.docker.test.ts
parent_task_id: TASK-359
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Many e2e tests assert track/operation counts with `toBeGreaterThanOrEqual(N)` or `toBeGreaterThan(0)` where the fixture count is fixed and knowable. A regression that over-syncs (phantom/duplicate tracks), under-detects (partial artwork/metadata detection), or drifts off by one passes silently. Replace with exact equality wherever the count is deterministic.

Sites (non-exhaustive):
- `features/artwork-change.docker.test.ts` — 288, 399-404, 508, 598 (goldberg=3, dual-tone=1)
- `features/artwork-sync-tags.test.ts` — 198, 203, 278, 283, 340, 345, 454, 459 (3-track collection)
- `workflows/subsonic-sync.docker.test.ts` — 82, 86, 91, 152, 154, 184 (6 FLACs)
- `commands/collection.test.ts` — 49, 94
- `features/transforms.test.ts` — 406-407, 487-488, 733
- `features/compilation.test.ts` — 259
- `features/mass-storage-sync.test.ts` — 1098 (orphan is exactly 2048 bytes)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Loose count assertions replaced with exact equality wherever the fixture count is deterministic
- [x] #2 Where a range is genuinely justified (e.g. non-deterministic interrupt points), a comment explains why
- [x] #3 Full e2e suite still green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude): Audited all 7 cited sites. Tightened the deterministic ones: artwork-change.docker (goldberg=3, dual-tone-related breakdowns=1 or 3), artwork-sync-tags (3-track collection or 1-track dual-tone), transforms (2 of 3 tracks transform-apply/-remove — Solo Artist no-op), compilation (1 track COMPILATION tag change), mass-storage-sync orphan (wastedBytes === 2048). Left the upstream-owned counts loose with justifying comments: collection.test.ts (audio + video fixture inventory evolves), subsonic-sync.docker (Navidrome serves the full @podkit/test-fixtures audio tree which has grown beyond the original 6 FLACs and Navidrome additionally filters by codec/metadata). For subsonic-sync.docker I switched the loose >= asserts to **relationship invariants** that stay precise as fixtures evolve: `trackCount === json.result.completed` (every Subsonic-served track survived sync onto the iPod) and `tracksToTranscode <= tracksToAdd` (subset relationship). For artwork-change.docker's third test (dual-tone artwork-added), `completed === 1` was wrong — the suite shares one Navidrome musicDir across its tests so goldberg fixtures are still served alongside the new dual-tone; reverted to >= 1 with a comment. The breakdown assertion is still exact (`artwork-added === 1`) because only dual-tone changed between syncs.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Replaced loose `toBeGreaterThanOrEqual` / `toBeGreaterThan(0)` count assertions with exact equality wherever the count is deterministic from the test's own fixture, and switched the remaining inventory-driven assertions to **relationship invariants** (e.g. iPod track count equals Subsonic-served count) so they catch regressions without breaking when the upstream fixture set grows.

## Tightened to exact counts

- `features/artwork-change.docker.test.ts`: goldberg-selections initial syncs → `=== 3`; artwork-updated/-removed breakdowns → `=== 3`; dual-tone artwork-added breakdown → `=== 1`.
- `features/artwork-sync-tags.test.ts`: 3-track collection assertions → `=== 3`; 1-track dual-tone → `=== 1`.
- `features/transforms.test.ts`: transform-apply / transform-remove updates → `=== 2` (2 of 3 fixture tracks have feat. patterns; Solo Artist no-op).
- `features/compilation.test.ts`: single-track COMPILATION tag change → `=== 1`.
- `features/mass-storage-sync.test.ts`: orphan `wastedBytes` → `=== 2048`.

## Loose-with-justification (AC#2)

- `commands/collection.test.ts` (audio + video fixtures): inventory owned by `@podkit/test-fixtures` and grows over time; comment explains the structural intent (command surfaces tracks, not an exact count).
- `workflows/subsonic-sync.docker.test.ts`: Navidrome scans the full audio fixture tree and codec-filters; absolute count varies. Switched to relationship invariants (`trackCount === completed`, `tracksToTranscode <= tracksToAdd`) plus `>0` guards. Tighter than the original `>= 6` and survives fixture growth.
- `features/artwork-change.docker.test.ts:565`: the dual-tone `completed` count includes goldberg (suite shares musicDir across tests); the test subject is the artwork-added breakdown which is still asserted exactly.

## Tests

- `bun run typecheck --filter @podkit/e2e-tests` ✓
- `bunx oxlint` on all touched files ✓
- `bun run test:e2e` → 31 pass / 0 fail (553s)
- `bun run test:e2e:docker` → 4 pass / 0 fail (80s)

## What over-tightening exposed

First docker run failed three asserts (`completed === 6` got 54; `completed === 1` got 4). The original `>= 6` was hiding two things: (1) the SubsonicTestSource still declares `tracksLoaded = 14` even though the real fixture tree is much larger now, and (2) artwork-change.docker tests share a single Navidrome library so per-test "fresh" counts aren't really fresh. Both noted; the second is genuine fixture sharing (not a bug in this task's scope) and the first is dead code (`tracksLoaded` has no readers).
<!-- SECTION:FINAL_SUMMARY:END -->
