---
id: TASK-247.09
title: Multi-device output and config relationship
status: To Do
assignee: []
created_date: '2026-03-26 01:55'
labels:
  - feature
  - device
dependencies:
  - TASK-247.01
references:
  - packages/podkit-cli/src/commands/device.ts
parent_task_id: TASK-247
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enhance `device scan` output to handle multiple iPods with per-device headers and config relationship display.

**PRD:** doc-023 | **Parent:** TASK-247

**Multi-device output format:**
```
iPod Classic 7G (disk5s2)
  Configured as: myipod

  ✓ USB Connection
    iPod Classic 7G (Apple 0x05ac)
  ...

iPod Nano 5G (disk6s1)
  Not configured — run: podkit device add

  ✓ USB Connection
  ...
```

**Config matching:** Compare discovered devices against configured devices by UUID/path. Show "Configured as: <name>" or "Not configured — run: podkit device add".

**Independent pipelines:** Each device gets its own readiness pipeline run. One device's failure does not affect another's output.

**User stories:** 11, 17
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each device gets a header with model name and disk identifier
- [ ] #2 Config relationship shown: configured name or not-configured guidance
- [ ] #3 Independent readiness pipeline per device
- [ ] #4 One device's failure doesn't affect another's output
- [ ] #5 Unit tests for multi-device output formatting
- [ ] #6 Unit test for config matching logic
<!-- AC:END -->
