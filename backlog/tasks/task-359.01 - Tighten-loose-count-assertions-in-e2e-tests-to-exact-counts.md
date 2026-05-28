---
id: TASK-359.01
title: Tighten loose count assertions in e2e tests to exact counts
status: To Do
assignee: []
created_date: '2026-05-28 21:27'
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
- [ ] #1 Loose count assertions replaced with exact equality wherever the fixture count is deterministic
- [ ] #2 Where a range is genuinely justified (e.g. non-deterministic interrupt points), a comment explains why
- [ ] #3 Full e2e suite still green
<!-- AC:END -->
