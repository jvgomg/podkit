---
id: TASK-509
title: >-
  Make waitForScsiGenericEnumeration persona-specific — it gives no protection
  to a second concurrent persona
status: To Do
assignee: []
created_date: '2026-09-13 15:07'
labels:
  - testing
  - vm
  - concurrency
  - flakiness
dependencies: []
references:
  - test-packages/device-testing/src/runners/lima-enumeration.ts
  - test-packages/device-testing/src/vm/dual-daemon-lifecycle.e2e.test.ts
  - test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts
priority: medium
type: bug
ordinal: 288000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`waitForScsiGenericEnumeration` (`lima-enumeration.ts`) polls `ls /dev/sg* 2>/dev/null | head -n1` and returns as soon as **any** SCSI generic node exists. It takes a `personaId` but only uses it for the error message — the probe is not persona-specific. TASK-508 measured what that costs.

## Measured on the rebuilt device VM (2026-09-13, Mavis, fresh `harness:setup`)

**The wait is real when one persona is up.** Boot disk is virtio (`/dev/vda`), so there is no boot-disk sg node — `baseline_sg_nodes=0`, contradicting the comment in `dual-daemon-lifecycle.e2e.test.ts` ("the boot disk already contributes sg nodes"). Starting `echo-mini` alone:

```
baseline_sg_nodes=0        (nothing, not even the boot disk)
usb_match_ms=449           persona vid:pid visible in sysfs
persona_sg_block_ms=1451   echo-mini's own sg node + block device
generic_ls_sg_first_true_ms=1451   (identical — only the persona can satisfy it)
after_stop_sg_nodes=0      no lingering node after systemctl stop
```

So for the single-persona case the wait buys a real ~1.0s over the USB wait, and `mountEchoMini` would race without it.

**The wait is worth nothing when a persona is already up.** With `echo-mini` settled, then starting `ipod-video-5g-iflash-1tb`:

```
A_up_sg_nodes=1
generic_wait_would_return_immediately=yes   ← echo-mini's node satisfies B's wait
B_new_sg_node_ms=1474                       ← B's own node appears ~1.5s later
```

`startDaemonForPersona` for B therefore returns ~1.5s before B's mass-storage node exists, while claiming in its docstring that it waits "until the persona's gadget has enumerated". The stale-node variant of the same hole (a node left by a previous persona) is closed in practice — `after_stop_sg_nodes=0` — but the concurrent variant is open.

## Why nothing is failing today

No current caller both (a) starts a second mass-storage persona while another is up, and (b) then discovers a `/dev/sd<x>` node. `dual-daemon-lifecycle` is the only concurrent caller and it already counts against a pre-start baseline itself, so it does not rely on the wait. Every mount-bearing suite runs one mass-storage persona at a time, where the wait does hold. This is a latent guarantee gap, not a live flake.

## Fix shape

Make the probe persona-specific by walking `/sys/class/scsi_generic/sg*` up to the owning USB device and matching `idVendor`/`idProduct` — exactly the script `mountEchoMini` already uses (`pre-sync-sweep.e2e.test.ts:103`), which is persona-specific for this reason. That also turns `personaId` into a parameter the function actually uses, and lets the signature take the whole `DevicePersona` like `waitForUsbEnumeration` does.

Two knock-ons to handle in the same change:

- `dual-daemon-lifecycle`'s baseline-delta comment is factually wrong on this image (baseline is 0). Keep the delta approach — it is defensive and cheap — but fix the stated reason.
- Personas whose backing file never enumerates as a disk would now time out rather than pass on a foreign node. That is the correct behaviour but may surface a persona that was silently getting away with it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `waitForScsiGenericEnumeration` matches the persona's own sg node by walking `/sys/class/scsi_generic/sg*` to its owning USB device and comparing `idVendor`/`idProduct`, not `ls /dev/sg*`
- [ ] #2 The signature takes the whole `DevicePersona` (mirroring `waitForUsbEnumeration`) so the id is no longer error-message-only
- [ ] #3 A unit test with an injected `SubprocessRunner` pins that a foreign sg node does NOT satisfy the wait for a different persona
- [ ] #4 Starting persona B while persona A is up is shown to block for B's own node (re-measure the ~1.5s window recorded in the description)
- [ ] #5 The factually-wrong boot-disk rationale in `dual-daemon-lifecycle.e2e.test.ts`'s baseline comment is corrected; the baseline-delta approach itself is kept
- [ ] #6 `bun run test:vm` stays green on the macOS harness host
<!-- AC:END -->
