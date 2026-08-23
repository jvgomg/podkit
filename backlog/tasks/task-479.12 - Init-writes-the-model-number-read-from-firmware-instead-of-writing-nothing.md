---
id: TASK-479.12
title: Init writes the model number read from firmware instead of writing nothing
status: To Do
assignee: []
created_date: '2026-08-23 13:20'
updated_date: '2026-08-23 13:46'
labels:
  - identity
  - ipod-firmware
  - libgpod
milestone: m-18
dependencies:
  - TASK-479.07
  - TASK-479.02
  - TASK-479.06
parent_task_id: TASK-479
priority: medium
ordinal: 253000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`resolveInitModelNumStr` (`packages/podkit-cli/src/commands/device/shared.ts`) feeds `initializeIpod`, which writes the model number it is given into the device's `iPod_Control/Device/SysInfo` — durable identity podkit itself later reads back as evidence.

TASK-479.05 fixed the bug where this wrote a **fabricated** `MA147` (iPod Video) identity. The fix was correct but conservative: when the cascade resolves only a generation, it returns `undefined` and libgpod writes no SysInfo at all.

After TASK-479.07 the cascade can resolve a real model number by reading it from the device's own firmware. Refusing to use identity we just read correctly — on a path whose entire failure mode was writing identity we *didn't* read — would be perverse.

## Change

Let live-inquired identity flow into `resolveInitModelNumStr`. `device init` / `reset` on a device with no SysInfoExtended and no classic SysInfo then writes the firmware-derived model number instead of writing nothing.

## Why this is its own task

TASK-479.07 is scoped to *read* paths. This is a **write-behaviour** change on an explicitly-destructive command. It lands separately so it can be reviewed and reverted on its own terms.

The distinction to hold onto: the read tasks promise read-only commands never write. They do not promise the device is never written — `init`/`reset` write by definition, and this task changes *what* they write.

## Interaction with the shuffle refusal

`assertInitIdentitySufficient` refuses shuffle initialisation when no model number resolved. With this change the refusal fires strictly less often — only when live inquiry also failed. The refusal itself is unchanged; its copy is TASK-479.11's business.

## Why TASK-479.02 and TASK-479.06 are hard dependencies

The residual risk is a wrong serial-suffix or FamilyID table entry producing a plausible-but-wrong model number. Writing a *wrong* model number into `SysInfo` is more durable damage than writing none — it is precisely the failure class TASK-479.05 just fixed, arrived at by a different route.

TASK-479.02 (impossible FamilyID entries) and TASK-479.06 (FamilyID provenance / band invariant) are the mitigation. This task must not land before them.

## Verification note

Full proof requires hardware — a device with no SysInfoExtended, initialised, then read back. Keep that as a hardware log entry so the CI-provable criteria can close independently.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `resolveInitModelNumStr` returns a firmware-derived model number when the cascade resolved one live, and `initializeIpod` writes it to SysInfo
- [ ] #2 Still returns `undefined` — and libgpod writes no SysInfo — when neither disk nor firmware yields a model number
- [ ] #3 No fabricated or defaulted model number can reach the write under any input; a failed probe behaves exactly like any other unresolved cascade
- [ ] #4 The shuffle refusal in `assertInitIdentitySufficient` still fires when live inquiry also failed to resolve a model number
- [ ] #5 Hardware log: initialising a device with no SysInfoExtended writes the model number its firmware reports, and reading it back resolves the same variant
<!-- AC:END -->
