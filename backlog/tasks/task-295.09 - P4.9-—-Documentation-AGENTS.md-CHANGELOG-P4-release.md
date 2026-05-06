---
id: TASK-295.09
title: 'P4.9 — Documentation, AGENTS.md, CHANGELOG, P4 release'
status: Done
assignee: []
created_date: '2026-05-03 11:35'
updated_date: '2026-05-06 23:16'
labels:
  - device-capability-architecture
  - phase-4
  - release
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11090
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final release prep. AGENTS.md updated to reflect the final package structure. CHANGELOG entries for all affected packages. Changesets. Release.

After this task, the device capability architecture milestone (m-18) is complete.

See spec doc-035, Migration steps 11–13.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AGENTS.md monorepo structure reflects the final layout (4 new packages, smaller core)
- [x] #2 CHANGELOG entries for podkit, @podkit/core, all four new packages
- [x] #3 Changeset entries documenting any breaking import path changes
- [ ] #4 P4 released through CI
- [ ] #5 Milestone m-18 marked complete
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Changeset `.changeset/device-capability-finalisation.md` created covering minor bumps for `@podkit/core` (breaking removals: `createIpodCapabilities`, `LibgpodDeviceInfo`, `DEVICE_PRESETS`, `DevicePreset`, `getDevicePreset`, `resolveDeviceCapabilities`), `@podkit/ipod-firmware` (sysinfo I/O, diagnostics helpers, `ParsedFirmware.modelNumber`), `@podkit/device-types` (iPod model types moved here, `UsbConnectionInfo` removed, `notSupportedReason`, `artworkMaxResolution: number | null`), and patches for `@podkit/devices-ipod`, `@podkit/devices-mass-storage`, `podkit`.

AGENTS.md updated: added `iPod sysinfo I/O`, `Capability resolver`, and `libgpod bridge` rows to Entry Points table.

Stale references fixed in `packages/devices-ipod/README.md` (2 hits — removed `createIpodCapabilities`/`LibgpodDeviceInfo` framing), `packages/devices-mass-storage/README.md` (1 hit — `resolveDeviceCapabilities` → `resolveCapabilities`), `packages/devices-mass-storage/src/capabilities.ts` (1 hit), `packages/devices-mass-storage/src/preset.ts` (1 hit).

`packages/ipod-firmware/README.md` updated: platform table now shows libusb-1.0 via koffi (not libgpod-node shim), sysinfo I/O section added with code example, API reference table extended with all new exports.

All quality gates passed: typecheck (27/27), podkit-core unit (2554 tests), devices-ipod (178), devices-mass-storage (74), ipod-firmware (205), lint (0 errors), build (all 16 tasks successful).

AC #4 (CI release) and #5 (m-18 close) stay open — awaiting TASK-295.08 hardware validation and merge.
<!-- SECTION:FINAL_SUMMARY:END -->
