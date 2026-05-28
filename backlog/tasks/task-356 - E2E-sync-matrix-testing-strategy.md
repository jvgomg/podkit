---
id: TASK-356
title: E2E sync matrix testing strategy
status: To Do
assignee: []
created_date: '2026-05-28 07:59'
labels:
  - testing
  - e2e
  - matrix
  - sync
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - test-packages/e2e-tests/src/features/art-matrix.test.ts
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
priority: medium
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Umbrella for generalising the `art-matrix*` rule-based prediction harness into a coherent, scalable e2e matrix-testing approach across all sync variables (adapter, format, artwork, device, codec, quality, transfer mode, check-artwork).

Full design, rationale, axis catalogue, reference-model concept, combinatorial-control strategy, and phased migration plan live in **doc-039 — E2E Sync Matrix Testing Strategy**. Read it before starting any subtask.

## Phases (subtasks)

- **P1** — Extract a shared matrix harness + reference model against the EXISTING artwork matrix; prove cell-for-cell parity (de-risking, no new coverage).
- **P2** — Add the rigid-codec transcode-vs-copy axis to the artwork concern.
- **P3** — Generalise `IpodTarget` → `SyncTarget` (iPod + mass-storage, capability-carrying).
- **P4** — Add device + transfer-mode axes; migrate the imperative `codec-preference` / `mass-storage-sync` tests into concern matrices.
- **P5** — Close concrete coverage gaps (transfer×artwork, artwork-removed, resize, compilation×album-cache).

Decision-assertion support (asserting podkit's *choices* — e.g. auto-selected transfer mode — via richer `--json` or a `--explain` plan-dump) is tracked as a separate PRD task because it needs a podkit capability that doesn't exist yet.

## Relationship to TASK-355

TASK-355 (artwork bugs) is the artwork-specific predecessor that proved the pattern. Its remaining subtasks (355.02, 355.05) are cross-linked: 355.05 (Subsonic change-matrix) should be built on the P1 harness rather than the old per-file pattern.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All phase subtasks (P1–P5) reach Done
- [ ] #2 doc-039 kept in sync as axes/reference-model evolve during implementation
- [ ] #3 Decision-assertion PRD task filed and linked
<!-- AC:END -->
