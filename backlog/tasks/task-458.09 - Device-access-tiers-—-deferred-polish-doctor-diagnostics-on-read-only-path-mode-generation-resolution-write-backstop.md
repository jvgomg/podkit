---
id: TASK-458.09
title: >-
  Device access tiers — deferred polish (doctor diagnostics on read-only,
  path-mode generation resolution, write backstop)
status: To Do
assignee: []
created_date: '2026-07-05 22:50'
labels:
  - device-capability
  - read-only
  - follow-up
  - polish
milestone: m-18
dependencies: []
parent_task_id: TASK-458
ordinal: 218000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-ups split out of the TASK-458 epic once the core value shipped and was live-verified. None block the reported bug (fixed in 458.02); these are refinements.

**1. Bare `doctor` should diagnose a read-only device, not hard-refuse.**
Today `doctor -d <read-only>` short-circuits at the `readiness === 'unsupported'` gate ("Device is not supported"). Per ADR-024 §4 / US #7, bare `doctor` is a READ op and should run its diagnostic checks on a read-only shuffle (only `--repair` should refuse). Requires the readiness/doctor gate to distinguish read-only (run checks) from none (refuse). The read-only archive hint already landed (commit 25450d29).

**2. Path-mode `device info` should resolve generation from the USB PID.**
`device info -d <shuffle>` shows "iPod shuffle (4th Generation) - Unknown Generation" and nudges "Needs repair — run doctor", and the 458.01 `Support:` line doesn't render — because the path-mode readiness pipeline doesn't resolve `generationId` from the USB PID when SysInfo is absent. (Note: doctor's readiness DID have usbModel.generationId, so the data is reachable — the info display path just isn't using it.) Fixing this renders the Support line and drops the misleading repair nudge for read-only devices.

**3. libgpod write backstop (ADR-024 §5).**
A guard before `IpodDatabase.save()` that refuses when the opened device's generation access is not `syncable` — the belt-and-suspenders net for the fail-open no-USB edge. Deferred because the DB write layer doesn't currently carry the access tier; a real backstop must re-derive generation from libgpod's model info at the write boundary. Low value (writes already refused upstream via the identity cascade; fail-open is already the de-facto behavior), so scoped as its own follow-up rather than forced into the epic.

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md §4, §5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Bare `doctor` runs diagnostic checks on a read-only shuffle instead of hard-refusing; `doctor --repair` refuses cleanly
- [ ] #2 Path-mode `device info` resolves generation from the USB PID: renders the Support line and drops the 'Needs repair' nudge for read-only devices
- [ ] #3 A backstop before IpodDatabase.save() refuses a non-syncable generation (fail-open safety net); unit test covers it
- [ ] #4 No regression to normal syncable-device sync
<!-- AC:END -->
