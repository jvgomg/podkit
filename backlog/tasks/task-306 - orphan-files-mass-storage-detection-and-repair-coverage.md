---
id: TASK-306
title: 'orphan-files-mass-storage: detection and repair coverage'
status: To Do
assignee: []
created_date: '2026-05-08 07:23'
labels:
  - testing
  - doctor
  - orphans
  - mass-storage
  - vm-coverage
milestone: m-19
dependencies: []
priority: medium
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the mass-storage flavour of orphan-file detection across the layouts produced by all built-in presets (echo-mini, generic, rockbox) plus user-customised content paths. Mass-storage orphan logic is meaningfully different from iPod orphan logic — there's no library database; "managed" files are identified by being inside the configured `musicDir` / `moviesDir` / `tvShowsDir` and having a file pattern that podkit would have produced. Anything else in those directories is an orphan.

For every test, run `podkit doctor --device <fixture> --json --no-system` against a mass-storage device fixture and assert on the `orphan-files-mass-storage` entry in `checks[]`. The fixture's content-paths configuration (preset + per-device overrides + global defaults) should be varied to exercise the resolution chain.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 echo-mini preset, no orphans → status=pass, details.orphanCount=0
- [ ] #2 echo-mini preset, one unmanaged file dropped into Music/ → status=warn+repairable, details.orphanCount=1, details.wastedBytes=fileSize
- [ ] #3 generic preset (configurable content paths), orphan in default location → status=warn
- [ ] #4 rockbox preset, orphan inside Rockbox-specific layout → status=warn (preset's content paths should resolve correctly)
- [ ] #5 Files outside configured content paths are not flagged as orphans (e.g. files in a non-music root directory)
- [ ] #6 Per-device musicDir override takes precedence over global deviceDefaults.musicDir which takes precedence over preset default; orphan detection respects the resolved path
- [ ] #7 Repair --repair orphan-files-mass-storage deletes detected orphans; subsequent doctor reports pass
- [ ] #8 Repair --dry-run prints planned deletions without modifying anything
- [ ] #9 Repair preserves managed files (verified by listing managed files before and after)
- [ ] #10 Repair handles partial failure (read-only file in the orphan set) — reports per-file error in details, success=false
- [ ] #11 Check is mass-storage-only (applicableTo: ['mass-storage']); iPod devices skip it
- [ ] #12 iPod-flavoured orphan-files check is NOT applied to mass-storage devices (verified by absence of 'orphan-files' in JSON checks[])
<!-- AC:END -->
