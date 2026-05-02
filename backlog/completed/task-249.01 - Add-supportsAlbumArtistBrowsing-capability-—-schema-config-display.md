---
id: TASK-249.01
title: 'Add supportsAlbumArtistBrowsing capability — schema, config, display'
status: Done
assignee: []
created_date: '2026-03-27 12:46'
updated_date: '2026-03-28 14:44'
labels:
  - feature
  - transforms
  - device-capabilities
dependencies: []
references:
  - doc-025
documentation:
  - agents/testing.md
parent_task_id: TASK-249
priority: medium
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the `supportsAlbumArtistBrowsing` boolean to `DeviceCapabilities` and wire it through the full config → adapter → display chain. This is a foundation slice — no sync behavior changes. See PRD: doc-025 for full context.

**Capability defaults:**
- iPod (all supported generations): `false` — stock firmware does not use Album Artist for browse navigation.
- Rockbox preset: `true`
- Echo Mini preset: `true`
- Generic preset: `true` (conservative — won't unexpectedly transform metadata on unknown devices)

**Config surface — follows the exact same pattern as existing capability overrides (`artworkMaxResolution`, `supportedAudioCodecs`, etc.):**
- Add to `DeviceCapabilities` interface, iPod capability derivation, and `DEVICE_PRESETS`
- Add to `DeviceConfig`, `ConfigFileDevice` (TOML parsing type), and config loader parsing
- Add to `deviceDefaults` with env var `PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING`
- Add validation: reject on iPod devices (same guard as other capability overrides)
- Add to capability override merging in `open-device.ts` (`buildCapabilityOverrides`) and `resolveDeviceCapabilities`

**Display in `device info`:**
- Text output: show in mass-storage capabilities section alongside audio codecs, artwork, video
- JSON output: include in capabilities object
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 supportsAlbumArtistBrowsing field exists on DeviceCapabilities interface
- [x] #2 iPod capability derivation returns false for all supported generations
- [x] #3 All three mass-storage presets (rockbox, echo-mini, generic) include the field with correct defaults
- [x] #4 resolveDeviceCapabilities merges the new field from overrides correctly
- [x] #5 Per-device config override parses from TOML (e.g. devices.mydevice.supportsAlbumArtistBrowsing = false)
- [x] #6 PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING env var populates deviceDefaults
- [x] #7 Config validation rejects the field on iPod-type devices
- [x] #8 buildCapabilityOverrides in open-device.ts passes the field through the override chain
- [x] #9 podkit device info text output shows Album Artist browsing status for mass-storage devices
- [x] #10 podkit device info JSON output includes supportsAlbumArtistBrowsing in capabilities
- [x] #11 Unit tests cover: preset defaults, resolveDeviceCapabilities merging, config loader parsing, env var handling, iPod rejection validation, device info output (text + JSON)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented in commit c370046.

Added `supportsAlbumArtistBrowsing: boolean` to `DeviceCapabilities` and wired through the full chain:

- **Core:** Interface field, iPod derivation (`false`), all mass-storage presets (`true`), `resolveDeviceCapabilities` merge
- **Config:** `DeviceConfig`, `ConfigFileDevice`, `deviceDefaults` types; TOML parsing with boolean type validation; `massStorageFields` iPod rejection guard; `PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING` env var
- **Commands:** `buildCapabilityOverrides` passthrough; `device info` text output (capabilities + overrides sections); JSON output via new `massStorageCapabilities` field on `DeviceInfoOutput`
- **Tests:** New `presets.test.ts` (preset defaults, resolve merging, getDevicePreset); iPod capability test for all generations; loader tests (TOML parse, invalid type, iPod rejection, env var true/false); all existing test fixtures updated
- **Docs:** Config file reference, supported devices table + capability overrides table + config example

Also fixed pre-existing gaps: added `audioNormalization` to mass-storage text display (capabilities + overrides), normalized "Audio codecs" → "Audio Codecs" casing.
<!-- SECTION:FINAL_SUMMARY:END -->
