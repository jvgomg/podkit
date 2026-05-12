---
id: TASK-321.05
title: Per-OS test tagging convention
status: To Do
assignee: []
created_date: '2026-05-11 22:56'
updated_date: '2026-05-12 08:16'
labels:
  - testing
  - vm-coverage
  - foundation
milestone: m-19
dependencies:
  - TASK-290
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
- [ ] #1 Filename convention documented in agents/testing.md with rationale and examples
- [ ] #2 Bun test runner skips mismatched-OS test files cleanly (or describe.skipIf pattern is documented as the standard)
- [ ] #3 Single-line skip log shows in CI / local output when a file is skipped (e.g. 'Skipping foo.darwin.test.ts on linux')
- [ ] #4 A canary test in each of two OS-tagged files (.darwin.test.ts and .linux.test.ts) confirms the convention works on at least one host
<!-- AC:END -->
