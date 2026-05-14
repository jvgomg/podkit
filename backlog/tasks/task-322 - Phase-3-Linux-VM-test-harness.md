---
id: TASK-322
title: 'Phase 3: Linux VM test harness'
status: To Do
assignee: []
created_date: '2026-05-11 22:56'
updated_date: '2026-05-14 19:23'
labels:
  - testing
  - vm-coverage
  - lima
  - tier-3
milestone: m-19
dependencies:
  - TASK-290
  - TASK-321
priority: high
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent task for **Tier 3** — the Linux VM test harness that synthesizes virtual iPods via `dummy_hcd` + FunctionFS and exercises real `libusb` / `SG_IO` / `lsblk` code paths against them.

Architecture (per ADR-016):

**Builder VM / Test VM split** (catches dev-library shadowing bug class):
- **Builder VM** (`tools/device-testing/lima/builder.yaml`, see TASK-321.07) — has dev tools, builds the standalone Linux binary with libgpod statically linked. Turbo-cached.
- **Test VM** (`tools/device-testing/lima/test-vm.yaml`, see TASK-322.01) — minimal: ffmpeg, gpod-tool (test-time dep, from @podkit/gpod-testing), kernel modules, and `/usr/local/bin/podkit` (compiled statically-linked binary). **NO Bun, NO Node, NO node_modules, NO source tree, NO -dev packages.**

Tier 3 runs on mac dev hosts only. CI does not execute tests — CI builds artefacts (prebuild.yml, build-platform.yml) only.

**Snapshot-based state layering** (Option III): one base test VM with all tools installed, named snapshots for each `SystemState` (`base-healthy`, `base-no-ffmpeg`, `base-no-libgpod`, `base-no-udev`, `base-no-sg-perms`, etc.). Tests restore the appropriate snapshot via `qemu-img snapshot -a <name>` (<1s).

**Test grouping by SystemState:** the test orchestrator groups tests by required SystemState and restores a snapshot once per group — not once per test. This keeps the combinatorial doctor matrix tractable.

**FunctionFS userspace daemon** runs inside the test VM, listens for new gadget instances, binds to FunctionFS endpoints, and serves persona payloads from the JSON-serialised `@podkit/device-testing` DevicePersona registry on vendor control transfers (`bmRequestType=0xC0, bRequest=0x40, wValue=0x02, wIndex=page`).

**Mass storage backing file:** for mass-storage personas (echo-mini-empty), the daemon presents a FAT32 backing file via `usb_f_mass_storage`. The backing file is separate from the VM disk and is reset between tests per the persona's `massStorageBackingFile.resetStrategy`.

**TestRuntime `lima-test-vm` runner** orchestrates: boot VM → transfer binary → applyState(snapshot) → run podkit cmd → revert snapshot.

**Tier 3 integration tests** exercise the full inquiry pipeline against synthesized personas.

Subtasks deliver each component.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All Phase 3 subtasks are Done
- [ ] #2 `bun run test` on a mac dev host with Lima installed runs Tier 3 end-to-end against the 3 starter personas and they all pass
- [ ] #3 Test VM contains NO Bun, NO Node, NO source tree, NO dev libraries — only the compiled binary + system packages a real user would have
- [ ] #4 Turbo cache hit on no-change makes subsequent `bun run test` invocations near-instant
- [ ] #5 Tier 3 tests synthesize at least 3 starter personas as real USB devices and the existing discoverUsbIpods + identify + inquireFirmware paths see them as the right device type
- [ ] #6 Snapshot-based state layering works: at least 5 named snapshots, each restorable in under 2 seconds
- [ ] #7 Auto-skip path logs a clear warning when no runner is available; does not fail the overall test suite
- [ ] #8 Test VM ships only the statically-linked podkit binary + ffmpeg + gpod-tool (test-time dep) + kernel modules — no Bun, no Node, no -dev packages, no source tree
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Phase 3 status (2026-05-14):** Subtasks 322.01-322.06 implemented; the harness scaffolding is in place and tests auto-skip on macOS without Lima. AC #2 (`bun run test` on mac with Lima passes Tier 3 end-to-end against 3 starter personas) is BLOCKED at the FunctionFS descriptor handshake — see TASK-322.05.01. Doctor-vs-state assertions in TASK-322.06 are BLOCKED on TASK-333 (system-only doctor invocation). Phase 3 completion requires both follow-up tasks to land. Phases 4 + 5 (TASK-324 persona expansion) are independent and can proceed in parallel.
<!-- SECTION:NOTES:END -->
