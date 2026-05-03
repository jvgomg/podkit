---
id: TASK-294.04
title: P3.4 — Bootstrap @podkit/devices-mass-storage; refactor presets content
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
- [ ] #1 packages/devices-mass-storage/ exists with package.json, build script, test runner
- [ ] #2 BUILT_IN_PRESETS exported with echo-mini, rockbox, generic
- [ ] #3 MassStoragePreset, MassStorageIdentity types moved with the data
- [ ] #4 PresetId is a literal-plus-runtime union
- [ ] #5 Existing presets tests run against the new module and pass
<!-- AC:END -->
