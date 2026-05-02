---
id: TASK-072.02
title: Update config loader for new schema
status: Done
assignee: []
created_date: '2026-03-08 23:47'
updated_date: '2026-03-09 00:00'
labels:
  - config
dependencies: []
parent_task_id: TASK-072
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the config loader to parse the new multi-collection/device schema:

- Parse `[music.*]` sections into music collections map
- Parse `[video.*]` sections into video collections map
- Parse `[devices.*]` sections with nested transforms
- Parse `[defaults]` section
- Validate collection/device references in defaults

Location: `packages/podkit-cli/src/config/loader.ts`
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Updated the config loader (`packages/podkit-cli/src/config/loader.ts`) to parse the new multi-collection/device schema from ADR-008.

### New Helper Functions Added

1. **`parseMusicCollections()`** - Parses `[music.*]` sections into `Record<string, MusicCollectionConfig>`
   - Supports `type: 'directory'` (default) and `type: 'subsonic'`
   - Validates required fields based on type
   - For directory: requires `path`
   - For subsonic: requires `url` and `username`

2. **`parseVideoCollections()`** - Parses `[video.*]` sections into `Record<string, VideoCollectionConfig>`
   - Distinguishes from legacy `[video]` section with `source`/`quality` keys
   - Requires `path` for each collection

3. **`parseDevices()`** - Parses `[devices.*]` sections into `Record<string, DeviceConfig>`
   - Handles nested `[devices.*.transforms]` sections
   - Validates `quality`, `videoQuality`, and `artwork` types
   - Required fields: `volumeUuid`, `volumeName`

4. **`parseDefaults()`** - Parses `[defaults]` section into `DefaultsConfig`
   - Optional fields: `music`, `video`, `device`

5. **`validateDefaultReferences()`** - Logs warnings if defaults reference non-existent collections/devices

### Updates to Existing Functions

- **`loadConfigFile()`** - Now populates `music`, `video`, `devices`, and `defaults` fields
- **`mergeConfigs()`** - Properly merges map-based fields by name (collections merge, don't replace)
  - Deep merges device settings including transforms

### Backwards Compatibility

- All legacy fields (`source`, `device`, `quality`, `artwork`, `videoSource`, `videoQuality`, `ipod`, `transforms`) continue to work
- Old configs with only legacy fields are unaffected
- New and legacy fields can coexist in the same config file
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Changes Made

### Files Modified

- `packages/podkit-cli/src/config/loader.ts` - Added multi-collection/device parsing
- `packages/podkit-cli/src/config/loader.test.ts` - Added 32 new tests for new schema parsing

### Test Results

- All 124 loader tests pass (92 existing + 32 new)
- All 333 podkit-cli tests pass
<!-- SECTION:FINAL_SUMMARY:END -->
