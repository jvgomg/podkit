---
id: TASK-442
title: 'Daemon: readiness classifier + notify-and-skip for needs-setup/needs-init'
status: To Do
assignee: []
created_date: '2026-06-27 19:04'
labels:
  - daemon
  - docker
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-daemon/src/sync-orchestrator.ts
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A freshly-detected device that needs setup (no authoritative identity) or initialisation (no database) currently produces a generic "sync failed". Add a pure **readiness classifier**: given a detected device, classify `ready | needs-setup | needs-init | unsupported`, driving notify-and-skip with actionable guidance.

Hard rule from doc-052: the daemon NEVER auto-mutates a detected device — never writes SysInfoExtended, never auto-inits a blank DB. Auto-formatting a freshly-detected block device is a data-loss footgun. Detect and guide only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pure readiness classifier: (detectedDevice) -> ready | needs-setup | needs-init | unsupported, unit-tested in isolation
- [ ] #2 needs-setup -> notification tells the user to run `device add` once (with USB passthrough); device is skipped, not retry-spammed
- [ ] #3 needs-init -> notification tells the user to run `device init`; device is skipped
- [ ] #4 Daemon never writes SysInfoExtended and never auto-inits a database
- [ ] #5 Notifications are device-specific and actionable (not generic 'sync failed')
<!-- AC:END -->
