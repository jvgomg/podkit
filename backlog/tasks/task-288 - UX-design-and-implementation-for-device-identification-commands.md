---
id: TASK-288
title: UX design and implementation for device identification commands
status: To Do
assignee: []
created_date: '2026-05-02 15:44'
labels: []
milestone: m-18
dependencies:
  - TASK-287
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design and implement UX improvements for device identification across all relevant podkit commands. This is a think-discuss-collaborate-then-implement task.

Commands to consider:
- `podkit device info` — how to surface richer identification data (firmware-reported capabilities, inquiry method used, identification fidelity level)
- `podkit device scan` — how to present generation-level vs model-level identification
- `podkit doctor` — how to communicate inquiry method availability, identification gaps, and repair options
- `podkit sync` — how to warn when running with degraded identification (e.g., generation-level only, missing checksum data)
- Any other commands that surface device information

Consider: progressive disclosure (basic info by default, detail with -v), consistent terminology for identification strategies, clear communication when identification is incomplete, actionable guidance for users to improve identification (e.g., "run podkit doctor --repair").
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 UX design discussed and agreed with user
- [ ] #2 podkit device info shows firmware-reported capabilities when available
- [ ] #3 podkit doctor clearly communicates inquiry method availability
- [ ] #4 Degraded identification states have clear user-facing messages with actionable guidance
- [ ] #5 Consistent terminology for identification strategies across all commands
- [ ] #6 Implementation complete with tests
<!-- AC:END -->
