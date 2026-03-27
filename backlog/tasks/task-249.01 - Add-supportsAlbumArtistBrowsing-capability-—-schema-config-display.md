---
id: TASK-249.01
title: 'Add supportsAlbumArtistBrowsing capability — schema, config, display'
status: To Do
assignee: []
created_date: '2026-03-27 12:46'
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
- [ ] #1 supportsAlbumArtistBrowsing field exists on DeviceCapabilities interface
- [ ] #2 iPod capability derivation returns false for all supported generations
- [ ] #3 All three mass-storage presets (rockbox, echo-mini, generic) include the field with correct defaults
- [ ] #4 resolveDeviceCapabilities merges the new field from overrides correctly
- [ ] #5 Per-device config override parses from TOML (e.g. devices.mydevice.supportsAlbumArtistBrowsing = false)
- [ ] #6 PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING env var populates deviceDefaults
- [ ] #7 Config validation rejects the field on iPod-type devices
- [ ] #8 buildCapabilityOverrides in open-device.ts passes the field through the override chain
- [ ] #9 podkit device info text output shows Album Artist browsing status for mass-storage devices
- [ ] #10 podkit device info JSON output includes supportsAlbumArtistBrowsing in capabilities
- [ ] #11 Unit tests cover: preset defaults, resolveDeviceCapabilities merging, config loader parsing, env var handling, iPod rejection validation, device info output (text + JSON)
<!-- AC:END -->
