---
id: TASK-294.07
title: P3.7 — Echo Mini USB hint + auto-detect at device add
status: To Do
assignee: []
created_date: '2026-05-03 11:33'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
parent_task_id: TASK-294
ordinal: 10070
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Echo Mini's USB VID/PID (`0x071b`/`0x3203`) to the built-in preset's hint table. Wire `podkit device add` (interactive mode) to use the new enumeration framework with both providers and auto-suggest the Echo Mini type when its USB descriptor is detected.

See spec doc-034, Scope > Auto-detection at device add.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Echo Mini USB VID/PID hint added to built-in preset
- [ ] #2 podkit device add (no --type) detects an Echo Mini and suggests/applies the type
- [ ] #3 Existing --type echo-mini flow continues to work
- [ ] #4 User with previously-added Echo Mini in config does not see duplicate detection
- [ ] #5 Integration test with mocked USB tree containing both an iPod and an Echo Mini returns correct identities
<!-- AC:END -->
