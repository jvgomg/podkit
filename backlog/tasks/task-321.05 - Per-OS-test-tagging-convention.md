---
id: TASK-321.05
title: Per-OS test tagging convention
status: Done
assignee: []
created_date: '2026-05-11 22:56'
updated_date: '2026-05-13 17:21'
labels:
  - testing
  - vm-coverage
  - foundation
milestone: m-19
dependencies:
  - TASK-290
modified_files:
  - agents/testing.md
  - packages/device-testing/src/__tests__/canary.darwin.test.ts
  - packages/device-testing/src/__tests__/canary.linux.test.ts
parent_task_id: TASK-321
priority: medium
ordinal: 250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Establish a filename-based convention for Tier 2 native integration tests that should only run on a specific host OS:

- `*.darwin.test.ts` — runs only on `process.platform === 'darwin'`
- `*.linux.test.ts` — runs only on `process.platform === 'linux'`
- `*.test.ts` — runs on any host (default)

Bun's test runner needs a small wrapper (or `describe.skipIf` pattern documented as the standard) that detects the tagged filename and skips the entire file when the host doesn't match. Skipped files should log a single line so it's obvious in CI logs that they were intentionally skipped.

Update `agents/testing.md` with the convention and an example.

No tests get migrated in this task — migration happens organically as new Tier 2 tests are written under TASK-301–311.

No package path changes from the original design — this task concerns test file naming convention only, not package location. The convention applies to tests across all packages including `@podkit/device-testing`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Filename convention documented in agents/testing.md with rationale and examples
- [x] #2 Bun test runner skips mismatched-OS test files cleanly (or describe.skipIf pattern is documented as the standard)
- [x] #3 Single-line skip log shows in CI / local output when a file is skipped (e.g. 'Skipping foo.darwin.test.ts on linux')
- [x] #4 A canary test in each of two OS-tagged files (.darwin.test.ts and .linux.test.ts) confirms the convention works on at least one host
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Used the zero-shared-helper approach: each tagged file stands alone with `describe.skipIf(process.platform !== '<os>')` at the top level. The `console.log` at module load (outside `describe`) ensures the skip log appears unconditionally in CI output. No changes to `bunfig.toml` were needed — bun discovers `src/__tests__/*.test.ts` files automatically since the pattern falls under `src/**/*`. The `pathIgnorePatterns` in `bunfig.toml` only excludes `*.integration.test.ts`, so OS-tagged unit tests are picked up by `test:unit` as intended.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Established the per-OS test tagging convention with documentation and canary tests.

- Added `### Per-OS Test Tagging` section to `agents/testing.md` covering the three filename patterns, the standard `describe.skipIf` pattern with example code, and rationale.
- Created `packages/device-testing/src/__tests__/canary.darwin.test.ts` and `canary.linux.test.ts` as canary files proving the convention works.
- On macOS: darwin canary runs (`pass`), linux canary skips with `Skipping canary.linux.test.ts on darwin` log line visible in output.
- All quality gates pass: typecheck clean, oxlint 0 warnings/errors, tests behave correctly.
<!-- SECTION:FINAL_SUMMARY:END -->
