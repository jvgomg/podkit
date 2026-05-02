---
id: TASK-138
title: Add device check and repair commands for iPod integrity
status: Done
assignee: []
created_date: '2026-03-14 18:22'
updated_date: '2026-03-23 14:57'
labels:
  - cli
  - feature
  - devices
dependencies: []
references:
  - TASK-136
  - adr/adr-009-self-healing-sync.md
  - packages/libgpod-node/native/track_operations.cc
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

There is currently no way for users to detect or fix integrity issues on their iPod. When tracks have corrupted files, mismatched extensions, missing files, or stale database entries, the only symptom is "it doesn't play" with no tooling to diagnose or repair.

This was discovered during self-healing sync development (TASK-136) when a bug caused AAC files to be stored with `.mp3` extensions. The tracks looked correct in the database but wouldn't play on the iPod. There was no `podkit` command to detect this.

## Proposed commands

### `podkit device check`

Scan the iPod and report integrity issues:

```bash
podkit device check

iPod Health Check:
  ✓ 2,173 tracks OK
  ✗ 23 tracks have mismatched file extensions
      Bombay Bicycle Club - Rinse Me Down (.mp3 file, AAC content)
      ...
  ✗ 2 tracks have missing files
  ✗ 1 orphaned file (not in database)
```

Checks to perform:
- **Extension mismatch**: File extension doesn't match actual file content (use `file` command or magic bytes)
- **Missing files**: Database entry exists but file is missing from disk
- **Orphaned files**: Files in `iPod_Control/Music/` not referenced by any database entry
- **Bitrate anomalies**: Tracks with `bitrate: 0` or suspiciously low values
- **Database consistency**: Tracks in playlists that don't exist in the master playlist

### `podkit device repair`

Fix detected issues:

```bash
podkit device repair              # Fix all detected issues
podkit device repair --dry-run    # Show what would be fixed
```

Repair strategies:
- **Extension mismatch**: Use `replaceTrackFile` to re-copy with correct extension, or rename file and update `ipod_path`
- **Missing files**: Remove database entries for tracks with missing files (or flag for re-sync)
- **Orphaned files**: Delete files not referenced by the database
- **Bitrate anomalies**: Flag for re-sync

### Alternative: `podkit sync --force`

For cases where the user just wants to re-sync specific tracks:

```bash
podkit sync --force-upgrade "Bombay Bicycle Club"
podkit sync --force-upgrade --album "Flaws"
```

## Context from TASK-136

During self-healing sync implementation, `replaceTrackFile()` initially reused the existing `ipod_path` when replacing a file, preserving the old `.mp3` extension even when the new content was AAC. This was fixed (now deletes old file and generates fresh path), but users who synced during the buggy window have no way to detect or fix the damage without manual intervention.

The one-off fix required a custom script to rename files and re-run `replaceTrackFile`. A built-in `device check` / `device repair` command would make this self-service.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 podkit device check detects file extension mismatches
- [ ] #2 podkit device check detects missing files
- [x] #3 podkit device check detects orphaned files
- [x] #4 podkit device repair fixes detected issues
- [x] #5 podkit device repair --dry-run shows what would be fixed without modifying
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`podkit doctor` diagnostics framework implemented with orphan-file detection/repair and artwork integrity checks. Extension-mismatch and missing-file detection split into a new follow-up task.
<!-- SECTION:FINAL_SUMMARY:END -->
