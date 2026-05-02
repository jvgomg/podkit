---
id: TASK-072.08
title: Apply device-scoped settings in sync engine
status: Done
assignee: []
created_date: '2026-03-08 23:47'
updated_date: '2026-03-09 00:15'
labels:
  - core
  - sync
dependencies: []
parent_task_id: TASK-072
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update sync engine to apply device-specific settings:

- Read quality/videoQuality from device config
- Read artwork setting from device config
- Read transforms config from device
- Pass these settings to transcoding and metadata pipelines

Ensure CLI flag overrides (e.g., `--quality`) still take precedence over device config.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Verification Complete

The sync command properly applies device-specific settings when syncing. The implementation was completed as part of TASK-072.04 (sync command refactoring).

### Implementation Details

**Helper Functions (sync.ts lines 645-689):**
- `getEffectiveTransforms(globalTransforms, deviceConfig)` - Merges device transforms with global, device takes precedence
- `getEffectiveQuality(globalQuality, deviceConfig)` - Returns device quality or global quality
- `getEffectiveVideoQuality(globalVideoQuality, deviceConfig)` - Returns device videoQuality or global or 'high' default
- `getEffectiveArtwork(globalArtwork, deviceConfig)` - Returns device artwork or global artwork

**CLI Flag Override Precedence (sync.ts lines 779-788):**
- `--quality` flag overrides device quality setting
- `--video-quality` flag overrides device videoQuality setting  
- `--no-artwork` flag overrides device artwork setting

**Device Resolution:**
- `-d <name>` flag selects a named device from config
- Falls back to `defaults.device` from config
- Falls back to legacy `ipod` config with auto-migration

### Verification
- All 384 podkit-cli tests pass
- Config loader tests cover device settings parsing and merging
- Legacy config migration properly moves quality/artwork/transforms to device config
<!-- SECTION:FINAL_SUMMARY:END -->
