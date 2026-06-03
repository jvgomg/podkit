---
id: TASK-356
title: E2E sync matrix testing strategy
status: Done
assignee: []
created_date: '2026-05-28 07:59'
updated_date: '2026-06-03 21:38'
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
- [x] #1 All phase subtasks (P1–P5) reach Done
- [x] #2 doc-039 kept in sync as axes/reference-model evolve during implementation
- [x] #3 Decision-assertion PRD task filed and linked
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Handoff (2026-05-28)

**Done & committed** (all test-only, no production code, branch local/unpushed):
- P1 (356.01) `1389ddad` — shared matrix harness in `test-packages/e2e-tests/src/matrix/` (axes, reference-model, harness, artwork-rules, README). The 3 art-matrix files are thin wrappers now.
- P3 (356.03) `e86faf95` — `SyncTarget` abstraction (`targets/sync-target.ts` + `targets/mass-storage.ts`); `IpodTarget extends SyncTarget`; mass-storage target generates its own `[devices.*]` TOML + ffprobe `getTracks()`.
- P2 (356.02) `6bea59fd` — transcode-vs-copy `pipeline` axis on the host artwork matrix (128 cells); `deviceAction()` + `artworkReaches()` in the reference model.

**Remaining:** P4 (356.04, unblocked) → then P5 (356.05). TASK-357 (decision-assertion exposure) is an independent PRD, unstarted.

**Start here:** P4 (356.04) — see that task's notes for the concrete design forks. Recommended order: (a) add `skip(cell)` to the harness `MatrixDef` first (doc-039 calls for it; not built yet), (b) wire device as an axis on the artwork matrix using `target.capabilities` + `target.deviceConfig()` (replacing the hardcoded `HOST_IPOD_CAPS` in artwork-rules), (c) extend `deviceAction()` with the mass-storage WAV/AIFF-output exception, (d) migrate the imperative `codec-preference.test.ts` + `mass-storage-sync.test.ts` last.

**Workflow that worked:** typecheck (`bun run typecheck --filter @podkit/e2e-tests`) + oxlint, then run host matrices (`bun run test:e2e -- art-matrix`), then docker (`bun run test:docker -- art-matrix.docker`), commit per phase. doc-039 is the source of truth — keep it in sync as axes are added.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All three umbrella ACs satisfied.

**AC #1** All phase subtasks (P1–P5) reach Done: ✔ closed prior (TASK-356.01–.05). P6–P8 (TASK-356.07–.09) and TASK-356.06 (Subsonic sidecar) also closed.

**AC #2** doc-039 kept in sync: ✔ updated through every phase. Most recently TASK-372 / TASK-371 / TASK-370 added the "device-side write dispatch" section + updated the matrix-prediction summary to reflect that `predictDirectory` collapsed to a single branch and `skipArtworkCell` retired all TASK-370 fences.

**AC #3** Decision-assertion PRD filed and linked: ✔ TASK-357 (doc-040) landed; matrix consumes `json.decisions.*` and per-op `inputCodec`/`outputCodec`.

The matrix harness has now grown to host: artwork (host + docker), codec decision matrix, transfer-mode × artwork, artwork-removed change, artwork resize, compilation/album-cache, config inheritance (TASK-356.08), CLI overrides (TASK-356.09). Each cell consumes the typed `SkipDecision` so structural vs `[BUG]` skips are visible. Six rough-edge follow-ups (TASK-374–381) anchored to doc-041 carry the remaining hardening work without polluting the matrix umbrella.
<!-- SECTION:FINAL_SUMMARY:END -->
