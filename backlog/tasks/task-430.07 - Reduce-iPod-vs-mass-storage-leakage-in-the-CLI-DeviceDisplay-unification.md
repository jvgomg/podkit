---
id: TASK-430.07
title: Reduce iPod-vs-mass-storage leakage in the CLI (DeviceDisplay unification)
status: To Do
assignee: []
created_date: '2026-06-21 09:28'
labels:
  - cli
  - refactor
milestone: m-18
dependencies:
  - TASK-430.02
references:
  - doc-045 - PRD-Device-discovery-seam-device-add-verification-tiers.md
parent_task_id: TASK-430
ordinal: 152000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Push the iPod-vs-mass-storage distinction down into core so the CLI operates on a device abstraction (doc-045). Can run in parallel with TASK-430.04/.05/.06.

- Behavioural kind dispatch sourced from the `openDevice` result (`isIpodDevice` / `adapter`), not re-derived from `config.type`. The `info` readiness gate keys off the opened result.
- Label/display selection unified onto a single `DeviceDisplay` (`{ short, rich }`): add a core `displayForConfig(deviceConfig, presets)` mirroring the existing live `displayFor`, and collapse `getDeviceTypeDisplayName` / `getDeviceTypeRichDisplayName` / `getDeviceLabel` into it so label call sites stop branching on kind.
- `isMassStorageDevice` survives only as an internal guard inside `openDevice` (the one place kind dispatch is genuinely real — DB vs adapter backend).

Net: ~11 label call sites lose their `isMassStorageDevice` branch; ~4 behavioural sites keep a kind check but source it from the opened-device result.

Parent: TASK-430. Design: doc-045.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A core `displayForConfig(deviceConfig, presets) -> DeviceDisplay` exists; `getDeviceTypeDisplayName`/`getDeviceTypeRichDisplayName`/`getDeviceLabel` collapse into it
- [ ] #2 Label call sites consume `DeviceDisplay.{short,rich}` and no longer branch on `isMassStorageDevice`
- [ ] #3 Behavioural kind dispatch (info readiness gate, eject, etc.) reads `isIpodDevice` from the `openDevice` result, not `config.type`
- [ ] #4 `isMassStorageDevice` is no longer exported as a label switch — used only inside `openDevice`
- [ ] #5 lint + typecheck + tests pass
<!-- AC:END -->
