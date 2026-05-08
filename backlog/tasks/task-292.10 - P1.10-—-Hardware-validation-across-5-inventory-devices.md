---
id: TASK-292.10
title: P1.10 — Hardware validation across 5 inventory devices
status: Done
assignee: []
created_date: '2026-05-03 11:30'
updated_date: '2026-05-08 08:12'
labels:
  - device-capability-architecture
  - phase-1
  - hardware-validation
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
  - documents/device-testing-playbook.md
  - documents/test-devices.md
parent_task_id: TASK-292
ordinal: 8100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run the Phase 3 procedure from documents/device-testing-playbook.md against all five inventory devices (mini 2G, nano 2G, nano 4G, nano 7G, iPod 5G Video). Verify behaviour matches spec acceptance criteria. Update documents/test-devices.md with the new "podkit doctor SCSI" / "podkit doctor USB" rows.

This is the user-visible validation gate before P1 release. HITL: requires connecting each physical device.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 mini 2G: SCSI fallback works, SysInfoExtended written successfully
- [ ] #2 nano 2G: SCSI fallback works, SysInfoExtended written successfully
- [ ] #3 nano 4G: USB inquiry used (no SCSI invocation), SysInfoExtended written successfully
- [ ] #4 nano 7G: USB inquiry used (no SCSI invocation), SysInfoExtended written successfully
- [ ] #5 iPod 5G Video: SCSI fallback works, SysInfoExtended written successfully
- [ ] #6 Written XML matches captures in documents/sysinfo-captures/ for each device (modulo per-read crypto blob)
- [ ] #7 documents/test-devices.md updated with podkit-side inquiry results for each device
- [ ] #8 podkit doctor system check passes appropriately for the running system
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Folded into m-18 manual hardware sweep tasks: TASK-S-A (macOS) and TASK-S-B (linka Linux). Hardware validation re-runs against the full inventory there, post-m18 changes baked in.
<!-- SECTION:NOTES:END -->
