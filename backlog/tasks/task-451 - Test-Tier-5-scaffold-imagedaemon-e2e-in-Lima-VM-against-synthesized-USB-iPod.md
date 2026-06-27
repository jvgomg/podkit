---
id: TASK-451
title: 'Test Tier 5: scaffold image+daemon e2e in Lima VM against synthesized USB iPod'
status: To Do
assignee: []
created_date: '2026-06-27 19:05'
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
