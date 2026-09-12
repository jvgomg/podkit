---
id: TASK-508
title: >-
  Confirm TASK-504's enumeration guarantee in the device VM (macOS harness host
  — Mavis)
status: To Do
assignee: []
created_date: '2026-09-12 13:47'
labels:
  - testing
  - vm
  - concurrency
  - flakiness
  - human-in-the-loop
dependencies:
  - TASK-504
references:
  - test-packages/device-testing/src/runners/lima-test-vm.ts
  - test-packages/device-testing/src/runners/lima-enumeration.ts
  - test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts
  - test-packages/e2e-vm-tests/src/doctor-device-types.e2e.test.ts
  - test-packages/e2e-vm-tests/src/doctor-output-contract.e2e.test.ts
  - test-packages/e2e-vm-tests/src/discovery-reconciliation.e2e.test.ts
  - docs/architecture/testing/vm-testing.md
priority: high
type: task
ordinal: 287000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Run this on a machine that can host the device harness.** TASK-504's code has landed and is fully verified below the VM line; this task is the half that needs real hardware virtualisation.

## Why this is a separate task

TASK-504 folded the gadget-enumeration wait into `startDaemonForPersona` so the primitive cannot hand back a daemon on an empty bus. Its ACs #1–#4 are done and proven: lint clean, typecheck 38/38, `@podkit/device-testing` unit suite 338 pass / 0 fail, and six new unit tests with an injected `SubprocessRunner` pin that the primitive actually polls rather than trusting `systemctl`.

Its AC #5 — `bun run test:vm` green, with the previously-racing files *confirmed* rather than assumed — could not be run on the Linux dev box. `bun run vm:status device` reports `missing` and the VM cannot be created there: `test-packages/lima/vms/podkit-device.yaml` declares `vmType: 'vz'` (Apple Virtualization.framework, macOS-only) and the host has no `/dev/kvm`, so the qemu fallback has no hardware virtualisation either. That gap is TASK-493's subject; this task just needs a host that already works.

## What changed, so you know what you are re-verifying

- `StartDaemonOpts.personaId: string` → `persona: DevicePersona`. The primitive waits for *this* persona's `vid:pid` in sysfs, plus `/dev/sg*` when the persona carries a `massStorageBackingFile`.
- `MountPersonaOpts.personaId`/`vendorId`/`productId` → `persona`. Ten call sites updated.
- The waits moved to `runners/lima-enumeration.ts` and are **no longer exported** from `@podkit/device-testing`.
- Four e2e files dropped their own wait: `pre-sync-sweep`, `doctor-device-types`, `doctor-output-contract`, `discovery-reconciliation`.

## How to run it

```bash
bun run harness:status          # VM, binaries, systemd unit, kernel modules
bun run test:vm                 # auto-runs vm:install (cached) + vm:doctor first
```

`test:vm` now installs the in-VM binary itself, so a plain run should be enough from a healthy harness.

## What to actually look at

Do not just read the exit code. The failure this guards against is silent: a daemon on an empty bus makes `podkit device scan` return zero devices, which reads as a legitimate result. So a green run proves less than it looks like it does unless you check the three files that previously raced.

Pay attention to:

- `pre-sync-sweep.e2e.test.ts` — echo-mini daemon stays up across the whole suite; it dropped a `waitForScsiGenericEnumeration` that ran before `mountEchoMini()`.
- `doctor-device-types.e2e.test.ts` and `doctor-output-contract.e2e.test.ts` — both mount echo-mini once per group off a long-lived daemon.
- `discovery-reconciliation.e2e.test.ts` — the replug loop (start/stop ×3). The one most likely to expose a regression, since it re-binds three times in a row.
- `dual-daemon-lifecycle.e2e.test.ts` — two personas concurrently. Its own `/dev/sg*` count poll is now downstream of the primitive's waits; confirm the `baseline + 2` assertion still holds rather than passing vacuously.

## Known weakness worth confirming or discarding while you are there

`waitForScsiGenericEnumeration` polls `ls /dev/sg* | head -n1`, which matches **any** SCSI generic node — including the VM's boot disk and a node left behind by a previous persona. `dual-daemon-lifecycle` already knows this and counts against a pre-start baseline for exactly that reason. So that wait can return before the persona's own node exists.

It should not be load-bearing: the USB wait *is* persona-specific and runs first. But `mountPersona`'s `/dev/sd<x>` discovery runs immediately after it, so if you see a mount-discovery failure, this is the first thing to suspect. File it separately with evidence rather than patching it here.

## Unblocks

TASK-506 (the retry-policy decision) wants the genuine flake causes fixed *and* shown to hold before `retry = 0` goes in. This is the last piece of that evidence for the VM surface.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `bun run test:vm` passes on the macOS harness host, with the run output recorded in the notes (not just 'it passed')
- [ ] #2 The four converged files — pre-sync-sweep, doctor-device-types, doctor-output-contract, discovery-reconciliation — are each confirmed green by name rather than assumed from a green suite
- [ ] #3 The replug loop in discovery-reconciliation is confirmed to still see exactly one device per cycle across all three cycles
- [ ] #4 dual-daemon-lifecycle's `baseline + 2` sg-count assertion is confirmed to still bind rather than pass vacuously now that the primitive waits first
- [ ] #5 A rerun under host load (or repeated runs) shows the VM suite is no less stable than before the change, so the wait was not traded for a new timeout
- [ ] #6 The non-persona-specific `ls /dev/sg*` weakness is either confirmed harmless in practice or filed as its own task with the failing evidence
- [ ] #7 TASK-504's AC #5 is recorded as satisfied (or the regression it exposes is filed and linked)
<!-- AC:END -->
