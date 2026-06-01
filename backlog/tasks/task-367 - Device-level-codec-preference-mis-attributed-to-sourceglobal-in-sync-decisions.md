---
id: TASK-367
title: >-
  Device-level codec preference mis-attributed to source=global in sync
  decisions
status: Done
assignee: []
created_date: '2026-05-31 22:48'
updated_date: '2026-06-01 18:05'
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
modified_files:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/sync-decisions.ts
  - packages/podkit-cli/src/commands/sync-decisions.test.ts
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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the boolean `codecPreferenceFromConfig` with an enum `codecPreferenceSource: 'device' | 'global' | 'default'` in `buildSyncDecisions`. The caller in `sync.ts` computes the enum from config presence with device > global > default precedence; the builder forwards it unchanged onto all four codec keys.

## Files

- `packages/podkit-cli/src/commands/sync-decisions.ts` — param shape and JSDoc updated. Type narrowed to the three values the caller actually emits so a future caller can't pass `'device-quality'` or other unsupported sources silently. JSDoc documents the single-valued limitation (see follow-up below).
- `packages/podkit-cli/src/commands/sync.ts:1085-1095` — caller now emits the enum.
- `test-packages/e2e-tests/src/matrix/config-rules.ts` — removed the `skipBug` fence for the 4 codec/device cells. Added `device` branches to `predictCodecScalar` / `predictCodecPreference`. Extended `cellToml` to emit `[devices.<n>.codec]` blocks.
- `packages/podkit-cli/src/commands/sync-decisions.test.ts` — existing tests updated for the new field name; added a regression test asserting all four codec keys carry `source: 'device'` when `codecPreferenceSource: 'device'`.

## Verification

- 1366 podkit unit tests pass, 0 fail.
- 2840 @podkit/core unit tests pass, 0 fail.
- Config-inheritance matrix e2e: 25 pass / 17 skipImpossible / 0 fail. The 4 codec/device cells now assert green.
- cli-overrides e2e: 10 pass.
- CLI binary rebuilt before e2e (`bun run build --filter podkit --force`).

## Follow-up

Sonnet review surfaced a real but rare gap: if a user splits the codec stacks (`[codec] lossy = [...]` + `[devices.x.codec] lossless = [...]`), the single-valued enum stamps both stacks with the most-specific level that appeared in either key, mis-attributing the cross-level stack. Filed as **TASK-368** (low priority); requires per-key resolution in `effectiveCodecPreference` plus two source enums into the builder. JSDoc on `codecPreferenceSource` documents the constraint.
<!-- SECTION:FINAL_SUMMARY:END -->
