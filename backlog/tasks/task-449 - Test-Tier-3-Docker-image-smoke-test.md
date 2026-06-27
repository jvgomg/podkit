---
id: TASK-449
title: 'Test Tier 3: Docker image smoke test'
status: To Do
assignee: []
created_date: '2026-06-27 19:05'
labels:
  - docker
  - testing
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 3 of the docker testing strategy. Build the image for the native arch and assert it boots and is internally consistent: `--version` works, `doctor` works (not just exists), command-parity holds against the running binary, ffmpeg present and runnable, both `podkit` and `podkit-daemon` binaries present and executable, entrypoint executable. Catches the entire "image drifted from the CLI" class. Local-only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Image builds for native arch within the test
- [ ] #2 `--version` and `doctor` both succeed through the image
- [ ] #3 Command-parity asserted against the running binary
- [ ] #4 ffmpeg present and runnable; both binaries present and executable; entrypoint executable
- [ ] #5 Runnable locally via a documented command
<!-- AC:END -->
