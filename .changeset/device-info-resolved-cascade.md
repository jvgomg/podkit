---
"podkit": minor
---

Redesign `podkit device info` output: first-class Capabilities + Settings sections.

The Settings section now shows every per-device setting as an effective
resolved value — `[bracketed]` when inherited from global, bare when
explicitly set on the device, `✗` for unsupported capabilities, `?` for
unknown — matching the convention `device list` already uses. The old
`Quality: (not set)` / `Artwork: (not set)` strings (which hid the
inherited value) and the duplicate `Audio Codecs:` vs `Codecs:` rows are
gone. Each row carries a `from <provenance>` tail (`from global`, `device
override`, `from preset`) so the reader can see at a glance where the
value came from.

The Capabilities section anchors to a display label dispatched from the
shared `displayFor()` primitive (same one `device scan` and `device add`
use), so `Capabilities (from echo-mini preset)` / `Capabilities (from
iPod nano 3G)` read consistently across commands. Mass-storage devices
with per-device capability overrides now surface those overrides as bare
values directly in the Capabilities section, with preset-inherited fields
bracketed.

The header line collapses `Device: <name>` + `Type: <preset>` into a
single anchored line: `<name> (default)  —  <rich display>`.

**Breaking JSON-mode change** for `podkit device info --json`:

- `device.quality`, `device.audioQuality`, `device.videoQuality`, and
  `device.artwork` are removed. Read the same data from the new
  `settings` block instead: `settings.quality.value`, `settings.audio.value`,
  `settings.video.value`, `settings.artwork.value`.
- The new `settings` block carries provenance for every field
  (`settings.<field>.source`) plus a `settings.capabilities` sub-block
  for mass-storage devices.

The existing `status.massStorageCapabilities` block is unchanged.

**Library / CLI internals consolidations**:

- `formatGlobalResolved` (CLI config-render helper) folded into
  `formatResolved` via a new `{ explicitSources }` option. Two new
  exported constants — `DEFAULT_EXPLICIT_SOURCES`, `GLOBAL_EXPLICIT_SOURCES`
  — name the boundaries the device-row and global-row consumers pass.
- New `formatResolvedRow` + `formatProvenanceTail` helpers in
  `@podkit-cli/output/resolved-row.ts` shared between `device info` and
  `device list`.
- New `matchConfiguredDeviceToDiscovered` in `@podkit-cli/commands/device/shared.ts`
  matches a configured `DeviceConfig` to its `DiscoveredDevice` entry
  (volume UUID → mount path → USB serial → preset id).
- `printCapabilitySummary` gains `sectionTitle` and `resolved` options so
  the mass-storage tabular layout can render preset-inherited values with
  `[bracketed]` markers when a per-device override is present, matching
  the Settings-section vocabulary.
