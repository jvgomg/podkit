---
id: TASK-450
title: 'Test Tier 4: daemon integration against a loopback FAT fixture iPod'
status: To Do
assignee: []
created_date: '2026-06-27 19:05'
labels:
  - docker
  - daemon
  - testing
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 4 of the docker testing strategy. The daemon binary + a real CLI subprocess against a loopback FAT image carrying a fixture iPod tree (with existing on-disk identity). Exercises the steady-state path end to end: detect via lsblk -> mount -> sync -> eject, plus SIGTERM graceful-drain and notification to a mock Apprise endpoint. The fast local proxy for "the daemon really syncs a real-ish device" without the VM. Also asserts hard-error-on-generic end to end (fixture lacking authoritative identity -> refuse + notify, never mutate).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Daemon + real CLI subprocess drives detect -> mount -> sync -> eject against a loopback FAT fixture iPod
- [ ] #2 SIGTERM graceful-drain asserted (completed tracks preserved)
- [ ] #3 Notification delivery asserted against a mock Apprise endpoint
- [ ] #4 Hard-error-on-generic asserted: fixture lacking authoritative identity is refused + notified, never mutated
- [ ] #5 Runnable locally via a documented command
<!-- AC:END -->
