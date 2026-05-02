---
id: TASK-060
title: Implement podkit reset command to remove all tracks from iPod
status: Done
assignee: []
created_date: '2026-02-26 12:59'
updated_date: '2026-02-26 13:03'
labels:
  - cli
  - core
  - feature
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a `podkit reset` command that removes all tracks from the iPod, allowing users to start fresh before syncing their full library.

## Use Case

User wants to transfer their entire music library to an iPod that already has tracks (from iTunes or previous syncs). Rather than incremental sync, they want to wipe and start fresh.

## Command Design

```bash
podkit reset                    # Prompts for confirmation
podkit reset --confirm          # Skip confirmation (for scripts)
podkit reset --dry-run          # Show what would be removed
```

## Implementation

### Core (`@podkit/core`)

Add reset functionality to `IpodDatabase`:
```typescript
// Remove all tracks from the database
database.removeAllTracks(): void

// Or iterate and remove
const tracks = database.getTracks();
for (const track of tracks) {
  track.remove();
}
database.save();
```

May need to add `removeAllTracks()` method to the database class for efficiency, or use existing `track.remove()` in a loop.

### CLI (`@podkit/cli`)

New command `packages/podkit-cli/src/commands/reset.ts`:
- Load device from config or `--device` flag
- Show current track count
- Prompt for confirmation (unless `--confirm`)
- Remove all tracks
- Save database
- Show summary

**Output example:**
```
iPod has 493 tracks.

This will remove ALL tracks from the iPod. Audio files will be deleted.
This action cannot be undone.

Continue? [y/N] y

Removing tracks...
Removed 493 tracks.
```

### Safety

- Require explicit confirmation (no accidental wipes)
- `--dry-run` shows count without removing
- Clear messaging that this deletes audio files, not just database entries

## Files to Modify

- `packages/podkit-core/src/ipod/database.ts` - Add removeAllTracks or ensure remove works in bulk
- `packages/podkit-cli/src/commands/reset.ts` - New command
- `packages/podkit-cli/src/main.ts` - Register command
- `docs/` - Document the reset command
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 podkit reset removes all tracks from iPod
- [x] #2 Confirmation prompt before removal (skip with --confirm)
- [x] #3 Dry-run mode shows what would be removed
- [x] #4 Works with device from config or --device flag
- [x] #5 Clear error if no device connected
- [x] #6 Integration test covers reset workflow
- [x] #7 CLI help and docs updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes (2026-02-26)

### Core Changes
- Added `removeAllTracks(options?: { deleteFiles?: boolean })` method to `IpodDatabase`
- Extended `removeTrack()` to accept optional `deleteFile` parameter
- Files are deleted using `fs.unlinkSync` if `deleteFiles: true`

### CLI Command
- New `reset.ts` command with `--confirm` and `--dry-run` flags
- Uses readline for interactive confirmation prompt
- Supports JSON output format via global `--json` flag
- Works with device from config or `--device` flag

### Tests Added
- Unit tests for command structure (`reset.test.ts`)
- Integration tests for `removeAllTracks()` in `database.integration.test.ts`
- CLI integration tests in `reset.integration.test.ts`
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary\n\nImplemented `podkit reset` command to remove all tracks from an iPod, enabling fresh library transfers.\n\n### Changes Made\n\n**packages/podkit-core/src/ipod/database.ts**\n- Added `removeAllTracks(options?: { deleteFiles?: boolean }): number` method\n- Extended `removeTrack()` to accept `{ deleteFile?: boolean }` option to delete audio files\n\n**packages/podkit-cli/src/commands/reset.ts** (new file)\n- New command with `--confirm` and `--dry-run` flags\n- Interactive confirmation prompt using readline\n- JSON output support\n- Error handling for missing device, invalid paths\n\n**packages/podkit-cli/src/main.ts**\n- Registered reset command\n\n### Tests Added\n- `packages/podkit-cli/src/commands/reset.test.ts` - unit tests for command structure\n- `packages/podkit-cli/src/commands/reset.integration.test.ts` - CLI integration tests\n- `packages/podkit-core/src/ipod/database.integration.test.ts` - added `removeAllTracks()` tests\n\n### Command Usage\n```bash\npodkit reset                    # Prompts for confirmation\npodkit reset --confirm          # Skip confirmation (for scripts)\npodkit reset --dry-run          # Show what would be removed\npodkit reset --json             # JSON output\n```
<!-- SECTION:FINAL_SUMMARY:END -->
