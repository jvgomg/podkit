---
id: TASK-451
title: 'Test Tier 5: scaffold image+daemon e2e in Lima VM against synthesized USB iPod'
status: To Do
assignee: []
created_date: '2026-06-27 19:05'
updated_date: '2026-07-11 11:22'
labels:
  - docker
  - daemon
  - testing
  - vm
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
  - test-packages/device-testing-daemon/
  - test-packages/e2e-vm-tests/
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 5 of the docker testing strategy (scaffold now, broaden later). Run the shipped Docker image inside the Linux Lima VM, against a synthesized USB iPod from `device-testing-daemon`, with real device passthrough to the container. The only tier that exercises the USB setup path (`device add` -> firmware inquiry -> SIE write) and validates daemon steady-state against a fully-controlled device.

Reuse: the VM harness already synthesizes USB iPods, serves SysInfoExtended over the vendor read, and has device-add / doctor-repair / discovery scenarios — re-point one persona at the Docker image rather than the host binary. Constraint: macOS Docker Desktop cannot pass USB to containers, so this runs inside the Linux VM. Scope here is scaffolding (one persona, wiring proven); the full persona matrix is a later Draft task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Docker image runs inside the Lima VM with /dev/bus/usb passthrough to the container
- [ ] #2 One synthesized USB iPod persona drives `device add` -> SIE write through the image
- [ ] #3 Daemon steady-state sync against the synthesized device proven through the image
- [ ] #4 Documented local command to run the tier
- [ ] #5 Full persona matrix explicitly deferred to a Draft task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Notes from TASK-443 verification (2026-07-11)

**nerdctl/containerd already installed:** The podkit-device-harness VM has containerd + nerdctl from the Lima bundle — no docker install needed. The WIP image was loaded and run via `sudo nerdctl` throughout TASK-443 verification.

**FunctionFS cannot serve DEVICE-level USB vendor reads (critical blocker for AC#2):**
Linux FunctionFS only routes INTERFACE-level (0xC1) control transfers to userspace ep0. The real iPod SIE protocol uses DEVICE-level (0xC0). This means `device-testing-daemon` (FunctionFS gadget) cannot serve the real USB SIE vendor read — the kernel STALLs it before the daemon sees a SETUP event. Confirmed empirically: 0xC1 → daemon received it; 0xC0 → STALL, no daemon log.

AC#2 ('firmware inquiry → SIE write through the image') cannot be proven via USB with the current FunctionFS approach. Options:
1. Pre-populate SysInfoExtended on disk before `device add` (exercises the disk-SIE path, not USB inquiry)
2. Fix device-testing-daemon to use raw gadget API or another mechanism that can serve DEVICE-level vendor requests
3. Adjust AC#2 scope: 'device add reads disk SIE' (proven in TASK-443) vs 'device add writes SIE from USB inquiry' (blocked by FunctionFS)

**PUID=0 + --device <blockdev> required for device add:**
findmnt resolves UUID via libblkid which reads the block device directly. Block device is `brw-rw---- root disk`; uid=1000 returns empty UUID. One-time `device add` needs PUID=0 or disk group + `--device /dev/sdX`. Tests must account for this.

**Disk headroom:** harness VM was at 86% (785M free) during TASK-443. Image + test workload may require pruning. Monitor with `sudo nerdctl system prune -af` before test runs.

UPDATE (2026-07-11, TASK-462): the FunctionFS DEVICE-level blocker recorded in the TASK-443 notes above is RESOLVED. The dummy-hcd-daemon now serves the real iPod USB SIE vendor read (bmRequestType=0xC0) via the FUNCTIONFS_ALL_CTRL_RECIP descriptor flag, proven in-harness (A/B: 0x03 STALLs, 0x43 serves SIE XML). Consequences for this task:
- AC#2 ('device add -> SIE write through the image') is achievable over REAL USB inquiry, no disk-SIE workaround. The three options in the TASK-443 note (pre-populate SIE / raw-gadget rewrite / reframe AC) are moot.
- Target a USB-mode persona (ipod-nano-4g-black, USB PID 0x1263 — 'USB inquiry: yes' generation), NOT the SCSI-only ipod-video-5g persona (serving 5G over 0xC0 would be a fiction; Docker supports USB inquiry only per identity-support-matrix.md §5).
- PREREQ: bump the harness VM disk. It is 6 GiB (Lima 'disk:') and baking a Docker image inside the VM needs headroom; an unclean stop near-full wedged the boot this session (required destroy+harness:setup to recover).
- Image source (per plan Q7): Stage 1 = local in-VM build from the Dockerfile; Stage 2 (separate follow-up task) = pull a pre-release GHA-built image. A GHA pre-release/RC image seam does NOT exist yet (docker.yml is release-only) and must be built for Stage 2.
<!-- SECTION:NOTES:END -->
