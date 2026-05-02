---
id: TASK-247.06
title: Device info readiness summary
status: Done
assignee: []
created_date: '2026-03-26 01:54'
updated_date: '2026-03-28 15:43'
labels:
  - feature
  - device
dependencies:
  - TASK-247.01
references:
  - packages/podkit-cli/src/commands/device.ts
parent_task_id: TASK-247
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a readiness summary to the `podkit device info` command output.

**PRD:** doc-023 | **Parent:** TASK-247

**Text output:** Brief readiness summary line (e.g. "Readiness: Ready" or "Readiness: Needs initialization — run: podkit device init")

**JSON output:** Full structured readiness data including all stage results.

**User stories:** 7
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 device info text output includes readiness summary line
- [x] #2 device info JSON output includes full structured readiness data
- [x] #3 Each readiness level has a human-readable label and suggested action
- [ ] #4 Unit tests for formatting with various readiness levels
<!-- AC:END -->
