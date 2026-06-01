---
id: TASK-368
title: 'Per-key codec source attribution: split lossy vs lossless provenance'
status: To Do
assignee: []
created_date: '2026-06-01 17:47'
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
