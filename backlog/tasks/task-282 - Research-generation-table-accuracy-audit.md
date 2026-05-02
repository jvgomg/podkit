---
id: TASK-282
title: 'Research: generation table accuracy audit'
status: Done
assignee: []
created_date: '2026-05-02 15:33'
updated_date: '2026-05-02 16:03'
labels: []
milestone: m-18
dependencies: []
documentation:
  - documents/device-identification.md#generation-tables-authority-vs-fallback
  - documents/device-testing-playbook.md#13-generation-table-accuracy-audit
  - packages/podkit-core/src/device/ipod-models.ts
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Compare podkit's hardcoded generation tables in `ipod-models.ts` against libgpod's `itdb_device.c` tables, SysInfoExtended XML captured from real devices (Phase 2), and Apple's published specs. Focus on devices in the test collection first. Note discrepancies for correction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Compared model numbers, serial suffix mappings, and checksum types against libgpod source
- [ ] #2 Compared artwork dimensions against firmware-reported data from captured SysInfoExtended XML
- [ ] #3 Discrepancies documented for correction
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Audited generation tables against libgpod source and firmware-reported data. Found 3 high-severity bugs: B867 misclassified as nano 4G (is Shuffle 3G), iPod Touch 1G-3G checksum should be hash72 not none, nano 7G checksum should be hashAB not none. Found 4 missing model numbers. Artwork format discrepancy: nano 4G fallback uses nano 1G/2G formats. Video profile is deliberately conservative. Updated device-identification.md with full audit results.
<!-- SECTION:FINAL_SUMMARY:END -->
