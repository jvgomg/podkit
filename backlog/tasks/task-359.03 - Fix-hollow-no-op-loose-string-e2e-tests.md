---
id: TASK-359.03
title: Fix hollow / no-op / loose-string e2e tests
status: Done
assignee:
  - claude
created_date: '2026-05-28 21:27'
updated_date: '2026-05-30 17:35'
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
- [x] #1 preset-change force-sync-tags test either asserts real plan operations with the flag set, or is removed
- [x] #2 No-op `typeof === 'boolean'` assertion replaced with the expected value
- [x] #3 video-sync tests assert the categorisation/plan they describe, not just exit code
- [x] #4 Loose substring matches tied to the specific value/line they verify
- [x] #5 Full e2e suite still green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude): Worked through all 6 site classes. Pre-commit sonnet review caught 3 real issues that the first test run would also have caught — I addressed them before resubmitting:

1. **video-transforms.test.ts**: my speculative local type used `videosToAdd`/`videosToUpdate` field names, but the CLI emits `tracksToAdd`/`tracksToUpdate` (video-presenter.ts:298 shares the music sync naming). With my `?? 0` fallback, both assertions would have silently read undefined ?? 0 = 0 and passed regardless of CLI output — a new hollow assertion masquerading as a tight one. Switched to the shared `SyncOutput` import and correct field names.

2. **device.test.ts MA147 exact string**: I'd asserted `'iPod Video 60GB Black (5th Generation)'`. `device reset` reads `ipod.device.modelName` directly from libgpod's own model table, not podkit's `displayName` cascade. The actual libgpod string is `'Video (Black)'`. Backed off to `/Video/i` for the dummy MA147 sites.

3. **preset-change.test.ts force-sync-tags scenario**: my first design asserted `--force-sync-tags --dry-run` on an idempotent state produces 3 sync-tag-write ops. handler.ts:710 actually short-circuits via `syncTagsEqual(currentTag, expectedTag)` when tags already match — which they do after a clean initial sync. Restructured to sync without `--check-artwork` first (no art= hash in syncTag), then re-sync with `--force-sync-tags --check-artwork --dry-run` — the lossless branch at handler.ts:702-704 adds the artwork hash to the expected tag, syncTagsEqual returns false, and all 3 tracks emit sync-tag-write. This exercises the documented baseline-establishment behaviour at handler.ts:677.

Second e2e run surfaced a fourth issue I'd missed: line 252's `device add --path uninitDir` returns modelName `'Unknown iPod'` (no SysInfo to identify), not `'Video (Black)'`. Different init path. Replaced the regex with a typeof+length presence assertion, since the test's actual subject is 'initialization succeeded' not 'specific model'.

Final video-sync fixture choice: `passthroughVideos[0]` was COMPATIBLE_H264 (640x480 H.264 Main L3.1) which the dummy MA147 (iPod Video 5G, Baseline L1.3 ceiling) genuinely needs to transcode. Switched to LOW_QUALITY (320x240 Baseline L1.3) which is the one passthrough fixture that actually matches the dummy's capability ceiling. The `passthrough: true` flag in the Videos catalogue means 'compatible with newer iPods', not 'with any iPod' — worth a follow-up clarification but not in this task's scope.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Tightened 6 classes of hollow / no-op / loose-string e2e tests per the task spec. Each test now asserts its stated subject; tests that were structurally hollow (claiming to test X but only checking `exitCode === 0`) now exercise the right plan/operation data.

## Major changes

- **`subsonic-sync.docker.test.ts:217`**: `typeof available === 'boolean'` → `available === true` (the file is `.docker.test.ts`; the harness ensures Docker is available, so `false` would be the actual regression).
- **`workflows/fresh-sync.test.ts:49`**, **`commands/sync.test.ts:108`**: loose `toContain('3')` / `toContain('Tracks to add')` → `toMatch(/Tracks to add:\s*3/)`. Goldberg fixture has 3 tracks.
- **`features/video-transforms.test.ts:276`**: loose `toContain('update')` (matches "no updates") → switched dry-run to `--json`, asserts `plan.tracksToUpdate === 2`, `tracksToAdd === 0`. Uses the shared `SyncOutput` import (the video presenter emits `tracks*` field naming, not `videos*`).
- **`commands/device.test.ts`** (4 sites): `modelName.toBeDefined()`. `device reset` reads from libgpod's own model table (not podkit's `displayName` cascade), so the actual string is `'Video (Black)'` for MA147. Tightened the three `device init` / `device reset` sites to `/Video/i`. Tightened the `device add --path uninitDir` site to a typeof+length presence assertion, since that path defaults to `'Unknown iPod'` when there's no SysInfo to identify.
- **`features/preset-change.test.ts` — force-sync-tags**: the original test never passed `--force-sync-tags` and never inspected plan ops. Restructured to exercise the `postProcessSyncTags` baseline-establishment behaviour: initial sync without `--check-artwork` (writes sync tags with no art= hash) → `--force-sync-tags --check-artwork --dry-run` → handler.ts:702 adds `artworkHash` to the expected tag, `syncTagsEqual` returns false, and all 3 lossless tracks emit `sync-tag-write` ops. Asserts `tracksToUpdate === 3` and `updateBreakdown['sync-tag-write'] === 3`.
- **`commands/video-sync.test.ts`** (~6 hollow category tests): removed the local incorrect `VideoSyncOutput` interface, imported shared `SyncOutput`, and tightened to assert plan fields:
  - dry-run plan in JSON → `tracksToAdd === 1`
  - passthrough → `tracksToCopy === 1`, `tracksToTranscode === 0` (using LOW_QUALITY fixture which actually matches iPod Video 5G's Baseline L1.3 ceiling, not COMPATIBLE_H264 which needs transcode on 5G)
  - transcode → `tracksToTranscode === 1`, `tracksToCopy === 0`
  - movie → `videoSummary.movieCount === 1`, `showCount === 0`
  - tvshow → `videoSummary.showCount === 1`, `episodeCount === 1`

## Tests

- `bun run typecheck --filter @podkit/e2e-tests` ✓
- `bunx oxlint` on touched files ✓
- `bun run test:e2e` → 31 pass / 0 fail
- `bun run test:e2e:docker` → 4 pass / 0 fail

## Review process

Pre-commit sonnet review caught 3 real issues that the e2e run also caught: wrong field names in video-transforms (`videosToAdd` vs `tracksToAdd`), wrong MA147 string (libgpod returns `'Video (Black)'` not podkit `displayName`), and the force-sync-tags scenario (idempotent state hits `syncTagsEqual` guard → no ops). All addressed before commit. A fourth `device add` vs `device init` difference was caught in the e2e run itself (`'Unknown iPod'` vs `'Video (Black)'`).

## Surfaced (not fixed)

- The `Videos` catalogue's `passthrough: true` flag is per-fixture without target context. COMPATIBLE_H264 is "passthrough" for newer iPods (nano 7G, classic) but needs transcode on iPod Video 5G. Worth a clarification in the catalogue doc; out of scope for this task.
<!-- SECTION:FINAL_SUMMARY:END -->
