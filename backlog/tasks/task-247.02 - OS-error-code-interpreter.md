---
id: TASK-247.02
title: OS error code interpreter
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
  - packages/podkit-core/src/device/platforms/macos.ts
  - packages/podkit-core/src/device/platforms/linux.ts
parent_task_id: TASK-247
priority: medium
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create an error code interpretation module that translates OS error codes into human-readable explanations, and integrate it into the readiness pipeline.

**PRD:** doc-023 | **Parent:** TASK-247

**Error code mapping:**
- errno 71 (EPROTO): "Device communication failed. The device may be uninitialized, have a corrupted filesystem, or have a bad USB connection."
- errno 13 (EACCES): "Permission denied."
- errno 19 (ENODEV): "Device not found. It may have been disconnected."
- errno 5 (EIO): "I/O error. Possible hardware failure or bad cable."
- Additional common codes as discovered during implementation

**Design:**
- Parse both numeric codes and common OS error message patterns (e.g. "operation not permitted")
- **Always include the raw error message alongside the interpretation** — interpretation is best-effort since error messages vary by OS version and locale (macOS localizes error messages)
- Integrate into readiness pipeline — failed stages include interpreted error in their details

**User stories:** 2, 14
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Known error codes (71, 13, 19, 5) produce correct human-readable explanations
- [x] #2 Unknown error codes produce generic message with raw error preserved
- [x] #3 Raw error message always included alongside interpretation
- [x] #4 Error patterns parsed from string messages (not just numeric codes)
- [x] #5 Integrated into readiness pipeline failure details
- [x] #6 Unit tests for all known codes, unknown codes, and pattern parsing
<!-- AC:END -->
