---
id: TASK-459
title: >-
  Sync emits distinct IPOD_NEEDS_INIT code for a blank device (activates daemon
  needs-init path)
status: To Do
assignee: []
created_date: '2026-07-06 22:58'
labels:
  - daemon
  - sync
  - docker
milestone: m-22
dependencies:
  - TASK-442
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-daemon/src/readiness-classifier.ts
priority: medium
ordinal: 219000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The daemon readiness classifier (TASK-442) already has a `needs-init` branch and a "Device Needs Init" notification wired, but it is dormant: `podkit sync` never emits an `IPOD_NEEDS_INIT` code. A blank device (mounted iPod with no database) currently surfaces via the overloaded `IPOD_OPEN_FAILED`, so the daemon can't distinguish "needs init" from a genuine DB-open failure.

Make `podkit sync` detect a blank device (no iTunesDB) before the db-open gate and surface a distinct typed `IPOD_NEEDS_INIT` error with remediation pointing at `podkit device init`. This activates the classifier's existing needs-init path end-to-end and closes TASK-442 AC#3.

Hard rule (doc-052): the daemon still never auto-inits — it detects and guides only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 podkit sync detects a blank device (no database) before the db-open gate and emits a distinct typed IPOD_NEEDS_INIT error (not the overloaded IPOD_OPEN_FAILED)
- [ ] #2 Error remediation tells the user to run `podkit device init`
- [ ] #3 Daemon classifies IPOD_NEEDS_INIT -> needs-init and sends the 'Device Needs Init' notification, then skips (verified end-to-end)
- [ ] #4 TASK-442 AC#3 satisfied; the 'Reserved' comment in readiness-classifier.ts is removed
- [ ] #5 Changeset added (user-facing: podkit + @podkit/core)
<!-- AC:END -->
