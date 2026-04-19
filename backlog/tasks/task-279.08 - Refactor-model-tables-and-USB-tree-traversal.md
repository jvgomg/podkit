---
id: TASK-279.08
title: Refactor model tables and USB tree traversal
status: To Do
assignee: []
created_date: '2026-04-19 17:13'
labels:
  - refactoring
  - device
dependencies:
  - TASK-279.03
  - TASK-279.04
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
parent_task_id: TASK-279
priority: low
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cleanup and refactoring task to improve code quality after the main feature work. Addresses technical debt identified during the SysInfoExtended PRD investigation.

**Model table cleanup:**
- After task-279.04 creates the unified model registry, remove the old separate `IPOD_MODELS` and `SYSINFO_MODEL_NAMES` tables from `ipod-models.ts`
- Ensure all consumers use the new unified registry
- Verify no dead code remains

**macOS USB tree traversal consolidation:**
- `macos.ts` has duplicated recursive tree walks: `findAllBsdNamesForDevice()` and `findUsbDeviceByBsdName()`
- Extract a generic tree search utility with predicate/collector callbacks
- Both functions should delegate to the shared utility
- Also consolidate with new path-to-USB correlation (from task-279.02)

**Readiness pipeline clarity:**
- `determineLevel()` is a growing switch/case — restructure as ordered rules list for clarity
- Not a full plugin system (over-engineering), just clearer conditional logic

**Platform device manager alignment:**
- Tighten shared interfaces so macOS and Linux provide the same USB info structure
- Ensures the SysInfoExtended orchestrator is fully platform-agnostic

See PRD: doc-029 — "Refactoring Opportunities" section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Old separate IPOD_MODELS and SYSINFO_MODEL_NAMES tables removed, all consumers use unified registry
- [ ] #2 macOS USB tree traversal uses shared generic search utility (no duplicated recursive walks)
- [ ] #3 determineLevel() restructured for clarity (ordered rules, not nested conditionals)
- [ ] #4 macOS and Linux device managers provide consistent USB info interface
- [ ] #5 All existing tests pass after refactoring
- [ ] #6 No functional behavior changes — refactoring only
<!-- AC:END -->
