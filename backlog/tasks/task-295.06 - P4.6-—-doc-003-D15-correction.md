---
id: TASK-295.06
title: P4.6 — doc-003 D15 correction
status: Done
assignee: []
created_date: '2026-05-03 11:35'
updated_date: '2026-05-06 22:16'
labels:
  - device-capability-architecture
  - phase-4
  - documentation
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
  - >-
    backlog/docs/doc-003 -
    ipod-db-Design-Document-Pure-TypeScript-iPod-Database-Implementation.md
parent_task_id: TASK-295
ordinal: 11060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update `backlog/docs/doc-003 - ipod-db Design Document`:

- Correct or remove decision **D15** ("SysInfoExtended is Out of Scope — Only Touch/iPhone/iPad use it"). It is required for hash58, hash72, and hashAB devices.
- Add a "Relationship to Device Capability Architecture" section pointing to doc-030.
- Note that ipod-db consumes parsed FireWireGUID directly (from @podkit/ipod-firmware or cached identity) and does not need the on-disk file for its own purposes.

Documentation-only change, but meaningful for m-8 implementer.

See spec doc-035, Scope > Update doc-003.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 doc-003 D15 either corrected or removed
- [x] #2 New section added pointing to doc-030 for the device-capability architecture
- [x] #3 doc-003 clarifies that ipod-db does not own SysInfoExtended handling
- [x] #4 m-8 implementer guidance is consistent with the device-capability work
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Corrected decision D15 and added §10 to doc-003.

D15 previously read: "SysInfoExtended — Not implemented — Only Touch/iPhone/iPad use it"
D15 now reads: "SysInfoExtended — Not owned by ipod-db. SysInfoExtended IS required for hash58/72/AB iPods. File I/O lives in @podkit/ipod-firmware/sysinfo/. @podkit/ipod-db receives a parsed FireWireGUID as a parameter — it never reads the on-disk file directly. See §2a and §10. — Correct boundary: firmware I/O in ipod-firmware, not in ipod-db"

The inline "SysInfoExtended: Out of Scope" prose block in §2 was replaced with §2a, which corrects the record with a dated attribution, explains which hash algorithms require SysInfoExtended and why, and maps the file I/O responsibility to @podkit/ipod-firmware/sysinfo/.

New §10 "Relationship to Device Capability Architecture" added, covering: the four-package architecture diagram (cross-reference to doc-030), where SysInfoExtended file I/O lives, how ipod-db consumes device identity (live ParsedFirmware or cached DeviceIdentity, never direct disk I/O), and concrete m-8 implementer guidance (hash params, Database.open() signature, iTunes interop note).

Hash table in §4 updated to note that FireWireGUID is passed as a parameter from @podkit/ipod-firmware, not read from disk by ipod-db.
<!-- SECTION:FINAL_SUMMARY:END -->
