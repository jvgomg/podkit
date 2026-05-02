---
id: TASK-176
title: 'Diagnostics: orphan file detection and cleanup'
status: Done
assignee: []
created_date: '2026-03-21 21:18'
updated_date: '2026-03-21 21:35'
labels:
  - graceful-shutdown
  - diagnostics
dependencies: []
references:
  - packages/podkit-core/src/diagnostics/index.ts
  - packages/podkit-core/src/diagnostics/types.ts
  - packages/podkit-core/src/diagnostics/checks/artwork.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a diagnostic check that detects orphaned audio/video files on the iPod — files in iPod_Control/Music/F* that are not referenced by the iTunesDB.

**New file:** `packages/podkit-core/src/diagnostics/checks/orphans.ts`

**Check behavior:**
- Scan iPod_Control/Music/F* directories for all files
- Compare against tracks in the database
- Report orphan count and total wasted space
- Status: pass (no orphans), warn (orphans found)

**Repair behavior:**
- Delete orphaned files with progress reporting
- Report freed space
- Requirement: writable-device

**Scope:** Music and video files only (not artwork/ithmb)

Register in `packages/podkit-core/src/diagnostics/index.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Diagnostic check scans iPod_Control/Music/F* for unreferenced files
- [x] #2 Reports orphan count and total size in check result
- [x] #3 Repair deletes orphaned files with progress callbacks
- [x] #4 Repair reports freed space in result
- [x] #5 Dry-run mode lists orphans without deleting
- [x] #6 Check registered in diagnostics index, visible in podkit doctor output
- [x] #7 Unit tests with mock iPod filesystem
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented orphan file detection diagnostic check.

## Files created
- `packages/podkit-core/src/diagnostics/checks/orphans.ts` — Check and repair implementation
- `packages/podkit-core/src/diagnostics/checks/orphans.test.ts` — 11 unit tests

## Files modified
- `packages/podkit-core/src/diagnostics/index.ts` — Registered `orphanFilesCheck` in the CHECKS array

## Implementation
- **Check:** Scans `iPod_Control/Music/F*` directories, compares files on disk against tracks in iTunesDB. Returns `skip` (no music dir), `pass` (no orphans), or `warn` (orphans found with count and wasted space).
- **Repair:** Deletes orphan files with progress reporting, cleans up empty F* directories. Supports dry-run mode. Requires `writable-device`.
- **Path conversion:** Handles iPod colon-separated paths (`:iPod_Control:Music:F00:file.m4a`) to filesystem paths.

## Quality gates
- TypeScript: passes `tsc --noEmit`
- Tests: 11/11 pass (35 assertions)
<!-- SECTION:FINAL_SUMMARY:END -->
