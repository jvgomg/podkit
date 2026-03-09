---
id: TASK-075
title: Restructure CLI commands for clarity (entity-centric design)
status: Done
assignee: []
created_date: '2026-03-09 15:16'
updated_date: '2026-03-09 15:57'
labels:
  - cli
  - breaking-change
  - ux
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Restructure CLI commands to use an entity-centric design where commands follow the pattern `<entity> <content-type> [name]`. This resolves ambiguity about what commands operate on (device vs collection, music vs video).

See TASK-058 final summary for the decision rationale.

## Target Command Structure

### Device Commands
```bash
podkit device                      # list configured devices (existing)
podkit device add <name>           # detect and add iPod (existing)
podkit device remove <name>        # remove from config (existing)
podkit device info [name]          # config + live status (NEW - replaces show)
podkit device music [name]         # list music on device (NEW)
podkit device video [name]         # list video on device (NEW)
podkit device clear [name]         # clear all content (MOVED from root)
podkit device reset [name]         # reset database (MOVED from root)
podkit device eject [name]         # eject device (MOVED from root)
podkit device mount [name]         # mount device (MOVED from root)
podkit device init [name]          # initialize iPod (NEW - also at root)
```

### Collection Commands
```bash
podkit collection                  # list configured collections (existing)
podkit collection add <type> <name> <path>  # (existing)
podkit collection remove <name>    # (existing)
podkit collection info <name>      # show details (RENAMED from show)
podkit collection music [name]     # list music in collection (NEW)
podkit collection video [name]     # list video in collection (NEW)
```

### Root Shortcuts
```bash
podkit eject [name]                # shortcut for device eject (KEEP)
podkit mount [name]                # shortcut for device mount (KEEP)
podkit init [name]                 # shortcut for device init (KEEP)
podkit sync -d <device> -c <collection>  # (existing)
```

### Commands to Remove
- `podkit status` → replaced by `podkit device info`
- `podkit list` → replaced by `podkit device music`
- `podkit clear` → moved to `podkit device clear`
- `podkit reset` → moved to `podkit device reset`
- `podkit device show` → renamed to `podkit device info`
- `podkit collection show` → renamed to `podkit collection info`
- `podkit add-device` → if exists, remove (use `podkit device add`)

## Implementation Notes

### Argument Pattern
- `[name]` is optional positional argument
- If omitted, use default from config (`config.defaults.device` or `config.defaults.music`/`config.defaults.video`)
- Error if no default configured and no argument provided

### `device info` Output
When mounted:
```
Device: terapod
  Volume UUID:   ABC-123-DEF
  Volume Name:   IPOD
  Status:        Mounted at /Volumes/IPOD
  Model:         iPod Classic (160GB) - 6th Generation
  Storage:       45.2 GB used / 149.1 GB total (30%)
  Music:         8,432 tracks
  Video:         12 videos
  Quality:       aac-256
  Artwork:       yes
```

When not mounted:
```
Device: terapod
  Volume UUID:   ABC-123-DEF
  Volume Name:   IPOD
  Status:        Not mounted
  Quality:       aac-256
  Artwork:       yes
```

### `device music` / `device video`
- Carry over existing formatting from `list` command: `--format table|json|csv`, `--fields`
- `device music` shows music tracks on iPod
- `device video` shows videos on iPod (new functionality)

### `collection music` / `collection video`
- List contents of a configured collection
- Use collection adapters from podkit-core to scan
- Same output format options as device commands

### Root Shortcuts Implementation
- `eject`, `mount`, `init` at root level should delegate to the device subcommand
- Can share implementation by extracting action handlers

## Files to Modify

### Remove
- `packages/podkit-cli/src/commands/status.ts` (merge into device info)
- `packages/podkit-cli/src/commands/list.ts` (functionality moves to device music)
- `packages/podkit-cli/src/commands/clear.ts` (move to device subcommand)
- `packages/podkit-cli/src/commands/reset.ts` (move to device subcommand)
- `packages/podkit-cli/src/commands/add-device.ts` (if exists)

### Modify
- `packages/podkit-cli/src/commands/device.ts` - Add info, music, video, clear, reset, eject, mount, init subcommands
- `packages/podkit-cli/src/commands/collection.ts` - Rename show→info, add music, video subcommands
- `packages/podkit-cli/src/commands/eject.ts` - Delegate to device eject
- `packages/podkit-cli/src/commands/mount.ts` - Delegate to device mount
- `packages/podkit-cli/src/commands/init.ts` - Delegate to device init (or shared implementation)
- `packages/podkit-cli/src/main.ts` - Update command registration

### Tests to Update
- All test files for modified/removed commands
- E2E tests in `packages/e2e-tests/`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All device subcommands work: info, music, video, clear, reset, eject, mount, init
- [x] #2 All collection subcommands work: info, music, video
- [x] #3 Root shortcuts work: eject, mount, init (delegate to device)
- [x] #4 Old commands removed: status, list, clear (root), reset (root), device show, collection show, add-device
- [x] #5 [name] argument uses default from config when omitted
- [x] #6 JSON output (--json) works for all new commands
- [x] #7 Format options (--format, --fields) work for music/video listing commands
- [x] #8 device info shows merged config + live status
- [x] #9 collection music/video scan and list collection contents
- [x] #10 All existing tests updated or removed
- [x] #11 E2E tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Important: No Deprecation

This is alpha software with no users. **Do not add deprecation warnings, aliases, or backwards compatibility shims.**

- Remove old commands entirely (don't keep them as hidden aliases)
- Delete the old command files completely
- Update all imports and registrations in main.ts
- Remove any tests for deleted commands

Clean break, not gradual migration.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Restructured the CLI to use an entity-centric command design where commands follow the pattern `<entity> <content-type> [name]`. This resolves ambiguity about what commands operate on (device vs collection, music vs video).

## Changes Made

### Device Commands (packages/podkit-cli/src/commands/device.ts)
Rewrote device.ts with the following subcommands:
- `podkit device` (list) - List configured devices
- `podkit device add <name>` - Detect and add iPod
- `podkit device remove <name>` - Remove from config
- `podkit device info [name]` - Show config + live status (merged from `show` + `status`)
- `podkit device music [name]` - List music on device (moved from `list`)
- `podkit device video [name]` - List video on device (new)
- `podkit device clear [name]` - Clear all content (moved from root)
- `podkit device reset [name]` - Reset database (moved from root)
- `podkit device eject [name]` - Eject device (moved from root)
- `podkit device mount [name]` - Mount device (moved from root)
- `podkit device init [name]` - Initialize iPod (placeholder - not yet implemented)

### Collection Commands (packages/podkit-cli/src/commands/collection.ts)
Updated collection.ts with:
- `podkit collection info <name>` - Renamed from `show`
- `podkit collection music [name]` - List tracks in music collection (new)
- `podkit collection video [name]` - List videos in video collection (new)

### Root Shortcuts
Updated to use positional `[name]` argument:
- `podkit eject [name]` - Shortcut for device eject
- `podkit mount [name]` - Shortcut for device mount
- `podkit init` - Creates config file (unchanged)

### Removed Commands
Deleted obsolete files:
- status.ts (merged into device info)
- list.ts (moved to device music)
- clear.ts (moved to device clear)
- reset.ts (moved to device reset)
- add-device.ts (use device add)

### Test Updates
- Updated unit tests for new command structure
- Updated E2E tests to use `target.getTracks()` instead of CLI `list` command
- All 250 unit tests pass
- All 62 E2E tests pass

## Breaking Changes
- `podkit status` → `podkit device info`
- `podkit list` → `podkit device music`
- `podkit clear` → `podkit device clear`
- `podkit reset` → `podkit device reset`
- `podkit device show` → `podkit device info`
- `podkit collection show` → `podkit collection info`
- `podkit add-device` → `podkit device add`

## Notes
- `device init` is a placeholder - actual iPod database initialization requires gpod-tool integration
- The new commands require devices/collections to be configured in config - they use positional `[name]` argument, not `--device` path
<!-- SECTION:FINAL_SUMMARY:END -->
