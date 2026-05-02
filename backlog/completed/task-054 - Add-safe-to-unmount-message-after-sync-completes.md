---
id: TASK-054
title: Add safe-to-unmount message after sync completes
status: Done
assignee: []
created_date: '2026-02-26 00:16'
updated_date: '2026-03-09 14:41'
labels:
  - cli
  - sync
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After a successful sync operation, display a message informing the user it's safe to unmount/eject their iPod.

**Current behavior:**
- Sync completes with summary of tracks synced
- No guidance about ejecting

**Desired behavior:**
1. Add `--eject` flag to sync command that auto-ejects on success
2. When `--eject` is NOT used, show tip: `Tip: Run 'podkit eject' to safely disconnect, or use --eject next time.`
3. When `--eject` IS used and succeeds, show: `iPod ejected. Safe to disconnect.`

**Notes:**
- Only show on successful sync (not dry-run, not on errors)
- Keep message simple and clear
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Message or auto-eject after successful sync
- [x] #2 Tip message NOT shown on dry-run
- [x] #3 Tip message NOT shown if sync had errors
- [x] #4 Add --eject flag to sync command
- [x] #5 When --eject used, actually eject the device
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation Summary

Added safe-to-eject UX to the sync command with two features:

### 1. `--eject` flag
New option that auto-ejects the iPod after a successful sync:
```bash
podkit sync --eject
```

Output when used:
```
=== Summary ===
Synced 50 items successfully
Duration: 2m 30s

Ejecting iPod...
iPod ejected. Safe to disconnect.
```

### 2. Tip message
When `--eject` is NOT used, shows a helpful tip after successful sync:
```
Tip: Run 'podkit eject' to safely disconnect, or use --eject next time.
```

### Conditions
Both features only activate when:
- Sync is NOT a dry-run
- Sync completed without errors
- Output is not JSON mode or quiet mode

### JSON output
When using `--json` with `--eject`, the output includes an `eject` field:
```json
{
  "success": true,
  "eject": {
    "requested": true,
    "success": true
  }
}
```

### Files changed
- `packages/podkit-cli/src/commands/sync.ts`

## Tests Added

### Unit Tests (packages/podkit-cli/src/commands/sync.test.ts)
- Verify `--eject` option is defined on sync command
- Verify `--dry-run` option exists
- Verify `--delete` option exists

### E2E Tests (packages/e2e-tests/src/commands/sync.e2e.test.ts)
New `eject behavior` describe block with 4 tests:
1. **shows eject tip after successful sync** - Verifies tip message appears
2. **does NOT show eject tip on dry-run** - Verifies tip is suppressed on dry-run
3. **attempts to eject with --eject flag** - Verifies ejecting message appears
4. **includes eject status in JSON output with --eject** - Verifies JSON includes eject field
<!-- SECTION:FINAL_SUMMARY:END -->
