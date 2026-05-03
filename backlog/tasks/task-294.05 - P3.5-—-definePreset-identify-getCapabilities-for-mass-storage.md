---
id: TASK-294.05
title: P3.5 — definePreset + identify + getCapabilities for mass-storage
status: To Do
assignee: []
created_date: '2026-05-03 11:32'
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
- [ ] #1 definePreset is a pure constructor with validation (capabilities shape, extends resolution)
- [ ] #2 definePreset rejects invalid input with clear error messages
- [ ] #3 extends-from-another-preset chain resolves at construction time
- [ ] #4 identify(usb, presets) matches by VID/PID hint; returns null for unknown
- [ ] #5 getCapabilities resolves preset; merges overrides on top
- [ ] #6 Two Echo Minis with different override maps yield different capabilities (no state collision)
- [ ] #7 Unit tests cover construction, identify, getCapabilities, override merging, extends chains
<!-- AC:END -->
