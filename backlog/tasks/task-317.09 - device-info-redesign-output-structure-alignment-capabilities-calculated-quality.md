---
id: TASK-317.09
title: >-
  device info: redesign output structure (alignment, capabilities, calculated
  quality)
status: To Do
assignee: []
created_date: '2026-05-09 16:15'
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

- [ ] #1 Column alignment is consistent across all rows in the device info block. No row has more or fewer spaces between label and value than its siblings.
- [ ] #2 Capabilities is a first-class section with its own header, distinct from Device metadata and from Settings.
- [ ] #3 Capabilities section is anchored: shows the preset name (mass-storage) or the iPod model name (iPod) as the source from which capabilities were derived.
- [ ] #4 Settings section shows resolved (effective) values for quality, artwork, etc., with inheritance markers matching the `[bracketed]` convention from `device list`. No `(not set)` strings.
- [ ] #5 Music quality and video quality shown separately when both are applicable; one or the other dimmed/marked as N/A when the device doesn't support video.
- [ ] #6 Boolean / availability values use a consistent vocabulary across the block (e.g., ✓ supported / ✗ not supported, OR yes / no, OR another consistent choice — pick one, apply everywhere).
- [ ] #7 Duplicate `Audio Codecs:` and `Codecs:` lines disambiguated: rename so it's obvious which is the device's supported set vs the per-device output choice (e.g., `Supported codecs:` vs `Output codec:`).
- [ ] #8 Identity composition uses the cascade primitive (per TASK-317.03 AC #8) — no libgpod-derived identity in this output path.
- [ ] #9 Unit + integration tests added: one snapshot per device class (mass-storage, supported iPod, unsupported iPod), confirming the new output shape.
- [ ] #10 Real-hardware verification: `device info` on Echo Mini, mini 2G, nano 4G, nano 7G #1 (unsupported) — confirm new shape is consistent and readable across all four. Capture the outputs in the task's final summary.
- [ ] #11 JSON-mode output (`--json`) updated to reflect the new structure: separate `capabilities` block, separate `settings` block with effective values + inheritance metadata.
<!-- AC:END -->
