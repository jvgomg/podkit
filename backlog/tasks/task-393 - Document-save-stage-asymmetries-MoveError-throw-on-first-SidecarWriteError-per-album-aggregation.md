---
id: TASK-393
title: >-
  Document save() stage asymmetries (MoveError throw-on-first, SidecarWriteError
  per-album aggregation)
status: Done
assignee: []
created_date: '2026-06-06 12:14'
updated_date: '2026-06-06 13:41'
labels:
  - documentation
  - architecture
  - save-transaction
  - doc-041
dependencies:
  - TASK-389
references:
  - documents/architecture/sync/save-transactions.md
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
  - packages/podkit-core/src/device/mass-storage-adapter.ts
modified_files:
  - documents/architecture/sync/save-transactions.md
  - documents/architecture/sync/error-handling.md
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: low
ordinal: 108900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-381's final-summary claims the four `save()` flush stages "now follow the same shape at the contract level". The TASK-380 second-opinion review (2026-06-06) caught two real residual asymmetries this claim glosses over. Both are **intentional**, but the architecture doc should call them out so a future "unify" refactor is a deliberate decision, not reflex.

## The two asymmetries

### 1. MoveError throws on FIRST non-ENOENT, vs settle-all elsewhere

`mass-storage-adapter.ts:1310` for-loops and `throw new MoveError([...])` on the first non-ENOENT failure. Tag/picture/sidecar stages all `runWithConcurrency` + settle-all + aggregate.

**Rationale**: each rename is atomic. Re-queueing a failed move isn't useful — the source file either exists or doesn't, the destination either exists or doesn't, and the next sync's rescan picks up the rest. Settle-all would buy nothing, and aggregating multi-cause MoveError would hide that the first failure is the only one that mattered.

doc-041 §3.5 dismissed this as "the move stage retains its for-loop semantics" with a one-line justification. That's the right call but it's not the same shape as the other stages — and the architecture doc currently implies they ARE the same shape.

### 2. SidecarWriteError aggregates PER-ALBUM, tag/picture aggregate PER-FILE

Sidecar `pendingSidecarWrites` is keyed by album dir (siblings collapse). `SidecarWriteError.causes` has one entry per failing album. Tag/picture write maps are keyed by file path; their `.causes` have one entry per failing file.

**Rationale**: sidecar's natural unit IS the album (one cover.jpg per dir). Per-file aggregation would have nothing to aggregate. But a reader skimming `error-handling.md §2 Current subclasses` table sees four "aggregated" entries and assumes they're all per-file.

## Scope

1. Add `save() stage asymmetries` subsection to `documents/architecture/sync/save-transactions.md` (lifted from doc-041 by TASK-389) covering both asymmetries with rationale.
2. Update `error-handling.md §2 Current subclasses` table to note the aggregation granularity per class.
3. Update doc-041 §3.5 to point at the architecture doc as the settled treatment, instead of carrying the rationale inline.

## Why low priority

Pure documentation. Catches a real but minor inconsistency. Land after TASK-389 (so the architecture doc exists) and after TASK-380 lands (so the matrix cell observation that exposes these asymmetries exists to cross-reference).

## Future trigger

If a future refactor proposes to normalize these stages "for consistency", reviewers should land on this doc and either accept the asymmetry deliberately or refute the rationale on its merits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `save-transactions.md` has a `save() stage asymmetries` subsection naming both asymmetries with rationale
- [x] #2 `error-handling.md §2 Current subclasses` table notes aggregation granularity per class (per-file vs per-album)
- [x] #3 doc-041 §3.5 either redirects to architecture doc or links it as the settled treatment
- [x] #4 Subsection wording makes clear these are deliberate, not deferred work
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `### save() stage asymmetries (intentional)` subsection to `save-transactions.md` §2 Primitives (between the per-stage tables and the rescan contract section). The subsection documents both asymmetries with code-traced rationale: (1) MoveError's for-loop throw-on-first-non-ENOENT at line 1310, contrasted with the settle-all stages, including why settle-all would buy nothing given each rename's atomicity and stale-directory-state assumptions after the first failure; (2) SidecarWriteError's per-album aggregation rooted in pendingSidecarWrites being keyed by albumDir (line 574) vs pendingTagWrites/pendingPictureWrites keyed by file path (lines 527/534). Both asymmetries are called out as deliberate with a closing sentence that a future unify refactor must refute these rationales explicitly.

Updated `error-handling.md` §2 Current subclasses table with a fourth `Aggregation` column: TagWriteError=per-file, SidecarWriteError=per-album, PictureWriteError=per-file, MoveError=single-cause (throw on first non-ENOENT), DatabaseWriteError=single-cause. Added a footer paragraph under the table linking to the new architecture subsection.

Updated §4 Conventions in `save-transactions.md` to replace the inline parenthetical exception with a cross-reference link to the new subsection.

Redirected `doc-041 §3.5` from carrying inline rationale about the move stage's for-loop semantics to a one-line forward pointer to the architecture doc subsection.
<!-- SECTION:FINAL_SUMMARY:END -->
