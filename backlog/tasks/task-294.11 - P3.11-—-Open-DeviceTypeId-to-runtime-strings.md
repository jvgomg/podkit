---
id: TASK-294.11
title: P3.11 — Open DeviceTypeId to runtime strings
status: To Do
assignee: []
created_date: '2026-05-03 11:33'
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
ordinal: 10110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the baked-in `DeviceTypeId = 'ipod' | 'echo-mini' | 'rockbox' | 'generic'` literal union with the literal-plus-runtime-string pattern. Built-ins still autocomplete in TypeScript callers; runtime config strings work without coercion.

CLI `--type` flag accepts arbitrary preset id at runtime, validating against the merged (built-in + user) preset map.

See spec doc-034, Scope > Core changes > CLI DeviceTypeId opening.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 BUILT_IN_DEVICE_TYPE_IDS const array exported alongside literal type
- [ ] #2 DeviceTypeId = BuiltInDeviceTypeId | (string & {}) accepts runtime strings
- [ ] #3 TypeScript callers using string literals get autocomplete and type errors for typos
- [ ] #4 CLI --type flag accepts user-defined preset ids
- [ ] #5 Validation happens at runtime against the active preset map
<!-- AC:END -->
