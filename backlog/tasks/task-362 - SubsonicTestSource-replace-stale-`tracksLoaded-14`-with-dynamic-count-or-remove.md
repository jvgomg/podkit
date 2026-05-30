---
id: TASK-362
title: >-
  SubsonicTestSource: replace stale `tracksLoaded = 14` with dynamic count (or
  remove)
status: To Do
assignee: []
created_date: '2026-05-30 15:00'
labels:
  - testing
  - e2e
  - tech-debt
dependencies: []
priority: low
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Surfaced by

TASK-359.01 first docker-e2e run failed `expect(json?.result?.completed).toBe(6)` with received: 54.

## Symptom

`SubsonicTestSource` (`test-packages/e2e-tests/src/sources/subsonic.ts:57,98`) declares `tracksLoaded = 14` as a literal in `setup()` after `cp`ing the full audio fixture tree into Navidrome. The literal is stale: the fixture tree has grown to ~70 audio files and Navidrome reports ~54 indexed tracks. The `trackCount` getter (`subsonic.ts:80`) exposes the value publicly, so any caller relying on it gets a wrong answer silently.

## Options

1. **Remove the field.** Grep shows no current readers outside the source file itself. Safe deletion.
2. **Compute dynamically.** Count audio files in `this.musicDir` after the `cp` completes (extension allowlist matching what Navidrome indexes). Useful if a test wants to assert against the source-of-truth count.
3. **Query Navidrome's API after scan.** Most accurate (matches Navidrome's codec filter), but requires waiting for the scan + an extra HTTP call.

If keeping the field, option 2 is the right call: the count callers care about is "what's in the library", not "what Navidrome chose to index". For relationship-invariant assertions (`trackCount === completed`) the current commit's approach already sidesteps this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `SubsonicTestSource.tracksLoaded` is either removed or computed dynamically from the music directory.
- [ ] #2 Any test using `source.trackCount` (none currently) gets a correct, current count.
- [ ] #3 `e2e-tests/src/sources/subsonic.ts` no longer contains the stale `// 14 audio files across 3 albums` comment.
<!-- AC:END -->
