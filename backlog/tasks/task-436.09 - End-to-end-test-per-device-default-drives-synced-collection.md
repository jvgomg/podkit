---
id: TASK-436.09
title: 'End-to-end test: per-device default drives synced collection'
status: To Do
assignee: []
created_date: '2026-06-24 15:21'
labels:
  - sync
  - collections
  - test
  - e2e
dependencies:
  - TASK-436.06
  - TASK-436.07
parent_task_id: TASK-436
ordinal: 190000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add one light, happy-path end-to-end test pinning the wired behavior: a named device with a per-device default music collection, synced with no `-c` flag, syncs that collection (not the global default). Prior art: existing config/sync e2e tests.

Optionally also cover the `false` (none) case end-to-end if cheap to do in the same fixture.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user story 1 (end-to-end verification).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An e2e test syncs a named device whose per-device default music collection differs from the global default, with no -c flag, and asserts the device default is used
- [ ] #2 The test follows existing config/sync e2e prior art
- [ ] #3 Test passes in the standard e2e run
<!-- AC:END -->
