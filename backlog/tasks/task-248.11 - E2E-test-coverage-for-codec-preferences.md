---
id: TASK-248.11
title: E2E test coverage for codec preferences
status: To Do
assignee: []
created_date: '2026-03-27 10:43'
labels:
  - feature
  - transcoding
  - testing
dependencies:
  - TASK-248.08
documentation:
  - doc-024
parent_task_id: TASK-248
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add end-to-end tests covering codec preference resolution in actual sync flows, validating integration seams between resolver, executor, and adapter.

See PRD: doc-024, section "E2E tests."

**Minimum coverage:**
- Sync to mass-storage mock device with Opus codec preference: verify `.opus` file on device with correct content
- Codec change re-sync: sync with AAC, change preference to Opus, re-sync — verify old `.m4a` file removed, new `.opus` file with correct extension present
- Validates the full integration path that unit and integration tests cannot catch
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 E2E test: sync to mass-storage mock device with Opus preference produces `.opus` files
- [ ] #2 E2E test: codec change re-sync removes old `.m4a` file and produces new `.opus` file
- [ ] #3 Tests validate correct file extension, not just file existence
<!-- AC:END -->
