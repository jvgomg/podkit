---
id: TASK-302
title: Readiness pipeline stage coverage
status: To Do
assignee: []
created_date: '2026-05-08 07:21'
labels:
  - testing
  - doctor
  - readiness
  - vm-coverage
milestone: m-19
dependencies: []
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify each of the six readiness stages reports the right status across the realistic permutations of device state. The readiness pipeline runs before the database-health checks and decides whether the device is `ready`, `needs-repair`, `needs-init`, `needs-format`, `needs-partition`, or `hardware-error`. Today only the happy path and a couple of failure modes are covered; many state combinations are untested.

Stages, in order: `usb`, `partition`, `filesystem`, `mount`, `sysinfo`, `database`.

For every test, run `podkit doctor --device <fixture> --json --no-system` (system checks out of scope here) and assert on `readiness.level` plus the matching entry in `readiness.stages[]`: `status`, `summary`, and `details`. Where stages depend on prior stages, also assert that downstream stages skip when an upstream stage fails — that "earliest failure stops the pipeline" behaviour is part of the contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 usb stage: pass when an Apple iPod USB descriptor is present; details include vendorId/productId and the resolved usbModel
- [ ] #2 usb stage: fail when no USB descriptor is reachable for the mount path
- [ ] #3 usb stage: skip with reason when the platform device manager is unsupported (not Linux/macOS)
- [ ] #4 partition stage: pass on a single-partition iPod layout; pass on the dual-partition Mac/Win iPod layout
- [ ] #5 partition stage: fail with hardware-error level when the device has no partition table at all
- [ ] #6 filesystem stage: pass on FAT32 and HFS+; details report the detected filesystem
- [ ] #7 filesystem stage: fail with needs-format level when the partition has no recognisable filesystem
- [ ] #8 mount stage: pass when iPod_Control directory is present at the mount point
- [ ] #9 mount stage: fail with needs-init level when iPod_Control is missing entirely
- [ ] #10 sysinfo stage: pass when SysInfo or SysInfoExtended is present and parses; details include usbModelName and deviceModel
- [ ] #11 sysinfo stage: warn when SysInfo is missing but SysInfoExtended is present (or vice versa) and the present file resolves a model
- [ ] #12 sysinfo stage: fail with needs-repair when both SysInfo and SysInfoExtended are missing
- [ ] #13 sysinfo stage: fail when present file(s) parse but identify() cannot resolve a model from any field
- [ ] #14 database stage: pass when iTunesDB is present and parses; details include trackCount
- [ ] #15 database stage: fail with needs-init level when iTunesDB is missing
- [ ] #16 database stage: fail when iTunesDB is present but corrupt
- [ ] #17 downstream skip: when usb fails, partition/filesystem/mount/sysinfo/database all report skip
- [ ] #18 downstream skip: when mount fails, sysinfo and database report skip
- [ ] #19 downstream skip: when sysinfo fails but mount passed, database still runs (sysinfo failure does not block database)
- [ ] #20 readiness.level is correctly derived from the worst non-skipped stage (e.g. mount fail → needs-init regardless of sysinfo)
- [ ] #21 readiness output is identical between text and JSON modes for the same fixture (modulo formatting)
<!-- AC:END -->
