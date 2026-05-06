---
id: TASK-297
title: 'Retroactive review: P2 (USB inquiry consolidation)'
status: To Do
assignee: []
created_date: '2026-05-06 21:54'
labels:
  - device-capability-architecture
  - review-debt
milestone: m-18
dependencies: []
ordinal: 9999
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
P2 (commit `4598f8f`) shipped without an independent sonnet review of the merged diff. Worker self-reports + lead gate-checks were the only verification.

This task: dispatch a holistic sonnet review of `4598f8f`. Areas of focus:
- libusb FFI implementation: lifecycle (init/exit, open/close), error paths, Apple vendor control transfer protocol correctness vs libgpod source
- libgpod-node binding cleanup: no dangling imports, libusb fully removed
- binding.gyp: no libusb pkg-config / link flags
- Linux build verifiability without libusb-1.0-dev
- Breaking change in `@podkit/libgpod-node` export removal — changeset accuracy

If review surfaces bugs, fix in P4 cleanup pass (don't rewrite history).

Backlog task to track gap; no scope until reviewer report comes back.
<!-- SECTION:DESCRIPTION:END -->
