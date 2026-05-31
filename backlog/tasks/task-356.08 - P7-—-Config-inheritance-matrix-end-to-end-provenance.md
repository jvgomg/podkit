---
id: TASK-356.08
title: P7 — Config-inheritance matrix (end-to-end provenance)
status: To Do
assignee: []
created_date: '2026-05-31 22:09'
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
