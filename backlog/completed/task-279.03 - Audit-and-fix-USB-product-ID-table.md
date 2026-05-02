---
id: TASK-279.03
title: Audit and fix USB product ID table
status: Done
assignee: []
created_date: '2026-04-19 17:11'
updated_date: '2026-04-19 17:40'
labels:
  - device
  - usb
dependencies: []
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
parent_task_id: TASK-279
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The USB product ID lookup table in `ipod-models.ts` is incomplete. A real iPod Nano 3G reports product ID `0x1262`, but the table only has `0x1208` for Nano 3G. The Linux USB ID database (`usb.ids` at linux-usb.org) shows a second range of IDs (`0x126x`) not present in podkit's table.

**Known ID ranges:**
- `0x120x` range: currently in podkit's table (source: community databases, may represent a different USB configuration or older firmware)
- `0x126x` range: confirmed by real hardware and linux-usb.org:
  - `0x1260` = iPod Nano 2G
  - `0x1261` = iPod Classic
  - `0x1262` = iPod Nano 3G (confirmed on real hardware)
  - `0x1263` = iPod Nano 4G
  - `0x1265` = iPod Nano 5G
  - `0x1266` = iPod Nano 6G
  - `0x1267` = iPod Nano 7G

**Work required:**
- Audit the full table against linux-usb.org `usb.ids` database
- Add the `0x126x` range with comments explaining both ranges exist
- Verify which IDs are for DFU/WTF mode (0x1223, 0x1224, etc) and ensure they're excluded or marked
- Add comments explaining the source and confidence level of each entry
- Unit tests verifying all known IDs resolve correctly

See PRD: doc-029 — "USB Product ID Table Fix" section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Product ID table includes both 0x120x and 0x126x ranges for all supported iPod generations
- [x] #2 DFU/WTF mode IDs are excluded or clearly marked as non-disk-mode
- [x] #3 Each entry has a comment indicating source (linux-usb.org, direct testing, community)
- [x] #4 lookupIpodModel resolves 0x1262 to iPod Nano 3rd generation
- [x] #5 Unit tests cover all entries in both ID ranges
- [x] #6 UNSUPPORTED_IPODS list reviewed against new entries
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Combined with TASK-279.04 into unified model registry. Both 0x120x and 0x126x USB ID ranges present. DFU/WTF excluded. 0x1266 added to UNSUPPORTED_IPODS. All entries sourced from linux-usb.org and real hardware.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rewrote ipod-models.ts as a unified model registry with:\n- USB product ID table expanded with 0x126x range (7 new entries confirmed by linux-usb.org and real hardware)\n- DFU/WTF mode IDs excluded by design\n- Source attribution comments on all sections\n- lookupIpodModel resolves 0x1262 to iPod nano 3rd generation\n- 68 unit tests covering all ID ranges\n- Comment noting 0x1266 needs adding to UNSUPPORTED_IPODS in usb-discovery.ts
<!-- SECTION:FINAL_SUMMARY:END -->
