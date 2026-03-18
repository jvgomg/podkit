---
id: TASK-157
title: GitHub Actions CI matrix for Linux (Ubuntu + Alpine)
status: To Do
assignee: []
created_date: '2026-03-18 12:25'
labels:
  - infra
  - ci
  - linux
milestone: Linux Device Manager
dependencies:
  - TASK-150
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Linux runners to the CI test matrix so the full test suite runs on macOS, Debian (Ubuntu), and Alpine.

- Add `ubuntu-latest` to the existing matrix
- Add an Alpine container job (e.g. `container: alpine:3.21`)
- Platform-conditional tests: lsblk tests only on Linux, diskutil tests only on macOS
- Ensure native addon builds on all platforms

Depends on Lima infrastructure (TASK-150) being validated first to confirm the dependency lists are correct.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CI runs test suite on macOS
- [ ] #2 CI runs test suite on Ubuntu (Debian)
- [ ] #3 CI runs test suite on Alpine container
- [ ] #4 Platform-conditional tests skip correctly on non-matching OS
- [ ] #5 Native addon builds on all CI platforms
<!-- AC:END -->
