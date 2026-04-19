---
id: TASK-279.06
title: Update readiness pipeline and doctor for SysInfoExtended
status: To Do
assignee: []
created_date: '2026-04-19 17:12'
labels:
  - device
  - cli
dependencies:
  - TASK-279.05
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
parent_task_id: TASK-279
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the readiness pipeline's SysInfo stage and the doctor command to account for SysInfoExtended. Add a new repairable check that triggers the SysInfoExtended orchestrator.

**Readiness pipeline changes (readiness.ts):**
- SysInfo stage now checks for SysInfoExtended in addition to SysInfo
- Pass: SysInfoExtended present with valid content, OR SysInfo present with valid ModelNumStr
- Warn: SysInfo present but SysInfoExtended missing (device works but may lack full capability data)
- Fail: both missing → suggest `podkit doctor --repair sysinfo-extended`
- Use checksum type mapping (from task-279.04) to determine severity: hash58+ devices FAIL without SysInfoExtended, older devices WARN

**Doctor command changes (doctor.ts):**
- New repairable check ID: `sysinfo-extended`
- Follow existing pattern from `artwork-rebuild` and `orphan-files` checks
- `doctor --repair sysinfo-extended` triggers the orchestrator (from task-279.05)
- Requires USB device info — resolve from device config's mount path using USB discovery (task-279.02)

**Limitation messaging:**
- Hash72 devices (Nano 5G): message explaining iTunes sync required for HashInfo bootstrap
- HashAB devices (Nano 6G, Touch 4G): message explaining proprietary component requirement
- These are informational messages, not repairable checks

See PRD: doc-029 — "Readiness Pipeline Update" and "Initialization Capability Mapping" sections.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SysInfo readiness stage passes when SysInfoExtended is present
- [ ] #2 SysInfo readiness stage warns when only SysInfo is present (no SysInfoExtended)
- [ ] #3 SysInfo readiness stage fails when both are missing, with repair suggestion
- [ ] #4 doctor --repair sysinfo-extended triggers SysInfoExtended read from USB and writes to device
- [ ] #5 Hash72 devices show clear message about iTunes sync requirement
- [ ] #6 HashAB devices show clear message about proprietary component requirement
- [ ] #7 Existing readiness tests updated to cover new SysInfoExtended states
- [ ] #8 Doctor repair follows existing pattern (artwork-rebuild style)
<!-- AC:END -->
