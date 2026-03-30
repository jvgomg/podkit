---
id: TASK-254
title: Orphan detection and cleanup for mass-storage devices
status: To Do
assignee: []
created_date: '2026-03-30 14:08'
labels:
  - mass-storage
  - diagnostics
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The doctor command's orphan detection currently only works for iPod devices (scans `iPod_Control/Music/`). Mass-storage devices need equivalent functionality — detecting files in content directories that aren't tracked in the `.podkit/state.json` manifest.

This becomes especially relevant when users change content path prefixes (e.g., `musicDir` from `Music` to `Tunes`), since there's no automatic migration — old files become orphans at the previous path.

Should support:
- Detecting unmanaged files in configured content directories
- Offering cleanup (delete orphans)
- Awareness of content path configuration (scan the right directories)
<!-- SECTION:DESCRIPTION:END -->
