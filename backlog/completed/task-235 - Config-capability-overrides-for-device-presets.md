---
id: TASK-235
title: Config capability overrides for device presets
status: Done
assignee: []
created_date: '2026-03-24 19:18'
updated_date: '2026-03-24 22:18'
labels:
  - feature
  - config
milestone: 'Additional Device Support: Echo Mini'
dependencies:
  - TASK-224
references:
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-core/src/device/presets.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Allow users to override device capability preset values in their config file. Currently device capabilities come exclusively from hardcoded presets (echo-mini, rockbox, generic). A user with a `generic` device type has no way to customize capabilities, and users with known devices can't adjust values that don't match their specific hardware revision.

**Config schema extension:**
```toml
[devices.my-dap]
type = "generic"
path = "/Volumes/MY_DAP"
# Capability overrides (optional, merge with preset defaults):
artworkMaxResolution = 320
artworkSources = ["sidecar", "embedded"]
supportedAudioCodecs = ["mp3", "flac", "aac"]
supportsVideo = false
```

**Implementation:**
- Add capability override fields to `DeviceConfig` and `ConfigFileDevice`
- Parse and validate in config loader (array fields, enum values)
- Merge overrides on top of preset defaults when resolving capabilities
- For `generic` type with no overrides, use the generic preset defaults
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 DeviceConfig supports optional artworkMaxResolution, artworkSources, supportedAudioCodecs, and supportsVideo override fields
- [x] #2 Config loader validates override values (codec names, artwork source names, resolution range)
- [x] #3 Overrides are merged on top of preset defaults when resolving device capabilities
- [x] #4 Generic device type works with user-specified capabilities
- [x] #5 Existing preset-only configs continue to work unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Completed (2026-03-24)

**Implementation:**
- `resolveDeviceCapabilities(deviceType, overrides?)` in presets.ts — merges overrides on top of preset
- Config types: artworkMaxResolution, artworkSources, supportedAudioCodecs, supportsVideo on DeviceConfig
- Loader validates: codec names against AUDIO_CODECS, artwork sources against ARTWORK_SOURCES, resolution 1-10000, empty arrays rejected
- sync.ts and device.ts consumers updated to use resolveDeviceCapabilities
- Config writer writes override fields

**Design decision:** Capability overrides on iPod devices are silently stored but not applied (iPod path uses its own capability detection). Not rejected at load time — these may become useful in future.
<!-- SECTION:NOTES:END -->
