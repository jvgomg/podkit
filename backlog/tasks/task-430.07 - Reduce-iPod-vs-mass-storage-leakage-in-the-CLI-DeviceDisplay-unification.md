---
id: TASK-430.07
title: Reduce iPod-vs-mass-storage leakage in the CLI (DeviceDisplay unification)
status: Done
assignee: []
created_date: '2026-06-21 09:28'
updated_date: '2026-06-21 11:14'
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
- [x] #1 A core `displayForConfig(deviceConfig, presets) -> DeviceDisplay` exists; `getDeviceTypeDisplayName`/`getDeviceTypeRichDisplayName`/`getDeviceLabel` collapse into it
- [x] #2 Label call sites consume `DeviceDisplay.{short,rich}` and no longer branch on `isMassStorageDevice`
- [x] #3 Behavioural kind dispatch (info readiness gate, eject, etc.) reads `isIpodDevice` from the `openDevice` result, not `config.type`
- [x] #4 `isMassStorageDevice` is no longer exported as a label switch — used only inside `openDevice`
- [x] #5 lint + typecheck + tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by opus worker + sonnet review + team-lead fix. Added core `displayForConfig(device, presets) -> DeviceDisplay` next to `displayFor` (exported via index). `getDeviceTypeDisplayName`/`getDeviceTypeRichDisplayName` collapsed to thin wrappers; `getDeviceLabel` deleted (it was the only isMassStorageDevice label switch). Label call sites (eject/mount labels, music/video headings, list rows, info anchor, add confirmation block) now consume display.short/.rich with no kind branch. Behavioural dispatch in info.ts (IpodError tolerance + readiness gate) now sources `isIpodDevice` from the openDevice result, falling back to the old config-type expression only when the open returned no result (behaviour-preserving). isMassStorageDevice survives only as genuine behavioural gates (openDevice DB-vs-adapter selector, list path-probe, set.ts option-validation, add.ts --path requirement, music/video path-not-found generic vocabulary) — zero label uses remain.

Architectural note: open-device.ts keeps a native-free CLI mirror of displayForConfig (it can't statically value-import @podkit/core without eager-loading libgpod). Review S1: the two copies were only independently asserted against literals — added a real cross-parity test block (imports BOTH core + CLI displayForConfig, 13-input sweep, expect toEqual) so they cannot drift; corrected the overclaiming comment. Output byte-identical (confirmed by reviewer field-by-field + parity test). Gates: lint 0/0, build 11/11, core 3188 pass, CLI pass.
<!-- SECTION:NOTES:END -->
