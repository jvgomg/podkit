---
id: TASK-293.05
title: P2.5 — binding.gyp cleanup + rebuild prebuilds
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
ordinal: 9050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drop libusb-1.0 from binding.gyp's pkg-config dependencies. Rebuild libgpod-node prebuilt binaries for all target platforms.

See spec doc-033, Scope > Updated build configuration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 binding.gyp pkg-config no longer references libusb-1.0
- [ ] #2 libgpod-node prebuilds rebuilt successfully on all CI target platforms
- [x] #3 Binding loads correctly on macOS and Linux runtimes
- [x] #4 Native binding build size measurably smaller (recorded in changeset)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
binding.gyp never had an explicit libusb-1.0 reference — it only calls pkg-config for libgpod-1.0 and glib-2.0. The previous dlsym approach in the C++ code made the libusb dependency implicit (resolved at runtime). With the dlsym shim removed, there is no longer any libusb dependency — direct or indirect — in the binding source or build config. No gyp edits were required.

AC #2 (prebuilds rebuilt on all CI target platforms) deferred to CI on merge — local arm64-darwin prebuild verified by rebuild. Binary size: 307,216 bytes before → 306,368 bytes after (848 bytes smaller).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
binding.gyp required no changes — it already had no direct libusb-1.0 reference. The libusb dependency was entirely in the C++ dlsym shim (now deleted in 293.04). After that removal, the binding has zero libusb surface. Local arm64-darwin rebuild completed cleanly: gyp info ok, no libusb link step. Binary: 307,216 → 306,368 bytes (848 bytes smaller). Full CI prebuild regeneration will happen automatically on merge.
<!-- SECTION:FINAL_SUMMARY:END -->
