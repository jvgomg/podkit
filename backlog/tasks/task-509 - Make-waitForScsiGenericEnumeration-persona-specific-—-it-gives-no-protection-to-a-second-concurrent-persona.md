---
id: TASK-509
title: >-
  Make waitForScsiGenericEnumeration persona-specific — it gives no protection
  to a second concurrent persona
status: In Progress
assignee: []
created_date: '2026-09-13 15:07'
updated_date: '2026-09-25 17:39'
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
modified_files:
  - test-packages/device-testing/src/runners/scsi-discovery.ts
  - test-packages/device-testing/src/runners/scsi-discovery.test.ts
  - test-packages/device-testing/src/runners/lima-enumeration.ts
  - test-packages/device-testing/src/runners/lima-enumeration.test.ts
  - test-packages/device-testing/src/runners/lima-test-vm.ts
  - test-packages/device-testing/src/runners/lima-test-vm.test.ts
  - test-packages/device-testing/src/vm/mount-persona.ts
  - test-packages/device-testing/src/vm/dual-daemon-lifecycle.e2e.test.ts
  - test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts
  - docs/architecture/testing/vm-testing.md
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
- [x] #1 `waitForScsiGenericEnumeration` matches the persona's own sg node by walking `/sys/class/scsi_generic/sg*` to its owning USB device and comparing `idVendor`/`idProduct`, not `ls /dev/sg*`
- [x] #2 The signature takes the whole `DevicePersona` (mirroring `waitForUsbEnumeration`) so the id is no longer error-message-only
- [x] #3 A unit test with an injected `SubprocessRunner` pins that a foreign sg node does NOT satisfy the wait for a different persona
- [x] #4 Starting persona B while persona A is up is shown to block for B's own node (re-measure the ~1.5s window recorded in the description)
- [x] #5 The factually-wrong boot-disk rationale in `dual-daemon-lifecycle.e2e.test.ts`'s baseline comment is corrected; the baseline-delta approach itself is kept
- [ ] #6 `bun run test:vm` stays green on the macOS harness host
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

`waitForScsiGenericEnumeration` is gone; the wait is now `waitForDiskAttachment`, which takes the whole `DevicePersona` and polls the persona's own `/sys/class/scsi_generic/sg*` → USB-parent walk instead of `ls /dev/sg*`.

The walk was not rewritten. It already existed twice — `buildScsiSdDiscoveryScript` / `buildDeviceNodeDiscoveryScript` in `vm/mount-persona.ts` — and a third hand-copied time in `pre-sync-sweep.e2e.test.ts` with `071b:3203` inlined. All three now share one builder, extracted to `runners/scsi-discovery.ts`. It had to move below `vm/` because `runners/` may not import from `vm/`; `mount-persona.ts` re-exports it, so the package surface is unchanged. The extraction was verified byte-identical to the previous inline copy before the e2e call site was switched.

**The wait is deliberately stricter than the AC wording.** AC #1 asks for the sg node; the probe reuses the sd-discovery script, which also requires `$sg/device/block` to be populated. An sg node appears before the kernel attaches the disk, and every caller wants the disk — so the wait now succeeds exactly when the `mountPersona` lookup that follows it will succeed. The function was renamed for the same reason: `…ScsiGenericEnumeration` would have been a misnomer.

## Verification

Unit + integration: 69 turbo tasks green. Host e2e: 37 passed. `lint` and `typecheck` clean.

The walk's four-level `device/../../../..` depth is the part that cannot be checked by reading the generated string, and it is the part a substrate change would break. `scsi-discovery.test.ts` therefore builds a synthetic sysfs tree with the real shape and runs the generated script through a real `sh` — covering the persona's own disk, a foreign gadget that enumerated first, a matched gadget with no disk attached yet, and an empty class dir.

## Not done here

AC #4 and AC #6 need a live device substrate. This machine is an LXC container with no `/dev/kvm`, no `.env`, and `vm:status device` reports `missing`, so no device VM can be started. The new behaviour's timing is pinned only by fakes and a synthetic sysfs tree; the ~1.5s window has not been re-measured.

## Correction to "Not done here"

Written before the remote substrate was tried, and wrong about the environment: the harness config lives in `.env.local`, not `.env`, and `deviceRemote` was reachable all along. AC #4 is now measured (comment #2) and AC #6's suite was run against `deviceRemote` — 194 pass, 44 skip, 0 fail. Only AC #6's literal wording (the macOS harness host, i.e. a Lima substrate) remains unverified, and with it TASK-523 AC #4, "the Lima substrate is unaffected".
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: claude
created: 2026-09-24 23:39
---
Recording the second Fix-shape knock-on, which this change makes concrete rather than hypothetical: *"Personas whose backing file never enumerates as a disk would now time out rather than pass on a foreign node… may surface a persona that was silently getting away with it."*

**Nine personas carry a `massStorageBackingFile` and are therefore in scope** (14 others are `null` and untouched):

```
echo-mini                  ipod-5g-video-mbr-part     ipod-video-5g-corrupt-db
echo-mini-populated        ipod-nano-4g-hfsplus       ipod-video-5g-iflash-1tb
ipod-5g-modelnum-mismatch  ipod-nano-7g-space-gray    ipod-5g-stale-guid
```

**This collides with TASK-523 and the count is not a coincidence.** On the remote amd64 substrate no mass-storage LUN ever attaches, and the nine e2e-vm cells failing there are drawn from exactly this set — hfsplus-refusal ×2, device-add-no-verify ×2, the two echo-mini doctor cells, sysinfo-repair, modelnum-mismatch, pre-sync-sweep. Before this change those cells reached their assertions and failed on the symptom. After it, `startDaemonForPersona` fails in the setup hook instead, naming the persona and the `vid:pid` whose disk never attached, with the daemon journal and the UDC slot budget appended.

That is the better failure and it is what TASK-523 AC #2 asks for — a substrate that cannot expose a LUN should say so rather than fail nine tests downstream. But note the blast radius is slightly **wider** than nine. TASK-523's own comment records `ipod-video-5g-iflash-1tb` as a *passing* cell on that substrate, passing only because its suite asserts the USB descriptor and never looks for a disk. That persona has a backing file, so its setup hook will now time out. Any other backing-file persona in a descriptor-only suite is in the same position.

No code change here: the new behaviour is the intended one. Flagging it so whoever picks up TASK-523 expects setup-hook timeouts rather than assertion failures, and does not read the changed failure shape as a regression from this task. On a substrate where LUNs do attach (Lima), nothing about the failure surface changes.
---

author: claude
created: 2026-09-25 17:39
---
AC #4 measured on the **remote amd64 substrate** (`deviceRemote`), 2026-09-25. Not the Lima VM the description used, and the difference turns out to be the whole story.

```
baseline_sg_nodes=2                              <- NOT 0
A (echo-mini)       blk=sdb  1790ms
old_generic_wait_would_return_immediately_for_B=yes
B (ipod-video-5g)   blk=sdc  1715ms
both_up_sg_nodes=4
after_stop_sg_nodes=2
```

B's own disk attaches 1715ms after its daemon starts, re-measuring the ~1.5s window. But `baseline_sg_nodes=2` is the finding that matters:

```
sg0 vendor=QEMU model=QEMU HARDDISK  block=sda
sg1 vendor=QEMU model=QEMU DVD-ROM   block=sr0
```

This substrate boots off a **SCSI** disk, where the Lima VM boots off virtio (`/dev/vda`). So `ls /dev/sg*` was already non-empty before any persona started, and the old wait returned on its first poll **always — for every persona, including the first**. The description's "the wait is real when one persona is up" holds on Lima and is false here. On this substrate the old wait never waited at all, and `startDaemonForPersona` returned ~1.8s before any persona's disk existed.

AC #6 is still unverified as literally worded: it names the macOS harness host, and I have no Lima device VM. What I can report is `bun run test:vm` against `deviceRemote`: **194 pass, 44 skip, 0 fail**.
---
<!-- COMMENTS:END -->
