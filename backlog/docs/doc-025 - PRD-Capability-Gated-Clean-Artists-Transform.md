---
id: doc-025
title: 'PRD: Capability-Gated Clean Artists Transform'
type: other
created_date: '2026-03-27 12:10'
---
## Problem Statement

When a user enables the `cleanArtists` transform globally, it applies uniformly to all configured devices. This made sense when podkit only supported iPods, where the stock firmware's Artist browse list doesn't use the Album Artist field — causing "Daft Punk feat. Pharrell Williams" to appear as a separate artist from "Daft Punk." But mass-storage devices (Rockbox, Echo Mini, generic DAPs) typically support Album Artist browsing natively, making the clean artists transform unnecessary and potentially unwanted — it discards featuring information from the Artist field that the device could display correctly alongside a clean Album Artist.

There is no mechanism today for podkit to automatically skip the transform on devices that don't need it, or to warn users who force-enable it unnecessarily.

## Solution

Gate the clean artists transform on a new device capability: `supportsAlbumArtistBrowsing`. When a device supports Album Artist browsing, the globally-enabled clean artists transform is automatically suppressed for that device. Users can force-enable it per-device if they want, and podkit will warn them (in `device info` and `sync --dry-run`) that the transform is enabled but likely unnecessary — unless the user has also overridden `supportsAlbumArtistBrowsing` to `false`, in which case the user has made a deliberate classification decision and no warning is shown.

## User Stories

1. As a user with an iPod and a Rockbox device, I want to enable `cleanArtists = true` globally and have it automatically apply only to my iPod, so that I don't have to configure each device separately.

2. As a user with a mass-storage device, I want podkit to tell me during `sync --dry-run` that the clean artists transform was skipped because my device supports Album Artist browsing, so that I understand why my global setting isn't being applied.

3. As a user who wants clean artists on a Rockbox device despite it supporting Album Artist, I want to force-enable the transform per-device with `[devices.my-rockbox.cleanArtists] enabled = true`, so that I have full control over my sync behavior.

4. As a user who has force-enabled clean artists on a device that supports Album Artist browsing, I want podkit to warn me in `device info` and `sync --dry-run` that the transform may not be necessary, so that I can make an informed decision.

5. As a user who has overridden `supportsAlbumArtistBrowsing = false` on a device, I want podkit to trust my classification and not show unnecessary warnings about clean artists, so that I'm not nagged about a deliberate decision.

6. As a user consuming JSON output from `device info`, I want transform warnings to appear in the JSON structure, so that my automation scripts can detect and act on them.

7. As a user with a device that already has tracks with transformed metadata from a previous sync (e.g., moved from iPod), I want podkit to self-heal by detecting those tracks via dual-key matching and reverting the transforms when clean artists is suppressed, so that my library stays consistent.

8. As a user checking `device info` for a mass-storage device, I want to see `supportsAlbumArtistBrowsing` reflected in the capabilities display, so that I can verify how podkit classifies my device.

9. As a user with a `generic` type device that doesn't actually support Album Artist browsing, I want to override `supportsAlbumArtistBrowsing = false` in my device config so that the global clean artists transform auto-applies to it.

10. As a user, I want the dry-run pre-sync summary to tersely indicate that clean artists was skipped for the current device, so that I'm informed without being overwhelmed by verbose output.

11. As a user with multiple devices of different types, I want the transform gating to be evaluated independently per device during each sync, so that a single sync session across devices applies the right behavior to each one.

12. As a user, I want to be able to provide per-device clean artists configuration (format, drop, ignore list) that applies when the transform is active for that device, regardless of whether it was auto-enabled or force-enabled.

## Implementation Decisions

### New Capability: `supportsAlbumArtistBrowsing`

- Add `supportsAlbumArtistBrowsing: boolean` to the `DeviceCapabilities` interface.
- **iPod (all supported generations):** `false` — stock firmware does not use Album Artist for browse navigation.
- **Rockbox preset:** `true` — supports Album Artist browsing.
- **Echo Mini preset:** `true` — reads standard tags with Album Artist support.
- **Generic preset:** `true` — conservative default; assume modern device behavior. Users override to `false` if their device lacks Album Artist browsing.

### Config Surface

- Add `supportsAlbumArtistBrowsing` as a per-device capability override in `DeviceConfig`, following the same pattern as `artworkMaxResolution`, `supportedAudioCodecs`, etc.
- Add `supportsAlbumArtistBrowsing` to `deviceDefaults` with a corresponding `PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING` env var, consistent with other capability overrides.
- Add to `ConfigFileDevice` raw TOML type for parsing.
- Add validation: only allowed on mass-storage devices (same guard as other capability overrides).
- Per-device `cleanArtists` config already exists — no new config fields needed for the force-enable mechanism.

### Transform Resolution Logic

Modify `getEffectiveTransforms()` to accept device capabilities and determine the effective clean artists state:

**Precedence rules:**
1. **Per-device `cleanArtists` explicitly set** → use that value (highest priority). This is the force-enable/disable mechanism.
2. **Global `cleanArtists` enabled + device `supportsAlbumArtistBrowsing: false`** → auto-enable (iPod case).
3. **Global `cleanArtists` enabled + device `supportsAlbumArtistBrowsing: true`** → auto-suppress (mass-storage case).
4. **Global `cleanArtists` disabled** → disabled regardless of device capability.

When auto-suppressed, the effective `TransformsConfig` has `cleanArtists.enabled = false`.

The function must also track *why* the transform is in its current state (auto-enabled, auto-suppressed, explicitly enabled, explicitly disabled) to drive warning logic downstream.

### Warning System

A dedicated utility that computes transform-related warnings given:
- Effective transforms config
- Device capabilities (effective, after user overrides)
- Whether the user explicitly set `cleanArtists` per-device
- Whether the user explicitly overrode `supportsAlbumArtistBrowsing`

**Warning conditions:**
- **"Enabled but unnecessary"**: cleanArtists is explicitly enabled per-device AND the device's effective `supportsAlbumArtistBrowsing` is `true` AND the user has NOT overridden `supportsAlbumArtistBrowsing`. The warning indicates the transform is active but the device natively supports Album Artist browsing.
- **No warning when**: the user has overridden `supportsAlbumArtistBrowsing` to `false` — they've made a deliberate device classification decision, so auto-enable is trusted.

This utility is a pure function with no dependencies on sync or device machinery — testable in complete isolation.

### Dry-Run Output Changes

In the pre-sync summary (where transforms config is displayed):
- When auto-suppressed: show a terse message like `Clean artists: skipped (device supports Album Artist browsing)`.
- When active with warning: show the active config plus a warning line.
- When active without warning: show the active config as today.

### Device Info Command Changes

**Text output:**
- Display `supportsAlbumArtistBrowsing` in the mass-storage capabilities section (alongside audio codecs, artwork, video).
- Show transform warnings after the transforms section when applicable.

**JSON output:**
- Include `supportsAlbumArtistBrowsing` in the capabilities object.
- Add transform warnings to the output structure.

### Self-Healing Behavior

When clean artists is auto-suppressed for a device, the dual-key matching system already handles the revert path:
- Tracks with transformed metadata are matched via the transform key.
- `detectUpdates()` returns `transform-remove` when the device has transformed metadata but transforms are disabled.
- The handler creates `update-metadata` operations to revert to original artist/title values.

This requires no new code — the existing transform-remove machinery works because auto-suppress sets `cleanArtists.enabled = false` in the effective config. The dual-key matching will find tracks by their transformed key and schedule metadata reverts.

### Capability Override Resolution

`supportsAlbumArtistBrowsing` follows the existing override chain:
1. Device preset default (from `DEVICE_PRESETS`)
2. Global `deviceDefaults` (from `PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING` env var)
3. Per-device config override (`devices.mydevice.supportsAlbumArtistBrowsing`)

For iPod: always derived from generation metadata (`false` for all supported generations), not overridable (same as other iPod capabilities).

### Modules Modified

1. **DeviceCapabilities** (podkit-core) — Add field to interface, update iPod derivation, update presets.
2. **Config Schema** (podkit-cli) — Add to `DeviceConfig`, `ConfigFileDevice`, `deviceDefaults`, env var parsing, validation, capability override merging in `open-device.ts`.
3. **Transform Resolution** (podkit-cli) — Extend `getEffectiveTransforms()` with capability awareness and state tracking.
4. **Transform Warning Utility** (podkit-core or podkit-cli) — New pure function for computing transform warnings.
5. **Device Info Command** (podkit-cli) — Surface new capability and warnings in text + JSON output.
6. **Music Presenter / Dry-Run** (podkit-cli) — Show auto-suppress message and warnings in pre-sync summary.

## Testing Decisions

Tests should verify external behavior through the public interfaces of each module, not implementation details. The codebase uses Bun test runner with a mix of unit tests (testing functions in isolation) and integration tests (testing through the sync pipeline).

### Modules to Test

1. **Transform Warning Utility** — Deep unit testing. This is a pure function with well-defined inputs and outputs. Test all warning conditions:
   - Auto-suppressed (no warning, just state)
   - Explicitly enabled on album-artist device (warning)
   - Explicitly enabled on album-artist device with `supportsAlbumArtistBrowsing` overridden to `false` (no warning)
   - Global disabled (no warning regardless)
   - Per-device disabled (no warning)
   - Various combinations of global/device/capability states

2. **Transform Resolution Logic** — Deep unit testing of the extended `getEffectiveTransforms()`. Test the precedence matrix:
   - Global on + capability false → enabled
   - Global on + capability true → suppressed
   - Global on + capability true + device override on → enabled
   - Global off + any capability → disabled
   - Device override off + any global/capability → disabled
   - Verify the returned state tracking (why the transform is in its current state)

3. **Capability Preset Changes** — Unit tests for presets returning correct `supportsAlbumArtistBrowsing` values. Test `resolveDeviceCapabilities()` merges the new field correctly.

4. **Config Loader** — Tests for parsing `supportsAlbumArtistBrowsing` from TOML device config, env var `PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING`, and validation that it's rejected on iPod devices. Follow existing config loader test patterns.

5. **Device Info Output** — Test that the new capability appears in both text and JSON output, and that warnings appear when conditions are met. Follow existing device info test patterns.

### Prior Art

- `packages/podkit-core/src/transforms/ftintitle/ftintitle.test.ts` — Unit tests for the clean artists transform logic
- `packages/podkit-cli/src/config/loader.test.ts` — Extensive config parsing tests including device capability overrides and env vars
- `packages/podkit-core/src/sync/engine/diff-utils.test.ts` — Tests for sync engine utilities
- `packages/podkit-core/src/device/presets.ts` — Simple enough to test inline with the capability changes

## Out of Scope

- **iOS iPod support**: iPod Touch and iOS devices are not supported by podkit. The `supportsAlbumArtistBrowsing` capability is only relevant to devices podkit currently supports.
- **Other transforms**: Only the `cleanArtists` transform is gated by this capability. The `showLanguage` video transform has no relationship to Album Artist browsing.
- **Automatic device capability detection**: The capability is set via presets and config overrides. No runtime detection of whether a device actually supports Album Artist browsing.
- **Retroactive config migration**: Existing configs continue to work. Users who want the new auto-gating behavior just need `cleanArtists = true` at the global level — the gating happens automatically based on device capabilities.
- **New CLI flags**: No new CLI flags are needed. The existing `--device` flag and config file are sufficient for all use cases.

## Further Notes

- The `generic` preset defaulting to `supportsAlbumArtistBrowsing: true` is a conservative choice — it means the transform won't unexpectedly modify metadata on unknown devices. Users with generic devices that lack Album Artist browsing can override to `false`.
- The warning utility being a pure function makes it easy to reuse if future transforms also need capability gating.
- The self-healing behavior (transform-remove when auto-suppressed) comes for free from the existing dual-key matching system — no new sync engine changes are needed.
