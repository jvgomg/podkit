---
id: TASK-523
title: >-
  Nine e2e-vm cells fail on the remote amd64 substrate — mass-storage LUNs never
  appear as /dev/sd*
status: To Do
assignee: []
created_date: '2026-09-23 20:23'
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
