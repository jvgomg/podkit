---
id: TASK-504
title: Centralise the USB-enumeration wait into startDaemonForPersona
status: Done
assignee: []
created_date: '2026-09-09 20:25'
updated_date: '2026-09-12 13:47'
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
- [x] #1 `startDaemonForPersona` does not return until the persona's gadget is enumerated, or fails loudly with the daemon journal
- [x] #2 The three direct callers in e2e-vm-tests no longer need their own wait, and `withPersona` is not doing the wait twice
- [x] #3 Any remaining way to get an un-waited daemon is explicit at the call site, not the default
- [x] #4 A unit test with an injected SubprocessRunner pins that the primitive waits, so the guarantee does not depend on running the VM
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Landed

**The wait is now inside the primitive and there is no way round it.**
`startDaemonForPersona` issues `systemctl start`, then waits for the persona's
`vid:pid` in sysfs, and additionally for `/dev/sg*` when the persona carries a
`massStorageBackingFile`. No opt-out was added — see AC#3 below.

**Signature change is what makes it unbypassable.** `StartDaemonOpts.personaId:
string` became `persona: DevicePersona`. The primitive waits for *this*
persona's gadget, which needs its `vid:pid` and whether it has a backing file;
a caller that can only name an id cannot be handed a daemon whose readiness we
can establish. The compiler now enforces that.

**Module move (no cycle).** The waits lived in `vm/persona-fixture.ts`, which
imports `runners/lima-test-vm.ts` — folding them in as-is would have made
`runners/` depend on `vm/`. Extracted both waits plus `probeTimeout`,
`udcSlotSuffix`, `daemonLogSuffix` and the two bounds into new
`runners/lima-enumeration.ts`, so the direction stays one-way (`vm/` composes
`runners/`, never the reverse). `vm/persona-fixture.test.ts` → `runners/
lima-enumeration.test.ts` (git mv, tests unchanged bar the import).

**Not re-exported.** `waitForUsbEnumeration` / `waitForScsiGenericEnumeration`
are gone from `src/index.ts`, with a comment saying why. Reaching past the
primitive is exactly the failure this task closes, so the door is shut rather
than left ajar with a warning.

**Timeout seam.** `StartDaemonOpts.enumerationTimeoutMs` exists solely so the
never-enumerates path is unit-testable in 200ms instead of waiting out the real
5s budget. Production callers leave it unset. This is the one knob added.

### Call sites converged (9 files)

Dropped their own wait — `vm/persona-fixture.ts` (`withPersona`),
`vm/mount-persona.ts`, and the four e2e files: `pre-sync-sweep`,
`doctor-device-types`, `doctor-output-contract`, `discovery-reconciliation`
(the replug loop `cd851a53` had patched at the call site).

`MountPersonaOpts` also changed: `personaId` + `vendorId` + `productId` →
`persona`. All ten call sites were already writing `personaId: PERSONA.id,
vendorId: PERSONA.usbDescriptor.vendorId, productId: PERSONA.usbDescriptor
.productId` — three fields re-derived from one object, and two vm-docker sites
had indirected them through local `VID`/`PID` consts that could drift from the
persona they claimed to describe. Now `persona: PERSONA`.

`dual-daemon-lifecycle.e2e.test.ts` passes the persona objects; its comment
claiming `waitForBothUnitsActive` "covers the gap" was stale and is corrected —
unit-active and enumerated are different properties and that test is about the
former.

### AC#3 — no opt-out, deliberately

The task allowed one "only if some caller genuinely wants the un-waited
behaviour". Every caller was audited and none does. The nearest candidate,
`dual-daemon-lifecycle`, wants *both* units started before asserting, which the
waits do not prevent. An unused flag would be dead code and a standing
invitation, so AC#3 is satisfied by there being no un-waited path at all rather
than by an explicit flag.

### AC#4 — unit coverage (the guarantee does not need the VM)

Six new tests in `lima-test-vm.test.ts` driven by a content-dispatching
`SubprocessRunner` (the positional `makeScriptedRunner` cannot serve a poll
loop):
- does not return until the vid:pid appears — first two probes see an empty
  bus, asserts it polled three times and probed for *this* persona's ids
- start precedes the probe (a probe before the start would be reporting on the
  previous persona's gadget)
- mass-storage persona also waits for `/dev/sg*`, and does so *after* the USB
  wait
- FunctionFS-only persona issues no SCSI probe at all
- never-enumerates fails with the persona, the vid:pid and the daemon journal
  in the message
- the pre-existing four (systemctl invocation, failure propagation, argument
  validation, lifecycle bound) retained

### Verification

- `bun run lint` clean (oxlint 0/0, CLI-stderr, shellcheck).
- `bunx turbo run typecheck` 38/38.
- `@podkit/device-testing` `test:unit` **338 pass / 0 fail** (`--force`, Cached: 0).
- `bunx prettier --write` on every touched file; re-linted after.
- Swept for stale references: no live code outside the primitive mentions
  either wait; no `startDaemonForPersona`/`mountPersona` call site still passes
  `personaId`.
- No changeset — test packages only, nothing user-facing in a distributed
  package.

### Docs

`docs/architecture/testing/vm-testing.md`: new section "Enumeration is the
primitive's job, not the caller's" stating the guarantee and why the failure is
silent rather than loud; the `withPersona` and `mountPersona` bullet lists
corrected.

## AC#5 — BLOCKED on this machine, not attempted

`bun run test:vm` was not run and AC#5 is left unchecked. `bun run vm:status
device` reports `missing`, and the harness cannot be provisioned here:
`test-packages/lima/vms/podkit-device.yaml` declares `vmType: 'vz'` (Apple
Virtualization.framework, macOS-only) and this host has no `/dev/kvm`, so the
qemu fallback would have no hardware virtualisation either. This is the gap
TASK-493 exists to close.

Everything below the VM is proven; what remains unproven is that the three
previously-racing files are green *in the VM*, which is AC#5's actual claim.
Run on a macOS harness host (or after TASK-493):

    bun run test:vm

with attention to `pre-sync-sweep.e2e.test.ts`,
`doctor-device-types.e2e.test.ts` and `doctor-output-contract.e2e.test.ts`.

## Finding, not fixed — the SCSI wait is not persona-specific

`waitForScsiGenericEnumeration` polls `ls /dev/sg* | head -n1`, which matches
**any** SCSI generic node, including the VM's boot disk and a node left by a
previous persona. `dual-daemon-lifecycle.e2e.test.ts` already knows this — it
counts against a pre-start baseline "because the boot disk already contributes
sg nodes". So that wait can return immediately without the persona's own node
existing.

It is not load-bearing here: the USB wait *is* persona-specific and runs first,
so the per-persona guarantee AC#1 asks for holds on that. But the SCSI wait is
weaker than its name suggests, and `mountPersona`'s `/dev/sd<x>` discovery runs
right after it. Left alone rather than silently widening this task's scope;
worth its own task if a mount-discovery flake ever shows up.

## AC#5 split out to TASK-508 (2026-09-12)

The original AC#5 (`bun run test:vm` green, the previously-racing files confirmed
rather than assumed) has been **removed from this task and re-filed as TASK-508**,
to be run on the macOS harness host. It is not dropped — TASK-508 carries it
verbatim plus the specific things to look at, and TASK-506 now depends on
TASK-508 so the retry decision still waits for that evidence.

This task is Done on the strength of everything that does not need the VM:
the primitive is unbypassable by type, all call sites converged, and six unit
tests with an injected `SubprocessRunner` pin that it polls rather than trusting
`systemctl`. What remains is confirmation on hardware nobody has here.
<!-- SECTION:NOTES:END -->
