---
id: TASK-356.09
title: P8 — CLI override matrix (end-to-end precedence)
status: To Do
assignee: []
created_date: '2026-05-31 22:10'
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
Follow-up to TASK-356.07. The pure-function precedence rules are unit-tested in `sync-decisions.test.ts` (15 tests covering `buildSyncDecisions`). But the wiring from CLI parser → `deriveSettings()` → `buildSyncDecisions()` → JSON is not asserted end-to-end. A regression where the CLI parser silently drops a flag (e.g. commander option renamed, default value changed) would pass every unit test but break the actual `--flag` behaviour.

## Scope

A new matrix file (`matrix/cli-rules.ts` + `features/cli-overrides.test.ts`) sweeping CLI flag interactions:

- `--audioQuality` vs `--quality` precedence (audioQuality wins; covered in unit test, prove via JSON shape).
- `--no-check-artwork` explicit-false vs flag absent (must show `source: 'cli'` with `value: false` vs `source: 'default'` with `value: false` — sonnet caught this trap in TASK-357 review).
- `--transfer-mode <m>` overrides per-device-config (source: 'cli', not 'device').
- `--check-artwork` overrides global-config (source: 'cli', not 'global').

## What this catches

- Commander option renames that silently break the flag.
- CLI-flag wiring regressions (option present in commander but not threaded through to `deriveSettings`).
- Explicit-false detection regressions (the `!== undefined` trap).
- Default-value collisions (e.g. a future migration introducing `default: false` that masks "flag absent").

## What this doesn't replace

- `sync-decisions.test.ts` unit tests cover the pure function correctness.
- This matrix proves the *full wiring* end-to-end via a real `podkit sync --dry-run --json` invocation.

## Acceptance Criteria
- New matrix file `matrix/cli-rules.ts` with `CliCell`, `CliExpected`, `predictCli`, `observeCliMatrix`.
- New `features/cli-overrides.test.ts` thin wrapper.
- At least: 4 flag combos × 2 directions (present/absent) = 8 cells minimum.
- The explicit-false case (`--no-check-artwork`) is asserted distinctly from the absent case.
- Cells assert both `value` and `source` exactly.
<!-- SECTION:DESCRIPTION:END -->
