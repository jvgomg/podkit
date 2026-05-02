---
id: TASK-186.17
title: Add tests for MusicHandler untested branches and UnifiedExecutor video phases
status: Done
assignee: []
created_date: '2026-03-22 12:57'
updated_date: '2026-03-22 20:33'
labels:
  - testing
dependencies: []
references:
  - packages/podkit-core/src/sync/handlers/music-handler.ts
  - packages/podkit-core/src/sync/handlers/music-handler.test.ts
  - packages/podkit-core/src/sync/unified-executor.ts
  - packages/podkit-core/src/sync/unified-executor.test.ts
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Several medium-priority test gaps exist across MusicHandler and UnifiedExecutor:

### MusicHandler gaps

1. **`detectUpdates` with `forceTranscode: true`** — this option prepends a `force-transcode` reason. Untested.
2. **`detectUpdates` with `transcodingActive: true`** — suppresses `format-upgrade` detection. Untested.
3. **`applyTransformKey`** — delegates to `getTransformMatchKeys` but never directly tested. Should verify it returns a transform-aware key.
4. **`getDeviceItems`** — filters iPod tracks by `isMusicMediaType`. Untested.
5. **`planAdd` with `customBitrate`** — the bitrate option flows through to transcode settings. Untested.

### UnifiedExecutor gaps

6. **Batch abort signal** — the `signal.aborted` check inside `executeBatch`'s loop (line ~309) is untested. Only the per-operation abort path has tests.
7. **Video operation phase mapping** — `getPhaseForOperation` maps `video-transcode` → `video-transcoding`, etc. These phases are never exercised in executor tests.

## What to test

### In `music-handler.test.ts`:
- `detectUpdates` with `forceTranscode: true` → returns array containing `force-transcode`
- `detectUpdates` with `transcodingActive: true` on a format-upgrade pair → suppresses upgrade
- `applyTransformKey` returns a key different from `generateMatchKey` when transforms apply
- `getDeviceItems` filters to music tracks only (exclude video media types)
- `planAdd` with `customBitrate` → operation settings reflect the bitrate

### In `unified-executor.test.ts`:
- Abort signal during batch execution stops yielding
- Video operation types yield correct phase strings (`video-transcoding`, `video-copying`, `video-removing`, `video-upgrading`, `video-updating-metadata`)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MusicHandler.detectUpdates tested with forceTranscode and transcodingActive options
- [x] #2 MusicHandler.applyTransformKey directly tested
- [x] #3 MusicHandler.getDeviceItems tested (filters by music media type)
- [x] #4 UnifiedExecutor batch abort signal path tested
- [x] #5 UnifiedExecutor video operation phase mapping tested
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Context update (2026-03-22)\n\nThe CLI now routes all content types through `genericSyncCollection()` + presenters. MusicHandler.executeBatch() is invoked via `MusicPresenter.executeSync()` which creates a `UnifiedExecutor` wrapping the handler.\n\nAll existing tests pass. The gaps listed in the description are still valid and untested."

## Completed (2026-03-22)

Added 21 tests across 2 files:

**music-handler.test.ts** (13 tests):
- detectUpdates with forceTranscode (4 tests) — lossless-only, not lossy, not when upgrade exists, prepend order
- detectUpdates with transcodingActive (2 tests) — suppresses for AAC device, preserves for MP3 device (corrected from agent output to match current code's AAC-only check)
- applyTransformKey (2 tests) — consistent with generateMatchKey when no transforms
- getDeviceItems (3 tests) — filters by music media type
- planAdd with customBitrate (2 tests) — bitrateOverride flows through

**unified-executor.test.ts** (8 tests):
- batch abort signal (1 test) — stops batch when signal aborted mid-execution
- video operation phase mapping (7 tests) — all 5 video types + combined plan

### Review fix
The agent wrote transcodingActive tests against the committed code which unconditionally suppresses format-upgrade. The uncommitted working directory code has an AAC-only check (only suppresses when `getIpodFormatFamily(device) === 'aac'`). Fixed tests to match current code: AAC device → suppressed, MP3 device → preserved.
<!-- SECTION:NOTES:END -->
