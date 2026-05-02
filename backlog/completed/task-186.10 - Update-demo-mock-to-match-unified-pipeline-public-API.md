---
id: TASK-186.10
title: Update demo mock to match unified pipeline public API
status: Done
assignee: []
created_date: '2026-03-22 09:53'
updated_date: '2026-03-22 12:00'
labels:
  - refactor
  - demo
dependencies: []
references:
  - packages/demo/src/mock-core.ts
  - packages/demo/build.ts
  - packages/demo/demo.tape
  - packages/podkit-core/src/index.ts (authoritative export list)
  - agents/demo.md
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The demo mock at `packages/demo/src/mock-core.ts` still exports classes and factory functions that were removed from the `@podkit/core` public API during the unified pipeline migration. The demo mock simulates the core library for animated GIF recording (VHS tape) and must match the public API surface.

## What's stale in mock-core.ts

The following exports no longer exist in `@podkit/core`'s public API:

| Mock export | Line (approx) | Removed from core |
|---|---|---|
| `DefaultSyncDiffer` class | ~674 | Yes — replaced by `UnifiedDiffer` |
| `createDiffer()` | ~680 | Yes |
| `DefaultSyncPlanner` class | ~710 | Yes — replaced by `UnifiedPlanner` |
| `createPlanner()` | ~716 | Yes |
| `DefaultSyncExecutor` class | ~792 | Yes (now internal to `MusicHandler`) |
| `createExecutor()` | ~899 | Yes |
| `executePlan()` | ~903 | Yes |
| `DefaultVideoSyncDiffer` class | ~1007 | Yes — replaced by `UnifiedDiffer` |
| `createVideoDiffer()` | ~1013 | Yes |
| `DefaultVideoSyncPlanner` class | ~1055 | Yes — replaced by `UnifiedPlanner` |
| `createVideoPlanner()` | ~1061 | Yes |
| `DefaultVideoSyncExecutor` class | ~1086 | Yes (now internal to `VideoHandler`) |
| `createVideoExecutor()` | ~1183 | Yes |

## What to do

### 1. Check what the demo build actually uses

Read `packages/demo/build.ts` and `packages/demo/demo.tape` to understand which mock-core exports are actually referenced by the demo CLI. The mock simulates `@podkit/core` for the demo recording — only exports actually used by the demo CLI need mocked equivalents.

### 2. Remove unused mock classes

If the demo CLI doesn't import `DefaultSyncDiffer`, `createDiffer`, etc. (likely — it probably goes through higher-level functions), delete the mock implementations entirely.

### 3. Add mocks for new unified API if needed

If the demo CLI uses any of these new exports, add mock implementations:
- `createMusicHandler()` / `MusicHandler`
- `createVideoHandler()` / `VideoHandler`
- `createUnifiedDiffer()` / `UnifiedDiffer`
- `createUnifiedPlanner()` / `UnifiedPlanner`
- `createUnifiedExecutor()` / `UnifiedExecutor`

The mock implementations just need to return plausible fake data for the demo animation — they don't need real logic.

### 4. Keep backward-compat items that ARE still exported

These are still in the public API (with deprecation notes) and should stay in the mock:
- `getVideoOperationDisplayName()` — still exported, used by demo
- `VideoSyncPlan` type alias — still exported

## Testing

- Run `bun run build` to ensure demo package compiles
- Run the demo tape if possible (`cd packages/demo && bun run build`) to verify the animated GIF still generates correctly
- If demo build is broken by stale imports, fix them

## Context

The demo is documented in `agents/demo.md`. Read that file for build instructions and how the mock system works.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 mock-core.ts only exports classes/functions that exist in @podkit/core's public API (index.ts exports)
- [x] #2 Demo build succeeds (bun run build includes demo package)
- [x] #3 Mock implementations added for any new unified API exports used by the demo CLI
- [x] #4 Removed mock classes that no longer have public API equivalents
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Cleaned up demo mock:\n- Removed stale type re-exports (SyncDiffer, SyncPlanner, etc.)\n- Made internal classes private (DefaultSyncDiffer, etc. kept as internals, removed `export`)\n- Removed stale factory exports (createDiffer, createPlanner, createExecutor, etc.)\n- Added unified API mocks: MusicHandler, VideoHandler, UnifiedDiffer, UnifiedExecutor, UnifiedPlanner\n- Added missing exports: ejectWithRetry, stripPartitionSuffix, unified pipeline types\n- Build passes (all 8 packages)">
<!-- SECTION:NOTES:END -->
