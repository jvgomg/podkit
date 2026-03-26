---
id: TASK-247
title: Device Readiness Diagnostics
status: To Do
assignee: []
created_date: '2026-03-26 01:53'
labels:
  - feature
  - device
dependencies: []
documentation:
  - doc-023
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a device readiness diagnostic system that checks every stage of device health — from USB connection through to database integrity — and gives users actionable guidance at each failure point.

**PRD:** doc-023

The readiness pipeline is a linear progression of 6 stages:
```
USB Connected → Partitioned → Has Filesystem → Mounted (with iPod Structure) → Valid SysInfo → Has Database
```

Readiness levels: `ready`, `needs-repair`, `needs-init`, `needs-format`, `needs-partition`, `hardware-error`, `unknown`.

**Enhanced commands:** `device scan` (full pipeline + verbose output), `doctor` (readiness before DB checks), `device info` (readiness summary), `device init` (readiness-aware with stubs for format/partition).

**Key features:** OS error code interpretation, USB discovery for unpartitioned devices, SysInfo validation, interactive mount prompt, `--mount` flag, `--report` flag, multi-device output, config relationship display.

**Scope:** iPod devices only. Mass-storage devices continue with their existing path-existence check and are shown in scan with a note that readiness checks are not applicable.

**Platforms:** macOS and Linux. Windows remains unsupported with existing graceful degradation. Docker containers should degrade gracefully when USB discovery tools are unavailable.

**Architectural note:** Readiness checks should implement the existing `DiagnosticCheck` interface with an extended context that makes `db` optional, keeping one unified diagnostic system rather than two parallel frameworks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 12 subtasks completed
- [ ] #2 All 22 user stories from PRD doc-023 addressed
- [ ] #3 HITL testing session completed with real hardware
- [ ] #4 Changesets created for affected packages
<!-- AC:END -->
