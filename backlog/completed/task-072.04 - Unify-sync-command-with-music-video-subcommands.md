---
id: TASK-072.04
title: Unify sync command with music/video subcommands
status: Done
assignee: []
created_date: '2026-03-08 23:47'
updated_date: '2026-03-09 00:13'
labels:
  - cli
dependencies: []
parent_task_id: TASK-072
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refactor sync command to handle both music and video:

- `podkit sync` — sync all (music + video defaults)
- `podkit sync music` — sync music only
- `podkit sync video` — sync video only
- Add `-c <collection>` flag (searches both namespaces)
- Add `-d <device>` flag
- Remove separate `video-sync` command (or alias to `sync video`)

Location: `packages/podkit-cli/src/commands/sync.ts`
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Unified the sync command to handle both music and video syncing with a consistent interface.

## Changes

### New CLI Structure

The sync command now supports:
- `podkit sync` - sync all defaults (music + video)
- `podkit sync music` - sync music only
- `podkit sync video` - sync video only
- `podkit sync -c <name>` - sync matching collections (searches both music and video namespaces)
- `podkit sync -c <name> music` - sync specific music collection
- `podkit sync -c <name> video` - sync specific video collection
- `podkit sync -d <device>` - sync to specific named device
- `podkit sync --dry-run` - preview changes

### New Options

- `-c, --collection <name>` - collection name to sync (searches music and video)
- `-d, --device-name <name>` - device name to sync to (from config)
- `--video-quality <preset>` - video transcoding quality (max, high, medium, low)

### Files Modified

- `packages/podkit-cli/src/commands/sync.ts` - Major refactor:
  - Added optional `[type]` argument (music, video, or all)
  - Added collection resolution logic (`resolveCollections()`)
  - Added device resolution logic (`resolveDevice()`)
  - Added effective settings helpers (quality, transforms, artwork per device)
  - Unified sync execution for both music and video collections
  - Integrated video sync logic from video-sync.ts
  
- `packages/podkit-cli/src/commands/video-sync.ts` - Added deprecation warning:
  - Shows "Use 'podkit sync video' instead" when command is used
  - Command still works for backwards compatibility

### Implementation Details

1. **Collection Resolution**: Searches both music and video namespaces when `-c` flag is used. Falls back to defaults or legacy config fields.

2. **Device Resolution**: Looks up named devices from config, applies device-specific settings (quality, transforms, artwork).

3. **Unified Execution**: Opens iPod database once, then iterates through all collections to sync. Music and video are handled separately but within the same command execution.

4. **Legacy Support**: `--source` flag still works and overrides collection resolution for backwards compatibility.

### Tests

All 384 existing tests pass. The sync command utilities (formatBytes, formatDuration, renderProgressBar) are still exported and tested.
<!-- SECTION:FINAL_SUMMARY:END -->
