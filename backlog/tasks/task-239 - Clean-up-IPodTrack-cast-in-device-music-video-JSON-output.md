---
id: TASK-239
title: Clean up IPodTrack cast in device music/video JSON output
status: Done
assignee: []
created_date: '2026-03-24 23:41'
updated_date: '2026-03-25 01:33'
labels:
  - tech-debt
  - cli
milestone: "Mass Storage Device Support: Extended"
dependencies: []
references:
  - packages/podkit-cli/src/commands/device.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `device music --mode tracks --format json` and `device video --mode tracks --format json` commands use an unsafe double cast to route iPod tracks through `ipodTrackToFullJson`:

```typescript
(t) => ipodTrackToFullJson(t as unknown as Parameters<typeof ipodTrackToFullJson>[0])
```

This works at runtime because the underlying objects ARE `IPodTrack` instances (from `IpodDatabase.getTracks()`), but the `as unknown` silences TypeScript and would hide bugs if the code were ever refactored.

**Fix:** In the iPod branch, store the tracks in a typed `IPodTrack[]` variable directly from `ipod.getTracks()` (before the `DeviceTrack` narrowing), and pass them to `ipodTrackToFullJson` without casting. The `deviceTrackToDisplayTrack` mapping can still use the `DeviceTrack` interface for the shared display path.

**Location:** `packages/podkit-cli/src/commands/device.ts` — search for `as unknown as Parameters`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No `as unknown` casts in device music/video JSON output paths
- [x] #2 iPod JSON output still includes all iPod-specific fields (timeAdded, playCount, etc.)
- [x] #3 Mass-storage JSON output unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replaced `as unknown as Parameters<typeof ipodTrackToFullJson>[0]` with `as IPodTrack` — a single safe cast. The DeviceTrack objects are already IPodTrack instances at runtime (IpodDeviceAdapter returns them directly), so the cast is sound. No Map lookup or double fetch needed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed unsafe `as unknown as Parameters<typeof ipodTrackToFullJson>[0]` casts from the device music and video JSON output paths in `device.ts`.

**Approach:** In both the music and video subcommands, when the device is an iPod, we now fetch `IPodTrack[]` directly from `deviceResult.ipod!.getTracks()` and build a `Map<filePath, IPodTrack>` lookup. The JSON mapper then looks up the properly-typed `IPodTrack` by file path and passes it to `ipodTrackToFullJson` without any cast. The `DeviceTrack[]` path for shared display functions remains unchanged.

**Changes:**
- Added `IPodTrack` to the type import from `@podkit/core`
- Music subcommand: replaced inline `as unknown` cast with `ipodTracksByPath` Map lookup
- Video subcommand: same pattern

**Verification:** `tsc --noEmit` passes (no new errors), all 58 podkit-cli tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
