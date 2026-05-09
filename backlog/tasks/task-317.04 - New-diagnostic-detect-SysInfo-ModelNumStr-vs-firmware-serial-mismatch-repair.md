---
id: TASK-317.04
title: >-
  New diagnostic: detect SysInfo ModelNumStr vs firmware serial mismatch +
  repair
status: To Do
assignee: []
created_date: '2026-05-09 15:21'
labels:
  - doctor
  - diagnostics
milestone: m-18
dependencies:
  - TASK-317.02
parent_task_id: TASK-317
priority: medium
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a new diagnostic check that detects when SysInfo's `ModelNumStr` and the firmware-derived serial-suffix imply different generations. The TERAPOD case (iPod 5G Video, iFlash 1TB) exposed this gap: SysInfo says `MA147` (Video 5G) — manually edited at some point — while the firmware serial says `9C642MEFV9M` → `V9M` → `A446` (Video 5.5G). The cascade trusts ModelNumStr first (correct general-case priority), so it produces a wrong-but-internally-consistent identity. Existing checks compare ModelNumStr-vs-USB; both agree (both 5G) so no warning fires. The user has no signal that their device is being misidentified.

## What to add

A new diagnostic check, e.g. `sysinfo-serial-consistency`, that:

1. Resolves both `identify({ from: 'sysinfo', modelNumStr })` and `identify({ from: 'serial', serialNumber })` from the device's data.
2. If both produce a result and their `generationId` fields differ (or differ across compatible-but-distinct generations like `video_5g` vs `video_5_5g`), surface a `warn` status with explanation: ModelNumStr suggests X; firmware serial suggests Y; serial is firmware-stamped and authoritative.
3. Offer a repair action: rewrite SysInfo using the firmware-derived ModelNumStr (looked up from the serial-suffix variant). Effectively: turn "wrong sysinfo" into a fixable repair instead of silent misidentification.

Important: this check must NOT fire for the common case where ModelNumStr is the only available identity and serial is unmappable (mini 2G's `S4G` → no match before commit `c20b7f3`). Only when both sources resolve to definite-but-different generations.

## Hardware test target

TERAPOD is the canonical positive case. The 5 other supported iPods (mini 2G, nano 2G, nano 3G, nano 4G, nano 7G) should NOT fire the warning — regression target.

## Dependency

Blocked by TASK-317.02 (doctor repair correctness pass) because both touch sysinfo-consistency-related checks; landing them in order avoids merge conflicts and keeps the doctor surface coherent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New diagnostic check `sysinfo-serial-consistency` (or similar id) added under `packages/podkit-core/src/diagnostics/checks/`.
- [ ] #2 Check fires `warn` when ModelNumStr-derived generation != serial-suffix-derived generation, both resolved.
- [ ] #3 Check is silent (status `pass` or `skip`) when either source is missing or unresolvable.
- [ ] #4 Repair action rewrites SysInfo's `ModelNumStr` using the variant looked up from the firmware serial. Backs up the original value (e.g., to a sibling file) before overwriting.
- [ ] #5 Unit tests added: TERAPOD-shaped fixture (MA147 + V9M serial) triggers warn; healthy device fixture does not; partial-data fixture (only ModelNumStr) does not.
- [ ] #6 Real-hardware run: TERAPOD before fix — confirm `⚠ sysinfo-serial-consistency` warns with both generations named; run repair, confirm SysInfo's ModelNumStr is rewritten to the serial-suffix variant; re-run doctor, confirm pass.
- [ ] #7 Real-hardware regression: mini 2G, nano 2G, nano 3G, nano 4G, nano 7G #1 — confirm no warning fires for any of them (their ModelNumStr and serial agree, OR one side is unresolvable).
<!-- AC:END -->
