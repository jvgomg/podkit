---
id: TASK-136
title: Implement self-healing sync (ADR-009)
status: Done
assignee: []
created_date: '2026-03-14 13:56'
updated_date: '2026-03-14 15:23'
labels:
  - sync
  - feature
dependencies: []
references:
  - adr/adr-009-self-healing-sync.md
  - TASK-064
documentation:
  - adr/adr-009-self-healing-sync.md
  - docs/reference/config-file.md
  - docs/reference/cli-commands.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement self-healing sync as designed in ADR-009. When source files have improved (format upgrade, quality upgrade, artwork added, soundcheck/metadata changes), sync should detect the change and upgrade the iPod track in place — preserving play counts, star ratings, and playlist membership.

Key design decisions (from ADR-009):
- **Change detection:** Metadata comparison on matched tracks (fileType, bitrate, hasArtwork, soundcheck, etc.)
- **In-place upgrade:** Keep the iPod database entry, swap the file underneath
- **On by default:** `--skip-upgrades` / `skipUpgrades` config as opt-out escape hatch
- **Config fallback:** CLI → device → global → default (false)

Work is broken into subtasks covering the full stack: libgpod verification, core diff/planner/executor changes, CLI integration, config, testing, and docs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Matched tracks with format/quality upgrades are detected and upgraded by default
- [x] #2 Matched tracks with artwork additions are detected and upgraded by default
- [x] #3 Matched tracks with soundcheck/metadata changes get in-place metadata updates
- [x] #4 Play counts, star ratings, and playlist membership are preserved during upgrades
- [x] #5 --skip-upgrades flag and skipUpgrades config option disable file upgrades
- [x] #6 skipUpgrades follows the standard resolution order (CLI → device → global → default)
- [x] #7 Dry-run output shows upgrade breakdown by category
- [x] #8 Config file reference docs updated
- [x] #9 CLI commands reference docs updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Implementation Summary\n\nSelf-healing sync implemented across the full stack per ADR-009.\n\n**libgpod-node (.01):** `replaceTrackFile()` method — resets `transferred` flag, overwrites file in place via libgpod. Documented as behavioral deviation #5.\n\n**Diff engine (.02):** `isQualityUpgrade()`, `detectUpgrades()`, `isFileReplacementUpgrade()` in new `upgrades.ts`. `ConflictTrack` removed — subsumed by metadata-correction. `transcodingActive` flag prevents false positives when lossless→lossy transcoding is expected.\n\n**Config/CLI (.03):** `skipUpgrades` boolean follows standard resolution: CLI `--skip-upgrades` → device → global → default (false).\n\n**Planner/Executor (.06):** New `upgrade` operation type. Planner reuses `categorizeSource()` for transcode/copy decisions. Executor delegates to existing `prepareTranscode`/`prepareCopy`, calls `replaceTrackFile`, updates technical metadata. Retry budget correctly branches on transcode vs copy.\n\n**Tests (.04):** 80+ new tests across unit, integration, and E2E. E2E tests verify metadata-correction workflow end-to-end with `metaflac`.\n\n**Docs (.05):** ADR-009 accepted. New user guide page `docs/user-guide/syncing/upgrades.md`. Config and CLI references updated.\n\n### Code Review Fixes Applied\n- Consolidated triplicated `valuesDiffer` to shared `metadataValuesDiffer`\n- Removed vestigial `ConflictTrack` type and conflict detection\n- Fixed critical bug: `skipUpgrades` wasn't wired to `computeDiff`\n- Fixed wrong retry budget for transcode-based upgrades\n- Eliminated `prepareUpgrade` duplication by delegating to existing methods\n- Updated stale `orderOperations` doc comment\n- Removed unnecessary double-cast in planner
<!-- SECTION:NOTES:END -->
