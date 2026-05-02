---
id: TASK-240
title: Extract openDevice() primitive and add config validation for device type
status: Done
assignee: []
created_date: '2026-03-24 23:48'
updated_date: '2026-03-25 00:59'
labels:
  - refactor
  - cli
milestone: 'Mass Storage Device Support: Extended'
dependencies:
  - TASK-234
references:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/device.ts
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-core/src/device/presets.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two related cleanups to the device resolution layer:

**1. Extract `openDevice()` function**

The same if/else pattern (check device type → resolve capabilities → open correct adapter) is repeated 4 times across sync.ts and device.ts (info, music, video). Extract into a single function:

```typescript
async function openDevice(
  path: string,
  deviceConfig?: DeviceConfig
): Promise<DeviceAdapter>
```

This encapsulates: type check → capability resolution (preset + overrides) → open correct adapter. Every command calls this instead of branching. `DeviceAdapter` is the return type — callers don't need to know which implementation they got.

For iPod-specific operations (validation, generation info), the existing `IpodDeviceAdapter.getIpodDatabase()` escape hatch is available.

**2. Validate capability overrides match device type**

Currently, capability overrides on iPod devices are silently stored but never applied. The loader should validate and reject invalid combinations:

- iPod devices (`type` undefined or `'ipod'`): reject capability override fields (`artworkMaxResolution`, `artworkSources`, `supportedAudioCodecs`, `supportsVideo`) with a clear error message explaining these are only valid for mass-storage devices
- Mass-storage devices: validate override values as currently done (codec names, artwork sources, resolution range)
- Unknown device type: reject with error

Same validation should apply regardless of whether config comes from TOML file, environment variables, or CLI arguments.

**Call sites to update (adapter opening):**
- `packages/podkit-cli/src/commands/sync.ts` ~line 870-983
- `packages/podkit-cli/src/commands/device.ts` — info (~line 1708-1826), music (~line 2187-2223), video (~line 2365-2412)

**Capability override construction duplication to remove:**
- `packages/podkit-cli/src/commands/sync.ts` ~line 948-953
- `packages/podkit-cli/src/commands/device.ts` `resolveCapabilities()` helper ~line 123-134
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Single openDevice(path, deviceConfig) function encapsulates type check, capability resolution, and adapter opening
- [x] #2 All 4 adapter-opening call sites (sync, info, music, video) use openDevice() instead of inline branching
- [x] #3 Capability override fields on iPod devices are rejected at config load time with a clear error message
- [x] #4 Unknown device type values are rejected at config load time
- [x] #5 Validation applies consistently to TOML config, env vars, and CLI args
- [x] #6 Existing valid configs continue to work unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Architecture note: consolidate supportsVideo checks

Once `openDevice()` returns a `DeviceAdapter`, consumers can check `adapter.capabilities.supportsVideo` directly instead of resolving capabilities separately. This would consolidate the video support checks that currently happen in two places:
- `sync.ts` video gate (checks before sync)
- `device.ts` video subcommand (checks before listing)

Both currently resolve capabilities independently just to check this flag. With `openDevice()`, the adapter already carries its capabilities, so these become `adapter.capabilities.supportsVideo`.

## Completed (2026-03-25)

Extracted `openDevice()` into `packages/podkit-cli/src/commands/open-device.ts`:
- Takes `core` module, path, and optional DeviceConfig
- Returns `OpenDeviceResult` with adapter, capabilities, deviceSupportsAlac, isIpodDevice, and optional ipod handle
- Handles iPod (IpodDatabase → generation capabilities → IpodDeviceAdapter) and mass-storage (preset + overrides → MassStorageAdapter) paths

Updated all 4 call sites:
- `sync.ts`: replaced ~120 lines of branching with openDevice() call + error handling
- `device.ts info`: replaced ~130 lines of duplicated branching with unified openDevice() path
- `device.ts music`: replaced branching, unified track listing with conditional JSON mapper
- `device.ts video`: replaced branching, unified with capabilities-based video support check

Removed duplicated `resolveCapabilities` helper from device.ts and `isMassStorageDevice` (now imported from open-device.ts).

Config validation added in loader.ts: capability override fields on iPod devices (type undefined or 'ipod') are rejected with clear error message. 3 new loader tests added.
<!-- SECTION:NOTES:END -->
