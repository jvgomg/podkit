---
id: TASK-136.01
title: Verify copyTrackToDevice on existing tracks in libgpod
status: Done
assignee: []
created_date: '2026-03-14 13:56'
updated_date: '2026-03-14 15:22'
labels:
  - sync
  - libgpod
dependencies: []
references:
  - adr/adr-009-self-healing-sync.md
  - packages/libgpod-node/native/src/track_operations.cc
  - packages/libgpod-node/src/__tests__/copy-track-twice.integration.test.ts
parent_task_id: TASK-136
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Before implementing in-place file upgrades, verify whether libgpod's `itdb_cp_track_to_ipod()` can be called on a track that already has a file on the iPod.

Write an integration test that:
1. Creates a test iPod, adds a track with a file
2. Calls `copyTrackToDevice()` again with a different source file
3. Verifies the new file is on the iPod and the old one is cleaned up (or still present)
4. Checks that the track's `ipodPath` is updated

If libgpod rejects this, implement a fallback: manually copy the file to `iPod_Control/Music/` and update the `ipodPath` in the native track struct. Document the finding in the ADR.

This is a blocker for all file-replacement upgrade work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Integration test confirms whether copyTrackToDevice works on tracks with existing files
- [ ] #2 If it doesn't work, a fallback mechanism is implemented and tested
- [x] #3 ADR-009 updated with the finding
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Implementation\n\n`copyTrackToDevice()` is a silent no-op when `track->transferred` is TRUE. Implemented `Database.replaceTrackFile(handle, newFilePath)` which resets `transferred` to FALSE, calls `itdb_cp_track_to_ipod()` (which reuses existing `ipodPath` and overwrites the file in place), then updates `track->size`.\n\nDocumented as behavioral deviation #5 in:\n- `packages/libgpod-node/README.md`\n- `docs/developers/libgpod.md`\n- `AGENTS.md`\n\n9 integration tests added (including error paths from code review). Fallback mechanism (AC #2) was not needed — the transferred flag reset approach works cleanly.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Finding: copyTrackToDevice() on already-transferred tracks is a silent no-op

### Root cause (libgpod source, `itdb_itunesdb.c` line 7578)

```c
if(track->transferred)  return TRUE; /* nothing to do */
```

When `track->transferred` is TRUE, `itdb_cp_track_to_ipod()` returns TRUE immediately without copying any file. The second call succeeds but does nothing.

### Additional finding: ipod_path reuse behavior

If `track->transferred` were reset to FALSE while `track->ipod_path` remains set, libgpod would reuse the existing `ipod_path` and **overwrite** the file in-place (line 7294-7298, 7559). This could be a viable mechanism for file replacement if we expose a way to reset the transferred flag.

### Workaround tested: duplicate-and-swap

The test confirms a working pattern:
1. `duplicateTrack()` to create a new track with identical metadata
2. Manually copy over user data (rating, playCount) via `updateTrack()`
3. `copyTrackToDevice()` on the duplicate with the new file
4. `removeTrack()` the original

**Limitation:** This creates a new database entry (new dbid), which means playlist membership must be manually transferred. It does preserve metadata including play counts and ratings if explicitly copied.

### Implications for ADR-009 self-healing sync

Three viable approaches for file replacement:
1. **Reset transferred flag** - Add native support to set `track->transferred = FALSE`, then call `copyTrackToDevice()` again. The existing ipod_path is reused and the file is overwritten in-place. This is the cleanest approach.
2. **Manual file copy** - Copy the file directly to the iPod filesystem, bypassing `copyTrackToDevice()` entirely. Update `track->size` manually.
3. **Duplicate-and-swap** - As tested above. Works but requires playlist membership migration.

Approach #1 is recommended as it requires minimal code (just expose `transferred` in `updateTrack`) and leverages libgpod's existing overwrite behavior.

### Test file

`packages/libgpod-node/src/__tests__/copy-track-twice.integration.test.ts` - 2 tests, both passing.
<!-- SECTION:FINAL_SUMMARY:END -->
