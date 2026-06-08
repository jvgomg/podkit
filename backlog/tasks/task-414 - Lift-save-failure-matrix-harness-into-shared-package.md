---
id: TASK-414
title: Lift save-failure matrix harness into shared package
status: To Do
assignee: []
created_date: '2026-06-08 10:04'
labels:
  - refactor
  - testing
  - matrix
  - infrastructure
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/matrix/harness.ts
  - test-packages/e2e-tests/src/matrix/harness.ts
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
priority: low
ordinal: 129000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-380 AC #12 explicitly deferred lifting the matrix harness into a shared package: *"Harness lift (`harness.ts` → shared location) NOT in scope; re-evaluate after matrix lands and a second consumer demands it."*

With TASK-412 extending the VM matrix with new failure modes + types, e2e-vm-tests is now a second consumer. The shapes have already diverged slightly between the two copies:

- `test-packages/e2e-vm-tests/src/matrix/harness.ts` (206 lines) — has a `Matches`-suffix regex comparator added by TASK-380 phase C.2, plus deeper diff handling.
- `test-packages/e2e-tests/src/matrix/harness.ts` (307 lines) — original implementation, lacks the regex matcher.

Future drift is likely. Lifting now prevents two parallel maintenance burdens.

## Scope

1. **New workspace** `test-packages/matrix-harness/` (or absorb into an existing test-packages workspace if a natural home exists). Exports `defineMatrix`, `diffCell`, `skipImpossible`, `skipRedundant`, `skipBug`, `CellExpectation`, the `Matches`-suffix comparator extension.
2. **Migrate both consumers** to import from the new package. Resolve the divergence — superset the union of both harness shapes (the `Matches` regex comparator should be available to host-side consumers too).
3. **Test parity**: every existing test that runs through either harness must still pass after the migration. Workspace typecheck + targeted bun test runs.
4. **Update task references**: TASK-380 implementation notes should get a closure note pointing at this task. Architecture doc (testing strategy if one exists) should mention the shared harness.

## Why low priority

The two copies aren't currently broken; this is preventative. No user-facing impact. The drift is small today.

## Reference

- `test-packages/e2e-vm-tests/src/matrix/harness.ts`
- `test-packages/e2e-tests/src/matrix/harness.ts`
- `backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md` — the broader matrix strategy.
- TASK-380 AC #12 — the original punt.
- TASK-412 — second consumer that motivates the lift.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 #1 New shared workspace (or absorbed into existing) holds the matrix-harness primitives; both copies removed
- [ ] #2 #2 Both e2e-tests and e2e-vm-tests import from the shared package; no divergence
- [ ] #3 #3 The Matches-suffix regex comparator is available to BOTH consumers (the VM harness's extension wins)
- [ ] #4 #4 Workspace typecheck green; all matrix tests pass before + after migration
- [ ] #5 #5 TASK-380 AC #12 reference closed; doc-039 updated to point at the shared harness
<!-- AC:END -->
