---
id: TASK-137
title: Detect quality preset changes and re-transcode existing tracks
status: Done
assignee: []
created_date: '2026-03-14 18:19'
updated_date: '2026-03-14 19:19'
labels:
  - sync
  - feature
  - design
dependencies: []
references:
  - adr/adr-009-self-healing-sync.md
  - TASK-136
  - packages/podkit-core/src/sync/upgrades.ts
  - packages/podkit-core/src/sync/differ.ts
  - docs/reference/quality-presets.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When a user changes their quality preset (e.g., `high` → `max`), existing tracks on the iPod were transcoded at the old bitrate but should now be re-transcoded at the new bitrate. The current self-healing sync does not detect this.

## Why self-healing sync doesn't catch this

Self-healing sync (ADR-009, TASK-136) detects changes in **source files** — format upgrades, quality upgrades, artwork added, metadata corrections. It compares source metadata against iPod metadata.

The quality preset change scenario fails because:

1. **The source files haven't changed.** The FLACs are the same FLACs. Self-healing sync sees "FLAC source + AAC iPod = expected state when transcoding" and correctly skips them.

2. **`transcodingActive` suppresses format-upgrade.** When quality != 'lossless', the diff engine suppresses format-upgrade for lossless-source-vs-AAC-iPod pairs because that's the normal transcoding outcome. This is correct for the self-healing case (don't re-transcode every FLAC on every sync).

3. **Quality-upgrade requires same format family.** `isQualityUpgrade()` only compares bitrates within the same format family (e.g., 128kbps AAC vs 256kbps AAC). It doesn't compare lossless source bitrate against lossy iPod bitrate because those are fundamentally different measurements.

4. **No record of what preset was used.** The system has no way to know that the existing 128kbps AAC on the iPod was transcoded with `quality = "high"` and should now be 256kbps because the user changed to `quality = "max"`.

## What same-format quality improvements DO work

The current self-healing sync correctly handles the case where a user replaces a source file with a higher-quality version of the **same format**:

- 128kbps AAC → 256kbps AAC: Detected as `quality-upgrade` (same family, bitrate threshold met)
- 128kbps MP3 → 320kbps MP3: Detected as `quality-upgrade`

This works because the source bitrate changed and the format families match.

## Design considerations

### Option A: Compare iPod bitrate against expected preset bitrate

The planner already knows the target bitrate for each quality preset. After the diff engine marks tracks as "existing," a second pass could check: "is this track's iPod bitrate lower than what the current preset would produce?"

```
For each existing track:
  if source is lossless and iPod is lossy:
    expectedBitrate = presetBitrate(currentQuality)  // e.g., 256 for "max"
    if iPod.bitrate < expectedBitrate * threshold:
      → mark as quality-preset-upgrade
```

**Pros:** Simple, no persistent state needed.
**Cons:** Only works in one direction (upgrade). If user goes from `max` → `high`, should tracks be re-transcoded to save space? Also, the iPod bitrate for VBR-encoded tracks may not exactly match the preset target.

### Option B: Store the quality preset used per track

Record which preset was used when each track was transcoded (e.g., in a sync state file or in the iPod database's `comment` field). On subsequent syncs, compare the stored preset against the current preset.

**Pros:** Precise, handles both upgrade and downgrade, no ambiguity.
**Cons:** Requires persistent sync state or repurposing a database field. Adds complexity.

### Option C: Store the quality preset used per device

Simpler variant of B — store the last-used quality preset per device in the config or a state file. If it changed since last sync, flag all transcoded tracks for re-processing.

**Pros:** Simple to implement, no per-track state.
**Cons:** All-or-nothing — can't partially re-transcode. May be too aggressive.

## Relationship to existing code

- `packages/podkit-core/src/sync/differ.ts` — `computeDiff()` would need a new check after the existing upgrade detection
- `packages/podkit-core/src/sync/upgrades.ts` — New upgrade reason (e.g., `preset-upgrade`)
- `packages/podkit-core/src/sync/planner.ts` — Route preset upgrades to `upgrade` operations with the new preset
- `packages/podkit-core/src/sync/executor.ts` — `transferUpgradeToIpod` already handles file replacement via `replaceTrackFile()`
- `packages/podkit-cli/src/commands/sync.ts` — The resolved `effectiveQuality` is already available; needs to be passed to the diff engine

## Key files

- `packages/podkit-core/src/sync/differ.ts` — diff engine
- `packages/podkit-core/src/sync/upgrades.ts` — upgrade detection
- `packages/podkit-core/src/sync/planner.ts` — planner (has preset bitrate mappings)
- `packages/podkit-core/src/sync/executor.ts` — executor (handles upgrades)
- `packages/podkit-core/src/ipod/types.ts` — `IPodTrack.bitrate`
- `adr/adr-009-self-healing-sync.md` — self-healing sync design
- `docs/reference/quality-presets.md` — preset definitions and bitrates
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Changing quality preset (e.g., high → max) triggers re-transcoding of existing tracks
- [x] #2 Dry-run shows tracks that need re-transcoding due to preset change
- [x] #3 Track count is unchanged after re-transcoding (upgrades, not adds)
- [x] #4 Play counts, ratings, and playlist membership preserved during re-transcode
- [x] #5 skipUpgrades flag also suppresses preset-change re-transcoding
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation

Added quality preset change detection using Option A (bitrate comparison, no persistent state).

### New upgrade reasons
- `preset-upgrade`: iPod bitrate significantly below current preset target
- `preset-downgrade`: iPod bitrate significantly above current preset target

### Detection
- New `detectPresetChange(source, ipod, presetBitrate)` in `upgrades.ts`
- Only applies to lossless source tracks (lossy are copied as-is)
- ±32 kbps tolerance for VBR variance (adjacent presets are 64+ kbps apart)
- Minimum bitrate threshold of 64 kbps to avoid false positives from short files
- Runs as post-processing step in the differ on `existing` tracks

### Files modified
- `packages/podkit-core/src/sync/types.ts` — new UpgradeReason values, DiffOptions.presetBitrate
- `packages/podkit-core/src/sync/upgrades.ts` — `detectPresetChange()`, updated `isFileReplacementUpgrade()`
- `packages/podkit-core/src/sync/differ.ts` — post-processing step for preset change detection
- `packages/podkit-cli/src/commands/sync.ts` — pass presetBitrate, updated UpdateBreakdown
- `packages/podkit-cli/src/output/formatters.ts` — display labels for new reasons
- `docs/user-guide/syncing/upgrades.md` — new categories and Preset Changes section
- `docs/reference/quality-presets.md` — note about re-transcoding on preset change
- `adr/adr-009-self-healing-sync.md` — updated out-of-scope note

### Tests
- 13 new unit tests for `detectPresetChange` (upgrades.test.ts)
- 8 new unit tests for differ integration (differ.test.ts)
- 2 new E2E tests (preset-change.e2e.test.ts)
- All 1322 unit tests pass, all 198 E2E tests pass

### Known limitation
The iPod database (via libgpod) stores low bitrate values for short test audio files, preventing E2E testing of the actual bitrate detection threshold. E2E tests verify the pipeline doesn't crash and skip-upgrades works; detection logic is covered by unit tests.
<!-- SECTION:FINAL_SUMMARY:END -->
