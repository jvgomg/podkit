---
id: TASK-458.08
title: '[HITL] Real-device verification — iPod shuffle 4g end-to-end'
status: Done
assignee: []
created_date: '2026-07-05 14:24'
updated_date: '2026-07-06 22:27'
labels:
  - device-capability
  - read-only
  - verification
  - hitl
milestone: m-18
dependencies:
  - TASK-458.01
  - TASK-458.02
  - TASK-458.03
  - TASK-458.04
  - TASK-458.05
  - TASK-458.06
  - TASK-458.07
parent_task_id: TASK-458
ordinal: 217000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Human-in-the-loop capstone: verify the whole epic on real hardware once all AFK slices are merged. Requires a physical mounted iPod shuffle 4g (the device from the original report). This is the acceptance run the AFK e2e tests approximate with a synthetic persona.

Confirms the reported bug is dead and the read-only model behaves end-to-end on a genuine device.

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `device scan` shows the mounted shuffle as a mounted read-only iPod with its volume path (no "USB only", no "not mounted")
- [x] #2 `device info` shows read-only + hardware-verified
- [x] #3 `device archive` (auto-detect AND -d path) archives the shuffle successfully
- [x] #4 `device music` lists its tracks
- [x] #5 `sync` on the shuffle hard-errors with DEVICE_READ_ONLY and the real reason
- [x] #6 `doctor` diagnoses the shuffle; `doctor --repair` refuses cleanly
- [x] #7 A normal writable iPod still syncs unaffected
<!-- AC:END -->
