---
id: DRAFT-007
title: >-
  Decide: should `device add` warn/block when identity is empty (files absent +
  USB unreachable)?
status: Draft
assignee: []
created_date: '2026-05-28 21:28'
labels:
  - needs-discussion
  - device
dependencies: []
references:
  - test-packages/e2e-tests/src/commands/device.test.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`commands/device.test.ts:158-191` ("persists the device even when both identity files are absent and USB is unreachable") documents that firmware inquiry lands in an `unwritable` state and device-add then *proceeds anyway* with cascade-derived (empty) identity rather than warning or blocking.

Open question: is silently persisting an empty-identity device the right UX, or should podkit warn the user (and/or refuse) when it can't establish any device identity? A device with empty identity may behave unexpectedly in later commands. Needs a UX/design decision.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decision recorded: silent-persist vs warn vs block on empty identity
- [ ] #2 If warn/block — implementation task filed and the device.test assertion updated to expect the warning/blocking behaviour
<!-- AC:END -->
