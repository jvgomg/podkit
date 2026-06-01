---
id: TASK-369
title: 'Matrix coverage: assert "other" codec key source in single-stack cells'
status: To Do
assignee: []
created_date: '2026-06-01 20:11'
labels:
  - test
  - matrix
dependencies:
  - TASK-368
references:
  - test-packages/e2e-tests/src/matrix/config-rules.ts
  - packages/podkit-cli/src/commands/sync-decisions.test.ts
priority: low
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up surfaced during TASK-368 sonnet review.

The config-inheritance matrix cells in `test-packages/e2e-tests/src/matrix/config-rules.ts` pin ONE setting at ONE level and assert only that setting's `source`. They don't assert the *other* codec key's source in the same run.

Consequence: a regression that reinstated the old TASK-367 single-source behavior (where a `[devices.x.codec] lossy = [...]` block stamped `losslessCodec.source = 'device'`) would not be caught by the matrix. Today this is covered by a unit test in `packages/podkit-cli/src/commands/sync-decisions.test.ts` ("split stacks: lossy from global + lossless from device"), so the gap is integration-level only.

## Fix sketch
Extend `predictConfig` (or add a sibling matrix axis) so that single-stack codec cells *also* assert the un-pinned key's source. e.g. when `lossyCodec/device` is the cell:
- assert `lossyCodec.source === 'device'` (existing)
- assert `losslessCodec.source === 'default'` (new)

Alternatively, add a separate "split" cell axis (lossy at level A, lossless at level B) for explicit coverage of the split case.

## Why low priority
Unit-level regression coverage exists; matrix gap is belt-and-suspenders. Worth filling when next touching the matrix.
<!-- SECTION:DESCRIPTION:END -->
