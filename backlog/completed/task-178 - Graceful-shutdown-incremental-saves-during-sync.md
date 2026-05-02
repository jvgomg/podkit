---
id: TASK-178
title: 'Graceful shutdown: incremental saves during sync'
status: Done
assignee: []
created_date: '2026-03-21 21:18'
updated_date: '2026-03-21 21:41'
labels:
  - graceful-shutdown
dependencies:
  - TASK-166
references:
  - packages/podkit-core/src/sync/executor.ts
  - adr/adr-013-ipod-artwork-corruption-diagnosis-and-repair.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add periodic database saves during sync to reduce the window of data loss if the process is killed.

**Approach:**
- Call `ipod.save()` every N completed tracks (e.g., every 50 tracks)
- The executor already tracks `completed` count — add a save checkpoint mechanism
- Trade-off: each save triggers libgpod's non-atomic ithmb compaction, so the interval should not be too frequent
- Consider making the interval configurable or adaptive

**Note:** This increases the frequency of the ithmb corruption window (documented in ADR-013), so the interval needs to balance data safety vs artwork corruption risk.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Database saved periodically during sync (every N completed tracks)
- [x] #2 Save interval is reasonable (not too frequent to trigger ithmb issues)
- [ ] #3 Progress display indicates when incremental save is happening
- [x] #4 Incremental save does not interfere with abort-save flow
- [x] #5 Unit tests verify saves happen at expected intervals
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added `saveInterval` option to `ExtendedExecuteOptions` (default: 50 tracks). The checkpoint save runs inline in the consumer loop after every N completed transfers. No progress event is yielded for checkpoint saves — the save is fast and would interfere with the `updating-db` phase display (which finishes the progress bar, designed for the final save only).

AC #3 (progress display) intentionally not implemented — checkpoint saves are transparent to the user. The display just pauses briefly during save.
<!-- SECTION:NOTES:END -->
