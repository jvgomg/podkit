---
id: TASK-186.11
title: Migrate music diff/plan to UnifiedDiffer + UnifiedPlanner
status: Done
assignee: []
created_date: '2026-03-22 09:54'
updated_date: '2026-03-22 12:36'
labels:
  - refactor
dependencies: []
references:
  - >-
    packages/podkit-cli/src/commands/sync.ts (syncMusicCollection ~line 726,
    761)
  - packages/podkit-core/src/sync/unified-differ.ts
  - packages/podkit-core/src/sync/unified-planner.ts
  - packages/podkit-core/src/sync/handlers/music-handler.ts
  - packages/podkit-core/src/sync/differ.ts (computeDiff)
  - packages/podkit-core/src/sync/planner.ts (createPlan)
parent_task_id: TASK-186
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The music sync pipeline is partially unified: execution now goes through `MusicHandler` + `UnifiedExecutor`, but diffing and planning still use the legacy standalone functions (`computeDiff()` and `createPlan()`) directly in the CLI.

This means the music path is:
```
computeDiff() → createPlan() → MusicHandler + UnifiedExecutor
```

While video is fully unified:
```
UnifiedDiffer + VideoHandler → planVideoSync() → VideoHandler + UnifiedExecutor
```

Ideally both would be:
```
UnifiedDiffer + Handler → UnifiedPlanner + Handler → UnifiedExecutor + Handler
```

## Current state

In `packages/podkit-cli/src/commands/sync.ts`, `syncMusicCollection()`:
- **Line ~726**: Uses `core.computeDiff(collectionTracks, ipodTracks, { ... })` — legacy differ
- **Line ~761**: Uses `core.createPlan(diff, { ... })` — legacy planner
- **Line ~856**: Uses `MusicHandler` + `UnifiedExecutor` — already unified ✓

The legacy `computeDiff()` and `createPlan()` functions are NOT deprecated — they're the real implementation that `MusicHandler.detectUpdates()` and `MusicHandler.planAdd()` already delegate to. So this migration is about routing through the generic pipeline, not changing behavior.

## What to do

### 1. Replace computeDiff() with UnifiedDiffer + MusicHandler

```typescript
// Before:
const diff = core.computeDiff(collectionTracks, ipodTracks, { transforms, skipUpgrades, ... });

// After:
const handler = core.createMusicHandler({ transforms });
const differ = core.createUnifiedDiffer(handler);
const diff = differ.diff(collectionTracks, ipodTracks, {
  skipUpgrades,
  forceTranscode,
  transcodingActive: true,
  presetBitrate: core.getPresetBitrate(effectiveQuality),
  transformsEnabled: effectiveTransforms.cleanArtists.enabled,
});
```

The `UnifiedSyncDiff` format differs from the legacy `SyncDiff`:
- Legacy: `{ toAdd, toRemove, existing, toUpdate }` where toUpdate has `{ source, ipod, reason, changes }`
- Unified: `{ toAdd, toRemove, existing, toUpdate }` where toUpdate has `{ source, device, reasons[] }`

The dry-run display logic and plan creation use the legacy diff format. Either:
- (a) Convert unified diff back to legacy format (bridge approach, like video's `convertToVideoSyncDiff`)
- (b) Update the dry-run display and plan creation to accept unified format

Option (a) is safer and matches the video pattern.

### 2. Replace createPlan() with UnifiedPlanner + MusicHandler

This is optional if option (a) above is used — the legacy `createPlan()` can still accept the converted diff. But for full unification, use `UnifiedPlanner`:

```typescript
const planner = core.createUnifiedPlanner(handler);
const plan = planner.plan(diff, { removeOrphans, qualityPreset, deviceSupportsAlac });
```

### 3. Update dry-run display

The `buildMusicDryRunOutput()` function uses the legacy diff format extensively. If switching to unified diff, this function needs updating to read `reasons[]` instead of single `reason`, and `device` instead of `ipod`.

### 4. Verify existing options flow through

The legacy `computeDiff()` accepts many options (`forceSyncTags`, `forceMetadata`, `encodingMode`, `bitrateTolerance`, `isAlacPreset`, `resolvedQuality`, `customBitrate`). Verify that all these options either:
- Flow through `HandlerDiffOptions` to `MusicHandler.detectUpdates()`
- Or are handled by `UnifiedDiffer` directly

Some of these options (like `forceSyncTags`, `encodingMode`) may not have equivalents in the handler interface and would need to be added.

## Risk

This is a low-risk refactor since the underlying functions are the same — `MusicHandler` delegates to the same logic. The main risk is in the diff format conversion and ensuring all the music-specific diff options are preserved.

## Why this is low priority

The current state works correctly. `computeDiff()` and `createPlan()` are not deprecated and produce correct results. This task is about architectural consistency, not fixing a bug or adding a feature. It can be done opportunistically when working in this area.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ~Deferred~ syncMusicCollection() uses UnifiedDiffer — gap too large, computeDiff() has 4 post-processing passes not supported by UnifiedDiffer. Follow-up: TASK-186.13.
- [x] #2 ~Deferred~ syncMusicCollection() uses UnifiedPlanner — depends on differ migration. Follow-up: TASK-186.13.
- [x] #3 ~N/A~ Music sync options still work — no changes made, legacy path unchanged.
- [x] #4 ~N/A~ Dry-run output unchanged — no changes made.
- [x] #5 ~N/A~ Tests pass — no changes made.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Migration Deferred (2026-03-22)\n\nAfter analysis, the music diff path cannot be safely migrated to UnifiedDiffer + MusicHandler without substantial changes:\n\n1. `computeDiff()` has 4 post-processing passes (preset detection, force transcode, sync tag writing, force metadata) that iterate over the full `existing` array\n2. `HandlerDiffOptions` is missing 7 of 12 options that `DiffOptions` accepts\n3. Transform apply/remove detection is absent from the unified path\n4. No bridge approach provides value over the current working code\n\nThe music differ works correctly as-is. Follow-up: TASK-186.13.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Deferred: migration not feasible without substantial architectural changes

After thorough code analysis, determined that the `UnifiedDiffer + MusicHandler` pipeline cannot replicate `computeDiff()` behavior. The legacy music differ has four post-processing passes (preset change detection, force transcode sweep, sync tag writing, force metadata rewrite) that operate over the full `existing` array — a pattern the `UnifiedDiffer` doesn't support.

Additionally, `HandlerDiffOptions` is missing 7 of the 12 options that `DiffOptions` accepts (`forceSyncTags`, `forceMetadata`, `encodingMode`, `bitrateTolerance`, `isAlacPreset`, `resolvedQuality`, `customBitrate`), and transform apply/remove detection is not handled.

**No code changes made.** The current music pipeline (`computeDiff → createPlan → MusicHandler + UnifiedExecutor`) works correctly. Full unification would require rearchitecting the `UnifiedDiffer` to support post-processing passes, which is not justified for this low-priority consistency task.
<!-- SECTION:FINAL_SUMMARY:END -->
