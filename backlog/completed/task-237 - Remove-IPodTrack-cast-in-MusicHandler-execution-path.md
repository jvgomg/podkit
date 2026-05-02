---
id: TASK-237
title: Remove IPodTrack cast in MusicHandler execution path
status: Done
assignee: []
created_date: '2026-03-24 21:24'
updated_date: '2026-03-24 21:54'
labels:
  - refactor
  - tech-debt
milestone: m-14
dependencies:
  - TASK-224
references:
  - packages/podkit-core/src/sync/handlers/music-handler.ts
  - packages/podkit-core/src/sync/music-executor.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The MusicHandler's execution path in `music-handler.ts` casts `DeviceAdapter.getTracks()` results to `IPodTrack[]`, which is structurally unsafe when the adapter is a `MassStorageAdapter` returning `MassStorageTrack[]`.

**Location:** `packages/podkit-core/src/sync/handlers/music-handler.ts` around line 990

**Current code:**
```typescript
const tracks = ctx.device.getTracks() as IPodTrack[];
```

**Problem:** `MassStorageTrack` satisfies the `DeviceTrack` interface but is NOT an `IPodTrack`. The cast silently succeeds at compile time (structural typing), but downstream code that accesses iPod-specific properties on these tracks would get `undefined` at runtime. Currently this likely works by accident because the execution path only accesses `DeviceTrack`-compatible fields, but it's a time bomb.

**Fix:** Replace `IPodTrack` cast with `DeviceTrack` throughout the MusicHandler execution path. Specifically:

1. Find all `as IPodTrack` or `as IPodTrack[]` casts in `music-handler.ts`
2. Replace with `as DeviceTrack` or `as DeviceTrack[]` (or remove the cast entirely if the type is already correct)
3. Check if any code downstream of these casts accesses iPod-specific properties (e.g., `track.ipod_path`, `track.transferred`, etc.) — if so, those need to be guarded or moved behind the `DeviceTrack` interface
4. Update imports: add `DeviceTrack` from `../device/adapter.js`, remove `IPodTrack` if no longer used
5. Check `music-executor.ts` for the same pattern — the recent refactor changed `IpodDatabase` to `DeviceAdapter` but may have left `IPodTrack` casts in place

**Related context:** The MusicExecutor was recently refactored to accept `DeviceAdapter` instead of `IpodDatabase` (TASK-224). The handler execution path was updated to pass `ctx.device` directly. But the track type casts inside the handler weren't updated at the same time.

**Testing:** Run `bun run test --filter @podkit/core` — existing tests should continue to pass since `MassStorageTrack` satisfies `DeviceTrack`. If any tests mock `IPodTrack` specifically, they may need updating.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No IPodTrack casts remain in music-handler.ts execution path
- [x] #2 No IPodTrack casts remain in music-executor.ts
- [x] #3 All DeviceTrack-consuming code uses DeviceTrack or DeviceAdapter interface types only
- [x] #4 Existing tests pass without modification (or with minimal type-only updates)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Also check `packages/podkit-core/src/sync/handlers/video-handler.ts` line 738 — same `IPodTrack[]` cast pattern on `device.getTracks()`.

## Completed (2026-03-24)

All `as IPodTrack` casts removed from execution paths:
- `music-handler.ts`: class generic + all method signatures changed to DeviceTrack
- `video-handler.ts`: removed double-cast, renamed `ipodTrackToVideo` → `deviceTrackToVideo`
- `upgrades.ts`: all function signatures changed
- `types.ts` (SyncOperation): target/track fields changed to DeviceTrack
- Test mocks updated in music-handler.test.ts and video-handler-execute.test.ts
- Stale IPodTrack comments cleaned up in music-executor.ts

Planning code correctly left using IPodTrack where appropriate (SyncDiff, music-planner).
<!-- SECTION:NOTES:END -->
