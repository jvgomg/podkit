---
id: TASK-136.04
title: Unit and integration tests for self-healing sync
status: Done
assignee: []
created_date: '2026-03-14 13:57'
updated_date: '2026-03-14 15:23'
labels:
  - sync
  - testing
dependencies: []
references:
  - packages/podkit-core/src/sync/
  - packages/e2e-tests/
  - test/fixtures/audio/
parent_task_id: TASK-136
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Comprehensive test coverage for the self-healing sync feature.

**Unit tests (diff engine):**
- `isQualityUpgrade`: lossy→lossless, bitrate increase, cross-format lossy (not upgrade), same quality (not upgrade), edge cases (missing bitrate)
- `detectUpgrades`: each category detected correctly, multiple reasons on same track, no false positives on unchanged tracks
- `computeDiff` with upgrades: tracks route to `toUpdate` not `existing`, `skipUpgrades` suppresses file upgrades but allows metadata updates

**Integration tests (planner + executor):**
- Format upgrade: MP3 track on iPod, FLAC in source → upgrade operation created and executed
- Quality upgrade: 128kbps → 320kbps same format → upgrade
- Artwork added: track without artwork gets artwork
- Soundcheck update: metadata-only update, no file replacement
- Metadata correction: genre/year change, metadata-only update
- Preservation: verify play count, rating, and playlist membership survive a file upgrade
- skipUpgrades: file upgrades skipped, metadata updates still applied

**E2E tests:**
- Full sync cycle with upgrades using dummy iPod
- `--skip-upgrades` flag respected
- Dry-run output shows upgrade categories
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Unit tests cover all upgrade detection categories and edge cases
- [x] #2 Integration tests verify file swap preserves play counts, ratings, playlists
- [x] #3 Integration tests verify each upgrade category end-to-end
- [x] #4 E2E test covers a full sync-with-upgrades cycle
- [x] #5 skipUpgrades behavior tested at unit and integration level
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Test Coverage Added\n\n**Unit tests (upgrades.test.ts):** Contradictory lossless flag, artwork-added false positive prevention, skipUpgrades + transforms interaction.\n\n**Executor tests:** Upgrade-not-found error path (with and without continueOnError), metadata update identity fields excluded (title/artist/album not in update fields).\n\n**Differ tests:** 6 tests for `transcodingActive` — suppresses format-upgrade, doesn't suppress quality/metadata/soundcheck, undefined/false behavior.\n\n**E2E tests (upgrades.e2e.test.ts):** 3 tests using metadata-correction workflow — detects and applies genre changes, dry-run reporting, track count preservation across multiple sync cycles. Uses `metaflac` to modify fixtures in-place.
<!-- SECTION:NOTES:END -->
