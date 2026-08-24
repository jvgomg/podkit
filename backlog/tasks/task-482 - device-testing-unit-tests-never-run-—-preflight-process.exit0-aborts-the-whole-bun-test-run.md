---
id: TASK-482
title: >-
  device-testing unit tests never run — preflight process.exit(0) aborts the
  whole bun test run
status: Done
assignee: []
created_date: '2026-08-23 19:52'
updated_date: '2026-08-24 00:45'
labels:
  - testing
  - tech-debt
  - bug
dependencies: []
references:
  - test-packages/device-testing/bunfig.toml
  - test-packages/device-testing/src/preflight.ts
priority: high
ordinal: 261000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Symptom:** `bunx turbo run @podkit/device-testing#test:unit` reports success while executing **zero tests**. `bun test` inside `test-packages/device-testing/` prints only the version banner and exits 0.

**Cause:** the package's `bunfig.toml` preloads `@podkit/device-testing/preflight`. `preflight.ts` calls `process.exit(0)` when no VM tests are targeted — under Bun that terminates the entire `bun test` process during preload, before any test file executes. The task is therefore vacuously green rather than skipping selectively.

**Impact:** every unit test in the package has been silently non-executing under `test:unit` — `src/runtime.test.ts`, the persona tests, the `src/runners/lima-test-vm-*.test.ts` scripted-runner suites, and `src/baseline-hash.test.ts`. These tests pass when invoked from the repo root (which bypasses the package-local bunfig), so the assertions themselves are believed sound; the harness around them is what's broken. This is a testing-integrity hole, not a product bug: regressions in the device-testing runners would not have been caught by CI or by `bun run quality`.

**Discovered during** the @podkit/lima P2 consolidation, when a newly added test in the package appeared to pass without running.

**Fix direction (not yet decided):** the preload needs to skip VM-gated files without killing the process — e.g. have preflight set a guard that individual VM test files check and `describe.skip` on, rather than exiting; or scope the bunfig preload so it applies only to the VM test surface. Whatever the mechanism, `test:unit` must report a real, non-zero test count.

**Guard against recurrence:** consider asserting a minimum executed-test count for the package so a future preload change cannot silently re-empty the suite.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Fix

Inverted the guard in `src/preflight.ts`: the Lima-checking body now lives inside `if (vmTestsTargeted()) { ... }` and the module simply falls off the end otherwise, instead of calling `process.exit(0)`. `vmTestsTargeted()` and the VM-targeted branch are byte-identical, just re-indented — so `test:vm` / `test:e2e:docker-dist` gating and the deliberate hard-fail-with-remediation when the VM is down are provably untouched.

## A second, larger hole in the same family

`@podkit/e2e-vm-tests` had **no `test:unit` script at all**. Its pure unit tests (`src/expectations/*.test.ts`) therefore only ever ran bundled inside `test:vm` — meaning assertions with no VM dependency whatsoever required a running Lima VM to execute, and never ran in any unit sweep. Added the script; its existing `bunfig.toml` `pathIgnorePatterns` already scoped a bare `bun test` correctly.

Audited all five `bunfig.toml` preloads in the repo (`podkit-cli`, `ipod-web`, `device-testing`, `e2e-vm-tests`, `e2e-tests`); only this one called `process.exit()`.

## Recurrence guard

New `test-packages/device-testing/scripts/assert-min-tests.ts`, exposed as a package bin (`assert-min-tests`, mirroring `gpod-tests-parallel` from `@podkit/gpod-testing`) and wrapping `test:unit` in both affected packages. It tees `bun test`'s output, parses bun's own "Ran N tests across M files" line, and fails if the count is below `MIN_TEST_COUNT` (default 1) **regardless of bun's exit code**.

That last part is the point: a `process.exit()` during preload stops bun before its own pass/fail accounting, so neither the exit code nor `--pass-with-no-tests` can distinguish "ran everything, green" from "ran nothing, green". Verified by reintroducing the early exit — turbo exited 1 with the guard's diagnostic — then reverting.

## Turbo inputs (done by the lead, not the worker)

The base `test:unit` task hashes `src/**`, `bunfig.toml`, `package.json` — **not** `scripts/**`. So the new guard was not a tracked input (it could be weakened and a cached pass replayed), and neither was `scripts/quality-rc.test.ts`, a test file that genuinely executes via bun's recursive discovery. Added a `@podkit/device-testing#test:unit` override adding `scripts/**`. Confirmed against the resolved hashed-input list: 15 `scripts/` entries, both files now tracked.

## Result

| invocation | before | after |
|---|---|---|
| `@podkit/device-testing#test:unit` | **0 tests**, reported pass | **294 tests** (292 pass, 2 skip) across 18 files |
| `@podkit/e2e-vm-tests#test:unit` | script did not exist | **67 tests** across 4 files |
| repo-root `bun run test:unit` | 7113 tests, 41 tasks | 7480 tests, 42/42 tasks |

**No regressions.** Every one of the 361 newly-executing tests passes — including `scripts/quality-rc.test.ts`, which had been orphaned entirely. Confirmed a unit-only run makes no Lima contact. lint 0/0, typecheck 38/38.
<!-- SECTION:NOTES:END -->
