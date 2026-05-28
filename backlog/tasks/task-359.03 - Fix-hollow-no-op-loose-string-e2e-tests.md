---
id: TASK-359.03
title: Fix hollow / no-op / loose-string e2e tests
status: To Do
assignee: []
created_date: '2026-05-28 21:27'
labels:
  - testing
  - e2e
  - test-quality
dependencies: []
references:
  - test-packages/e2e-tests/src/features/preset-change.test.ts
  - test-packages/e2e-tests/src/commands/video-sync.test.ts
parent_task_id: TASK-359
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Some e2e tests assert nothing about the behaviour their title claims, or use matches so loose they can't fail meaningfully. Make each assert its actual subject.

Sites:
- `features/preset-change.test.ts:304-335` — test "`--force-sync-tags` writes tags as plan operations" never passes `--force-sync-tags` and never inspects plan operations; the "clear comments to simulate pre-sync-tag tracks" step is never done. Either implement the real assertion or delete the test.
- `workflows/subsonic-sync.docker.test.ts:204` — `expect(typeof available).toBe('boolean')` asserts the function returns *a* boolean, not the correct value. Assert the expected value.
- `commands/video-sync.test.ts:176-367` — ~a dozen tests assert only `exitCode === 0` and never inspect the categorisation/plan they claim to test ("identifies passthrough", "needs transcode", "categorizes movie/TV"). Assert the JSON plan/category.
- `features/video-transforms.test.ts:276` — `toContain('update')` also matches "no updates"; tie it to the actual operation.
- `workflows/fresh-sync.test.ts:49` — `toContain('3')` matches any 3 in output; assert the track-count line specifically. (`commands/sync.test.ts:108` similar.)
- `commands/device.test.ts` (249, 348, 626, 971) — `modelName/mountPoint).toBeDefined()` on a dummy target with a known model; assert the known value.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 preset-change force-sync-tags test either asserts real plan operations with the flag set, or is removed
- [ ] #2 No-op `typeof === 'boolean'` assertion replaced with the expected value
- [ ] #3 video-sync tests assert the categorisation/plan they describe, not just exit code
- [ ] #4 Loose substring matches tied to the specific value/line they verify
- [ ] #5 Full e2e suite still green
<!-- AC:END -->
