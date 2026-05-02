---
id: TASK-136.02
title: Add quality comparison and upgrade detection to diff engine
status: Done
assignee: []
created_date: '2026-03-14 13:56'
updated_date: '2026-03-14 15:22'
labels:
  - sync
  - core
dependencies: []
references:
  - packages/podkit-core/src/sync/differ.ts
  - packages/podkit-core/src/sync/types.ts
  - packages/podkit-core/src/sync/matching.ts
parent_task_id: TASK-136
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the diff engine (`packages/podkit-core/src/sync/differ.ts`) to detect upgrades on matched tracks.

**New function: `isQualityUpgrade(source, ipod)`**
- Lossless source replacing lossy iPod track → upgrade
- Higher bitrate lossy replacing lower bitrate lossy (same format family, ≥1.5× or ≥64kbps increase) → upgrade
- Lossy → lossy different format → NOT an upgrade

**New function: `detectUpgrades(source, ipod)`**
Returns upgrade reasons for a matched track pair:
- `format-upgrade`: source fileType differs and is higher quality
- `quality-upgrade`: same format family, significantly higher bitrate
- `artwork-added`: source has artwork, iPod `hasArtwork` is false
- `soundcheck-update`: source has soundcheck, iPod value absent or differs
- `metadata-correction`: non-matching fields differ (genre, year, trackNumber, etc.)

**Extend `UpdateReason` type** with the new upgrade reasons.

**Modify `computeDiff()`**: After matching a track, before classifying as `existing`, call `detectUpgrades()`. Tracks with upgrade reasons go into `toUpdate` instead of `existing`.

Add `skipUpgrades` option to diff config to suppress file-replacement upgrades (format, quality, artwork) while still allowing metadata-only updates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 isQualityUpgrade correctly identifies format and bitrate upgrades
- [x] #2 isQualityUpgrade does not flag lossy-to-lossy cross-format as upgrade
- [x] #3 detectUpgrades returns correct reasons for each upgrade category
- [x] #4 computeDiff routes upgraded tracks to toUpdate instead of existing
- [x] #5 skipUpgrades option suppresses file-replacement upgrades but allows metadata updates
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Implementation\n\nNew file `packages/podkit-core/src/sync/upgrades.ts` with:\n- `isQualityUpgrade(source, ipod)` — directional quality comparison\n- `detectUpgrades(source, ipod)` — returns array of `UpgradeReason` values\n- `isFileReplacementUpgrade(reason)` — distinguishes file vs metadata-only upgrades\n\nDiff engine extended: matched tracks checked for upgrades before classifying as `existing`. `skipUpgrades` option suppresses file-replacement upgrades but allows metadata-only updates.\n\n`ConflictTrack` type removed — metadata-correction upgrades fully subsume the old conflict concept. Triplicated comparison logic consolidated to shared `metadataValuesDiffer`.\n\n`transcodingActive` option added to prevent false format-upgrade detections when lossless sources are intentionally transcoded to lossy.\n\n70+ unit tests covering all categories, edge cases, and integration with computeDiff.
<!-- SECTION:NOTES:END -->
