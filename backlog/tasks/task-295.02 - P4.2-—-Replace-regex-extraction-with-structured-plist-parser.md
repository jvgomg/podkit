---
id: TASK-295.02
title: P4.2 — Replace regex extraction with structured plist parser
status: To Do
assignee: []
created_date: '2026-05-03 11:34'
labels:
  - device-capability-architecture
  - phase-4
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the regex-based identity extraction in `readSysInfoExtended` (P1's legacy path) with the structured plist parser. Existing tests adjusted to reflect richer extraction (parser handles cases the regex couldn't — nested dicts, arrays, integers).

See spec doc-035, Scope > Move SysInfoExtended file I/O > new implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 readSysInfoExtended uses parsePlist + extractFromPlist (no regex)
- [ ] #2 Existing extraction-related tests pass; new tests added for richer fields
- [ ] #3 Identity extraction (firewireGuid, serialNumber) byte-identical to regex output for all 5 captured XML fixtures
- [ ] #4 Capabilities extraction enabled where firmware data was previously ignored
<!-- AC:END -->
