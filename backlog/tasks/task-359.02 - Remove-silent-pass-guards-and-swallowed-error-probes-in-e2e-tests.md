---
id: TASK-359.02
title: Remove silent-pass guards and swallowed-error probes in e2e tests
status: To Do
assignee: []
created_date: '2026-05-28 21:27'
labels:
  - testing
  - e2e
  - test-quality
dependencies: []
references:
  - agents/testing.md
  - test-packages/e2e-tests/src/features/upgrades.test.ts
  - test-packages/e2e-tests/src/commands/video-sync.test.ts
parent_task_id: TASK-359
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Several e2e tests wrap their assertions in conditionals or swallow probe errors, so missing/broken data reads as a pass instead of failing loudly — the silent-skip anti-pattern (agents/testing.md). Make the data presence an assertion, and let probes throw.

Sites:
- `if (json?.plan) { …expect… }` guarding whole blocks → assert `plan` is defined first: `features/upgrades.test.ts` (163, 222, 301, 373, 439, 455), `features/preset-change.test.ts:168`.
- `if (dims)` / `if (existsSync(file))` skipping the real assertion: `features/mass-storage-sync.test.ts` (339 artwork-resize cap, 421 idempotency mtime, 1298/1425/1543/1685 empty-dir tolerance).
- try/catch returning false/null in probe helpers → degrades to "no artwork"/"not a dir": `features/file-mode.test.ts:71-83`, `features/upgrades.test.ts:529`, `features/mass-storage-sync.test.ts:164-211`.
- `if (videos.length === 0) { console.log('Skipping'); return; }` silent skips: `commands/video-sync.test.ts` (252-256, 281-285, 311-315, 341-345) — these should `ensureFixturesExist`/`requireX` at module load instead.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Assertion-guarding `if` conditions replaced with a definedness/existence assertion that fails when data is missing
- [ ] #2 Probe helpers no longer swallow errors into a falsy default — a broken probe fails the test
- [ ] #3 video-sync silent early-returns replaced with module-load fixture preflight
- [ ] #4 Full e2e suite still green
<!-- AC:END -->
