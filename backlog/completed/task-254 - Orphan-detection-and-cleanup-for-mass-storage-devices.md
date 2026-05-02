---
id: TASK-254
title: Orphan detection and cleanup for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-30 14:08'
updated_date: '2026-03-31 15:40'
labels:
  - mass-storage
  - diagnostics
dependencies:
  - TASK-261
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The doctor command's orphan detection currently only works for iPod devices (scans `iPod_Control/Music/`). Mass-storage devices need equivalent functionality — detecting files in content directories that aren't tracked in the `.podkit/state.json` manifest.

**Key design decisions (from design review 2026-03-31):**

1. **Scope to configured content directories only.** The directories to scan come from the device's content path configuration (device preset, config file, CLI arguments, env vars — e.g., `musicDir`, `videoDir`). Files outside these directories are completely ignored — they're the user's business.

2. **Mirrors iPod orphan model.** iPod orphan check scans `iPod_Control/Music/F*/` — the directories the iPod database controls. Mass-storage orphan check scans the equivalent: the configured content directories (e.g., `Music/`, `Video/`).

3. **"Managed" = tracked in state.json manifest.** A file in a content directory that isn't in `managedFiles` is an orphan. This is the same distinction used by `--delete` (which only removes managed files — see TASK-261).

4. **Common scenario: content path changes.** When users change `musicDir` from `Music` to `Tunes`, old files at `Music/` become orphans. Doctor should detect these by scanning both current and any previously-used content directories if discoverable, or at minimum flagging that old directories exist with content.

Should support:
- Detecting unmanaged files in configured content directories
- Offering cleanup (delete orphans)
- Awareness of content path configuration (scan the right directories based on device preset, config, args, envs)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Orphan check scans configured content directories (musicDir, videoDir) on mass-storage devices
- [x] #2 Files in content directories not tracked in state.json managedFiles are reported as orphans
- [x] #3 Files outside content directories are ignored entirely
- [x] #4 Repair mode deletes orphaned files and cleans up empty directories
- [x] #5 Content directory paths are resolved from full config chain (device preset → config file → args → env)
- [x] #6 E2E test covers orphan detection and cleanup on mass-storage device
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation summary

### New files
- `packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.ts` — Mass-storage orphan detection check with repair support
- `packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.test.ts` — 19 unit tests

### Modified files
- `packages/podkit-core/src/diagnostics/types.ts` — Added `contentPaths` to DiagnosticContext
- `packages/podkit-core/src/diagnostics/index.ts` — Registered new check, added contentPaths to RunDiagnosticsInput
- `packages/podkit-cli/src/commands/doctor.ts` — Mass-storage devices now run diagnostics (was "no checks available"), extracted `resolveMassStorageContentPaths` helper, added `runMassStorageRepair`
- `packages/e2e-tests/src/features/mass-storage-sync.e2e.test.ts` — E2E test: orphan detection, repair, and verification

### Design decisions
- Check is self-contained: reads `.podkit/state.json` directly rather than requiring the adapter
- Content path resolution extracted into shared helper to avoid duplication between diagnostics and repair
- Scan deduplicates overlapping content directories (e.g., musicDir="" covers everything)
- Empty directory cleanup walks up to content root but never deletes the root itself
<!-- SECTION:NOTES:END -->
