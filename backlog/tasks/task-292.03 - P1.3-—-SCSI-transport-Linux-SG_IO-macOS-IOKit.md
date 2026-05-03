---
id: TASK-292.03
title: P1.3 — SCSI transport (Linux SG_IO + macOS IOKit)
status: To Do
assignee: []
created_date: '2026-05-03 11:29'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
  - backlog/docs/doc-031 - Spec-Phase-0-FFI-SCSI-inquiry-spike.md
parent_task_id: TASK-292
ordinal: 8030
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the SCSI transport in `@podkit/ipod-firmware` covering both Linux (SG_IO ioctl via koffi) and macOS (IOKit SCSITaskUserClient via koffi, or helper binary if P0 spike concluded that). One platform-dispatch entry point (`scsiReadVpdPages(bus, dev)`).

See spec doc-032, Scope > inquiry/scsi/. Implementation strategy comes from doc-031 spike findings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 scsiReadVpdPages(bus, dev) returns a byte array on Linux against a real iPod
- [ ] #2 scsiReadVpdPages(bus, dev) returns a byte array on macOS against a real iPod
- [ ] #3 Reads VPD page 0xC0 index, then iterates subpages, concatenates response data
- [ ] #4 Linux: uses SG_IO ioctl on /dev/sgN or /dev/sdN
- [ ] #5 macOS: uses IOKit SCSITaskUserClient (or helper binary path per P0)
- [ ] #6 Unit tests with fake byte streams cover CDB construction, response assembly, short-read, sense data, timeout error paths
- [ ] #7 No new privilege requirements vs existing podkit USB udev rules
<!-- AC:END -->
