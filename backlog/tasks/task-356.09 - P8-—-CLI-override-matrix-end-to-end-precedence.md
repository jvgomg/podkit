---
id: TASK-356.09
title: P8 — CLI override matrix (end-to-end precedence)
status: Done
assignee: []
created_date: '2026-05-31 22:10'
updated_date: '2026-05-31 23:12'
labels:
  - testing
  - e2e
  - matrix
  - decisions
  - cli
dependencies: []
references:
  - backlog/docs/doc-040 - PRD-—-Expose-sync-decisions-in-json-TASK-357.md
  - packages/podkit-cli/src/commands/sync-decisions.ts
  - packages/podkit-cli/src/commands/sync-decisions.test.ts
  - packages/podkit-cli/src/commands/sync.ts
parent_task_id: TASK-356
priority: low
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-356.07. The pure-function precedence rules are unit-tested in `sync-decisions.test.ts` (15 tests covering `buildSyncDecisions`, including the explicit-false trap at lines 63-87). But the wiring from CLI parser → `deriveSettings()` → `buildSyncDecisions()` → JSON is not asserted end-to-end. A regression where the CLI parser silently drops a flag (e.g. commander option renamed, default value changed) would pass every unit test but break the actual `--flag` behaviour.

## Scope

A new matrix file (`matrix/cli-rules.ts` + `features/cli-overrides.test.ts`) sweeping CLI flag interactions:

- `--audio-quality` vs `--quality` precedence (audioQuality wins; prove via JSON shape).
- `--transfer-mode <m>` overrides per-device-config (source: 'cli', not 'device').
- `--transfer-mode <m>` overrides global config.
- `--check-artwork` overrides global-config (source: 'cli', not 'global').
- `--check-artwork` overrides per-device config.

The explicit-false case (`--no-check-artwork`) is NOT exercised: commander does not auto-generate a `--no-` opposite for `--check-artwork`, and the `!== undefined` trap is already locked in by `sync-decisions.test.ts:63-87` ("checkArtwork explicit false from CLI is distinguishable from absent") at the pure-function level. Adding a CLI flag purely to satisfy this matrix would be gold-plating.

## What this catches

- Commander option renames that silently break the flag.
- CLI-flag wiring regressions (option present in commander but not threaded through to `buildSyncDecisions` overrides).
- Default-value collisions (e.g. a future migration introducing `default: false` that masks "flag absent").
- `--quality` vs `--audio-quality` precedence regressions in the full pipeline.

## What this doesn't replace

- `sync-decisions.test.ts` unit tests cover the pure function correctness (including explicit-false detection).
- This matrix proves the *full wiring* end-to-end via a real `podkit sync --dry-run --json` invocation.

## Acceptance Criteria
- New matrix file `matrix/cli-rules.ts` with `CliCell`, `CliExpected`, `predictCli`, `observeCliMatrix`.
- New `features/cli-overrides.test.ts` thin wrapper.
- At least 8 cells covering: baseline (no flags), `--quality`/`--audio-quality`/both, `--transfer-mode` over global + device, `--check-artwork` over global + device.
- Cells assert both `value` and `source` exactly.
- A regression in the CLI overlay layer (e.g. swapped `--quality`/`--audio-quality` precedence in `buildSyncDecisions`) flips ≥1 cell.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `matrix/cli-rules.ts` and `features/cli-overrides.test.ts`. 10 cells in 8 CLI combos:

- baseline (no flags) × 3 focal settings → asserts defaults / resolver fall-through.
- `--audio-quality low` → quality `{low, cli}` via `overrides.audioQuality` branch.
- `--quality low` → quality `{low, cli}` via `overrides.quality` branch.
- `--quality max --audio-quality low` → quality `{low, cli}` (audioQuality wins).
- `--transfer-mode optimized` over global `portable` → `{optimized, cli}`.
- `--transfer-mode optimized` over device `portable` → `{optimized, cli}`.
- `--check-artwork` over global `false` → `{true, cli}`.
- `--check-artwork` over device `false` → `{true, cli}`.

Surfaced a resolver quirk worth knowing: with no audioQuality set anywhere, `resolveDeviceAudio` falls through to `resolveDeviceQuality` which returns `source: 'global-quality'`, not `'global'`. The baseline-quality cell pins this.

Regression sensitivity verified: swapping the `audioQuality` / `quality` precedence in `buildSyncDecisions` flips `audio-quality-wins-quality` red (value: expected `low`, observed `max`).

Sonnet review found no correctness bugs; addressed two naming/comment polish items pre-commit. Skipped two optional cell additions (orthogonality + `--audio-quality over global`) as low-risk gaps appropriate for follow-up.

Files: `test-packages/e2e-tests/src/matrix/cli-rules.ts`, `test-packages/e2e-tests/src/features/cli-overrides.test.ts`.
<!-- SECTION:FINAL_SUMMARY:END -->
