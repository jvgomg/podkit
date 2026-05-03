---
id: TASK-292.07
title: P1.7 — FirmwareCapabilities extraction from plist tree
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
parent_task_id: TASK-292
ordinal: 8070
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `firmware/extract.ts` in `@podkit/ipod-firmware`. Takes a parsed plist value tree (from P1.2) and produces a structured `FirmwareCapabilities` object containing audio codecs, video codecs, artwork formats, album art formats, FamilyID, DBVersion, firmware version, RAM, etc.

Identity fields (firewireGuid, serialNumber) are also extracted here. The `FirmwareCapabilities` is the firmware-overlay input consumed by `@podkit/devices-ipod`'s `getCapabilities` in P3.

See spec doc-032, Scope > firmware/extract.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 extractFromPlist(plistValue) returns ParsedFirmware with firewireGuid, serialNumber, and capabilities subset
- [ ] #2 Audio codecs extracted with sample rates, bit depths where present
- [ ] #3 Artwork formats extracted with format ID, width, height, pixel format
- [ ] #4 Album art formats extracted similarly
- [ ] #5 Video codecs extracted (when present) with profile, level, max resolution, max bitrate
- [ ] #6 FamilyID, DBVersion, firmware version, RAM size extracted
- [ ] #7 Returns null gracefully when required identity fields missing
- [ ] #8 Unit tests against captured XML from all 5 inventory devices
<!-- AC:END -->
