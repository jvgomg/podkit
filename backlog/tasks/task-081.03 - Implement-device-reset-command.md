---
id: TASK-081.03
title: Implement device reset command
status: Done
assignee: []
created_date: '2026-03-09 22:18'
updated_date: '2026-03-09 22:44'
labels:
  - cli
  - ipod
dependencies:
  - TASK-081.01
parent_task_id: TASK-081
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Implement `podkit device reset` to recreate the iTunesDB from scratch, providing a clean slate without reformatting the filesystem.

## Context

Current `device reset` removes all tracks but keeps the database structure. The new behavior recreates the entire database, useful for:
- Corrupted database recovery
- Fresh start when switching from iTunes
- Cleaning up problematic database state

## Behavior

```
podkit device reset myipod

WARNING: This will recreate the iPod database from scratch.
All tracks, playlists, and play counts will be lost.

Continue? [y/N] y

Recreating database...
✓ Database recreated
  Model: iPod Classic 160GB (6th gen)
  Tracks: 0
```

## Requirements

1. **Strong confirmation** - defaults to No, requires explicit "y" or "yes"
2. **Recreate database** - delete existing iTunesDB and create fresh one
3. **Preserve filesystem** - volume UUID unchanged, config stays valid
4. **Show result** - display model info and confirm empty state
5. **Handle errors** - graceful failure if device not found, not mounted, etc.

## Options

- `--confirm` or `--yes` - skip confirmation (for scripting)
- `--json` - structured output

## Migration from Current Reset

The current `device reset` behavior (remove all tracks, keep database) should be preserved as `device clear --type all`. This may require updating the current reset implementation or just documenting the behavior change.

## Testing

- Unit tests: Test confirmation logic, error handling
- Integration tests: Verify database is recreated correctly
- E2E tests: Full reset flow with dummy iPod
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Recreates iTunesDB from scratch (not just clearing tracks)
- [x] #2 Strong confirmation prompt (defaults to No)
- [x] #3 Preserves filesystem and volume UUID
- [x] #4 Config remains valid after reset
- [x] #5 Supports --confirm/--yes for scripting
- [x] #6 Supports --json for structured output
- [x] #7 Graceful error handling for edge cases
- [x] #8 Unit tests cover confirmation and error paths
- [x] #9 E2E tests verify database recreation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete

Rewrote `device reset` command to recreate the database from scratch:

1. **Strong confirmation**: Defaults to No (`[y/N]`), requires explicit 'y' or 'yes'
2. **Database recreation**: Uses `IpodDatabase.initializeIpod()` to create fresh database
3. **Filesystem preserved**: Volume UUID and config remain valid
4. **--yes flag**: Skip confirmation for scripting
5. **--dry-run flag**: Show what would happen without making changes
6. **JSON output**: Structured output for all operations
7. **Clear messaging**: Shows model, track count removed, next steps

The old behavior (remove tracks but keep database) is now available via `device clear --type all`.
<!-- SECTION:NOTES:END -->
