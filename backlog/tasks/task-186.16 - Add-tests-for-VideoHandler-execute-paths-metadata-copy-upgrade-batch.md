---
id: TASK-186.16
title: 'Add tests for VideoHandler execute paths (metadata, copy-upgrade, batch)'
status: Done
assignee: []
created_date: '2026-03-22 12:57'
updated_date: '2026-03-22 20:35'
labels:
  - testing
dependencies: []
references:
  - packages/podkit-core/src/sync/handlers/video-handler.ts
  - packages/podkit-core/src/sync/handlers/video-handler-execute.test.ts
parent_task_id: TASK-186
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Several `VideoHandler` execution methods have zero or partial test coverage:

1. **`executeUpdateMetadata`** — zero tests. Has three distinct branches: tvshow metadata, movie metadata, and seriesTitle-only updates. Each branch calls different iPod database methods.

2. **`executeUpgrade` copy path** — only the transcode variant is tested. When `op.settings` is undefined, the upgrade uses a copy instead of transcode. This path is untested.

3. **`executeBatch`** — the shared temp directory lifecycle (create before first transcode, cleanup in `finally`) and `hasTranscodes` detection are untested.

4. **`setVideoQuality` + sync tag writing** — when `this.videoQuality` is set, `executeTranscode` writes sync tags after transcoding. This path is untested.

## What to test

Add to `packages/podkit-core/src/sync/handlers/video-handler-execute.test.ts`:

### executeUpdateMetadata
- TV show metadata update: verify `ipod.setTrackInfo` called with updated season/episode/year
- Movie metadata update: verify title/year updated
- Series title transform: verify `seriesTitle` applied without other metadata changes
- Error handling: track not found on device

### executeUpgrade (copy path)
- Upgrade without settings → copies file instead of transcoding
- Verify old track removed, new track added, no `transcodeVideo` call

### executeBatch
- Creates temp directory when plan has transcodes
- Cleans up temp directory in `finally` (even on error)
- Skips temp directory when no transcodes needed
- Passes temp directory to individual execute calls

### setVideoQuality
- When set, sync tags are written after transcode
- When not set, no sync tag writing
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 executeUpdateMetadata tested for tvshow, movie, and seriesTitle-only branches
- [x] #2 executeUpgrade copy path (no settings) tested
- [x] #3 executeBatch temp directory lifecycle tested (create, cleanup, skip when no transcodes)
- [x] #4 setVideoQuality sync tag writing path tested
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Context update (2026-03-22)\n\nVideoHandler was significantly enhanced during the Phase 3 CLI unification work. New methods that also need test coverage:\n\n- `postProcessDiff()` — preset-change detection (sync tag + bitrate comparison) and force-metadata sweep. Two passes over `diff.existing` array.\n- `setVideoTransformsConfig()` — stores transforms config on handler instance\n- `applyTransformKey()` — now uses `getVideoTransformMatchKeys` for transform-aware key generation (was a no-op before)\n- `transformSourceForAdd()` — returns `CollectionVideo` with transformed series title for TV shows\n- `getTransformedSeriesTitle()` — private helper, returns transformed series title string\n- `detectUpdates()` — now handles transform-apply/transform-remove scenarios in addition to metadata-correction\n- `planUpdate()` — now handles transform-apply, transform-remove, force-metadata, metadata-correction reasons\n- `planAdd()` — now passes transformedSeriesTitle when transforms are active\n\nConsider adding tests for these new diff/plan methods alongside the execute path tests listed in the original description. The diff/plan methods are critical for correctness when routing video through the unified pipeline."

## Completed (2026-03-22)

Added 26 new tests across 2 files:

**video-handler-execute.test.ts** (12 tests):
- executeUpdateMetadata (6): tvshow metadata, movie director, movie studio fallback, newSeriesTitle override, newSeriesTitle-only branch, track not found error
- executeUpgrade copy path (1): no settings → copy path, old track removed, no transcodeVideo call
- executeBatch (3): temp dir creation/cleanup for transcodes, skip when no transcodes, cleanup on error
- setVideoQuality sync tag writing (3): writes tag when set, no tag when unset, correct quality value

**video-handler.test.ts** (14 tests):
- planUpdate additional branches (4): force-metadata, preset-downgrade, transform-apply, transform-remove
- postProcessDiff preset detection (4): bitrate mismatch, bitrate match, sync tag mismatch, sync tag match
- postProcessDiff force-metadata (2): moves all to toUpdate, sets newSeriesTitle on tvshow
- detectUpdates metadata correction (3): year mismatch, key-based matching, no year match

All acceptance criteria met. 1945 tests pass.
<!-- SECTION:NOTES:END -->
