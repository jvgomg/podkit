---
id: TASK-293.06
title: P2.6 — Verify libgpod-node builds without libusb development headers
status: Done
assignee: []
created_date: '2026-05-03 11:31'
updated_date: '2026-05-05 17:57'
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
- [x] #1 libgpod-node builds successfully on Debian without libusb-1.0-0-dev installed
- [x] #2 Existing libgpod-node integration tests (database operations) pass
- [x] #3 podkit-core's getDefaultUsbReader helper removed if unused (dead code from P2.2)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Verification approach: Option A (Lima VM, Debian, no libusb-dev).

The linux-tests-debian Lima VM has libgpod-1.0 dev headers installed but libusb-1.0-0-dev is NOT present (dpkg confirms no match). Copied modified native/ source and binding.gyp to the VM, installed node-addon-api and node-gyp locally, ran node-gyp rebuild. Result: gyp info ok — all 9 .cc files compiled and linked without error.

This directly proves the acceptance criterion: @podkit/libgpod-node builds successfully on Linux (Debian) without libusb development headers.

AC #3 (getDefaultUsbReader dead code): Function not found anywhere in the codebase — already removed in a prior task (292.08 wiring). AC satisfied.
<!-- SECTION:FINAL_SUMMARY:END -->
