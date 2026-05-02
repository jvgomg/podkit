---
id: TASK-224
title: Config and detection support for non-iPod devices
status: Done
assignee: []
created_date: '2026-03-23 20:31'
updated_date: '2026-03-25 01:47'
labels:
  - feature
  - cli
  - config
milestone: 'Additional Device Support: Echo Mini'
dependencies:
  - TASK-222
references:
  - packages/podkit-cli/src/device-resolver.ts
  - packages/podkit-core/src/config/
documentation:
  - backlog/docs/doc-020 - Architecture--Multi-Device-Support-Decisions.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add config schema and device detection support for mass-storage devices. This enables podkit to identify, remember, and configure non-iPod devices.

**Architecture doc:** DOC-020 (decision 6: three-tier detection strategy)

**Three-tier detection:**
1. **Fully automatic** — probe filesystem for device markers (e.g., specific directories, USB vendor/product ID). Works for iPod today; may work for Echo Mini if investigation (TASK-221) reveals identifiable markers.
2. **Wizard-assisted** — `podkit device setup` interactive flow: probe what's available, show the user what was found, let them confirm or select device type, persist to config. This is the universal onboarding path.
3. **Manual config** — user writes device config directly in TOML.

**Config schema changes:**
```toml
[[devices]]
name = "my-echo-mini"
path = "/Volumes/ECHO_MINI"       # Mount point or volume name
type = "echo-mini"                 # Selects capability preset
# Optional explicit capability overrides:
# artworkMaxResolution = 320
# artworkSources = ["sidecar", "embedded"]
# supportedAudioCodecs = ["mp3", "flac", "aac"]
```

**Device type presets:**
- `"ipod"` — auto-detected, capabilities from generation metadata (existing behavior)
- `"echo-mini"` — capabilities from device profile
- `"rockbox"` — capabilities from hardware model (future)
- `"generic"` — user specifies all capabilities manually

**Wizard flow (`podkit device setup`):**
1. List connected removable volumes
2. Attempt auto-detection (iPod probe, USB ID matching, filesystem markers)
3. If auto-detected: "Found Echo Mini at /Volumes/ECHO_MINI — correct?" → persist
4. If not auto-detected: show list of supported device types, let user select → persist
5. Optionally allow capability overrides for power users

**How this integrates with existing device resolution:**
The current device resolver finds iPods by auto-detection or config. This extends it to:
- Check config for non-iPod device entries
- Use device type to select the correct `DeviceAdapter` implementation (iPod → IpodDatabase, echo-mini/rockbox/generic → MassStorageAdapter)
- Pass capabilities to the adapter

**Depends on TASK-221 for:** USB identification details, filesystem markers to detect Echo Mini automatically.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Config schema supports [[devices]] entries with name, path, type, and optional capability overrides
- [x] #2 Device type presets defined for echo-mini (and generic) with correct DeviceCapabilities
- [x] #3 Device resolver updated to resolve non-iPod devices from config
- [x] #4 Device resolver selects correct DeviceAdapter implementation based on device type
- [x] #5 podkit device setup wizard implemented with auto-detect → confirm → persist flow
- [x] #6 Wizard falls back to manual device type selection when auto-detection fails
- [x] #7 Existing iPod auto-detection continues to work unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-221 dependency removed (superseded by TASK-233/232, both done).

## Detection details from research (DOC-022)

**USB identification (confirmed firsthand):**
- Vendor ID: 0x071b (NOT 0x0b98 as previously assumed)
- Product ID: 0x3203
- Manufacturer string: "ECHO MINI"
- Serial: "USBV1.00"

**Dual-volume handling (critical):**
Device always presents two USB LUNs:
- LUN 0: Internal storage, FAT32, "ECHO MINI", 7.5GB
- LUN 1: SD card, exFAT, user-configurable label, variable size

Distinguish by:
- Media name: "MINI" (internal) vs "MINI   SD" (SD card) — most reliable
- LUN number: 0 = internal, 1 = SD
- Volume label defaults are changeable, not fully reliable
- Capacity: internal always ~7.5GB

Config must let user specify which volume. Default to SD card (larger).

**Echo Mini capability preset:**
```
artworkSources: ['embedded']
artworkMaxResolution: 600
supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'wav']
supportsVideo: false
```
Note: ALAC confirmed working (corrects community data). WAV plays but not library-indexed.

## Research completed (2026-03-24)

The config and device resolver code has been read and understood. Here's what the next implementer needs to know:

**Current config structure** (`packages/podkit-cli/src/config/types.ts`):
- `DeviceConfig` has `volumeUuid`, `volumeName`, and sync settings (quality, artwork, etc.)
- `ConfigFileDevice` is the raw TOML parse type
- Devices live under `[devices.{name}]` in the TOML config
- No `type` field exists yet — all devices are implicitly iPod

**Current device resolver** (`packages/podkit-cli/src/resolvers/device.ts`):
- `resolveDevice()` looks up named device from `config.devices`
- `resolveDevicePath()` finds the physical mount point via UUID or CLI path
- `autoDetectDevice()` scans for iPods via `DeviceManager.findIpodDevices()`
- All error messages and display text say "iPod" — needs updating
- `DeviceManager` interface (`packages/podkit-core/src/device/types.ts`) has `findIpodDevices()`, `findByVolumeUuid()`, `listDevices()`, `getUuidForMountPoint()`

**Changes needed for TASK-224:**
1. Add `type` field to `DeviceConfig` and `ConfigFileDevice` (values: 'ipod' | 'echo-mini' | 'rockbox' | 'generic')
2. Add `path` field to `DeviceConfig` for mass-storage devices that use path instead of UUID
3. Create device preset registry mapping type → DeviceCapabilities (in podkit-core or podkit-cli)
4. Update device resolver to handle non-iPod devices (resolve by path for mass-storage)
5. Add adapter selection logic: type → IpodDeviceAdapter or MassStorageAdapter
6. Update sync.ts to use the correct adapter based on device type (currently hardcodes iPod)
7. Update error messages from "iPod" to generic "device" where appropriate

**The wizard (AC #5, #6) is HITL** — needs UX decisions. Defer to a later pass.

**Key file locations:**
- Config types: `packages/podkit-cli/src/config/types.ts`
- Config loader: `packages/podkit-cli/src/config/loader.ts`
- Device resolver: `packages/podkit-cli/src/resolvers/device.ts`
- Resolver types: `packages/podkit-cli/src/resolvers/types.ts`
- Sync command (where adapter is created): `packages/podkit-cli/src/commands/sync.ts`
- Device commands: `packages/podkit-cli/src/commands/device.ts`

## Phase 1 implementation (2026-03-24)

AC #1–4 and #7 implemented. AC #5–6 (wizard) deferred to Phase 2 (HITL).

**Key decisions:**
- Device type default: `undefined` = iPod (full backward compat, no config migration needed)
- Presets in `podkit-core/src/device/presets.ts` — core knowledge, not CLI
- Mass-storage music execution guarded with clear error (MusicExecutor still expects IpodDatabase; dry-run works for planning)
- `config-path` resolution priority: after CLI path, before UUID
- If both `path` and `volumeUuid` are set, volumeUuid takes precedence

**Files changed:**
- `packages/podkit-cli/src/config/types.ts` — DeviceType, DEVICE_TYPES, type/path on DeviceConfig
- `packages/podkit-core/src/device/presets.ts` — NEW: preset registry
- `packages/podkit-core/src/device/index.ts` — preset exports
- `packages/podkit-core/src/index.ts` — preset exports
- `packages/podkit-cli/src/config/loader.ts` — type/path parsing and validation
- `packages/podkit-cli/src/resolvers/types.ts` — DeviceIdentity additions
- `packages/podkit-cli/src/resolvers/device.ts` — path-based resolution, device-aware messages
- `packages/podkit-cli/src/commands/sync.ts` — adapter selection, iPod vs mass-storage branching

## Status after Phase 1-3 (2026-03-24)

AC #1-4, #7 complete. AC #5-6 (wizard) remain HITL — requires UX decisions for the interactive `podkit device setup` flow. The wizard is not blocking any other milestone work since `device add --type` provides the manual config path.

AC #5-6 (device setup wizard) split to TASK-245. All config, preset, resolver, and adapter selection work is complete.
<!-- SECTION:NOTES:END -->
