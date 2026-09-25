---
id: TASK-523
title: >-
  Nine e2e-vm cells fail on the remote amd64 substrate — mass-storage LUNs never
  appear as /dev/sd*
status: In Progress
assignee: []
created_date: '2026-09-23 20:23'
updated_date: '2026-09-25 19:28'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies:
  - TASK-514
  - TASK-509
references:
  - docs/environments/device-substrate-proxmox.md
  - test-packages/device-testing/scripts/apply-state.sh
  - test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts
priority: high
type: bug
ordinal: 293000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With TASK-514 half 2 landed, `bun run test:vm` reaches the remote Proxmox substrate end to end for the first time: artifacts build on the remote amd64 builder, install onto the remote amd64 substrate, and the suites run. **176 of 229 e2e-vm cells pass. Nine fail, and they fail for one reason.**

The gadget's mass-storage LUN never appears as a SCSI disk in the substrate. The clearest message is the echo-mini one:

```
error: failed to find echo-mini /dev/sd* node (exit=1, stdout="")
```

and the HFS+ pair report the same thing one layer up — `readiness.level` is `needs-partition` instead of `unsupported`, and `device add` answers `DETECTED_MASS_STORAGE` instead of `UNSUPPORTED_FILESYSTEM_ON_LINUX`, both of which are what podkit says about a disk whose partitions it cannot read.

**This is not the build path, and not the backing files.** Ruled out by measurement on the box:

- `substrate-doctor.sh` PASSES on the substrate — 24 assertions, including all five kernel modules, four UDC slots, configfs, and `avx2`.
- The synthesised backing files are correct *on the substrate*. `/var/device-testing/backing-files/ipod-nano-4g-hfsplus.img` loop-mounts there as `PTTYPE="dos"` with `loop0p1: TYPE="hfsplus"`, UUID intact. The other six images are present at their declared sizes.
- The binaries are correct amd64 glibc ELFs, built on the remote builder, and 176 cells — including device discovery — pass with them.

So the gap is between "the image is on the box" and "the kernel exposes a partitioned SCSI disk for it", i.e. the FunctionFS/mass-storage gadget path in `apply-state.sh` + the dummy-hcd daemon, on this substrate specifically.

The nine cells:

| Suite | Cells |
|---|---|
| `hfsplus-refusal` | 2 |
| `device-add-no-verify` | 2 |
| `doctor-output-contract` (echo-mini) | 1 |
| `doctor-device-types` (echo-mini) | 1 |
| `doctor-sysinfo-repair` (SIE truncated) | 1 |
| `doctor-sysinfo-modelnum-mismatch` | 1 |
| `pre-sync-sweep` (SIGKILL round trip) | 1 |

Worth checking first, cheapest to most: whether the LUN is bound at all (`ls /sys/kernel/config/usb_gadget/*/functions/`), whether the host controller enumerates (`dmesg` around the gadget bind), and whether the difference is a *timing* one — 4 vCPU/2 GiB on a contended hypervisor is slower to settle than a Lima VM on a laptop, and several of these suites poll with a bound.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The cause is identified as one of: gadget bind failure, enumeration timing, or a substrate-contract gap the doctor does not assert
- [x] #2 If it is a contract gap, substrate-doctor.sh asserts it — a substrate that cannot expose a LUN must fail its own doctor rather than fail nine tests
- [x] #3 All nine cells pass on the remote amd64 substrate, or each remaining one is skipped with a reason naming what the substrate lacks (ADR-028 §5)
- [ ] #4 The Lima substrate is unaffected — the same suites still pass there
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: claude
created: 2026-09-24 01:12
---
Re-measured on 2026-09-24 from the amd64 Linux dev box, with the substrate sealed and its doctor passing 24/24: **176 pass, 44 skip, 9 fail** — the same nine, unchanged. So the count in the description is reproducible rather than a one-off, and nothing about the seal or the build path moves it.

One extra data point, from a hand-run `podkit device scan --json` against the `ipod-video-5g-iflash-1tb` persona (a cell that *passes*, because its suite only asserts the USB descriptor):

```json
"readiness": { "level": "needs-partition", "stages": [
  { "stage": "usb",       "status": "pass", "summary": "iPod Video (5th Generation) (Apple 05ac)" },
  { "stage": "partition", "status": "fail", "summary": "No disk representation found" },
  … filesystem/mount/sysinfo/database all skipped
]}
```

That separates the two halves cleanly on this substrate: the gadget **binds and enumerates on the USB bus** — vendor `05ac`, product `1209`, serial read back, model cascade-resolved to `video_5g` — and it is only the mass-storage LUN → SCSI disk step that never happens. Which is to say the failure is downstream of the FunctionFS descriptor handshake, not in it.

Two caveats on that reading, so nobody treats it as more than it is. I do not have a same-day Lima run of the same persona to compare against, so `needs-partition` here is measured, not contrasted — confirming that this persona reaches a further readiness level on Lima is still worth doing, and is cheap. And a passing cell showing the symptom means the nine failures are the *only* ones that assert on it, not the only ones exhibiting it; the blast radius is wider than the failure count suggests.

AC #1's three candidates narrow accordingly: whatever the cause is, it lets the UDC bind succeed. Worth starting at `ls /sys/kernel/config/usb_gadget/*/functions/` and the `usb_f_mass_storage` LUN file on a live bind rather than at the daemon's own logs.
---

author: claude
created: 2026-09-25 17:40
---
**Cause found, and it is enumeration timing — AC #1's second candidate.** Fixed as a side effect of TASK-509. Back-to-back A/B on this substrate, 2026-09-25, same box, same backing files, nothing else changed:

| Commit | Result |
|---|---|
| `d6c87b5f` (before TASK-509) | **176 pass, 44 skip, 9 fail** |
| `ea07558d` (after TASK-509) | **194 pass, 44 skip, 0 fail** |

The nine failures at `d6c87b5f` are this task's table exactly — hfsplus-refusal ×2, device-add-no-verify ×2, doctor-output-contract (echo-mini), doctor-device-types (echo-mini), doctor-sysinfo-repair, doctor-sysinfo-modelnum-mismatch, pre-sync-sweep.

**Why the description's conclusion was wrong.** It ruled out timing because `substrate-doctor.sh` passed and the backing files loop-mounted correctly on the box. Both true, and neither touches the actual defect, which was in the *host-side harness*, not the substrate. `startDaemonForPersona` waited for `/dev/sg*` to be non-empty — and this substrate boots off a **SCSI** disk:

```
sg0 vendor=QEMU model=QEMU HARDDISK  block=sda
sg1 vendor=QEMU model=QEMU DVD-ROM   block=sr0
```

So `ls /dev/sg*` was already non-empty before any persona started. The wait returned on its first poll, every time, and the daemon start returned ~1.8s before the persona's disk attached. Every downstream `/dev/sd*` lookup then raced it and lost — which is precisely the reported symptom, `failed to find echo-mini /dev/sd* node` and `partition: No disk representation found`.

The Lima VM where the harness was developed boots off virtio (`/dev/vda`), baseline 0, so the same wait accidentally worked there. That difference is the whole bug, and it is why this reproduced on the remote substrate and nowhere else.

TASK-509 replaced the existence check with the persona's own `sg -> USB parent` walk, requiring the block device. Disk attach is measured at 1790ms (echo-mini) and 1715ms (ipod-video-5g); the wait now blocks for it.

**AC #2 does not apply** — this was not a substrate-contract gap, and `substrate-doctor.sh` was right to pass. A doctor assertion would have been the wrong fix: the substrate could always expose a LUN, the harness just did not wait for it.

**AC #4 is not verified.** "The Lima substrate is unaffected" needs a Lima device VM; this box is an LXC container with no `/dev/kvm`. The change is substrate-agnostic and the unit suites are green, but that is an argument, not a measurement — worth one `test:vm` run on the macOS harness host before closing.
---

author: claude
created: 2026-09-25 17:46
---
Corroboration for AC #4, found in TASK-508's notes rather than by running anything. Its run 1 and run 3 on the **macOS Lima harness** (2026-09-13, pre-fix) both recorded:

```
e2e-vm-tests: 194 pass / 44 skip / 0 fail
```

That is cell-for-cell what this substrate produced after the fix (238 total either way). So the remote substrate has gone from 229 cells with nine failing to matching the Lima baseline exactly — which is the shape you would expect if the only difference between the two was a wait that happened to work on one boot-disk type.

Treat it as corroboration, not as AC #4. It is a *pre-fix* Lima run twelve days old, so it shows the remote substrate now agrees with where Lima already was; it does not show that Lima is still there *after* the change. Only a post-fix `test:vm` on the macOS host does that, and the same run closes TASK-509 AC #6.
---

author: claude
created: 2026-09-25 19:15
---
**AC #2 resolved — checked as not-applicable, and for a structural reason rather than just "the conditional is false".**

Comment #2 established the cause was harness-side, so the `if it is a contract gap` premise fails. But the clause after the dash states a general principle worth answering on its own terms: *a substrate that cannot expose a LUN must fail its own doctor rather than fail nine tests.*

`substrate-doctor.sh` cannot be where that lives. Its own contract, stated at the top of the file:

> Runs unprivileged. It inspects and never mutates — a doctor that fixes what it finds cannot tell you whether provisioning worked.

Proving a LUN attaches means binding a gadget: writing configfs, claiming a UDC, waiting for the kernel to attach a disk. That is privileged and mutating, and it is a *dynamic* property — nothing static about the box establishes it. What the doctor does assert is the full static capability that makes a LUN possible, and it asserts it well: the five kernel modules, `udc slots: N >= SUBSTRATE_UDC_COUNT` (the count, not merely `dummy_hcd`'s presence, precisely because `num=1` loads cleanly then fails the first two-daemon test), configfs mounted *and* surviving a reboot, plus the negative toolchain assertions. It passed 24/24 and was right to.

The principle is now satisfied one layer up, where the bind actually happens: `startDaemonForPersona` waits per-persona for that persona's own disk and, when it does not attach, fails in the setup hook naming the persona, its `vid:pid`, the daemon journal and the UDC slot budget. A substrate that cannot expose a LUN therefore says so once, at the first persona that needs one — not nine assertion failures downstream. That is the right layer: the doctor answers "could this box do it", the wait answers "did it, for this gadget, now".

So AC #2 is checked as answered rather than left open pending a doctor change that would contradict the doctor's purpose.

## AC #4 still open, and it is the one that matters

Re-ran `bun run test:vm` against `deviceRemote` at HEAD (`995da172`): **194 pass, 44 skip, 0 fail** — so the fix holds at HEAD, not only at `ea07558d`. Totals only; the run was piped through `tail -60` so per-cell names did not survive the capture.

That still says nothing about Lima, and the gap is not a formality: virtio-vs-SCSI boot *is* the axis the bug lived on. A green SCSI-substrate run re-confirms the side that was broken. AC #4 asks about the side that accidentally worked, and only a post-fix `test:vm` on the macOS host answers it. The same run closes TASK-509 AC #6.

What has changed in the meantime is that the substrate difference is now pinned by unit tests rather than by argument — two new cases in `scsi-discovery.test.ts` model a PCI-attached host disk holding `sg0`/`sg1` and assert it neither satisfies a persona's wait nor hides the persona's own disk (TASK-509 comment #3). Those run on any host, including a macOS one, so a Lima regression of this specific kind would now fail at unit level too.
---

author: claude
created: 2026-09-25 19:28
---
Two corrections to comment #4, both flagged in review as overclaims. They are.

**1. "a Lima regression of this specific kind would now fail at unit level too" — too strong.** The new cases run against a *transcribed* sysfs tree, so they can only catch a regression in **our code** — someone reverting the walk to an existence check, or breaking its depth. They cannot catch a Lima sysfs or timing divergence, because the tree is a fixture and not a measurement of Lima. That residual risk is exactly what AC #4 exists for, so the sentence was arguing the AC away rather than supporting it. Withdrawn.

Related, and it cuts the same way: the fixture's substrate-disk chain was transcribed from `deviceRemote` (TASK-509 comment #4), so it is faithful to *that* box. Nobody has measured Lima's `/sys/class/scsi_generic` layout, and a virtio-blk boot disk contributes no sg node at all — so on Lima the interesting case is the *absence* the fixture models as an empty class dir, which was already covered.

**2. "says so once, at the first persona that needs one" — wrong unit.** The wait runs per setup hook, not once per suite run. A substrate that cannot expose a LUN produces a setup-hook failure in every suite that mounts a mass-storage persona — on the evidence of this task's own table, at least seven. The claim that holds is narrower and still worth something: each failure names the persona, its `vid:pid`, the daemon journal and the UDC budget *at the point the disk did not attach*, instead of surfacing as a downstream assertion about readiness level or a missing `/dev/sd*` node. Better diagnosis, not fewer failures.

Neither correction changes AC #2's resolution, which rests on the doctor being unprivileged and non-mutating.

**Status moved To Do → In Progress** — 3 of 4 ACs are checked and there are five comments of measured work on it; `To Do` was misreporting.
---
<!-- COMMENTS:END -->
