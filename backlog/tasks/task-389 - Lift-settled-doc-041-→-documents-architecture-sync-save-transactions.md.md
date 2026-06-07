---
id: TASK-389
title: Lift settled doc-041 → documents/architecture/sync/save-transactions.md
status: Done
assignee: []
created_date: '2026-06-06 12:12'
updated_date: '2026-06-06 12:54'
labels:
  - documentation
  - architecture
  - save-transaction
  - doc-041
dependencies: []
references:
  - documents/architecture/README.md
  - documents/architecture/sync/error-handling.md
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
priority: medium
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`documents/architecture/README.md` migration plan calls for extracting settled parts of `doc-041` into `documents/architecture/sync/save-transactions.md`. This task does it.

Also fixes stale claims discovered during TASK-380 re-scoping:
- `error-handling.md §7` claims MassStorageAdapter doesn't implement `setWarningSink`. It does — `mass-storage-adapter.ts:1500`.
- `doc-041 §4.1/§4.2` "what's covered / what's not" tables predate TASK-381's typed-error rollout — multiple rows are stale (PictureWriteError now typed, MoveError typed, etc.).

## Why lands first

TASK-380 (the save-failure matrix) needs to cite the architecture doc directly. Without this task landing first, the matrix PR drags an unrelated doc lift along and reviewers conflate them.

## Scope

1. Create `documents/architecture/sync/save-transactions.md` using the 8-section template (per `architecture/README.md`).
2. Lift from doc-041:
   - §1 (what "save transaction" means) → Map + Primitives
   - §2 (per-adapter flows) → Primitives + Responsibility boundaries
   - §6 (self-healing across runs / rescan contract) → Primitives
   - §7 (principles for incremental work) → Conventions for new contributors
3. Keep in doc-041 journal (these evolve):
   - §3 (rough-edges catalogue)
   - §4 (test coverage state of play)
   - §5 (failure modes catalogue)
   - §8 (open design questions)
4. Update doc-041 §4.1/§4.2 to post-TASK-381 reality. Specifically: PictureWriteError/MoveError typed; picture-write stage uses runWithConcurrency + clear-before-throw; mass-storage `setWarningSink` exists.
5. Fix `error-handling.md §7` stale `MassStorageAdapter doesn't yet implement setWarningSink` claim.
6. Update `architecture/README.md` migration-plan checkbox for doc-041 row.

## References

- doc-041 — the journal being partially lifted
- doc-039 — sibling living strategy doc (NOT lifted; testing-strategy, not architecture per migration plan)
- error-handling.md — the canonical example to mirror
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `documents/architecture/sync/save-transactions.md` created using the 8-section template from architecture/README.md
- [x] #2 doc-041 §1/§2/§6/§7 reduced to forward-pointers; journal keeps §3/§4/§5/§8
- [x] #3 doc-041 §4.1/§4.2 tables updated to reflect TASK-381 typed-error closure (PictureWriteError, MoveError, settle-all + clear-before-throw across all stages)
- [x] #4 documents/architecture/sync/error-handling.md §7 stale `MassStorageAdapter doesn't yet implement setWarningSink` line removed (it does — mass-storage-adapter.ts:1500)
- [x] #5 documents/architecture/README.md goals/migration-plan row for doc-041 marked complete
- [x] #6 New architecture doc cross-links to error-handling.md (companion) + doc-041 (journal) + ADR-009 (self-healing rationale)
- [x] #7 Lands BEFORE TASK-380 so the matrix PR can cite the architecture doc
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Lifted the settled portions of doc-041 into `documents/architecture/sync/save-transactions.md` (the second per-subsystem architecture doc after error-handling.md).

**What landed in the new architecture doc** (`documents/architecture/sync/save-transactions.md`, sidebar order 2):
- §1 Map — what save() is, both adapters at a glance, transactional aspiration vs. flush-and-rescan reality.
- §2 Primitives — per-stage tables for `MassStorageAdapter.save()` (moves / tag / picture / sidecar / manifest) and `IpodAdapter.save()` (iTunesDB + portable tags); the hard-vs-soft rationale; the rescan self-heal contract folded in as a primitive with a per-stage "what's on the device → what the next sync sees" table.
- §3 Responsibility boundaries — adapter / pipeline / next-sync-rescan / doctor.
- §4 Conventions for new contributors — three checklist items: normalize the failure shape (settle-all + concurrency cap + typed aggregate + clear-before-throw), atomic writes for on-file mutations, pin the failure behaviour with tests.
- §5 Scope boundaries — pointers to doc-041 §3/§4/§5/§8 and to error-handling.md and doc-041 Q5.
- §6 Open work — TASK-390, TASK-391, TASK-376, TASK-392, TASK-393, TASK-380.
- §7 References — source file paths with line numbers, companion error-handling.md, ADR-009, doc-041.

**doc-041 journal updates**:
- §1, §2, §6, §7 reduced to forward-pointers (headers retained for cross-reference stability).
- §4.1 (what's covered) rewritten to post-TASK-381 reality: added PictureWriteError aggregation + clear-before-throw, MoveError typed + ENOENT-skip warning, SidecarWriteError, sidecar atomic write, MassStorageAdapter.setWarningSink, DatabaseWriteError mutator tests.
- §4.2 (what's NOT covered) trimmed: removed picture-write 1/N (done), move partway (done), ENOENT skip (done), TagWriteError clear ordering (done). Kept genuine gaps (crash mid-tag-write → TASK-376 force-function; cross-stage crash; SIGINT mid-batch device-state contract). Added the save-failure matrix row → TASK-380.
- §9 Cross-references updated with TASK-376, TASK-378, TASK-379, TASK-380, TASK-381 (closed), TASK-389 (closed), TASK-390, TASK-391, TASK-392, TASK-393. Future-task list trimmed for items now owned by named tasks.

**error-handling.md fix**: removed the stale §7 bullet claiming MassStorageAdapter doesn't implement setWarningSink — it does, at `mass-storage-adapter.ts:1500`. Other two bullets in §7 left alone (sidecar concurrency owned by TASK-390; libgpod async wrapper still genuinely open).

**architecture/README.md updates**: added save-transactions.md to "What's here today" (third bullet), ticked the doc-041 migration row with what landed vs what stays in the journal, marked save-transactions.md as ✅ landed in the eventual-shape tree.

TASK-380 (the matrix) can now cite the architecture doc directly without dragging this lift along.
<!-- SECTION:FINAL_SUMMARY:END -->
