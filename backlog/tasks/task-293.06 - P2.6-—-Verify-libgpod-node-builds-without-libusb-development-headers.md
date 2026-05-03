---
id: TASK-293.06
title: P2.6 — Verify libgpod-node builds without libusb development headers
status: To Do
assignee: []
created_date: '2026-05-03 11:31'
labels:
  - device-capability-architecture
  - phase-2
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-033 - Spec-Phase-2-USB-inquiry-consolidation.md
parent_task_id: TASK-293
ordinal: 9060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Manually build libgpod-node on a Debian system that lacks libusb development headers. Build should succeed cleanly (which it could not before P1's runtime dlsym workaround).

This validates that the libusb concern has fully migrated out of the binding.

See spec doc-033, Native binding regression tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 libgpod-node builds successfully on Debian without libusb-1.0-0-dev installed
- [ ] #2 Existing libgpod-node integration tests (database operations) pass
- [ ] #3 podkit-core's getDefaultUsbReader helper removed if unused (dead code from P2.2)
<!-- AC:END -->
