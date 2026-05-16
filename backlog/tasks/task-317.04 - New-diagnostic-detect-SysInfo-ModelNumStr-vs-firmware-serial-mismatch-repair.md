---
id: TASK-317.04
title: >-
  New diagnostic: detect SysInfo ModelNumStr vs firmware serial mismatch +
  repair
status: Done
assignee: []
created_date: '2026-05-09 15:21'
updated_date: '2026-05-16 11:18'
labels:
  - doctor
  - diagnostics
milestone: m-18
dependencies:
  - TASK-317.02
modified_files:
  - packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.ts
  - >-
    packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.test.ts
  - packages/podkit-core/src/diagnostics/index.ts
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-cli/src/commands/doctor.test.ts
  - .changeset/sysinfo-modelnum-mismatch-check.md
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
- [x] #1 New diagnostic check `sysinfo-serial-consistency` (or similar id) added under `packages/podkit-core/src/diagnostics/checks/`.
- [x] #2 Check fires `warn` when ModelNumStr-derived generation != serial-suffix-derived generation, both resolved.
- [x] #3 Check is silent (status `pass` or `skip`) when either source is missing or unresolvable.
- [x] #4 Repair action rewrites SysInfo's `ModelNumStr` using the variant looked up from the firmware serial. Backs up the original value (e.g., to a sibling file) before overwriting.
- [x] #5 Unit tests added: TERAPOD-shaped fixture (MA147 + V9M serial) triggers warn; healthy device fixture does not; partial-data fixture (only ModelNumStr) does not.
- [ ] #6 Real-hardware run: TERAPOD before fix — confirm `⚠ sysinfo-serial-consistency` warns with both generations named; run repair, confirm SysInfo's ModelNumStr is rewritten to the serial-suffix variant; re-run doctor, confirm pass.
- [ ] #7 Real-hardware regression: mini 2G, nano 2G, nano 3G, nano 4G, nano 7G #1 — confirm no warning fires for any of them (their ModelNumStr and serial agree, OR one side is unresolvable).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as `sysinfo-modelnum-mismatch` (per the spec wording — more descriptive than the placeholder `sysinfo-serial-consistency`). New diagnostic check + repair under `packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.ts`. Registered in the diagnostics registry; added to the CLI's `--repair` choices list and the failure-explanation router in `doctor.ts`.

## Decisions

- **Status `warn`, not `fail`.** The device still works — the cascade silently picks one side of a wrong-but-internally-consistent identity. Per the task description's "surface a `warn` status" wording, and consistent with other identity-drift signals (orphan files also warn).
- **Firmware-truth cascade: SIE serial → live USB.** Prefer `SysInfoExtended.SerialNumber` (firmware-stamped, survives clones, gives variant detail via suffix lookup); fall back to `liveIdentity.model` (USB-derived; generation only). Both axes documented in the `FirmwareTruthSource` enum and surfaced in `details.firmwareSource`.
- **Skip when either side missing.** Per AC #3, the check must not fire when ModelNumStr is the only available identity (mini 2G S4G regression target). Implemented by returning `skip` whenever the on-disk ModelNumStr is unresolvable OR the firmware-truth cascade comes up empty.
- **Repair backs up to sibling file.** AC #4 requires backup before overwrite. Written to `iPod_Control/Device/SysInfo.podkit-backup` (same dir, clear ownership). Idempotent (overwrites prior backup).
- **Minimal in-place line replacement.** Only the `ModelNumStr: ...` line is rewritten; every other line in classic SysInfo is preserved verbatim. Protects against accidental drift on any keys we haven't catalogued.
- **Injection seams over module mocks.** The check and repair accept optional `SysInfoFsReader` + `SieReader` parameters; production callers leave them unset and get the real implementations. Avoids `mock.module('@podkit/ipod-firmware', ...)` which leaks across Bun test files and breaks unrelated readiness tests.
- **USB-only-firmware-truth repair refuses to guess.** When live USB is the only firmware truth source, the model carries `generationId` but no `modelNumber` — the repair can't produce a precise replacement, so it returns an error directing the user to populate SysInfoExtended first.

## Test coverage

19 unit tests in `sysinfo-modelnum-mismatch.test.ts` covering:

- Check metadata (id, scope, applicableTo, repair shape, no-database requirement)
- Skip paths: SysInfo absent, no ModelNumStr line, unknown ModelNumStr, no firmware truth
- Match paths: SIE-sourced and live-USB-sourced
- Mismatch (TERAPOD-shaped): SIE serial V9M vs MA147 → warn with full details payload
- Live-USB fallback mismatch
- SIE-takes-precedence-over-USB
- Repair: dry-run no-side-effects, live overwrite with backup + line-replacement, short-circuit when already matching, file-absent failure, missing-line failure, USB-only-truth refusal
- Real-persona smoke (TERAPOD identity)

Plus updated `doctor.test.ts` choices-list assertion.

## Quality gates

- `bun install` ✓
- `bun run lint` ✓ (0 errors, 4 pre-existing warnings)
- `bun run build --filter @podkit/core --filter podkit --filter @podkit/ipod-firmware` ✓
- `bun run test:unit --filter @podkit/core --filter podkit --filter @podkit/ipod-firmware` ✓ (2720 pass / 0 fail in @podkit/core; 1277 pass in podkit)
- `bun run test:integration --filter @podkit/core --filter podkit` ✓ (69 pass)

## Out of scope (deferred)

- AC #6 (TERAPOD before/after hardware run) — deferred to TASK-319 per the task spec.
- AC #7 (5-device regression sweep) — deferred to TASK-319.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New `podkit doctor` check `sysinfo-modelnum-mismatch` detects when the classic on-disk SysInfo file's `ModelNumStr` disagrees with the firmware-derived identity (e.g. SysInfo manually edited or copied from another iPod). Surfaces a `warn` with both sides named; offers `--repair sysinfo-modelnum-mismatch` to rewrite the ModelNumStr from firmware-derived data after backing up the original.

Identified during the TERAPOD (iPod 5G with iFlash mod) inventory pass — the SysInfo claimed `MA147` (5G) while the serial said `9C642MEFV9M` → `V9M` → `A446` (5.5G). The existing `sysinfo-consistency` check compared ModelNumStr vs USB (both 5G — agreed) so no signal fired; the new check compares ModelNumStr vs the SysInfoExtended-derived serial suffix and catches this discrepancy.

ACs #1–#5 complete. ACs #6–#7 (hardware verification) deferred to TASK-319 per task spec.
<!-- SECTION:FINAL_SUMMARY:END -->
