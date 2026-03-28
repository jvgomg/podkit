---
id: TASK-247.10
title: Diagnostic report (--report flag)
status: Done
assignee: []
created_date: '2026-03-26 01:55'
updated_date: '2026-03-28 15:50'
labels:
  - feature
  - device
dependencies:
  - TASK-247.01
  - TASK-247.02
references:
  - packages/podkit-cli/src/commands/device.ts
parent_task_id: TASK-247
priority: low
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a `--report` flag to `device scan` that outputs a diagnostic report to stdout, designed for pasting into GitHub issues.

**PRD:** doc-023 | **Parent:** TASK-247

**Report contents:**
- podkit version
- OS version and platform
- All readiness check results with details
- Interpreted error messages (from error code interpreter)
- Any warnings or notes

**Redaction rules (define early, test explicitly):**
- `/Users/<name>/` → `/Users/****/`
- `/home/<name>/` → `/home/****/`
- Volume names left as-is (needed for debugging)
- Config file paths redacted

**Output:** Plain text to stdout — users redirect to file or pipe as needed. No special file format.

**User stories:** 18
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 --report flag on device scan outputs diagnostic report to stdout
- [x] #2 Report includes podkit version, OS version, platform
- [x] #3 Report includes all readiness check results with details
- [x] #4 File paths with usernames redacted on both macOS and Linux
- [x] #5 Volume names preserved (not redacted)
- [x] #6 Report is plain text suitable for pasting into GitHub issues
- [x] #7 Unit tests for report format and redaction rules
<!-- AC:END -->
