---
id: TASK-382
title: MusicPipeline ExecutionContext refactor (extract per-execute state)
status: To Do
assignee: []
created_date: '2026-06-04 08:05'
labels:
  - enhancement
  - refactor
  - music-pipeline
  - concurrency
  - code-quality
dependencies:
  - TASK-372
references:
  - packages/podkit-core/src/sync/music/pipeline.ts
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: medium
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`MusicPipeline` (commit 9465faf9) stores six per-execute fields on the instance:

- `this.adapter` (CollectionAdapter)
- `this.transferMode`
- `this.artworkResize`
- `this.audioNormalization`
- `this.sidecarResize`
- `this.syncTagConfig`

Each `execute()` sets them at entry. Two concurrent `execute()` calls on the same instance race — silent state corruption.

The `PipelineBusyError` guard (commit 2161dbda) catches this at runtime with an actionable message, but the structural fix is to pull these fields off `this` and pass them through as a single `ExecutionContext` object.

## Why

1. **Concurrent execute() actually safe.** No shared mutable state to clobber.
2. **Library consumers can pool instances.** Today's pattern (one MusicPipeline per sync invocation) wastes setup; daemon mode and future caller patterns may want to reuse the same pipeline across syncs.
3. **5 private fields disappear.** Easier to read, easier to test.
4. **Pairs with TASK-39 (pipeline split).** Both touch every private method that reads these fields.

## Scope

```ts
interface ExecutionContext {
  adapter?: CollectionAdapter;
  transferMode?: TransferMode;
  artworkResize?: number;
  sidecarResize?: number;
  audioNormalization?: string;
  syncTagConfig?: SyncTagConfig;
}
```

1. Replace the 6 fields with a context object passed to every private method that reads them. Threads through `executePipeline`, `transferToIpod`, `transferUpgradeToIpod`, `transferArtwork`, `buildAdapterFallback`, `getResizedArtwork`, and helpers.
2. `execute()` builds the context from options and passes it down.
3. Remove `PipelineBusyError` guard? — likely NO, keep it as a defensive net. Once state is contextual the guard is unnecessary for correctness but harmless. Could move to a `@deprecated` notice and remove in a future cycle.
4. The album cache (`AlbumArtworkCache`) and resized-artwork cache stay on `this` — those are PER-INSTANCE caches, not per-execute. Clear them at execute entry as today.

## Acceptance criteria

- No per-execute state on `MusicPipeline.this` except the cache fields (artworkCache, resizedArtworkCache, albumCandidates).
- All private methods accept `ExecutionContext` rather than reading `this.adapter` etc.
- New test pins concurrent execute() correctness — actually safe, not just guarded.
- Existing test suite green (no behaviour changes).

## Notes

- Worker discovered (sonnet review Phase 1) that 3 dead methods (`executeOperation`, `executeTranscode`, `executeCopy`) were deleted as part of TASK-372. Those were the legacy single-method execution path. The current `executePipeline` (three-stage prefetch/prepare/consumer) is the live entry. The refactor only needs to touch live methods.

## Reference

- `doc-041 §3.6` documents the hazard.
- Commit 9465faf9 (TASK-370) added `sidecarResize` as the 6th field.
<!-- SECTION:DESCRIPTION:END -->
