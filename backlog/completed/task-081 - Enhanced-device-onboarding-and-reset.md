---
id: TASK-081
title: Enhanced device onboarding and reset
status: Done
assignee: []
created_date: '2026-03-09 22:17'
updated_date: '2026-03-09 22:52'
labels:
  - cli
  - ipod
  - epic
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Improve the device onboarding experience so users can go from "iPod plugged in" to "ready to sync" with a single command, regardless of the device's initial state.

## Background

Currently, setting up an iPod requires multiple manual steps:
1. `podkit init` - create config
2. Manually mount iPod if not auto-mounted
3. `podkit device add <name>` - register device
4. If database missing, user is stuck (no init command works)

Users connecting an iPod should have a smooth experience whether:
- iPod is already set up with music (adopt existing library)
- iPod is blank/fresh (needs initialization)
- iPod is not auto-mounted (common with iFlash mods)
- User is adding a second device to existing setup

## Design Decisions

From design discussion:

### `device add <name> [path]`
- Auto-detect mode: `podkit device add myipod`
- Explicit path mode: `podkit device add myipod /Volumes/IPOD`
- Smart flow handles: mounting → initialization → config registration
- Multiple devices found → error with guidance to specify path

### `device reset`
- Recreates iTunesDB from scratch (not just clearing tracks)
- Preserves filesystem (volume UUID unchanged, config stays valid)
- Use case: corrupted database, fresh start, switching from iTunes

### `device clear`
- Keeps existing behavior: removes content from database
- `--type all` removes everything but keeps database structure
- Different from `reset` which recreates the database

## Sub-tasks

- TASK-081.01: Implement iPod database initialization in libgpod-node
- TASK-081.02: Enhance device add with smart onboarding flow
- TASK-081.03: Implement device reset command

## Related

- Supersedes: TASK-052, TASK-055
- Future work: DRAFT-002 (complete iPod reformat capability)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All sub-tasks completed
- [x] #2 User can onboard any iPod state with single command flow
- [x] #3 Reset command provides clean database recreation
- [x] #4 E2E tests cover full user journeys
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary\n\nImplemented enhanced device onboarding and reset functionality across three sub-tasks:\n\n### TASK-081.01: iPod Database Initialization\n- Added `Database.initializeIpod()` to libgpod-node native bindings\n- Creates iPod_Control directory structure and empty iTunesDB\n- Supports model configuration for proper capability detection\n- Added to podkit-core as `IpodDatabase.initializeIpod()`\n\n### TASK-081.02: Smart Device Onboarding\n- Enhanced `podkit device add <name> [path]` command\n- Auto-detects single connected iPod\n- Errors with guidance when multiple iPods found\n- Offers to initialize uninitialized devices\n- Added `--yes` flag for non-interactive mode\n- Shows next steps (collection add, sync)\n\n### TASK-081.03: Database Reset Command\n- Rewrote `device reset` to recreate database from scratch\n- Strong confirmation (defaults to No)\n- Preserves filesystem and config validity\n- Added `--dry-run` and `--yes` flags\n- Old behavior available via `device clear --type all`\n\n## Files Changed\n\n**libgpod-node:**\n- `native/gpod_binding.cc` - Added `InitIpod()` native function\n- `src/binding.ts` - Added `initIpod()` export\n- `src/database.ts` - Added `Database.initializeIpod()` and `IpodModels`\n- `README.md` - Documented new API\n\n**podkit-core:**\n- `src/ipod/database.ts` - Added `IpodDatabase.initializeIpod()` and `hasDatabase()`\n\n**podkit-cli:**\n- `src/commands/device.ts` - Enhanced `add`, `reset`, and `init` subcommands\n\n## Testing\n\n- 7 new integration tests for `Database.initializeIpod()`\n- All 66 E2E tests pass\n- All 296 libgpod-node tests pass"]

## Additional Improvements

### E2E Tests (19 new tests)
- `device add` with explicit path and existing database
- `device add` JSON output verification
- `device add` first device becomes default
- `device add` invalid/duplicate name validation
- `device add` with uninitialized device (auto-init)
- `device reset` database recreation
- `device reset` JSON output
- `device reset` dry-run mode
- `device reset` on uninitialized device (shows 'create' not 'recreate')
- `device init` on uninitialized device
- `device init` --force for existing database
- `device init` JSON output

### Edge Case: Reset on Uninitialized Device
- Improved messaging: 'Creating' vs 'Recreating'
- No confirmation required when no database exists
- Dry-run correctly indicates no existing database

## Important Notes

### `device reset` vs `device clear`

**`device reset`** recreates the iPod database from scratch but does **NOT** delete orphaned audio files in `iPod_Control/Music/`. This is by design - the reset command focuses on recreating a fresh, valid database.

If you want to completely wipe all content (database entries AND files):
1. Run `podkit device clear --type all` first (removes tracks and deletes files)
2. Then run `podkit device reset` if needed

Alternatively, `device clear --type all` alone may be sufficient if you just want to remove all content without recreating the database structure.

Implemented enhanced device onboarding and reset functionality across libgpod-node, podkit-core, and podkit-cli.

**Changes:**
- Added `Database.initializeIpod()` native binding with 12 iPod model constants
- Enhanced `device add` with optional path argument and auto-initialization
- Rewrote `device reset` to recreate database from scratch instead of clearing tracks
- Added `--yes` and `--dry-run` flags for scripting support
- Added comprehensive test coverage (7 integration + 19 E2E tests)
<!-- SECTION:FINAL_SUMMARY:END -->
