---
id: TASK-460
title: 'Doctor inquiry-methods check: surface USB transport availability honestly'
status: Done
assignee: []
created_date: '2026-07-11 08:59'
updated_date: '2026-07-11 11:23'
labels:
  - diagnostics
  - ipod-firmware
dependencies: []
references:
  - packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts
  - packages/ipod-firmware/src/inquiry/probe.ts
modified_files:
  - packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts
  - packages/podkit-core/src/diagnostics/checks/inquiry-methods.test.ts
  - packages/podkit-core/src/diagnostics/checks/system-scope-matrix.test.ts
priority: medium
ordinal: 220000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `inquiry-methods` doctor check reports SCSI availability only, on the assumption that "the USB transport is always available in shipped binaries (the usb prebuild is embedded)". The Alpine-container verification spike falsified this twice: the runtime bundling interception silently failed on machines without the build tree (fixed via the build-time bundler plugin), and the `usb` prebuild dynamic-links libudev.so.1 which can be absent (Alpine without eudev-libs). In both cases doctor showed a passing/warn check with no hint the USB transport was dead, and `-v`/`-vv` on `device add` surfaced nothing about the skipped transport.

Make USB load failures visible: include usb availability + failure reason in the check details (probe already returns it), consider status derivation when USB is unavailable, and surface the per-transport plan (`usb-then-scsi`/`scsi-only`/`none`) somewhere diagnosable. The stashed `globalThis.__podkit_native_binding_error`-style error for the usb wire was also never consumed anywhere — either surface it or remove the stash.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 USB availability and failure reason are included in check `details` alongside SCSI
- [ ] #2 Status derivation: `pass` when USB is available (SCSI absence on a host with working USB does not warn); `warn` when USB is down (regardless of SCSI state)
- [ ] #3 Transport plan (`usb-only`/`scsi-only`/`usb-then-scsi`/`none`) is included in check `details` as `plan`
- [ ] #4 `buildSummary` surfaces USB failure when USB is down; leads with USB status when USB is up
- [ ] #5 The `__podkit_native_binding_error` stash was investigated: it is for the libgpod `.node` binding, already consumed in `packages/libgpod-node/src/binding.ts` lines 411-413 — NOT dead code, no change needed
- [ ] #6 Unit tests extended: USB down + SCSI up, USB up + SCSI down, both down, both up — all assert status, summary, and details
- [ ] #7 Existing system-scope-matrix tests (AC#1–AC#4b) updated to reflect new USB-first status logic
- [ ] #8 `bun run test:unit --filter @podkit/core`: 3411 pass, 0 fail
- [ ] #9 `bun run typecheck --filter @podkit/core`: clean
- [ ] #10 `bun run build --filter @podkit/core`: clean
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Status-derivation logic**

USB is the preferred transport (`chooseTransports` returns `usb-then-scsi` or `usb-only` when USB is available). The new logic: `pass` iff USB is available; `warn` otherwise (USB down + SCSI up = degraded; both down = no inquiry possible). This prevents a common false-positive: a Linux host without `/dev/sg*` but with working USB (the normal containerised case) previously showed `warn` because SCSI was absent. Now it correctly shows `pass`. `warn` is used for the "both down" case rather than `fail` because the core sync path does not hard-depend on firmware inquiry — using `fail` would incorrectly block non-inquiry operations in the doctor summary.

**`__podkit_native_binding_error` stash**

The task description claimed this stash "was never consumed anywhere." Investigation found it IS consumed: `packages/libgpod-node/src/binding.ts` lines 411-413 reads it when no addon path is found on disk (embedded binary where the `.node` file failed to load). This stash is for the libgpod binding, not the USB transport. No change was needed — not dead code.

**Files changed**
- `packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts` — Updated module TSDoc, `buildSummary`, `deriveStatus`, `checkInquiryMethods`; import `chooseTransports`; add `usb` and `plan` to details.
- `packages/podkit-core/src/diagnostics/checks/inquiry-methods.test.ts` — Rewrote helper `makeAvailability` to accept both SCSI and USB params; replaced old SCSI-only tests with new coverage of all four transport permutations; added details assertions for `usb`, `plan`.
- `packages/podkit-core/src/diagnostics/checks/system-scope-matrix.test.ts` — Updated AC#1–AC#4b assertions to reflect new USB-first status logic and updated summary expectations."

Code-complete + green (3411 core tests pass, typecheck/build clean). Awaiting user commit before marking Done. Team-lead review: accepted; deriveStatus flip to USB-first is sound and the matrix-test updates are principled, not made-to-pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The inquiry-methods doctor check now surfaces USB transport availability, not just SCSI. It includes usb {available, reason} and the transport plan (usb-only/scsi-only/usb-then-scsi/none) in details, and buildSummary leads with USB status and names the USB failure reason when USB is down.

Status derivation flipped to USB-first: pass iff USB is available; warn otherwise (USB down + SCSI up = degraded fallback; both down = no inquiry). This fixes a false-positive where a host with working USB but no /dev/sg* (the common container case) previously showed warn. warn (not fail) is used for the both-down case because the core sync path does not hard-depend on firmware inquiry.

The task's premise that the __podkit_native_binding_error stash was 'never consumed' was wrong: it is read by packages/libgpod-node/src/binding.ts (for the libgpod .node binding, not USB) — left unchanged, not dead code.

Changed: inquiry-methods.ts, inquiry-methods.test.ts (all four transport permutations), system-scope-matrix.test.ts (AC#1–#4b updated to USB-first). 3411 core tests pass; typecheck + build clean. A @podkit/core changeset accompanies the commit (doctor output is user-facing).
<!-- SECTION:FINAL_SUMMARY:END -->
