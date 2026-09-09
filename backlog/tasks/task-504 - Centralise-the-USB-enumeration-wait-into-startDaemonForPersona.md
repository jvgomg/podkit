---
id: TASK-504
title: Centralise the USB-enumeration wait into startDaemonForPersona
status: To Do
assignee: []
created_date: '2026-09-09 20:25'
labels:
  - testing
  - vm
  - concurrency
dependencies: []
references:
  - test-packages/device-testing/src/runners/lima-test-vm.ts
  - test-packages/device-testing/src/vm/persona-fixture.ts
  - test-packages/e2e-vm-tests/src/
priority: medium
type: bug
ordinal: 283000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The follow-up `5556e966` named and never landed. That commit fixed `withPersona`; `cd851a53` fixed the replug loop. Three callers still race.

## The gap

`startDaemonForPersona` (`runners/lima-test-vm.ts:396`) is a bare `systemctl start` plus an exit-code check. The unit is `Type=simple`, so systemd returns as soon as the daemon **execs** — 2-3 seconds before the kernel finishes enumerating the synthesised USB gadget. The readiness wait lives outside the primitive, in `persona-fixture.ts`'s `withPersona` (`waitForUsbEnumeration`, line 127).

So any caller reaching for the primitive directly gets a daemon that has started and a bus that is empty. `5556e966` spelled this out: *"Direct startDaemonForPersona callers (doctor-device-types, doctor-output-contract, pre-sync-sweep, the replug-cycle test) bypass withPersona and still race — a follow-up will centralize the wait into the startDaemonForPersona primitive."* Only the replug-cycle case was fixed, by exporting `waitForUsbEnumeration` and calling it at the call site — which treats the symptom.

Still bypassing, verified:

- `e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts:420`
- `e2e-vm-tests/src/doctor-device-types.e2e.test.ts:301`
- `e2e-vm-tests/src/doctor-output-contract.e2e.test.ts:534`

## Why it is worth doing properly

The failure is silent, not loud: `podkit device scan` against an empty bus returns zero devices, which reads as a legitimate result rather than an error. A test asserting "no unsupported device appears" would *pass* for the wrong reason.

Fixing it at the call sites means the next person to call the primitive races again. The primitive should be unbypassable — a started daemon that isn't enumerated is not a useful thing to hand back to anyone.

## Direction

Fold the wait into `startDaemonForPersona`, so `withPersona` and the direct callers converge on one path. Keep an opt-out only if some caller genuinely wants the un-waited behaviour, and make that caller say so explicitly rather than getting it by default. `waitForUsbEnumeration` already dumps the daemon journal on timeout, so a genuine synthesis failure stays loud.

Note the module boundary: the wait currently lives in `vm/persona-fixture.ts` and the primitive in `runners/lima-test-vm.ts` — moving one or the other may be part of the change.

**Verification needs the device VM** (`bun run test:vm`), so this cannot be validated by unit tests alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `startDaemonForPersona` does not return until the persona's gadget is enumerated, or fails loudly with the daemon journal
- [ ] #2 The three direct callers in e2e-vm-tests no longer need their own wait, and `withPersona` is not doing the wait twice
- [ ] #3 Any remaining way to get an un-waited daemon is explicit at the call site, not the default
- [ ] #4 A unit test with an injected SubprocessRunner pins that the primitive waits, so the guarantee does not depend on running the VM
- [ ] #5 `bun run test:vm` passes, and the three previously-racing files are confirmed green rather than assumed
<!-- AC:END -->
