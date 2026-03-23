---
id: TASK-210
title: Add extension-mismatch and missing-file doctor checks
status: To Do
assignee: []
created_date: '2026-03-23 14:57'
labels:
  - cli
  - feature
  - devices
  - diagnostics
dependencies: []
references:
  - TASK-138
  - packages/podkit-core/src/diagnostics/
  - packages/podkit-core/src/diagnostics/checks/orphans.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add two new checks to the `podkit doctor` diagnostics framework to detect common iPod integrity issues.

Follows on from TASK-138 which established the diagnostics framework and implemented orphan-file and artwork checks.

## Sub-task 1: Extension-mismatch detection

Detect tracks where the file extension doesn't match the actual file content (e.g. AAC content stored with `.mp3` extension). Use magic bytes or file header inspection to determine actual format and compare against the `ipod_path` extension.

**Context:** This was the original motivating bug from TASK-136 — a self-healing sync bug caused AAC files to be stored with `.mp3` extensions, and tracks wouldn't play on the iPod.

**Repair strategy:** Use `replaceTrackFile` to re-copy with correct extension, or rename file and update `ipod_path`.

## Sub-task 2: Missing-file detection

Detect database entries that reference files which don't exist on disk. This is the inverse of the existing orphan-files check.

**Repair strategy:** Remove database entries for tracks with missing files (flag for re-sync on next `podkit sync`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 podkit doctor detects file extension mismatches (e.g. AAC content with .mp3 extension)
- [ ] #2 podkit doctor --repair extension-mismatch fixes mismatched extensions
- [ ] #3 podkit doctor detects missing files (DB entry exists but file absent from disk)
- [ ] #4 podkit doctor --repair missing-files removes DB entries for missing files
- [ ] #5 Both checks support --dry-run mode
- [ ] #6 Tests cover detection and repair for both check types
<!-- AC:END -->
