---
id: TASK-136.06
title: Add upgrade operation to sync planner and executor
status: Done
assignee: []
created_date: '2026-03-14 13:57'
updated_date: '2026-03-14 15:23'
labels:
  - sync
  - core
dependencies:
  - TASK-136.01
references:
  - packages/podkit-core/src/sync/planner.ts
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/sync/types.ts
parent_task_id: TASK-136
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the sync planner and executor to handle upgrade operations.

**Planner (`planner.ts`):**
- Map `toUpdate` entries with file-replacement reasons (format-upgrade, quality-upgrade, artwork-added) to a new `upgrade` operation type
- Map metadata-only reasons (soundcheck-update, metadata-correction) to `update-metadata` (already exists)
- The `upgrade` operation includes source track, target iPod track, reason, and transcode preset (if needed)
- Include upgrade operations in size/time estimates

**Executor (`executor.ts`):**
- Handle `upgrade` operations: transcode/copy the new source file, then swap it onto the existing iPod track (using the mechanism verified in TASK-136.01)
- After file swap, update technical metadata (bitrate, size, duration, sampleRate, fileType) via `updateTrack()`
- Update artwork if available
- Preserve: play counts, ratings, skip counts, time added, playlist membership (these stay because the database entry is unchanged)
- Include upgrade results in ExecuteResult stats
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Planner maps file-replacement upgrades to upgrade operations with correct transcode presets
- [x] #2 Planner maps metadata-only upgrades to update-metadata operations
- [x] #3 Executor swaps files on existing tracks without removing the database entry
- [x] #4 Play counts, star ratings, and playlist membership are preserved after upgrade
- [x] #5 Upgrade operations included in size/time estimates and ExecuteResult stats
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Implementation\n\n**Planner:** Extended `planUpdateOperations` to route file-replacement upgrades to `upgrade` operations with correct transcode/copy preset decisions. Metadata-only upgrades (soundcheck, metadata-correction) create `update-metadata` operations. Upgrade operations included in size/time estimates and plan summary.\n\n**Executor:** Added `prepareUpgrade` (delegates to existing `prepareTranscode`/`prepareCopy` to avoid duplication) and `transferUpgradeToIpod` which calls `replaceTrackFile` then updates technical metadata. Play counts, ratings, playlists preserved because database entry is unchanged.\n\n**IpodDatabase:** Added `replaceTrackFile()` wrapper method.\n\n**CLI:** Added upgrade to output types, JSON output, and reason formatting.\n\nRetry budget correctly uses `transcodeRetries` for transcode-based upgrades, `copyRetries` for copy-based. 17 tests (11 planner + 6 executor).
<!-- SECTION:NOTES:END -->
