---
id: TASK-479.07
title: >-
  Identity display should read firmware over USB, not require writing
  SysInfoExtended first
status: To Do
assignee: []
created_date: '2026-08-17 22:58'
labels:
  - identity
  - ux
  - ipod-firmware
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: medium
ordinal: 250000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

To see a device's full identity — model number, capacity, colour — podkit currently requires that identity be **written to the device** first. A device with no `SysInfoExtended` on disk resolves from the USB product ID alone, which carries only a generation.

Observed on real hardware 2026-08-17. An iPod nano 7G (16GB Green, serial `DCYN83SFF0GQ`) connected over USB displays as:

```
Model:          iPod nano (7th Generation)
```

while the same device's serial — which resolves to `D478`, 16GB Green — is readable from firmware over USB at that moment, and is sitting in the macOS iPod cache. The only way to make podkit show it is `doctor --repair sysinfo-extended`, which *writes a file to the user's device* purely so a later read can display a nicer name.

The device owner's reaction, verbatim: "It's frustrating that we must write the SysInfoExtended file for correct info to show for the device."

## Why it is fixable

The firmware inquiry that obtains SysInfoExtended is **read-only**. `doctor --repair sysinfo-extended` performs exactly that read and then persists the result; the reading half needs no write intent at all (`packages/ipod-firmware/src/inquiry/orchestrator.ts`, SCSI/USB transports).

The identity cascade's USB axis, however, is PID-only — `packages/devices-ipod/src/resolve.ts` `synthesizeFromGeneration` deliberately returns no `modelNumber`, `capacityGb` or `color` for a `from: 'usb'` resolution (`packages/devices-ipod/src/identity.ts:63-84`). So the richer live-firmware data never reaches the display path.

## Direction

Let the display path consult a live firmware inquiry when on-disk identity is thin, without writing anything. Considerations:

- **Cost**: a USB/SCSI inquiry per `device info` / `device scan` invocation is not free; scan touches every connected device. Consider caching per session, or only enriching on `info` (single device, user asked for detail) rather than `scan`.
- **Provenance**: identity read live from firmware is *stronger* evidence than a file on disk, which can be stale or hand-written. `device info` should be able to say where the identity came from.
- **Permissions**: USB inquiry needs the right access on Linux (udev rule); the enrichment must degrade silently to the PID-only answer rather than erroring.
- **Interaction with the repair**: once this lands, writing SysInfoExtended becomes a genuine repair (making the device self-describing for libgpod and other tools) rather than a prerequisite for display — which is the honest framing.

## Related

The write-side need remains: libgpod resolves identity only from files on disk, so a `SysInfoExtended`/`SysInfo` write is still what makes the *database layer* correct. This task is about the display path only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `device info` shows model number, capacity and colour for a connected device whose identity is readable from firmware but absent from disk
- [ ] #2 No write occurs on any read-only command — verified by checking the device's filesystem is untouched
- [ ] #3 The enrichment degrades silently to the USB-PID answer when inquiry is unavailable or unpermitted
- [ ] #4 Inquiry cost on `device scan` is bounded (cached, deferred, or skipped) so scanning many devices does not regress
- [ ] #5 `device info` distinguishes identity read live from firmware from identity read off disk
<!-- AC:END -->
