---
title: "ADR-019: MusicPipeline ↔ engine/executor Symmetry"
description: Roadmap for collapsing the bespoke 2094-line MusicPipeline onto the shared sync engine — phased migration that preserves three-stage download/transcode/transfer concurrency while letting the engine own save coordination, abort handling, and the warning sink contract uniformly across music + video.
sidebar:
  order: 20
---

# ADR-019: MusicPipeline ↔ engine/executor Symmetry

## Status

**Accepted** — P1 complete (all phases landed). P2 deferred until a second pipelined-execution handler appears.

## Context

Podkit's sync layer has two content types — music and video — that share most of their orchestration scaffold but diverge sharply in execution machinery. After TASK-423 collapsed the CLI-side per-collection loop into one helper, the remaining drift sits in the core sync engine.

### Concrete drift between music and video paths

Both content types share the same CLI entry (`runSync` → `runCollectionPhase` → `genericSyncCollection` → `presenter.executeSync`). Both invoke `engine.SyncExecutor.execute(plan)` (`packages/podkit-core/src/sync/engine/executor.ts:131`). Both `ContentTypeHandler`s implement `executeBatch`. So far, symmetric.

The divergence starts inside the handler's `executeBatch`:

- **Video** (`packages/podkit-core/src/sync/video/handler.ts:420`): iterates operations sequentially, delegates each to `this.execute(op, batchCtx)`. The yielded `OperationProgress` events use the engine's standard `phase: 'starting' | 'complete' | 'failed'` protocol — engine counters tick, engine checkpoint saves fire at `saveInterval=10`, engine final save fires at end (added in commit `3ff70a17`).

- **Music** (`packages/podkit-core/src/sync/music/handler.ts:1009`): instantiates `new MusicPipeline(deps)` and delegates the entire plan to `pipeline.execute(plan, options)`. The pipeline runs a three-stage concurrent pipeline:
  - **Downloader** — resolves file access (for Subsonic, fetches source bytes ahead of CPU work).
  - **Preparer** — transcodes via FFmpeg.
  - **Consumer** — transfers prepared files to the device.

  The pipeline owns:
  - **Per-track checkpoint save** at `saveInterval=50` (`pipeline.ts:1245`)
  - **Final save** at end-of-plan (`pipeline.ts:1351`), preceded by a `phase: 'updating-db'` yield that `MusicHandler.executeBatch` filters out (`handler.ts:1046`)
  - **3-stage queues + retry semantics** (transcode: 1 retry, copy: 1 retry, DB errors: no retry, artwork errors: skip)
  - **Per-instance artwork extraction + resize caches** (`MusicArtworkManager`)
  - **Per-instance transfer dispatcher** (`MusicTransferOps`)

This means music's execution model is **fundamentally pipelined** while video's is **sequentially per-op**. Both yield `OperationProgress` events upward, but the music handler's `bridgeProgress` maps every successful pipeline event to `phase: 'complete'` so engine counters do tick correctly.

### Why the drift exists

`MusicPipeline` predates `engine/SyncExecutor`. The engine was introduced for video — a content type whose simpler per-op execution didn't need the download-overlap optimisation music needed for remote Subsonic collections. Music's pipeline was left in place because (a) the 3-stage concurrency genuinely matters for Subsonic performance, and (b) the cost of migration was higher than the cost of duplication at the time.

### Concrete double-save introduced and contained

Commit `3ff70a17` (TASK-423 follow-up A) moved video's post-loop `adapter.save()` from the CLI orchestrator into `engine/executor.ts` so the engine owns the final save for both batch and per-operation paths. The intent was symmetry: both content types end with one engine-owned save.

But music's `MusicHandler.executeBatch` yields `phase: 'complete'` events per track (via `bridgeProgress`), so the engine's batch counters tick for music — and the engine's new final save would have fired AGAIN for music, after `MusicPipeline.execute` had already saved internally. `libgpod_save` is idempotent, so this isn't a correctness bug, but it doubles the end-of-sync DB write.

The transitional fix (this commit): `ContentTypeHandler.savesInternally?: boolean`. `MusicHandler.savesInternally = true`; engine's final save skips when true. Documented as transitional — to be removed once the music pipeline hands off save coordination to the engine.

### What "symmetry" should mean

Two flavours of symmetry are achievable. They have different costs:

1. **Save coordination + result contract symmetry** (P1, this ADR's scope): the engine owns final save, checkpoint save, warning drain, and result aggregation uniformly. The handler implementation may still be bespoke (music's 3-stage pipeline, video's sequential loop), but the engine-handler boundary is identical.

2. **Execution model symmetry** (P2, future ADR): the 3-stage concurrent pipeline becomes a generic engine primitive (`engine/pipelined-executor.ts`?). Video can opt into it once video collections become remote-source (e.g. cloud-hosted media servers). Music stops being the only path that knows about download-overlap.

P2 is the architecturally cleaner end-state but is L-effort with a meaningful design surface (queue tuning, abort propagation, error categorisation across stages). P1 is mostly mechanical: remove the pipeline's internal save coordination, lift checkpoint cadence to engine config, drain warnings via the existing sink.

## Decision

Adopt P1 as a phased roadmap. Defer P2 until either (a) the music pipeline's internal save coordination has been fully lifted out, or (b) a concrete second content type appears that needs download-overlap (e.g. a podcast or cloud-video handler).

### P1 phases

Each phase is independently mergeable, behaviour-preserving, and reversible.

**Phase 1 + 2 — DONE in this commit.** Originally planned as a two-step (a transitional `savesInternally` flag, then a clean lift), collapsed once the audit confirmed the lift was bounded. Specifically:

- Dropped `pipeline.ts:1336-1352` (the `'updating-db'` yield + `await this.device.save()`).
- Music now relies on the engine's final save for end-of-run persistence.
- Updated pipeline tests: deleted the standalone `'updating-db' phase before save` test, flipped 5 `expect(mockAdapter.save.mock.calls.length).toBe(1)` assertions to `toBe(0)` with an ADR-019 marker, and flipped 3 `expect(db.save).toHaveBeenCalled*` assertions to `.not.toHaveBeenCalled()`. Save coordination is now an engine-tier integration concern.
- Updated `pipeline.integration.test.ts`'s "emits progress for each operation" test to drop its `'updating-db'` phase assertion.

The transitional `ContentTypeHandler.savesInternally?: boolean` flag introduced in commit was deleted before merge once the lift was complete — it would have been dead code.

**Risk taken**: pipeline tests are written against `MusicPipeline` directly, bypassing the engine. The previous assertions conflated pipeline-internal behaviour (transcoding, transferring) with save coordination (engine responsibility). The updated assertions make the scope-of-test explicit.

**Phase 3 — DONE.** Lifted the checkpoint save out of `MusicPipeline.execute`.
- Deleted the per-track checkpoint block (`if (saveInterval > 0 && completed % saveInterval === 0) await this.device.save()`) and removed the now-orphan `saveInterval` plumbing (type declaration, destructure, `executePipeline` signature + call site).
- Music now inherits the engine's `saveInterval=10` default rather than the pipeline's historical 50. The 50 was never benchmarked or explicitly tuned against video's 10 — symmetric default chosen for crash resilience and one-less-tuning-constant.
- Engine's checkpoint logic (`engine/executor.ts:373`) fires on `OperationProgress.phase === 'complete'` events. Music's `MusicHandler.bridgeProgress` already maps every successful pipeline event to that phase, so engine ticks per track. Behaviour-equivalent at the I/O layer with the additional safety of the engine's `device && !signal?.aborted` guards (pipeline's checkpoint had neither — a subtle gap closed by the lift).
- **Contract change for `executeMusicPlan`** (library convenience that bypasses the engine): it now has no checkpoint cadence — only the existing final save fires. Library callers that need checkpoint behaviour should use `createSyncExecutor(createMusicHandler(...))` directly.
- New integration test `engine fires checkpoint save every saveInterval completed operations` (`pipeline.integration.test.ts`) pins the cadence at the engine boundary: 5 tracks at `saveInterval=2` produces 3 saves (2 checkpoints + 1 final).

**Phase 4 — DONE.** Audit + lift remaining engine-vs-pipeline duplication. Sub-phases 4a/4b/4c landed independently.
- Warning sink (4a): pipeline uses `WarningSink` already, drained by `MusicHandler.executeBatch` into `ctx.warningSink`. ✓ (verified shared; no code change).
- Abort handling (4b): **DONE.** Pipeline previously threw `new Error('Sync aborted')` after draining its three-stage queues; the engine's batch-path catch (`executor.ts:414`) converted that to a synthetic per-operation failure and never set `ExecuteResult.aborted`. The bug was masked because `music-presenter.ts:850` independently checked `signal?.aborted` and overrode the interrupt state in its own return — three layers, each compensating for the next layer's broken contract. Phase 4b replaced the bare throw with a typed `AbortError` (new class in `engine/errors.ts`), and the engine's batch + per-op catch blocks now recognise `AbortError` (and `signal?.aborted`) and set `aborted = true` instead of recording a failure. Final save guard correctly observes the flag; `ExecuteResult.aborted` is honest. Music presenter's signal checks stay as belt-and-suspenders. New integration test `routes abort through engine: result.aborted=true on signal abort` pins the contract end-to-end.
- Error categorisation: `engine/error-handling.ts` already exports `categorizeError`. Pipeline imports + uses it (via `getRetriesForCategory` adapter shim that converts pipeline's 4-field `RetryConfig` to engine's 7-category `SharedRetryConfig`). ✓ (verified shared; no code change).
- Retry config (4c): pipeline owns its own `RetryConfig` shape and per-error-class counts (`MUSIC_RETRY_CONFIG` at `pipeline.ts:124`). The engine had a `retryConfig?: RetryConfig` field on `SyncExecuteOptions` that was declared but never read by any execution path — dead surface — **REMOVED**. Music's retry policy stays handler-owned via `MusicSyncConfig.retryConfig`, which is the only path that any production caller ever wired up. A future "engine owns retry" unification can reintroduce the option when it has a functional implementation behind it; until then, no speculative API.

**Phase 5 — N/A.** The original plan called for deleting a transitional `ContentTypeHandler.savesInternally?: boolean` flag once the lifts were done. Phase 1+2 inlined that lift before merging, so the flag was never present in the codebase — there is nothing to delete. P1's "done" marker is `MusicPipeline.execute` no longer calling `device.save` directly, which has been true since Phase 3.

### P2 (deferred)

When a second handler needs download-overlap, extract `MusicPipeline`'s 3-stage machinery into a generic `engine/pipelined-executor.ts` that `engine/SyncExecutor` can compose with. Video and music handlers both opt in via a `wantsPipelinedExecution?: boolean` flag (or equivalent). Pipeline-specific config (queue depths, per-stage retry, downloader strategy) lives in a typed `PipelineConfig` passed to the engine.

P2's design is out of scope for this ADR; file a separate ADR when triggered.

## Consequences

### Positive

- Music and video end-of-sync save semantics are identical. The engine owns the contract (final save, checkpoint cadence, abort guard); handlers no longer reimplement it.
- `MusicPipeline` shrunk by ~30 lines (final save + `'updating-db'` yield + checkpoint block + orphan `saveInterval` plumbing). The 3-stage queue machinery — the actual valuable part — stays put.
- Tests scope correctly: pipeline tests assert on pipeline behaviour (transcoding, transferring), engine tests assert on save coordination. Pre-Phase-1 the boundary was muddled.
- Phase 4b uncovered and fixed a silent contract violation: `ExecuteResult.aborted` was `false` after music sync abort, masked by `music-presenter.ts` reading `signal.aborted` directly. Now honest end-to-end via the typed `AbortError` protocol.
- No transitional `savesInternally` flag was ever merged — the lift was inlined when the audit confirmed the bounded scope, so there is zero residual technical debt from the migration scaffold.
- Future content types (podcast, audiobook) start from the engine contract directly, without needing to reimplement save coordination or abort handling.

### Negative

- Phase 2 + 3 each required pipeline test updates. The pipeline test file is large (~3000 lines); updating assertions was mechanical but tedious.
- Music's checkpoint cadence changed from `saveInterval=50` (pipeline default) to `saveInterval=10` (engine default). Behaviourally: 5× more saves on a long sync. Not benchmarked. If a user later reports DB-rewrite overhead during sync, the override path is `MusicSyncConfig.retryConfig`-style — but adding a config knob isn't done.
- `executeMusicPlan` (library convenience that bypasses the engine) lost pipeline-internal checkpoint cadence. Only the final save fires on that path. Documented in JSDoc and ADR; library callers wanting checkpoints should use `createSyncExecutor(createMusicHandler(...))` directly.
- Until P2 lands, video cannot benefit from download-overlap. If a video collection adapter for remote sources appears, that's the trigger for P2.

### Neutral

- The 2094-line MusicPipeline file does NOT disappear in P1. The 3-stage execution model is genuinely necessary for Subsonic music. P1 surfaces the *pipeline-vs-orchestration* boundary; it doesn't reduce the pipeline's intrinsic complexity.

## Alternatives Considered

### Alternative A: full migration in one task

Migrate MusicPipeline onto engine in one PR, including the 3-stage extraction (P2). Rejected: scope is too large to review safely. Risk of latent regressions in transcode error handling, abort propagation, artwork extraction cache management. Phased approach lets each piece land independently.

### Alternative B: leave the duplication; document it

Mark MusicPipeline as the music-specific execution path and stop trying to unify. Rejected: the `ContentTypeHandler.executeBatch` abstraction was specifically created to unify; reverting that decision means video's simpler model becomes the outlier and future content types have no clear pattern to follow.

### Alternative C: revert commit `3ff70a17` (engine final save)

Move the final save back to the CLI orchestrator (`sync.ts`). Rejected: undoes a genuine symmetry win. The `savesInternally` flag is a smaller surface change that achieves the same compatibility while keeping the desired direction of travel.

## Implementation Plan

- **Phase 1 + 2 — DONE** (commit `bddb2406`): engine owns the music final save. Pipeline's `'updating-db'` yield + final `await this.device.save()` deleted.
- **Phase 3 — DONE** (commit `45a21b8e`): engine owns the music checkpoint save. Pipeline's per-track checkpoint block + orphan `saveInterval` plumbing deleted. Music inherits engine's `saveInterval=10` default. `executeMusicPlan` library convenience loses pipeline-internal checkpoint cadence (final save preserved).
- **Phase 4a — DONE (verification only)**: warning sink already shared via `MusicHandler.executeBatch` draining `executor.getWarnings()` into `ctx.warningSink`. No code change.
- **Phase 4b — DONE** (commit `e49db159`): typed `AbortError` class added to `engine/errors.ts`. Pipeline throws it after queue drain on signal abort. Engine batch + per-op catch blocks recognise it and set `aborted=true` (instead of converting to a synthetic per-op failure). Concurrent-failure case preserved: a non-AbortError thrown while `signal.aborted` is true is still recorded in `result.errors` AND sets `aborted=true` — diagnostic info survives.
- **Phase 4c — DONE** (commit `0f6f386a`): removed dead `SyncExecuteOptions.retryConfig` field — declared, never read. Music retry policy stays handler-owned via `MusicSyncConfig.retryConfig`.
- **Phase 5 — N/A**: no `savesInternally` flag was merged; the lift was inlined during Phase 1+2 once the audit confirmed bounded scope.
- **P2 (deferred)**: trigger is a second pipelined-execution handler.

## Cross-References

- TASK-423 — the CLI-side loop collapse that surfaced this drift
- `packages/podkit-core/src/sync/engine/executor.ts:131` — engine SyncExecutor
- `packages/podkit-core/src/sync/music/pipeline.ts:691` — MusicPipeline
- `packages/podkit-core/src/sync/music/handler.ts:1009` — MusicHandler.executeBatch (the bridge)
- `packages/podkit-core/src/sync/video/handler.ts:420` — VideoHandler.executeBatch (the symmetric counterpart)
- `documents/architecture/sync/save-transactions.md` — companion architecture doc, updated alongside Phase 4b to reflect engine-owned save coordination for both content types.
- `packages/podkit-core/src/sync/engine/errors.ts` — `AbortError` class (Phase 4b).
