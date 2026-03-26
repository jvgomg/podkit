---
id: TASK-247.13
title: Changesets for device readiness diagnostics
status: To Do
assignee: []
created_date: '2026-03-26 01:56'
labels:
  - release
  - device
dependencies:
  - TASK-247.01
  - TASK-247.02
  - TASK-247.03
  - TASK-247.04
  - TASK-247.05
  - TASK-247.06
  - TASK-247.07
  - TASK-247.08
  - TASK-247.09
  - TASK-247.10
parent_task_id: TASK-247
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create changesets for all packages affected by the device readiness diagnostics feature.

**Parent:** TASK-247

**Affected packages:**
- `@podkit/core` — new readiness pipeline, error interpreter, USB discovery, SysInfo validation, diagnostics refactoring (minor bump)
- `podkit` (CLI) — enhanced scan, doctor, info, init commands; new --mount and --report flags (minor bump)

**Changeset content should cover:**
- New device readiness diagnostic system with 6-stage pipeline
- Enhanced `device scan` with verbose readiness output, `--mount` flag, `--report` flag, multi-device support
- Enhanced `podkit doctor` with two-phase diagnostics (readiness + database)
- Enhanced `device info` with readiness summary
- Enhanced `device init` with readiness-aware guidance
- OS error code interpretation for actionable error messages
- USB discovery for unpartitioned/uninitialized iPods
- SysInfo validation with early detection of missing/corrupt files

**Timing:** Create after all implementation subtasks are complete but before the HITL testing session, so the testing session validates the release-ready state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Changeset created for @podkit/core (minor)
- [ ] #2 Changeset created for podkit CLI (minor)
- [ ] #3 Changeset descriptions cover all user-facing changes
- [ ] #4 bunx changeset validates successfully
<!-- AC:END -->
