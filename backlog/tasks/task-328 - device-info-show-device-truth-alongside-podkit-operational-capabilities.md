---
id: TASK-328
title: 'device info: show device truth alongside podkit-operational capabilities'
status: Done
assignee: []
created_date: '2026-05-13 08:41'
updated_date: '2026-06-09 21:50'
labels:
  - mass-storage
  - cli
  - ux
  - follow-up
dependencies: []
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/devices-mass-storage/src/presets/built-in.ts
modified_files:
  - packages/podkit-cli/src/commands/open-device.ts
  - packages/podkit-cli/src/commands/device/capability-summary.ts
  - packages/podkit-cli/src/commands/device/info.ts
  - packages/podkit-cli/src/commands/device/output-types.ts
  - packages/podkit-cli/src/commands/device/capability-summary.test.ts
  - packages/podkit-cli/src/commands/device-info.behavior.test.ts
  - packages/podkit-cli/src/test-utils/fake-ipod.ts
  - packages/devices-mass-storage/src/presets/built-in.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - .changeset/device-info-firmware-vs-operational-codecs.md
priority: low
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

After TASK-327, `MassStorageAdapter.capabilities.supportedAudioCodecs` is the *operational* view (filtered through `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS`, currently `['wav', 'aiff']`). If `podkit device info` displays this list verbatim, users see a list that disagrees with the preset declaration in `packages/devices-mass-storage/src/presets/built-in.ts` — confusing for users who know the firmware can play WAV.

## Goal

Make `podkit device info` surface both views clearly:

- **Device firmware can play:** the unfiltered list from the preset (the "device truth" the preset documents).
- **Podkit will use on this device:** the operational list (what the planner actually decides direct-copy vs transcode against).

For codecs that appear in (device truth) but not (operational), annotate them as "transcoded before transfer" or similar.

## Out of scope

- Changing where the filter is applied. `MassStorageAdapter.capabilities` stays operational — the differ/classifier consumes it and shouldn't see WAV/AIFF.

## References

- `packages/podkit-core/src/device/mass-storage-adapter.ts` — the filter site (`MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS`)
- `packages/devices-mass-storage/src/presets/built-in.ts` — unfiltered preset truth
- `packages/podkit-cli/src/commands/device/info.ts` (or wherever device info lives)

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 podkit device info shows both lists (device-firmware vs podkit-output) with the operational list annotated for codecs podkit will transcode
- [x] #2 iPod info output is unchanged (the filter is mass-storage-only)
- [x] #3 Snapshot or text test covers the rendering
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## What changed

`podkit device info` now distinguishes the "device firmware can play" codec list from the "podkit will write" list on mass-storage devices. Driven by the TASK-327 observation that `MassStorageAdapter` silently drops wav/aiff from `supportedAudioCodecs` (tag-write reliability), so the info display disagreed with the preset declaration users could read in `@podkit/devices-mass-storage`.

### Text output

Mass-storage `Audio Codecs:` line expands into a `Firmware:` / `Podkit:` sub-block whenever the two views disagree:

```
Capabilities:
  Audio Codecs:
    Firmware:   aac, alac, mp3, flac, vorbis, opus, wav, aiff
    Podkit:     aac, alac, mp3, flac, vorbis, opus
                (wav, aiff transcoded before transfer)
```

When firmware == operational (echo-mini, generic), the existing single-line render is preserved (no churn for users whose firmware exactly matches what podkit writes).

### JSON output

`status.massStorageCapabilities.firmwareSupportedAudioCodecs?: string[]` is set alongside the existing `supportedAudioCodecs` only when the two differ. Absence signals "views agree" — `supportedAudioCodecs` retains its operational meaning so existing consumers keep working.

### iPod path

Untouched. iPod has no filter; `OpenDeviceResult.firmwareCapabilities` is `undefined` on the iPod branch. `printCapabilitySummary`'s iPod variant returns before the firmware-diff block. AC#2 verified by a dedicated test.

## Design notes

- **Source of firmware truth.** Surfaced via `OpenDeviceResult.firmwareCapabilities?: DeviceCapabilities` in the CLI carrier — populated from `resolvedCaps` in `openDevice` BEFORE the adapter applies its filter. No core/adapter API change; no double-resolve at info-time.
- **Shared diff predicate.** `getTranscodedCodecs(firmware, operational): string[]` lives in `capability-summary.ts` and is consumed by both the text renderer (sub-block gate) and `info.ts` (JSON gate). Single source of truth.
- **Where the filter still lives.** `MassStorageAdapter` constructor — unchanged. Comment now cross-refs the CLI surface so future readers don't lose the symmetry.

## Files changed

- `packages/podkit-cli/src/commands/open-device.ts` — new `firmwareCapabilities?` on `OpenDeviceResult`; populated on mass-storage branch.
- `packages/podkit-cli/src/commands/device/capability-summary.ts` — new exported `getTranscodedCodecs` helper; `PrintCapabilitySummaryOptions.firmwareCapabilities?`; sub-block render on mass-storage variant.
- `packages/podkit-cli/src/commands/device/info.ts` — captures firmware caps from openDevice; threads into both JSON and `printCapabilitySummary`.
- `packages/podkit-cli/src/commands/device/output-types.ts` — `firmwareSupportedAudioCodecs?: string[]` on `massStorageCapabilities`.
- `packages/podkit-cli/src/test-utils/fake-ipod.ts` — `makeFakeOpenDeviceResult({firmwareCapabilities})`.
- `packages/devices-mass-storage/src/presets/built-in.ts` + `packages/podkit-core/src/device/mass-storage-adapter.ts` — JSDoc cross-refs at the constant + filter site.

## Tests

- `capability-summary.test.ts`: sub-block (firmware ⊋ operational), collapse (firmware == operational), iPod-ignores-firmwareCapabilities (AC#2).
- `device-info.behavior.test.ts`: JSON `firmwareSupportedAudioCodecs` omitted when no diff, present with full list when there is one.
- All 1406 podkit unit tests pass; `bunx tsc --noEmit` clean.

## Changeset

`podkit: minor` — additive JSON field + new text sub-block on existing surface.
<!-- SECTION:FINAL_SUMMARY:END -->
