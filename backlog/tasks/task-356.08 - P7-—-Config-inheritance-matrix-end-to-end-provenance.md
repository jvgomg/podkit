---
id: TASK-356.08
title: P7 — Config-inheritance matrix (end-to-end provenance)
status: Done
assignee: []
created_date: '2026-05-31 22:09'
updated_date: '2026-05-31 22:51'
labels:
  - testing
  - e2e
  - matrix
  - decisions
  - config
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - backlog/docs/doc-040 - PRD-—-Expose-sync-decisions-in-json-TASK-357.md
  - packages/podkit-cli/src/config/resolve.ts
  - packages/podkit-cli/src/commands/sync-decisions.ts
parent_task_id: TASK-356
priority: low
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-356.07. The existing matrices assert decision provenance for the *single inheritance path* each test happens to exercise (codec matrix always uses `[codec]` at global level → expects `'global'`; artwork matrix never sets `checkArtwork` in config → expects `'default'` or `'cli'`). They don't sweep the inheritance chain.

A bug like "device-level codec config is silently ignored when global is also set" or "device-quality inheritance was supposed to win over global-quality but doesn't" would pass every existing matrix cell — none drive the resolver through more than one path per setting.

## Scope

A new matrix file (`matrix/config-rules.ts` + `features/config.test.ts`) that crosses:

- **Setting**: `transferMode`, `quality` (or `audioQuality`), `checkArtwork`, `lossyCodec` (one or two).
- **Source level** (each setting's resolved provenance): `none` (default), `global`, `global-quality` (where applicable), `device`, `device-quality`, `cli`.
- **Expected**: `{ value, source }` pair, exact.

Each cell writes a minimal TOML config that pins the setting at one and only one level, optionally passes a CLI flag, runs `podkit sync --dry-run --json`, and asserts the corresponding `json.decisions.<setting>` field matches expected `{ value, source }`.

## What this catches

- Resolver order regressions (the chain that `resolve.ts:28` documents).
- The TASK-357 sonnet-caught class of bug: `codecPreferenceFromConfig` mis-attributing presence vs length.
- CLI overlay layer dropping provenance silently.
- New config dimensions added without source attribution wiring.

## What this doesn't replace

- Unit tests in `resolve.test.ts` cover the resolver in isolation; this matrix proves the *full chain* end-to-end.
- Unit tests in `sync-decisions.test.ts` cover `buildSyncDecisions` in isolation; this matrix proves the wiring.

## Acceptance Criteria
- New matrix file `matrix/config-rules.ts` with `ConfigCell`, `ConfigExpected`, `predictConfig`, `observeConfigMatrix`.
- New `features/config.test.ts` thin wrapper.
- At least: 6 source levels × 3 settings = 18 cells, all asserting both value and source exactly.
- A regression in the resolver-chain ordering flips ≥1 cell (verify by mutating `resolveDeviceSettings` temporarily — at least one new cell must turn red).
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `matrix/config-rules.ts` and `features/config.test.ts`. Walks (setting × source-level) for the 7 SyncDecisions keys × 6 levels = 42 combinations: 21 asserting, 4 bug-fenced (codec/device → filed as TASK-367), 17 impossible-pruned.

Asserted cells cover every reachable provenance source on `transferMode` / `quality` / `checkArtwork` (`default`/`global`/`device`/`cli` for scalars; `global-quality`/`device-quality` additionally for `quality`) and `default`/`global` on the four codec keys.

Regression sensitivity verified: swapping the order in `resolveSimple` so device source mis-attributes as `'global'` flips `transferMode/device` red (mutation tested with a forced rebuild of `packages/podkit-cli/dist/main.js`).

Surfaced TASK-367 — device-level `[codec]` and `[devices.<n>.codec]` both flip `codecPreferenceFromConfig=true`, but `buildSyncDecisions` always emits `source: 'global'`. The 4 device-level codec cells are visibly fenced with `skipBug('TASK-367')` rather than silently passing.

Files: `test-packages/e2e-tests/src/matrix/config-rules.ts`, `test-packages/e2e-tests/src/features/config.test.ts`.
<!-- SECTION:FINAL_SUMMARY:END -->
