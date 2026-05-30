---
id: TASK-362
title: >-
  SubsonicTestSource: replace stale `tracksLoaded = 14` with dynamic count (or
  remove)
status: Done
assignee:
  - claude
created_date: '2026-05-30 15:00'
updated_date: '2026-05-30 17:55'
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
- [x] #1 `SubsonicTestSource.tracksLoaded` is either removed or computed dynamically from the music directory.
- [x] #2 Any test using `source.trackCount` (none currently) gets a correct, current count.
- [x] #3 `e2e-tests/src/sources/subsonic.ts` no longer contains the stale `// 14 audio files across 3 albums` comment.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude): Removed the field entirely (option 1) rather than computing dynamically. Verified via grep there are no readers of `TestSource.trackCount`, `SubsonicTestSource.trackCount`, or `DirectoryTestSource.trackCount` anywhere in the codebase — every `trackCount` reference in the e2e tree belongs to iPod target objects (`target.getTrackCount()`), CLI JSON result structs (`verify.trackCount`, `result.trackCount`), or warning payloads (`lossyWarning?.trackCount`).

DirectoryTestSource had the same problem with a hardcoded `return 4` — also stale and dead. Removed both implementations + the interface field. Updated the subsonic `setup()` comment to explain that no count is surfaced because the inventory evolves and Navidrome codec-filters, so tests use relationship invariants (e.g. `iPod trackCount === json.result.completed`) instead.

Pre-commit sonnet review confirmed zero readers via grep variants (destructure, `as any`, structural typing), no docker-suite risk. Docker e2e passed 4/0 (1m24s).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Removed `TestSource.trackCount` from the shared interface and both implementations (`SubsonicTestSource`, `DirectoryTestSource`). Both held stale hardcoded literals (14 and 4 respectively); neither had any readers anywhere in the codebase.

## Why remove vs. compute dynamically

A dynamic implementation would be non-trivial (especially for Subsonic, where the post-scan count differs from the on-disk file count due to Navidrome's codec filtering) and still wouldn't match what callers actually want. Tests that need a count assert relationship invariants instead — e.g. `iPodTrackCount === json.result.completed` — which is strictly tighter and stays correct as fixtures evolve. Dead interface fields are liabilities: they invite future implementors to add another stale hardcoded literal.

## Changes

- `test-packages/e2e-shared/src/test-source.ts` — interface: removed `readonly trackCount: number`.
- `test-packages/e2e-tests/src/sources/subsonic.ts` — removed the `tracksLoaded` private field, the `trackCount` getter, the stale `tracksLoaded = 14` assignment in `setup()`, and the misleading "14 audio files across 3 albums" comment. Replaced with a comment explaining the relationship-invariant approach.
- `test-packages/e2e-tests/src/sources/directory.ts` — removed the `trackCount` getter that returned a hardcoded `4`.

## Tests

- `bun run typecheck --filter @podkit/e2e-tests` ✓
- `bunx oxlint` on touched files ✓
- `bun run test:e2e:docker` → 4 pass / 0 fail (verifies the subsonic source still works end-to-end).

## Pre-commit review

Sonnet confirmed zero readers via multiple grep patterns (`.trackCount`, destructure, `as any`, `'trackCount' in`) and no docker-suite risk.
<!-- SECTION:FINAL_SUMMARY:END -->
