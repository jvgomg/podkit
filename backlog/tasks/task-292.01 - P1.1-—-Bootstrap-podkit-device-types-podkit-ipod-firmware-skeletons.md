---
id: TASK-292.01
title: P1.1 — Bootstrap @podkit/device-types + @podkit/ipod-firmware skeletons
status: To Do
assignee: []
created_date: '2026-05-03 11:29'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the two new package directories with build, lint, and test infrastructure. Move shared types into `@podkit/device-types` and add re-export shims in podkit-core for back-compat. `@podkit/ipod-firmware` ships as an empty skeleton in this task — implementations follow.

See spec doc-032, Scope section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 packages/device-types/ exists with package.json, build script, test runner
- [ ] #2 packages/ipod-firmware/ exists with package.json, build script, test runner
- [ ] #3 DeviceCapabilities, AudioCodec, DeviceArtworkSource, AudioNormalizationMode moved to @podkit/device-types
- [ ] #4 DeviceIdentity, DeviceProvider, UsbFingerprint, ParsedFirmware, FirmwareCapabilities types added to @podkit/device-types
- [ ] #5 podkit-core re-exports the moved types via shim for back-compat
- [ ] #6 Both packages build successfully and pass empty test suite in CI
<!-- AC:END -->
