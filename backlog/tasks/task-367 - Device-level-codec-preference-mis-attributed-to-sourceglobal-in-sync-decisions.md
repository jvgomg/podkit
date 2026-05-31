---
id: TASK-367
title: >-
  Device-level codec preference mis-attributed to source=global in sync
  decisions
status: To Do
assignee: []
created_date: '2026-05-31 22:48'
labels:
  - bug
  - cli
  - decisions
dependencies:
  - TASK-356.08
references:
  - 'packages/podkit-cli/src/commands/sync.ts:1089'
  - 'packages/podkit-cli/src/commands/sync-decisions.ts:102'
  - test-packages/e2e-tests/src/matrix/config-rules.ts
priority: medium
ordinal: 93000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from TASK-356.08. `packages/podkit-cli/src/commands/sync.ts:1089-1093` sets `codecPreferenceFromConfig` to true if either global `[codec]` or device `[devices.<n>.codec]` is configured, but `buildSyncDecisions` then unconditionally emits `source: 'global'` (see `packages/podkit-cli/src/commands/sync-decisions.ts:102`). A user who pins `[devices.terapod.codec] lossy = ["aac"]` sees `decisions.lossyCodec.source === 'global'` in the JSON output even though no global `[codec]` block exists.

Affects all four codec keys in the decisions block: `lossyCodec`, `losslessCodec`, `lossyPreference`, `losslessPreference`.

## Fix sketch
Pass the source as an enum, not a boolean, into `buildSyncDecisions`:
```ts
codecPreferenceSource: deviceConfig?.codec?.lossy !== undefined || deviceConfig?.codec?.lossless !== undefined
  ? 'device'
  : (config.codec?.lossy !== undefined || config.codec?.lossless !== undefined ? 'global' : 'default')
```
`buildSyncDecisions` then forwards that source unchanged.

## Acceptance
- 4 cells in the config-inheritance matrix (`lossyCodec/device`, `losslessCodec/device`, `lossyPreference/device`, `losslessPreference/device`) currently fenced with `skipBug(... 'TASK-367')` flip green.
- Remove the `skipBug` clauses in `matrix/config-rules.ts:skipConfigCell` so the cells assert.
- Unit test in `sync-decisions.test.ts` covering the device-source case.
<!-- SECTION:DESCRIPTION:END -->
