---
id: TASK-523
title: >-
  Nine e2e-vm cells fail on the remote amd64 substrate — mass-storage LUNs never
  appear as /dev/sd*
status: To Do
assignee: []
created_date: '2026-09-23 20:23'
updated_date: '2026-09-24 01:12'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies:
  - TASK-514
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
- [ ] #1 The cause is identified as one of: gadget bind failure, enumeration timing, or a substrate-contract gap the doctor does not assert
- [ ] #2 If it is a contract gap, substrate-doctor.sh asserts it — a substrate that cannot expose a LUN must fail its own doctor rather than fail nine tests
- [ ] #3 All nine cells pass on the remote amd64 substrate, or each remaining one is skipped with a reason naming what the substrate lacks (ADR-028 §5)
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
<!-- COMMENTS:END -->
