---
id: TASK-296
title: SCSI inquiry in podkit-docker + podkit-daemon
status: To Do
assignee: []
created_date: '2026-05-03 12:46'
labels:
  - device-capability-architecture
  - docker
  - daemon
milestone: m-18
dependencies:
  - TASK-292
documentation:
  - backlog/docs/doc-030 - PRD-Device-Capability-Architecture.md
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
  - tools/scsi-spike/FINDINGS.md
  - packages/podkit-docker/Dockerfile
  - packages/podkit-docker/entrypoint.sh
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After P1 ships SCSI inquiry in `@podkit/ipod-firmware`, we need it to work inside the podkit-docker container — for both one-shot CLI invocations (`docker run podkit doctor`) and the long-running daemon mode (`podkit-daemon`) where devices are hot-plugged after the container starts.

This is a meaningful chunk of architecture, distinct from the host-side P1 work. The CLI-from-host case is solved by `--device /dev/sgN:/dev/sgN`; the daemon case requires hotplug-aware device exposure.

## Problem

`packages/podkit-docker/Dockerfile` runs as root (no `USER` directive). Inside the container, root has free SCSI access — the host's udev rule is irrelevant.

What the container can see depends on the `docker run` invocation:

- `--device /dev/sgN:/dev/sgN` — exposes a single specific device that exists at container start. Does not survive replug; new device nodes do not appear.
- `--device /dev/bus/usb` — exposes the entire USB tree. libusb sees hotplug events. SCSI generic nodes (`/dev/sgN`) are NOT in `/dev/bus/usb` and still need separate exposure.
- `--privileged` — broad and discouraged but works for everything, including hotplug.
- `--device-cgroup-rule 'c 21:* rmw'` plus `--volume /dev:/dev:rw` — middle ground; allows the container to access scsi_generic char devices (major 21) when they appear in the host's `/dev`. Requires bind-mounting `/dev` so new nodes propagate. Some security trade-off.

The daemon use case (`podkit-daemon`) is the harder one because it must respond to hotplug events for the duration of its lifetime, not just at start. The current entrypoint.sh does some libusb-related setup but does not handle SCSI generic devices.

## Scope

1. **Design decision: which exposure strategy ships as default?** Trade off between security, simplicity, and "it just works":
   - Document the spectrum: `--device` (specific) vs cgroup-rule + /dev bind (hotplug-friendly) vs `--privileged` (broad).
   - Default likely cgroup-rule + /dev bind, with `--privileged` documented as the lazy escape hatch.
2. **podkit-docker entrypoint.sh:** detect at startup whether SCSI nodes are accessible; warn if not. For daemon mode, set up any host-side bridges needed (probably none — udev events propagate through the bind-mount automatically).
3. **podkit-daemon hotplug handling:** the daemon already listens for USB events for libusb; it must additionally watch for `/dev/sg*` appearance/disappearance and re-issue SCSI inquiry as needed. The inquiry orchestrator from P1 should be re-callable on hotplug.
4. **Documentation:** the canonical `docker run` invocation for one-shot use; the canonical `docker run` invocation for daemon use; the trade-offs each makes; how to verify the container has the right device access.
5. **Docker compose example:** add a compose file (or update existing one in `packages/podkit-docker/`) showing the daemon use case with all the right volume / device flags.
6. **Integration test:** a CI test that runs the docker image with passthrough and exercises a SCSI inquiry path (against a USB gadget — the virtual iPod from m-17 may serve here, or against a mock SCSI device).
7. **Document the udev rule's irrelevance inside the container.** Users coming from the host setup will wonder.
8. **Security review of the chosen default.** Whatever exposure strategy ships should be reviewed against principle-of-least-privilege for the daemon case especially (long-running, root inside container).

## Why a separate task

P1 (TASK-292) ships SCSI working on the host — the user-visible win. This work assumes that primitive exists and layers container support on top. Splitting keeps P1 small and means SCSI ships to host users immediately while the container/daemon story is designed properly.

This task can begin once TASK-292 (P1 main) is done. It depends conceptually on the SCSI transport being available; it does not need P2/P3/P4.

Parent PRD: doc-030 (PRD: Device Capability Architecture).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Default `docker run` invocation documented for one-shot SCSI use (probably `--device /dev/sgN:/dev/sgN`)
- [ ] #2 Default `docker run` invocation documented for daemon use with hotplug (probably `--device-cgroup-rule 'c 21:* rmw' --volume /dev:/dev:rw` or equivalent)
- [ ] #3 Trade-off documentation comparing the strategies (security, hotplug support, simplicity)
- [ ] #4 podkit-docker entrypoint.sh detects SCSI access availability at startup; warns clearly when SCSI inquiry would be needed but no /dev/sg* is visible
- [ ] #5 podkit-daemon handles /dev/sg* appearance/disappearance events for the lifetime of the daemon, re-running inquiry as appropriate
- [ ] #6 Docker compose example file in packages/podkit-docker/ for the daemon use case
- [ ] #7 Integration test exercises SCSI inquiry inside the container with proper device passthrough
- [ ] #8 User docs include a Linux SCSI section under docker.md (or equivalent) covering: how to expose devices, how to verify access, what changes when running daemon vs one-shot
- [ ] #9 Documents that the host udev rule (TASK-292.12) does not apply inside the container; container root has access to whatever devices are exposed via --device or cgroup
- [ ] #10 Security review notes: which exposure strategies escalate privileges, which are safe-by-default, recommendation for the daemon case
<!-- AC:END -->
