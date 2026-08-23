---
id: TASK-482
title: >-
  device-testing unit tests never run — preflight process.exit(0) aborts the
  whole bun test run
status: To Do
assignee: []
created_date: '2026-08-23 19:52'
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
