---
id: DRAFT-012
title: >-
  Extract music pipeline prepare.ts + inline-ops.ts (Phase 4 of pipeline.ts
  split)
status: Draft
assignee: []
created_date: '2026-06-05 19:36'
labels:
  - refactor
  - music-pipeline
  - code-quality
  - phase-4
dependencies:
  - TASK-383
references:
  - packages/podkit-core/src/sync/music/pipeline.ts
  - packages/podkit-core/src/sync/music/artwork.ts
  - packages/podkit-core/src/sync/music/transfer.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-383 extracted `artwork.ts` (~300 LOC) and `transfer.ts` (~386 LOC) from `music/pipeline.ts`, dropping it from 2607 → 1952 LOC. The task AC was "below 1500 LOC". The worker stopped at 1952 because the remaining bulk is the three-stage executePipeline body plus prepare* helpers — a logically cohesive unit.

## Scope

Two more extracts that would land `pipeline.ts` under 1500 LOC:

### `sync/music/prepare.ts` (~400 LOC)

Extract the five `prepare*` methods (operate on a single `SyncOperation` to produce a `PreparedFile`):

- `prepareTranscode`
- `prepareCopy`
- `prepareOptimizedCopy`
- `prepareUpgrade` (and its sub-variants)

Likely shape: `MusicPrepareOps` class taking `(transcoder: FFmpegTranscoder)` — the operation-shape-specific logic doesn't need the device adapter.

### `sync/music/inline-ops.ts` (~200 LOC)

Extract the four small private inline-op handlers from the executor:

- `executeRemove`
- `executeUpdateMetadata`
- `executeUpdateSyncTag`
- `executeRelocate`

These run on the device adapter without going through the three-stage pipeline — simple operations executed inline by `executePipeline`. Likely shape: a `MusicInlineOps` class taking `(device: DeviceAdapter)`.

## After

`pipeline.ts` should drop to around 1300–1400 LOC, leaving only:
- `MusicPipeline` class definition + the ExecutionContext-building `execute()` entry
- The three-stage executePipeline body (prefetch / prepare / consumer loop)
- The collaborator field declarations (`this.artwork`, `this.transfer`, `this.prepare`, `this.inlineOps`)
- The `PipelineBusyError` + busy guard

## Acceptance criteria

- `pipeline.ts` drops below 1500 LOC (the target TASK-383 missed).
- `prepare.ts` exists; the five prepare* methods relocated.
- `inline-ops.ts` exists; the four inline-op handlers relocated.
- No behaviour changes — all existing tests green; matrix counts unchanged.

## Notes

- This is a continuation of TASK-383. The patterns are established (collaborator class + `(device, ...)` constructor) — should be smaller than 383's Phase 1+2 since the surface to split is more uniform.
- May surface opportunities for further DRY: the prepare* methods share retry/temp-file conventions that could be extracted into a base class or helper module. Use judgment.

## Reference

- TASK-383 completion notes (the worker's recommended follow-up #3).
- Decided 2026-06-05 in team-lead session after TASK-383's Sonnet review surfaced the AC miss.
<!-- SECTION:DESCRIPTION:END -->
