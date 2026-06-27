---
id: TASK-443
title: Verify firmware inquiry (USB + SCSI) works inside the Alpine image
status: To Do
assignee: []
created_date: '2026-06-27 19:04'
labels:
  - docker
  - ipod-firmware
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-docker/Dockerfile
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The USB *setup* tier (one-time `device add` writing SysInfoExtended) depends on firmware inquiry working inside the Alpine container. The Dockerfile installs no libusb/sg3-utils; the `usb` native binding is bundled and SG_IO via koffi needs no extra package — but this has never been verified in-container. This is a verify-first spike that gates the promise of the USB setup tier.

Determine empirically (with USB passthrough) whether `device add`/`device scan` firmware inquiry succeeds in the image. Add runtime system packages only if verification shows they're needed; otherwise document why none are required. Capture the result in the in-codebase USB/SCSI support matrix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Empirically verified whether USB firmware inquiry works in the Alpine image with /dev/bus/usb passthrough
- [ ] #2 Any required runtime system packages added to the Dockerfile (or documented as not needed, with reasoning)
- [ ] #3 `device add` with USB passthrough writes SysInfoExtended to a device from inside the container (proven via the VM e2e tier)
- [ ] #4 Finding recorded in the in-codebase USB/SCSI device-support matrix
<!-- AC:END -->
