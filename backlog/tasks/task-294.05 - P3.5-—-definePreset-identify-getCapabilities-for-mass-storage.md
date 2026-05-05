---
id: TASK-294.05
title: P3.5 — definePreset + identify + getCapabilities for mass-storage
status: Done
assignee: []
created_date: '2026-05-03 11:32'
updated_date: '2026-05-05 18:23'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
parent_task_id: TASK-294
ordinal: 10050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the user-extensible mass-storage framework in `@podkit/devices-mass-storage`:

- `definePreset(input) → MassStoragePreset` — pure constructor with validation; resolves `extends` at construction time.
- `identify(usb, presets) → MassStorageIdentity | null` — USB VID/PID hint matching against the preset map.
- `getCapabilities(identity, { presets, overrides? }) → DeviceCapabilities` — preset lookup + override merging.

No global state. Caller composes the preset map.

See spec doc-034, Scope > New package: @podkit/devices-mass-storage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 definePreset is a pure constructor with validation (capabilities shape, extends resolution)
- [x] #2 definePreset rejects invalid input with clear error messages
- [x] #3 extends-from-another-preset chain resolves at construction time
- [x] #4 identify(usb, presets) matches by VID/PID hint; returns null for unknown
- [x] #5 getCapabilities resolves preset; merges overrides on top
- [x] #6 Two Echo Minis with different override maps yield different capabilities (no state collision)
- [x] #7 Unit tests cover construction, identify, getCapabilities, override merging, extends chains
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented definePreset, identify, getCapabilities, and USB_PRESET_HINTS in @podkit/devices-mass-storage.

Files added:
- packages/devices-mass-storage/src/preset.ts — definePreset with extends resolution, cycle detection, validation, merge semantics (arrays replace)
- packages/devices-mass-storage/src/usb-hints.ts — USB_PRESET_HINTS table (Echo Mini 0x071b/0x3203)
- packages/devices-mass-storage/src/identity.ts — identify() with case-insensitive VID/PID normalisation and optional preset scope filtering
- packages/devices-mass-storage/src/capabilities.ts — getCapabilities() resolving preset + overrides, built-in fallback
- packages/devices-mass-storage/src/preset.test.ts — 62 tests covering all three functions
- packages/devices-mass-storage/src/identity.test.ts
- packages/devices-mass-storage/src/capabilities.test.ts

Changes to @podkit/device-types:
- Added UsbConnectionInfo type to identity.ts and exported from index.ts (to avoid circular deps from devices-mass-storage → podkit-core)
- Added presetId?: string to MassStorageIdentity (tagging matched preset from identify())

Key decisions:
- UsbConnectionInfo lives in @podkit/device-types (not podkit-core) for devices-mass-storage to consume without a circular dep. Core's usb-discovery.ts has a superset with busNumber/deviceAddress.
- USB hint table uses normaliseId() helper so '0x071B', '071b', '0x071b' all compare equal.
- identify() presets arg filters which hint-table entries are in scope; absent = no filter.
- definePreset uses 'generic' as implicit base when no extends given.
- Built-in ids always win over opts.available when resolving extends (prevents shadowing built-ins).
- getCapabilities falls back to BUILT_IN_PRESETS when opts.presets doesn't contain the preset id.

Quality gates: 62 tests pass, typecheck clean, lint 0 errors (14 pre-existing warnings), build succeeds, podkit-core unit tests 2509 pass 0 fail.
<!-- SECTION:FINAL_SUMMARY:END -->
