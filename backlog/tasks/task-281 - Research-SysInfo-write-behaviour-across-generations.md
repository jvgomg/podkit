---
id: TASK-281
title: 'Research: SysInfo write behaviour across generations'
status: Done
assignee: []
created_date: '2026-05-02 15:33'
updated_date: '2026-05-02 16:03'
labels: []
milestone: m-18
dependencies: []
documentation:
  - documents/device-identification.md
  - documents/device-testing-playbook.md#12-sysinfo-write-behaviour-research
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Research which iPod generations write a populated SysInfo file (containing ModelNumStr) when formatted. Check libgpod's init code, Rockbox/iPodLinux community documentation. This affects whether filesystem identity is available without a prior iTunes sync.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Updated device-identification.md with findings on SysInfo write behaviour
- [ ] #2 Documented which generations are known to write SysInfo on format vs which do not
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Researched SysInfo write behaviour. Mid-2006 is the cutoff: iPod 1G-4G, mini, nano 1G write populated SysInfo on format. Nano 2G and all subsequent generations write empty SysInfo (0 bytes). iTunes or libgpod HAL callout populates files on newer devices. Post-2006 firmware overwrites SysInfo on normal boot. Updated device-identification.md Filesystem Identity section with findings, sources (KDE/Amarok wiki, iPodLinux docs, dstaley/ipod-sysinfo).
<!-- SECTION:FINAL_SUMMARY:END -->
