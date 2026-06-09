---
id: TASK-418
title: >-
  VM personas-baseline: healthy SystemState fixture asserts inquiry-methods warn
  but VM has /dev/sg*
status: Done
assignee: []
created_date: '2026-06-09 13:42'
updated_date: '2026-06-09 14:04'
labels:
  - bug
  - test
  - vm
  - fixtures
  - device-harness
dependencies: []
references:
  - test-packages/device-testing/src/system-states/healthy.ts
  - test-packages/device-testing/src/vm/personas-baseline.e2e.test.ts
  - packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts
  - packages/ipod-firmware/src/inquiry/probe.ts
priority: medium
ordinal: 133000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`test-packages/device-testing/src/system-states/healthy.ts` asserts that under the "healthy" SystemState, `podkit doctor --scope system --json` returns `overallStatus: 'warn'` with `inquiry-methods` at `status: 'warn'` summarized as `no /dev/sg* nodes`. Consequently `expectedExitCode: 2`.

Reality on the current device-harness VM (`podkit-device-harness`):

```
$ limactl shell podkit-device-harness bash -c 'ls /dev | grep -E "^sg"'
sg0
sg1
```

`podkit doctor --scope system --json` correctly reports `inquiry-methods: pass` with summary `/dev/sg* present`, `overallStatus: ok` (`healthy: true`), exit code `0`.

Three `personas-baseline.e2e.test.ts` cells fail as a result:

```
(fail) VM: starter personas > SystemState: healthy > persona: ipod-video-5g-iflash-1tb > podkit doctor --scope system --json agrees with the SystemState fixture
(fail) VM: starter personas > SystemState: healthy > persona: ipod-nano-7g-space-gray > podkit doctor --scope system --json agrees with the SystemState fixture
(fail) VM: starter personas > SystemState: healthy > persona: echo-mini > podkit doctor --scope system --json agrees with the SystemState fixture
```

All three are the same fixture drift; they fan out across personas because the test loops over personas at the outer `describe`.

## Root cause hypothesis

The fixture's module-level comment says: "The VM has the `sg` kernel module loaded but no physical SCSI generic devices attached." That assumption broke when the dummy_hcd + usb_storage + scsi_generic kernel chain started spawning `sg0`/`sg1` on the synthesized USB host controller. Possibly introduced when `dummy-hcd-daemon` was added (m-19 phase 2) or when `usb_f_mass_storage` started attaching automatically.

`lsmod` on the VM confirms the kernel chain:
```
sg                     45056  0
scsi_mod              229376  4 sd_mod,usb_storage,uas,sg
usb_f_mass_storage     53248  4
```

## Scope

1. Pick one resolution:
   - **(a) Fix the fixture.** Flip `inquiry-methods` to `status: 'pass'` + `summary: '/dev/sg* present'`, `overallStatus: 'healthy'`, `expectedExitCode: 0`. Update the module-level comment to reflect that the harness VM does have sg nodes (via dummy_hcd → usb_storage → scsi_generic).
   - **(b) Suppress sg node creation in the harness.** If the design intent is "harness VM has no SCSI devices", figure out which kernel module load to defer (probably `usb_storage` or `usb_f_mass_storage`) and rework the daemon setup. Higher cost.
   - Recommend **(a)** — the sg nodes are a real-environment property of dummy_hcd-based gadget emulation, and a real iPod connected to a Linux box ALSO produces sg nodes. The "healthy" fixture should match what users see.
2. Strengthen the test to fail on UNEXPECTED status (so if someone reintroduces a warn condition we catch it immediately).
3. Audit the other SystemState fixtures (`no-libgpod`, `no-ffmpeg`, `no-udev`, etc.) for similar drift — they may share the same wrong-assumption-about-inquiry-methods baseline.

## Provenance

Surfaced while running `bun run test:vm` to validate TASK-416's matrix prediction update. The fixture drift pre-dates TASK-416 entirely; filed separately because the fix touches `system-states/healthy.ts` (and possibly siblings) rather than the save-transaction code.

## References

- `test-packages/device-testing/src/system-states/healthy.ts:33-72` — the wrong fixture
- `test-packages/device-testing/src/vm/personas-baseline.e2e.test.ts:159-193` — the failing assertion
- `packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts` — the check (correctly returns pass)
- `packages/ipod-firmware/src/inquiry/probe.ts:128-162` — the Linux SCSI probe
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 #1 Pick resolution (a) fix fixture / (b) suppress sg nodes; document rationale in the fixture's module-level comment
- [x] #2 #2 All three `personas-baseline.e2e.test.ts` healthy-state cells GREEN
- [ ] #3 #3 Audit other SystemState fixtures for the same baseline assumption; fix or note as healthy
- [ ] #4 #4 If (a): add a regression guard so `/dev/sg*` re-appearing/disappearing breaks the fixture loudly, not silently
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Root cause was the TEST, not the fixture

After capturing actual doctor output under a clean `apply-state.sh healthy` (no persona attached), `inquiry-methods` correctly returns `status: 'warn'` summary `'no /dev/sg* nodes'` — matching the fixture exactly. The harness VM does NOT have `/dev/sg*` in baseline state; the modules (`sg`, `usb_storage`, `scsi_mod`) are loaded but no scsi_generic nodes are created until something attaches a USB mass-storage gadget.

The doctor-vs-state test wrapped its `podkit doctor --scope system --json` call in `withPersona({ persona }, ...)`. The wrap starts `dummy-hcd-daemon` which attaches a synthetic USB mass-storage gadget on the dummy_hcd controller. The host's `usb_storage` driver binds the gadget and `scsi_generic` spawns `/dev/sg0`/`/dev/sg1`. The doctor probe (correctly) finds the sg nodes and reports `pass` — but the fixture is pinned for the no-persona-attached host environment.

The test comment said "System-scope doctor reads the host environment only — no device required" but the test wrapped in `withPersona` anyway. Removing the wrap (one edit at `personas-baseline.e2e.test.ts:166`) makes the test observe the baseline host environment, matching the fixture.

## What landed

- `test-packages/device-testing/src/vm/personas-baseline.e2e.test.ts:159-193`: removed the `withPersona` wrapper around the doctor-vs-state assertion. Added a comment explaining the rationale (persona attach loads usb_storage/scsi_generic which spawns sg nodes and masks the baseline harness state).
- No fixture changes. `healthy.ts` (and the 8 other system-state fixtures) are accurate for the baseline harness; the `system-state-cross-check.e2e.test.ts` suite (which doesn't use `withPersona`) was already aligned.

## Verification

`bun run test:vm`: 20/20 turbo tasks GREEN.
- `@podkit/device-testing#test:vm`: all 38 tests pass (3 previously-failing healthy-state persona cells now GREEN).
- `@podkit/e2e-vm-tests#test:vm`: 184 pass / 42 skip / 0 fail. Save-failure matrix (including TASK-416's ENOSPC-routed drift cell) GREEN. SystemState cross-check GREEN across all 9 states.

## Carry-forward closures (scope items not needed)

- AC #1 / AC #3 / AC #4 — N/A. The fixture wasn't drifting; the test was. No fixture audit needed; no regression guard added (the `system-state-cross-check.e2e.test.ts` suite already pins every fixture's per-check status against the live registry — drift in either direction lands as a loud test failure).

## Provenance

Filed during TASK-416 verification; closed as part of the same VM-green pass. The minimal fix kept TASK-416's PR boundary clean by isolating the personas-baseline change to a single test file.
<!-- SECTION:FINAL_SUMMARY:END -->
