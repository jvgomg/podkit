---
id: TASK-069.16
title: E2E video sync tests
status: To Do
assignee: []
created_date: '2026-03-08 16:05'
labels:
  - video
  - phase-5
  - testing
dependencies: []
references:
  - packages/e2e-tests/src/commands/sync.e2e.test.ts
  - packages/e2e-tests/README.md
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
End-to-end tests for video sync workflow using the e2e-tests package.

Tests full workflow from CLI invocation through to iPod database verification.

**Depends on:** TASK-069.15 (CLI), TASK-069.02 (Fixtures)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 E2E test: Sync compatible video (passthrough)
- [ ] #2 E2E test: Sync incompatible video (transcode)
- [ ] #3 E2E test: Sync TV show with correct metadata
- [ ] #4 E2E test: Sync movie with correct metadata
- [ ] #5 E2E test: Dry-run shows accurate video analysis
- [ ] #6 E2E test: Quality preset affects output
- [ ] #7 E2E test: Source quality capping works
- [ ] #8 E2E test: Device without video support shows warning
- [ ] #9 Tests run on dummy iPod target
- [ ] #10 Tests documented in e2e-tests README
<!-- AC:END -->
