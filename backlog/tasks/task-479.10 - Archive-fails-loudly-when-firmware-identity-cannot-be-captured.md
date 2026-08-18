---
id: TASK-479.10
title: Archive fails loudly when firmware identity cannot be captured
status: Done
assignee: []
created_date: '2026-08-18 01:19'
updated_date: '2026-08-18 01:19'
labels:
  - archive
  - cli
  - data-integrity
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: medium
ordinal: 253000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`captureSysInfoXml()` reads a device's SysInfoExtended from firmware, read-only, for devices carrying none on disk — that capture is what lets a read-only device's identity (serial, model number, capacity, colour) survive into the archive as a sidecar. When it failed, the failure was swallowed unless `--verbose`, and the user got a complete-looking archive whose README silently lacked model, capacity and colour. That happened to a real user, who then had to guess why the fields were missing.

Returning `undefined` meant both "not needed" and "failed". Now four outcomes are distinguished: `not-needed` (SysInfoExtended already on disk — silent), `skipped-no-fingerprint` (no live USB device correlates to the volume; a legitimate skip that no flag could change, so it never blocks), `captured`, and `failed` (a USB endpoint existed, the inquiry was attempted, nothing came back).

Only `failed` blocks, with a typed `IDENTITY_CAPTURE_FAILED` error naming `--force`. Under `--force` the archive proceeds and records the gap honestly rather than leaving blanks: a README callout stating identity could not be captured and that the fields are unknown rather than absent, plus `identity_capture_failed` and `identity_capture_failure_reason` columns in `library.sqlite` (schema bumped to 2).

`--force` was chosen over a more descriptive name because `device add`, `eject` and `init` already use `--force` for the same shape of override.

Also fixed: a genuine `CORE_LOAD_FAILED` was being swallowed by the same catch and silently downgraded to "capture not needed". It now propagates as the typed error it already was.

Verified on hardware afterwards: an iPod nano 7G with no on-disk identity of any kind archived with full model, capacity, colour and serial recorded from the firmware sidecar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A needed-but-failed capture stops the archive with a typed error naming the override
- [x] #2 A device that already carries SysInfoExtended stays silent
- [x] #3 A missing USB fingerprint is a skip, never a block
- [x] #4 Under the override the archive records identity as unknown in both README and library database
- [x] #5 Verified on hardware against a device with no on-disk identity
<!-- AC:END -->
