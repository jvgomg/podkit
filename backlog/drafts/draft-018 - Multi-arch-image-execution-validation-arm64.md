---
id: DRAFT-018
title: Multi-arch image execution validation (arm64)
status: Draft
assignee: []
created_date: '2026-06-27 19:05'
labels:
  - docker
  - testing
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
priority: low
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Beyond-scope for the alignment release. The image smoke test (Tier 3) builds and runs the native arch only. This task validates that the arm64 binaries are the correct architecture and execute (e.g. via qemu-user), so a broken cross-arch artifact can't ship unnoticed. Draft until prioritised.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 arm64 binaries asserted to be the correct architecture
- [ ] #2 arm64 image executes (qemu-user or equivalent) for `--version`/`doctor`
- [ ] #3 Runnable locally
<!-- AC:END -->
