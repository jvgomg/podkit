---
id: TASK-280
title: 'Research: inquiry method device boundaries'
status: Done
assignee: []
created_date: '2026-05-02 15:33'
updated_date: '2026-05-02 16:03'
labels: []
milestone: m-18
dependencies: []
documentation:
  - documents/device-identification.md
  - documents/device-testing-playbook.md#11-inquiry-boundary-research
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Research which iPod generations support SCSI inquiry (VPD page 0xC0) and USB inquiry (vendor control transfer 0x40). Sources: libgpod source code and commit history, linux-usb.org device database, Rockbox wiki, iPodLinux wiki archives. Update `documents/device-identification.md` open questions with findings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Updated device-identification.md with researched SCSI inquiry device boundary
- [ ] #2 Updated device-identification.md with researched USB inquiry device boundary
- [ ] #3 Sources consulted are listed in the document
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Researched inquiry method boundaries using dstaley/ipod-sysinfo hardware-tested data, libgpod source, and web resources. SCSI inquiry works from iPod 4G onwards (all minis, nanos, shuffles). USB inquiry works from nano 3G, Classic 6G, Shuffle 3G onwards. For nano 5G+, USB returns extra fields. Updated device-identification.md with full device compatibility tables and corrected inquiry method selection to USB-first (matching libgpod's order).
<!-- SECTION:FINAL_SUMMARY:END -->
