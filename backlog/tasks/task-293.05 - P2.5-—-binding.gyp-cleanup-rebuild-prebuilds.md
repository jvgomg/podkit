---
id: TASK-293.05
title: P2.5 — binding.gyp cleanup + rebuild prebuilds
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
ordinal: 9050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drop libusb-1.0 from binding.gyp's pkg-config dependencies. Rebuild libgpod-node prebuilt binaries for all target platforms.

See spec doc-033, Scope > Updated build configuration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 binding.gyp pkg-config no longer references libusb-1.0
- [ ] #2 libgpod-node prebuilds rebuilt successfully on all CI target platforms
- [ ] #3 Binding loads correctly on macOS and Linux runtimes
- [ ] #4 Native binding build size measurably smaller (recorded in changeset)
<!-- AC:END -->
