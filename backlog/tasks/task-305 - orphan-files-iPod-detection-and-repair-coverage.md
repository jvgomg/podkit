---
id: TASK-305
title: 'orphan-files (iPod): detection and repair coverage'
status: To Do
assignee: []
created_date: '2026-05-08 07:23'
updated_date: '2026-05-12 11:56'
labels:
  - testing
  - doctor
  - orphans
  - vm-coverage
milestone: m-19
dependencies: []
priority: medium
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the iPod-flavoured `orphan-files` check across realistic combinations of files-on-disk vs library-references. The check scans `iPod_Control/Music/F*` directories and reports any audio file not referenced by an iTunesDB track, plus optional verbose breakdown by directory and extension and a CSV export path. Today's coverage is shallow — the breakdown logic, the largest-orphans listing, and the repair edge cases (read-only filesystem, partial deletion failure) aren't exercised.

For every test, run `podkit doctor --device <fixture> --json --no-system` and assert on the `orphan-files` entry in `checks[]`: `status`, `summary`, `repairable`, `details.orphanCount`, `details.wastedBytes`, `details.orphans` (array of {path, size}). For CSV tests, run `podkit doctor --device <fixture> --format csv --no-system` and assert on stdout shape.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; use `DevicePersona.partitionLayout` and `expectedCapabilities` for injectable fakes; orphan-state variations are test-local mutations
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner against the `ipod-nano-7g-populated` persona (populated iTunes library provides the baseline)
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No F* directories at all → status=skip or pass with details.orphanCount=0
- [ ] #2 All files on disk are library-referenced → status=pass, details.orphanCount=0, details.wastedBytes=0
- [ ] #3 Some files on disk not referenced by library → status=warn+repairable, details.orphanCount and wastedBytes reflect the orphan set, details.orphans lists each path+size
- [ ] #4 Library references files that do not exist on disk → status=pass for orphan-files check (this is a separate concern, not orphan detection)
- [ ] #5 Orphans spread across multiple F* directories → details.orphans contains all of them; CSV export contains every entry
- [ ] #6 CSV format: header is 'path,size'; each row is the orphan's path and byte size; paths containing commas/quotes are properly CSV-escaped
- [ ] #7 Verbose text output groups orphans by F* directory with count and total size
- [ ] #8 Verbose text output groups orphans by file extension with count and total size
- [ ] #9 Verbose text output lists the 10 largest orphan files by size, descending
- [ ] #10 Repair --repair orphan-files deletes all detected orphans; subsequent doctor reports pass
- [ ] #11 Repair --dry-run prints planned deletions without modifying the filesystem
- [ ] #12 Repair handles a mix of deletable and undeletable files (e.g. read-only): reports per-file errors in details, success=false when any fail
- [ ] #13 Repair preserves library-referenced files (asserted by re-running diff after repair)
- [ ] #14 Check is iPod-only (applicableTo: ['ipod']); mass-storage devices use orphan-files-mass-storage instead
<!-- AC:END -->
