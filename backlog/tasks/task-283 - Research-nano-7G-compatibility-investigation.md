---
id: TASK-283
title: 'Research: nano 7G compatibility investigation'
status: Done
assignee: []
created_date: '2026-05-02 15:33'
updated_date: '2026-05-02 16:03'
labels: []
milestone: m-18
dependencies: []
documentation:
  - documents/device-identification.md
  - documents/test-devices.md
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Research the iPod nano 7th generation's database format and compatibility with podkit. Verify: uses standard iTunesDB, actual checksum type (currently listed as 'none'), expected inquiry behaviour, known libgpod compatibility issues. The nano 7G is post-libgpod (libgpodGeneration maps to 'unknown').
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Documented nano 7G database format compatibility
- [ ] #2 Verified or corrected checksum type
- [ ] #3 Updated device-identification.md and test-devices.md with findings
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Researched nano 7G compatibility. Uses iTunesCDB + SQLite databases with hashAB checksums (DBVersion 5, FamilyID 18, 8-byte FireWireGUID). Same format as nano 6G. Both SCSI and USB inquiry work. libgpod fails out of box (missing generation enum). Third-party tools ipod_manager and iOpenPod have working support. podkit's checksumType: 'none' is incorrect — should be hashAB. Updated device-identification.md and test-devices.md.
<!-- SECTION:FINAL_SUMMARY:END -->
