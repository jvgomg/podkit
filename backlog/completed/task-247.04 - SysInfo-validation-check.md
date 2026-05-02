---
id: TASK-247.04
title: SysInfo validation check
status: Done
assignee: []
created_date: '2026-03-26 01:54'
updated_date: '2026-03-28 15:29'
labels:
  - feature
  - device
dependencies:
  - TASK-247.01
references:
  - packages/podkit-core/src/ipod/device-validation.ts
  - packages/podkit-core/src/ipod/database.ts
parent_task_id: TASK-247
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement SysInfo validation as an independently callable check and integrate it as readiness pipeline stage 5.

**PRD:** doc-023 | **Parent:** TASK-247

**SysInfo file:** `iPod_Control/Device/SysInfo` contains `ModelNumStr` (e.g. `MA147`) which libgpod needs for device capabilities (artwork format, video support, storage layout).

**Check states:**
- **Pass:** SysInfo exists and contains a valid `ModelNumStr` that maps to a known iPod model
- **Warn:** SysInfo exists but model is unrecognized — device works but with reduced capability confidence (not a failure per user story 22)
- **Fail (missing):** SysInfo file does not exist
- **Fail (corrupt):** SysInfo exists but is unreadable/unparseable — explicitly define "corrupt" as: binary file, missing `ModelNumStr` key, invalid UTF-8, truncated/empty file

**Suggested actions:**
- Missing/corrupt: suggest `podkit device reset` (recreates DB + SysInfo) or manual SysInfo creation with correct model number
- Unrecognized model: informational warning only

**Integration:**
- Callable independently so `doctor` can verify SysInfo integrity on an otherwise healthy device
- Integrated into readiness pipeline as stage 5 (between iPod Structure and Database)
- SysInfo issues produce `needs-repair` readiness level (iPod structure exists, specific file is broken)
- Builds on existing `validateDevice()` in `device-validation.ts` which handles `unknown_model` post-DB-open — readiness pipeline catches this earlier

**User stories:** 21, 22
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pass state: SysInfo exists with known ModelNumStr
- [x] #2 Warn state: SysInfo exists with unrecognized model (not a failure)
- [x] #3 Fail state: SysInfo missing
- [x] #4 Fail state: SysInfo corrupt — binary file, missing key, invalid UTF-8, truncated
- [x] #5 Suggested actions included in check result for each fail state
- [x] #6 Check callable independently (not just via pipeline)
- [x] #7 Integrated as readiness pipeline stage 5
- [x] #8 Unit tests for all states including each corrupt variant
<!-- AC:END -->
