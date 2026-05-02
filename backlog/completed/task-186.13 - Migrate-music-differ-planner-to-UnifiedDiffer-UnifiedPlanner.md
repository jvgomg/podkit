---
id: TASK-186.13
title: Migrate music differ/planner to UnifiedDiffer + UnifiedPlanner
status: Done
assignee: []
created_date: '2026-03-22 12:35'
updated_date: '2026-03-22 14:21'
labels:
  - refactor
  - architecture
dependencies:
  - TASK-186
references:
  - packages/podkit-core/src/sync/unified-differ.ts
  - packages/podkit-core/src/sync/content-type.ts
  - packages/podkit-core/src/sync/handlers/music-handler.ts
  - packages/podkit-core/src/sync/differ.ts
  - packages/podkit-core/src/sync/planner.ts
  - packages/podkit-cli/src/commands/sync.ts
parent_task_id: TASK-186
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Route music diffing and planning through the unified pipeline (`UnifiedDiffer` + `MusicHandler` and `UnifiedPlanner` + `MusicHandler`) instead of calling `computeDiff()` and `createPlan()` directly. This achieves full architectural consistency — all content types use the same pipeline.

## Background

TASK-186.11 analyzed this migration and deferred it because `computeDiff()` has 4 post-processing passes that don't fit the `UnifiedDiffer`'s single-pass model:

1. **Preset change detection** — iterates `existing` array to find tracks whose encoding preset changed
2. **Force transcode sweep** — marks all matched tracks for re-transcode when `forceTranscode` is set
3. **Sync tag writing** — detects tracks needing sync tag updates
4. **Force metadata rewrite** — marks all tracks for metadata update when `forceMetadata` is set

Additionally, `HandlerDiffOptions` is missing 7 of 12 options that `DiffOptions` accepts: `forceSyncTags`, `forceMetadata`, `encodingMode`, `bitrateTolerance`, `isAlacPreset`, `resolvedQuality`, `customBitrate`.

## What to do

1. **Extend `HandlerDiffOptions`** to include all music-specific options, or add a generic `handlerOptions` passthrough field.

2. **Add post-processing support to `UnifiedDiffer`** — either:
   - (a) Add an optional `postProcessDiff()` hook to `ContentTypeHandler` that receives the full diff and can mutate `toUpdate`/`existing`
   - (b) Move the post-processing into `MusicHandler.detectUpdates()` (but this is per-pair, not full-array)
   - (c) Accept that `UnifiedDiffer` needs a richer model for content types with batch-level analysis

3. **Handle transform apply/remove detection** — `computeDiff()` detects when transforms are newly applied or removed. This is absent from the unified path.

4. **Migrate `createPlan()` to `UnifiedPlanner`** — depends on the differ migration since the planner consumes the diff.

5. **Update dry-run display** — `buildMusicDryRunOutput()` uses the legacy diff format. Either update it for `UnifiedSyncDiff` or route through `MusicHandler.formatDryRun()`.

## Key risk

This is purely architectural consistency — `computeDiff()` and `createPlan()` work correctly today. The risk is introducing subtle behavioral differences in the music diff/plan that break edge cases (preset changes, force flags, sync tags, transform detection).

## Key files

- `packages/podkit-core/src/sync/unified-differ.ts` — extend for post-processing support
- `packages/podkit-core/src/sync/content-type.ts` — extend HandlerDiffOptions or add hooks
- `packages/podkit-core/src/sync/handlers/music-handler.ts` — implement full detectUpdates with all options
- `packages/podkit-cli/src/commands/sync.ts` — replace computeDiff/createPlan calls in syncMusicCollection

## Deferred from

- TASK-186.11 AC#1 (syncMusicCollection uses UnifiedDiffer)
- TASK-186.11 AC#2 (syncMusicCollection uses UnifiedPlanner)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 UnifiedDiffer supports post-processing passes (or equivalent hook) for content types that need batch-level analysis
- [x] #2 HandlerDiffOptions extended to support all music-specific diff options (forceSyncTags, forceMetadata, encodingMode, bitrateTolerance, isAlacPreset, resolvedQuality, customBitrate)
- [x] #3 syncMusicCollection() uses UnifiedDiffer + MusicHandler instead of computeDiff()
- [x] #4 syncMusicCollection() uses UnifiedPlanner + MusicHandler instead of createPlan()
- [x] #5 Transform apply/remove detection works through the unified path
- [x] #6 Dry-run output is identical to current output for music collections
- [x] #7 All existing differ and planner tests pass with identical results
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Related tasks

**TASK-186.14** (naming refactor) is related but not dependent on this task. The underlying functions (`computeDiff`, `createPlan`) will be renamed to `computeMusicDiff`/`createMusicPlan` in 186.14 regardless of whether this migration happens first. However, if 186.13 completes first, fewer CLI callsites need updating during the rename.

## Completed (2026-03-22)

- Added postProcessDiff() hook to ContentTypeHandler interface
- Added generic HandlerDiffOptions<THandlerOptions> with typed passthrough
- Added MatchInfo for transform detection in detectUpdates()
- Implemented MusicHandler.postProcessDiff() with all 4 passes
- Added transformSourceForAdd() for transform application on new tracks
- CLI syncMusicCollection() now uses UnifiedDiffer + UnifiedPlanner
- All E2E tests pass
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Music diff/plan now routes through UnifiedDiffer + UnifiedPlanner + MusicHandler in the CLI. Key infrastructure added:\n\n- `postProcessDiff()` hook on ContentTypeHandler for batch-level diff post-processing\n- Generic `HandlerDiffOptions<THandlerOptions>` for typed content-type-specific options\n- `MatchInfo` parameter on `detectUpdates()` for transform apply/remove detection\n- `transformSourceForAdd()` for applying transforms to new tracks\n- `collectPlanWarnings()` for handler-specific plan warnings\n- `planUpdate()` extended with `changes` parameter for metadata propagation\n\nAll 4 post-processing passes from `computeDiff()` ported to `MusicHandler.postProcessDiff()`. 7 behavioral differences found and fixed during E2E validation (format-upgrade suppression, upgrade presets, metadata population, artwork routing, transform application, lossy warnings, graceful shutdown).
<!-- SECTION:FINAL_SUMMARY:END -->
