---
id: TASK-294.04
title: P3.4 — Bootstrap @podkit/devices-mass-storage; refactor presets content
status: Done
assignee: []
created_date: '2026-05-03 11:32'
updated_date: '2026-05-05 18:08'
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
ordinal: 10040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the `@podkit/devices-mass-storage` package skeleton. Move `podkit-core/device/presets.ts` content (and capability-relevant parts of mass-storage-utils.ts) into the new package per spec doc-034 file structure:

- presets/built-in.ts (BUILT_IN_PRESETS map)
- presets/types.ts (MassStoragePreset interface)
- preset.ts (definePreset constructor — added in P3.5)

Types move with the data: MassStoragePreset, MassStorageIdentity, BuiltInPresetId / PresetId.

See spec doc-034, Scope > New package: @podkit/devices-mass-storage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/devices-mass-storage/ exists with package.json, build script, test runner
- [x] #2 BUILT_IN_PRESETS exported with echo-mini, rockbox, generic
- [x] #3 MassStoragePreset, MassStorageIdentity types moved with the data
- [x] #4 PresetId is a literal-plus-runtime union
- [x] #5 Existing presets tests run against the new module and pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
File split:
- presets/types.ts: MassStoragePreset (extends DeviceCapabilities + contentPaths), ContentPaths interface, BUILT_IN_PRESET_IDS const array, BuiltInPresetId literal type, PresetId = BuiltInPresetId | (string & {})
- presets/built-in.ts: BUILT_IN_PRESETS Record<BuiltInPresetId, MassStoragePreset> — verbatim move of echo-mini/rockbox/generic from core's presets.ts; DEFAULT_CONTENT_PATHS inlined locally
- src/index.ts: re-exports all public types + BUILT_IN_PRESETS + BUILT_IN_PRESET_IDS
- src/presets/built-in.test.ts: 18 tests covering static preset data + sentinel import test

Deferred to TASK-294.05/06/07:
- definePreset() constructor with validation + extends resolution
- identify(usb, presets): MassStorageIdentity | null — USB VID/PID hint table
- getCapabilities(identity, opts): DeviceCapabilities — preset resolution + overrides
- createMassStorageProvider(presets): DeviceProvider<MassStorageIdentity>
- ContentPaths / DEFAULT_CONTENT_PATHS move from mass-storage-utils.ts (inlined for now)
- Echo Mini USB VID/PID hint table (0x071b / 0x3203)

podkit-core/device/presets.ts untouched — shim happens in TASK-294.12.
All quality gates pass: typecheck clean, 18 tests pass, 2509 core unit tests 0 fail, build succeeds, lint 0 errors.
<!-- SECTION:NOTES:END -->
