---
id: TASK-317
title: Doctor / sync / device-add hygiene from m-18 hardware sweep
status: To Do
assignee: []
created_date: '2026-05-09 15:18'
labels:
  - device-capability-architecture
  - hygiene
  - follow-up
milestone: m-18
dependencies: []
priority: high
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent task collecting follow-ups surfaced during the m-18 macOS hardware sweep (7 iPods + iPod touch + Echo Mini). The sweep validated the SCSI-fallback, bundling, identity-cascade, and device-add UX commits; in doing so it surfaced a coherent set of UX, safety, and architectural issues. Sub-tasks here address them.

## Context inherited by sub-tasks

The codebase already has a cascade identity primitive: `assessIpodIdentity(mountPoint, opts?)` in `@podkit/core` and `resolveIpodModel(bag)` in `@podkit/devices-ipod`. Cascade priority is `modelNumStr → serial → productId → familyId → libgpodGeneration`. `device add` and the doctor readiness stage already compose with it. **`sync`, `device info`, and a few diagnostic checks still bypass it** and carry their own (broken) identity logic. Several sub-tasks remove that smell.

The `SysInfoIdentity` bag returned by `readSysInfoExtended` and `ensureSysInfoExtended` carries `firewireGuid?, serialNumber?, modelNumStr?, familyId?` — including ModelNumStr opportunistically read from a SysInfo neighbour file. Sub-tasks consuming the bag should compose with `resolveIpodModel(bag)` and **never re-implement identity decisions**.

The CLI must compose, not decide. Identity decisions, capability defaults, and remediation messaging belong in `@podkit/core` or `@podkit/devices-ipod`, not in `commands/*.ts`.

## Hardware available for verification

Real-hardware verification is required for each sub-task that touches a code path a user will exercise. The inventory documented in `documents/test-devices.md` covers:

- **iPod mini 2G** (4GB Pink, FAT32, SCSI-only inquiry, pre-2006 SysInfo populated) — `/Volumes/SALLYS IPOD`
- **iPod nano 2G** (4GB Green, FAT32, SCSI-only inquiry) — `/Volumes/PARTY IPOD`
- **iPod nano 3G** (8GB Black, FAT32, USB inquiry works) — `/Volumes/IPOD`
- **iPod nano 4G** (8GB Black, HFS+, USB inquiry works) — `/Volumes/James' iPod`
- **iPod 5G Video** (TERAPOD, iFlash 1TB mod, FAT32, SCSI-only, manual-mount via `sudo podkit mount`) — `/private/tmp/podkit-TERAPOD`. Has manually-edited SysInfo claiming `MA147` (5G) when serial says `V9M`/`A446` (5.5G).
- **iPod nano 7G #1** (16GB Space Gray, FAT32, hashAB unsupported, USB inquiry works) — `/Volumes/IPOD`
- **iPod nano 7G #2** (16GB Blue, HFS+, hashAB unsupported, USB inquiry works) — `/Volumes/iPod` (lowercase)
- **iPod touch 5th gen** (iOS, no mass storage, PID 0x12aa)
- **Echo Mini** (mass storage, PID 0x071b:0x3203)

Sub-tasks specify which devices to use as primary test + regression checks.

## Common acceptance expectations across sub-tasks

Every sub-task must:

1. **Add tests for the change** — unit + integration as appropriate. The existing `@podkit/core/src/device/readiness/stages/sysinfo.test.ts` and `@podkit/ipod-firmware/src/sysinfo/ensure-orchestrated.test.ts` are good models for cascade- and orchestrator-level tests with mocked transports.
2. **Verify on real hardware** — name the specific iPod(s) used for the change-confirmation test AND a regression device that exercises a different code path.
3. **Update inline docs / agents/ guides** when behavior visible to other contributors changes.

## Sub-task list

Created as Backlog sub-tasks under this parent. Per-cluster mini-sweeps for testing (no monolithic re-sweep at the end).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All sub-tasks completed with their own tests and real-hardware verification.
- [ ] #2 No regressions in the m-18 sweep workflow on the 7 inventory iPods + iPod touch + Echo Mini.
- [ ] #3 CLI commands (`device add`, `device info`, `device scan`, `doctor`, `sync`) compose identity via the cascade primitive; no command re-implements identity logic.
- [ ] #4 User-facing copy never names libgpod, koffi, or other implementation details.
- [ ] #5 `documents/test-devices.md` and `documents/device-identification.md` reflect findings from the sub-task work.
<!-- AC:END -->
