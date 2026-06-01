---
id: TASK-368
title: 'Per-key codec source attribution: split lossy vs lossless provenance'
status: Done
assignee: []
created_date: '2026-06-01 17:47'
updated_date: '2026-06-01 20:54'
labels:
  - bug
  - cli
  - decisions
dependencies:
  - TASK-367
references:
  - 'packages/podkit-cli/src/commands/sync.ts:1017'
  - 'packages/podkit-cli/src/commands/sync.ts:1085'
  - 'packages/podkit-cli/src/commands/sync-decisions.ts:92'
modified_files:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/sync-decisions.ts
  - packages/podkit-cli/src/commands/sync-decisions.test.ts
  - packages/podkit-cli/src/commands/sync-presenter.ts
  - test-packages/e2e-tests/src/matrix/config-rules.ts
priority: low
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up surfaced during TASK-367 sonnet review.

The current `codecPreferenceSource` enum (`'device' | 'global' | 'default'`) is single-valued — it describes one provenance for all four codec keys (`lossyCodec`, `losslessCodec`, `lossyPreference`, `losslessPreference`). When a user *splits* the codec stacks across levels, the JSON output mis-attributes the level for one stack.

## Repro
```toml
[codec]
lossy = ["aac"]

[devices.terapod.codec]
lossless = ["flac"]
```
Effective `lossyStack` is `['aac']` (from global; `effectiveCodecPreference = deviceConfig?.codec ?? config.codec` is object-level coalesce in `sync.ts:1017`, but `deviceConfig.codec.lossy` is undefined so the resolver falls back to global). Effective `losslessStack` is `['flac']` (from device).

`codecPreferenceSource` fires `'device'` because `deviceConfig?.codec?.lossless !== undefined`. JSON output therefore reports:
- `decisions.lossyCodec.source = 'device'` (wrong — came from global)
- `decisions.losslessCodec.source = 'device'` (correct)

## Fix sketch
1. Resolve `effectiveCodecPreference` per-key instead of at the object level: lossy and lossless each fall back independently from device → global → defaults.
2. Compute two source enums (`lossySource`, `losslessSource`) and thread both into `buildSyncDecisions`. The four codec keys then carry the source of *their* stack, not the union.

## Acceptance
- Mixed-key TOML repro reports the correct per-stack `source` in `--json` output.
- New cell axis or dedicated unit test in `sync-decisions.test.ts` covering the split case.
- `predictCodecScalar` / `predictCodecPreference` in `matrix/config-rules.ts` may need a new "split" cell variant.

## Why deferred
Not blocking TASK-367's core fix (device-level all-keys → `'device'`). The split case is rare; users typically pin both stacks at the same level. Fix requires touching the resolver (`packages/podkit-core/src/...` codec resolution) on top of sync-decisions plumbing, which expands scope.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced object-level `effectiveCodecPreference` coalesce with per-key resolution (device → global → default, each stack independent). Replaced the single `codecPreferenceSource` enum with two per-key enums (`lossyCodecSource`, `losslessCodecSource`); each codec key in the decisions block now carries its own stack's source.

## Behavioral change

Before: `[devices.x.codec] lossless = ["flac"]` silently shadowed a top-level `[codec] lossy = ["aac"]` — the device's codec object replaced the global object wholesale, and the user's global lossy preference was lost. After: the lossy stack independently inherits from global; the user's `[codec] lossy = ["aac"]` is preserved.

Source attribution mirrors the resolution chain — the four codec keys are stamped with their respective stack's source. The split-stack repro from TASK-368 now reports the correct per-stack provenance.

## Files

- `packages/podkit-cli/src/commands/sync.ts` — per-key fallback for `lossyStack`/`losslessStack`. `effectiveCodecPreference` becomes a synthetic `{ lossy, lossless }` always-defined object built from the resolved stacks. Two source enums computed independently.
- `packages/podkit-cli/src/commands/sync-decisions.ts` — replaced `codecPreferenceSource` with `lossyCodecSource` + `losslessCodecSource`. Builder remains a pure pass-through.
- `packages/podkit-cli/src/commands/sync-presenter.ts` — `effectiveCodecPreference` tightened to non-optional `{ lossy: string[]; lossless: string[] }` (sonnet found this drifted from reality after the always-defined change).
- `packages/podkit-cli/src/commands/sync-decisions.test.ts` — field-renames; new "split stacks" test asserting lossy='global' + lossless='device' attribute independently.
- `test-packages/e2e-tests/src/matrix/config-rules.ts` — JSDoc updates referencing the new field names; existing single-stack cells continue to assert green.

## Verification

- 1367 podkit unit tests pass (1 new).
- Config-inheritance matrix e2e: 25 pass / 17 skipImpossible / 0 fail.
- cli-overrides e2e: 10 pass.
- CLI binary rebuilt before e2e.

## Follow-up

Sonnet flagged a matrix coverage gap: cells assert only their own setting's source, so a regression reinstating the single-source behavior wouldn't be caught by the matrix (only by the new unit test). Filed as **TASK-369** (low) for a future matrix pass.
<!-- SECTION:FINAL_SUMMARY:END -->
