---
id: TASK-317.09
title: >-
  device info: redesign output structure (alignment, capabilities, calculated
  quality)
status: Done
assignee: []
created_date: '2026-05-09 16:15'
updated_date: '2026-06-16 22:13'
labels:
  - cli
  - ux
  - device-info
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: medium
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Redesign `podkit device info` output. The current shape mixes derived capabilities, per-device config overrides, and computed values into a flat block where alignment and vocabulary are inconsistent.

## Current output (Echo Mini example)

```
Device: echomini
  Type:          Echo Mini
  Status:        Mounted at /Volumes/Echo SD
  Capabilities:
    Audio Codecs:    aac, alac, mp3, flac, ogg, wav
    Artwork:         embedded (max 127px)
    Video:           no
    Normalization:   none
    Album Artist:    yes
  Codecs:          aac, mp3, flac, alac
  Storage:       17.1 MB used / 117.7 GB total (0%)
  Music:         0 tracks
  Quality:       (not set)
  Artwork:       (not set)
```

## Issues

1. **Alignment off**: the `Codecs:` line has more leading whitespace before its value than `Quality:` / `Artwork:` / `Music:`. Inconsistent column alignment across the block.
2. **Two codec lines that mean different things and aren't differentiated**: `Audio Codecs:` (inside Capabilities, the device's preset-derived supported set) and `Codecs:` (top level, presumably the per-device transcoding output choice). The reader can't tell which is which from the labels alone, and the distinction matters.
3. **Capabilities is nested under Device, awkwardly**. Should be a first-class block (sibling section), with three pieces of information clearly visible: (a) the preset/generation it's derived from (anchor), (b) the derived defaults, (c) any per-device overrides distinct from defaults.
4. **`Quality: (not set)` is misleading**: when no per-device quality is set, the device inherits the global default. The output should show the *effective* (resolved) value with an inheritance indicator (e.g., the `[high]` bracket convention `device list` already uses). Same for `Artwork:`.
5. **`Quality:` is one composite field today; should expand**: show music quality + video quality separately, both with inheritance markers. The `device set` command already lets users override these independently.
6. **Inconsistent boolean vocabulary**: `Video: no` / `Normalization: none` / `Album Artist: yes` — three different forms of negative/positive. Pick one (e.g., the ✓/✗/[on]/[off] convention `device list` already uses). Read as a class problem and fix it consistently.
7. **Anchor missing**: the user can see `Type: Echo Mini` but not the richer descriptor (e.g., `FiiO Snowsky Echo Mini (echo-mini)` once TASK-317.07 lands, or the iPod model variant string for an iPod). This is the second-order effect of TASK-317.07's preset display metadata — `device info` is the consumer.

## Coordination with sibling tasks

- **TASK-317.03 AC #8** asks `device info` to compose identity via the cascade primitive. That's the identity layer; this task is the display layer. Land them together for coherence.
- **TASK-317.07** introduces preset manufacturer/productName fields. The new device info anchor uses those for mass-storage devices.
- **TASK-318** (config CLI audit) overlaps because resolved/inherited config values are also a config-CLI concern; the inheritance-display logic should be reusable from `device list`.

## Target shape (sketch — refine during implementation)

```
echomini  —  FiiO Snowsky Echo Mini (echo-mini)
  Status:        Mounted at /Volumes/Echo SD
  Storage:       17.1 MB used / 117.7 GB total (0%)
  Music:         0 tracks

Capabilities (from echo-mini preset)
  Audio Codecs:        aac, alac, mp3, flac, ogg, wav
  Video:               not supported
  Artwork:             embedded (max 127px)
  Normalization:       not supported
  Album Artist:        supported

Settings (effective; overrides marked)
  Music quality:       [high]   (inherited from global)
  Video quality:       —        (device does not support video)
  Output codec:        aac
  Artwork:             [on]     (inherited from global)
  Clean artists:       [off]    (override; preset would have it on)
```

Use the `device list` inheritance convention (`[bracketed]` for inherited values) to keep visual consistency across commands.

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list.
<!-- SECTION:DESCRIPTION:END -->

- [x] #1 Column alignment is consistent across all rows in the device info block. No row has more or fewer spaces between label and value than its siblings.
- [x] #2 Capabilities is a first-class section with its own header, distinct from Device metadata and from Settings.
- [x] #3 Capabilities section is anchored: shows the preset name (mass-storage) or the iPod model name (iPod) as the source from which capabilities were derived.
- [x] #4 Settings section shows resolved (effective) values for quality, artwork, etc., with inheritance markers matching the `[bracketed]` convention from `device list`. No `(not set)` strings.
- [x] #5 Music quality and video quality shown separately when both are applicable; one or the other dimmed/marked as N/A when the device doesn't support video.
- [x] #6 Boolean / availability values use a consistent vocabulary across the block (e.g., ✓ supported / ✗ not supported, OR yes / no, OR another consistent choice — pick one, apply everywhere).
- [x] #7 Duplicate `Audio Codecs:` and `Codecs:` lines disambiguated: rename so it's obvious which is the device's supported set vs the per-device output choice (e.g., `Supported codecs:` vs `Output codec:`).
- [x] #8 Identity composition uses the cascade primitive (per TASK-317.03 AC #8) — no libgpod-derived identity in this output path.
- [x] #9 Unit + integration tests added: one snapshot per device class (mass-storage, supported iPod, unsupported iPod), confirming the new output shape.
- [ ] #10 Real-hardware verification: `device info` on Echo Mini, mini 2G, nano 4G, nano 7G #1 (unsupported) — confirm new shape is consistent and readable across all four. Capture the outputs in the task's final summary.
- [x] #11 JSON-mode output (`--json`) updated to reflect the new structure: separate `capabilities` block, separate `settings` block with effective values + inheritance metadata.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Redesigned `podkit device info` Settings + Capabilities sections by composing the existing cascade resolvers + display dispatcher rather than re-implementing inheritance / vocabulary in the renderer. Two opus review rounds, all findings addressed.

**Cohesion stack now consumed by `device info`**:

- `resolveDeviceSettings()` (CLI `config/resolve.ts`) — config cascade with provenance per field.
- `resolveCapabilitiesResolved()` (`@podkit/core`) — capability cascade with provenance per field.
- `formatResolved()` (CLI `config/resolve.ts`) — single helper for `[bracketed]` inheritance markers, `✗` / `?` symbols, `on`/`off` booleans. Used to be paired with `formatGlobalResolved`; that's gone, one signature with `{ explicitSources }` opt now.
- `formatValue()` (newly exported from `config/resolve.ts`) — bare-value vocabulary, shared with `capability-summary`'s provenance-less fallback path so `yes`/`no` vs `on`/`off` can't drift.
- `displayFor()` (`@podkit/core` discovery) — single label dispatcher for header anchor + Capabilities section title; same one `device scan` and `device add` use.
- `matchConfiguredDeviceToDiscovered()` (new in CLI `shared.ts`) — matches a `DeviceConfig` to a `DiscoveredDevice` via volumeUuid → mount path → USB serial → sole-preset-match. Sole-preset gated on `!configUuid && !configPath` so two echo-minis with mismatched UUIDs don't mis-attribute.
- `pickCapabilityOverrides()` (new in CLI `shared.ts`) — single helper consumed by both `device info` and `device list` for the 6-field `Partial<DeviceCapabilities>` extraction.

**New CLI files**:

- `commands/device/info-render.ts` — `SUMMARY_LABEL_WIDTH`, `printSummaryRow`, `printSectionHeader`, `printSettingsZone`, `buildSettingsRows`, module-private `formatResolvedRow` + `formatProvenanceTail`.
- Tests: `info-render.test.ts` (10), `shared.test.ts` matcher coverage (+11), `device-info.behavior.test.ts` JSON shape coverage (+4 across mass-storage / iPod / path-mode / legacy-field-removal).

**Render contract** (text mode):

```
ipodterapod (default)  —  iPod (5.5th Generation)
  Status:         Mounted at /private/tmp/podkit-TERAPOD
  Model:          iPod (5.5th Generation)
  Readiness:      Ready

Capabilities (from iPod 5.5G)
  + Music
  + Artwork (max 320px)
  + Video
  + Podcasts

Settings (resolved; [brackets] = inherited)
  Music quality:  [high]  from global quality
  Output codecs:  aac, mp3, alac  from global
  Artwork:        [on]  from global
```

Mass-storage with per-device override surfaces the override bare and the inherited preset value `[bracketed]`. Unsupported / unknown collapse to `✗` / `?` from the same helper.

**JSON envelope** (`podkit device info --json`):

- New `settings` block with `{ value, source }` per field plus an optional `capabilities` sub-block for mass-storage.
- `source` typed as `DeviceInfoSource = ConfigSource | CapabilitySource` so consumer typos fail at compile time.
- Top-level `device.quality` / `device.audioQuality` / `device.videoQuality` / `device.artwork` REMOVED. Breaking minor — see `.changeset/device-info-resolved-cascade.md`; consumers read `settings.<field>.value`.
- `status.massStorageCapabilities` unchanged.

**Performance**:

- `discoverConnectedDevices` invoked LAZILY only when no cheap anchor is available (cascade-name for mounted iPod; preset rich-name for configured mass-storage). USB walk skipped on the happy path; saves ~200-800ms macOS / removes libusb permission noise in headless Linux/CI/Docker.

**ACs satisfied**: 1, 2, 3, 4, 5, 6, 7, 8, 9, 11. AC #10 (real-hardware) DEFERRED — user opted to skip the hardware verification pass; will fold into a follow-up sweep when convenient (Echo Mini + TERAPOD + nano 7G inventory).

**Quality gates**: 1608 unit tests / 67 integration / build all green.

**Changeset**: `.changeset/device-info-resolved-cascade.md` — minor bump with migration notes for the breaking JSON shape removal.
<!-- SECTION:FINAL_SUMMARY:END -->
