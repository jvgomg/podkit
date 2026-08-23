---
id: TASK-479.16
title: Diagnostics compare disk against firmware without writing first
status: To Do
assignee: []
created_date: '2026-08-23 13:45'
labels:
  - identity
  - diagnostics
  - ipod-firmware
milestone: m-18
dependencies:
  - TASK-479.07
parent_task_id: TASK-479
priority: medium
ordinal: 255000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Scope

`resolveFirmwareTruth` (`packages/podkit-core/src/diagnostics/checks/firmware-truth.ts:64`) gains a live-inquiry rung between the disk-SIE rung and the USB-descriptor rung. Every check consuming it then gains the ability to compare what the disk says against what the hardware says **without writing SysInfoExtended first**.

Zero coupling to the display work — this can land independently.

## This is a sync→async break, not an additive change

`resolveFirmwareTruth` is synchronous and every call site is synchronous. Adding live inquiry makes it async, propagating through three check `run` implementations.

Actual consumers — verified, and different from what an earlier draft claimed:

- `packages/podkit-core/src/diagnostics/checks/shuffle-playback-db.ts:161`
- `packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.ts:143, 261`
- `packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-missing.ts:91, 188`

`sysinfo-consistency.ts` does **not** consume it, despite the earlier draft naming it. `shuffle-playback-db` — the shuffle `iTunesSD` repair, the most safety-critical of the three — was unlisted.

## Rename: `'live-usb'` → `'usb-descriptor'`

`FirmwareTruthSource`'s existing `'live-usb'` means the USB *descriptor* (product ID, generation only). That name becomes actively misleading once a genuine live-firmware rung exists. Rename it; `'firmware-live'` takes the new meaning.

Blast radius — verified, and small:

- `firmware-truth.ts:32, 34, 86`
- emitted as `details.firmwareSource` at `sysinfo-modelnum-mismatch.ts:169, 190, 282, 303, 352` and `sysinfo-modelnum-missing.ts:117, 134, 206, 221, 288`
- pinned only at `sysinfo-modelnum-mismatch.test.ts:224, 264`

No hits in e2e, VM expectations, the docs site or JSON fixtures. No `.snap` files exist in the repo. `doctor-output-contract.e2e.test.ts` pins stage *shape*, not detail values.

## Reconcile the two provenance enums

TASK-479.07 introduces `identitySource` (`sysinfo-extended | sysinfo | firmware-live | usb-pid`) on the assessment. `FirmwareTruthSource` after this task is (`sysinfo-extended | firmware-live | usb-descriptor`). Two members shared; `usb-pid` and `usb-descriptor` name the same thing differently.

Either unify into one exported type or rename so nobody can mistake one for the other. Do not ship both as drafted — that is the collision the provenance model exists to avoid.

## What this unlocks

Today `sysinfo-consistency` can only tell a user their on-disk identity looks wrong and offer to overwrite it. With a live rung, the checks that consume firmware truth can state what the hardware actually reports before anything is written — which is the honest order of operations for a diagnostic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `resolveFirmwareTruth` resolves from live firmware when the disk SIE yields no usable serial, ranked above the USB-descriptor rung
- [ ] #2 All three consumers — `shuffle-playback-db`, `sysinfo-modelnum-mismatch`, `sysinfo-modelnum-missing` — handle the now-async resolver correctly, including their repair paths
- [ ] #3 `FirmwareTruthSource`'s `'live-usb'` is renamed `'usb-descriptor'`; `details.firmwareSource` emits the new value at all ten emission sites
- [ ] #4 `identitySource` and `FirmwareTruthSource` are reconciled into one type or named so they cannot be confused; `usb-pid` and `usb-descriptor` do not both survive meaning the same thing
- [ ] #5 A diagnostic on a device with no SysInfoExtended reports what the hardware says without writing anything
- [ ] #6 Probing here honours the same gate and opt-out as every other path
<!-- AC:END -->
