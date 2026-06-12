---
id: doc-042
title: Handover — TASK-423 follow-up + ADR-019 Phase 3+
type: guide
created_date: '2026-06-12 17:26'
tags:
  - handover
  - adr-019
  - task-423
  - tech-debt
  - sync
  - engine
---
## Purpose

You are picking up a multi-commit refactor stream that started with TASK-423 (collapsing music + video collection loops in `runSync`) and grew into ADR-019 (lifting `MusicPipeline`'s save coordination onto the engine `SyncExecutor`). Four commits landed cleanly. The most architecturally interesting work is still ahead — **Phase 3 (engine owns checkpoint save)**, **Phase 4 (warning-sink + abort + retry config consolidation)**, and the deferred **P2 (pipelined-executor extraction)**.

This document is dense on purpose. Read it once end-to-end before touching code. The trickiest parts of this stream are not in the code that landed; they're in the *audit findings* that informed the design — many of those findings would be expensive to rediscover.

---

## 1. Use the team-lead skill the same way

The previous lead invoked `team-lead` once for this whole stream. You should do the same when you start. The user explicitly endorses this skill for orchestrating refactors like this — they have to say "take responsibility" or "team-lead" verbally, but the work you are picking up IS that endorsement carried forward.

**The user's instruction at the start of the previous session was:** *"sounds like you have a good idea. I'd like you to use the idea of the team-lead skill to start working on this. Use the sub agents to review but also review the code yourself. I'd rather you work on the problem and close out the task at the end rather than updating plans."*

That guidance still applies. Specifically:

- **You implement.** Don't farm out every coding step to sub-agents. The user wants you in the diff.
- **Sub-agents review your work** at commit boundaries. They don't replace your own judgment.
- **Update tasks, not plans.** The user does not want plan-updating cycles. Decisions belong in the ADR; the TASK-423 final summary captures historical context.
- **Close out tasks at the end.** Mark them Done in backlog with a final summary. Don't leave In Progress for ambient cleanup.

The user's other endorsement (later in the same session): *"commit then work on those tasks rather than backlogging them. sequence the work smartly"* — meaning: when you discover follow-ups, do them, don't file them as future work for someone else to do.

---

## 2. What landed (the four commits)

In chronological order on `main`:

### `8e0fffd9` — TASK-423: extract `runCollectionPhase` helper

Collapsed two ~75%-overlapping loops in `packages/podkit-cli/src/commands/sync.ts` (music + video) into one content-type-agnostic helper at `packages/podkit-cli/src/commands/sync-collection-phase.ts`.

- Divergence flows through `ContentTypePresenter` dispatch — new methods `getSourcePath(collection)` and `getInterruptedSuffix()`.
- Discriminated `CollectionPhaseResult` (`kind: 'music' | 'video'`) for typed accumulators — overloads narrow return type.
- Hoisted `resolvedForDecisions`, `decisions`, `musicConfig`, `lastDecisions = decisions` OUT of the music loop (they were never per-collection; the original TASK-423 description claimed they were already outside — they weren't).
- 16 focused unit tests in `sync-collection-phase.test.ts` pin byte-identical headers + interrupt suffixes.
- `priorPhaseCompleted: number` input on the helper feeds the cross-phase save gate — caller passes its `totalCompleted` snapshot. This was a bug catch during extraction.

Result: `sync.ts` shrank by ~37 lines; the two phases now read as two clean wrapper calls.

### `94edb756` — Rename `video/planner.ts` → `video/estimation.ts`

Pure rename + import updates. The file contained estimation utilities, not planning logic; the misleading name dated from before the engine `estimation.ts` was extracted. Updated 6 sites + 2 architecture doc mentions. Zero behaviour change.

### `3ff70a17` — Engine owns final-save

Moved video's post-loop `adapter.save()` from `sync.ts` into `engine/executor.ts`. Both paths (per-op + batch) now save at end-of-run when `!dryRun && !aborted && device && (completed > 0 || failed > 0)`.

- Updated `executor.test.ts` mocks: 28 `device: {} as any` calls became `device: mockDevice()` (factory exposes `save()`).
- Added 3 regression tests: empty plan no-op, abort no-op, saveInterval=0 still emits final save.

**The commit introduced a silent double-save** for music. The next commit fixed it.

### `bddb2406` — ADR-019 Phase 1 + 2: lift `MusicPipeline`'s final save

Deep audit revealed that music ALREADY runs through `engine.SyncExecutor` (via `MusicHandler.executeBatch` wrapping `MusicPipeline.execute`). After commit `3ff70a17`, music was saving twice — once inside the pipeline (`pipeline.ts:1351`), once via the engine.

- Dropped `pipeline.ts:1336-1352` (the `'updating-db'` yield + `await this.device.save()`).
- Dropped the now-dead `'updating-db'` arm from `MusicHandler.executeBatch`'s filter.
- `executeMusicPlan` (library-level convenience that bypasses engine) got its own save added so the "fully persisted" contract survives for direct library callers.
- New ADR-019 documents context, audit findings, phased migration roadmap.
- New integration test `routes save through engine: exactly one save per music sync end-to-end` pins the contract at the engine boundary.
- Updated 8 pipeline-test save assertions to `not.toHaveBeenCalled` / `toBe(0)` with ADR-019 markers (no "phase N" suffix — per `feedback_code_agnostic_to_tasks` memory).
- Updated `pipeline.integration.test.ts:425` to drop its `'updating-db'` phase assertion.

**Test counts now**: 1520 (pre-stream) → 3165 unit + 12 + 69 integration. All passing.

---

## 3. What's NOT done — concrete work items in priority order

### Phase 3 — Engine owns checkpoint save (S, ~1 hour, low risk)

**Goal**: lift `MusicPipeline`'s per-track checkpoint save (`pipeline.ts:1245-1247`) so the engine owns ALL save coordination for music. After this, `MusicPipeline.execute` never calls `device.save()` directly.

**Concrete steps**:

1. Delete `pipeline.ts:1245-1247` (`if (saveInterval > 0 && completed % saveInterval === 0) await this.device.save()`).
2. The pipeline's `saveInterval` option (line 181, 839, 949, 1035) becomes orphaned. Remove it from `ExecuteOptions` if no other code references it. Grep first.
3. The engine's checkpoint save (`engine/executor.ts:271-273` and `:365-367`) fires on `progress.phase === 'complete'` events at `saveInterval` cadence. Music's `MusicHandler.bridgeProgress` already maps every per-track success to `phase: 'complete'`, so engine ticks for music.
4. **Decision needed**: music's pipeline default was `saveInterval=50`; engine's default is `10`. Two options:
   - **(a) Adopt engine's 10** — higher I/O, more crash-recoverable. Simplest. Accept the tuning change.
   - **(b) Plumb `saveInterval: 50` through `MusicPresenter.executeSync`** (music-presenter.ts:787-791 — currently doesn't pass it). Preserves music's historical cadence.
   - **Recommend (b)** — the user previously framed cross-content tuning differences as orthogonal to refactor work. Phase 3 should be behaviour-equivalent at the I/O level.
5. Pipeline tests at `pipeline.test.ts` that pin checkpoint behaviour (search for `saveInterval`) need review. Some may already pass without changes (they pinned pipeline-internal behaviour which is going away). At least one test "checkpoint save fires at saveInterval" was added in commit `3ff70a17` to `executor.test.ts:497`+ — those stay.
6. Add an integration test asserting checkpoint-save count is N/saveInterval at the engine boundary for a multi-track music sync. Pattern: same as the `routes save through engine` test in `pipeline.integration.test.ts:485`.

**Why low risk**: engine's checkpoint logic is already battle-tested for video. Music just opts into the same cadence via the existing `progress.phase === 'complete'` plumbing.

**Sub-agent collaboration suggestion**: after the change, dispatch a Sonnet reviewer with the same brief shape used in commit `bddb2406`'s review (full prompt is in the prior session's transcript; see Section 7 below).

### Phase 4 — Warning sink + abort handling + retry config consolidation (M, ~3-4 hours aggregate, medium risk per lift)

Three independent lifts. Do them as separate commits.

#### 4a. Warning sink — ALREADY SHARED

Read `pipeline.ts:697-699` and confirm. `MusicPipeline` uses the `WarningSink` interface from `engine/types.ts`. Drained by `MusicHandler.executeBatch:1061-1065` into `ctx.warningSink`. This one is done; verify and skip.

#### 4b. Abort handling — pipeline has parallel implementation (M, ~1-2 hours)

`MusicPipeline.execute` checks `signal?.aborted` independently in multiple places (search for `signal?.aborted` in `pipeline.ts`). Each check throws `new Error('Sync aborted')`. The engine's `SyncExecutor` catches this and sets `aborted = true`.

The lift: replace the bespoke abort string with the engine's abort protocol. Options:
- **Throw a typed `AbortError`** that the engine's catch block recognises (preferred; engine pattern).
- **Yield a `phase: 'failed'` event with `progress.error = signal.reason`** and let the engine's failed-phase counter handle it.

The pipeline's three-stage architecture (downloader → preparer → consumer) means abort needs to propagate across queues. Today the pipeline calls `await Promise.all([downloaderPromise, preparerPromise])` and then re-checks signal. That pattern stays. The change is the throw-type at the leaf.

**Test impact**: `pipeline.test.ts` has multiple "aborts" tests; check assertion messages. The integration test "abort path leaves DB unsaved" might exist — confirm it does, write one if not.

**Risk**: medium. The three-stage abort coordination is subtle. If you break it, music sync can hang on cleanup.

#### 4c. Retry config — pipeline has its own counts (M, ~1 hour)

`MusicPipeline` has bespoke retry counts per error class:
- Transcode failures: retry once.
- Copy failures: retry once.
- Database errors: do NOT retry.
- Artwork errors: do NOT retry (skip artwork, continue sync).

These are hardcoded in `pipeline.ts` (search for `transcodeAttempt`, retry counters). The engine's `SyncExecuteOptions.retryConfig` (`engine/executor.ts:55`) accepts a `RetryConfig` but doesn't use it in either execution path — it's plumbed through but inert at the engine level.

**The decision**: who owns retry policy?

- **Music handler owns it** (status quo, more or less) — engine just carries the config in `ExecutionContext`. Pipeline keeps its hardcoded counts but reads them from `ctx.retryConfig` if present.
- **Engine owns it** — engine wraps every `handler.execute` call with retry logic per the operation type's error class. Handlers stop having their own retry loops. This is closer to the unified pattern but is L-effort: it requires standardising the error categorisation across content types and the retry semantics across operation types. Probably out of scope for Phase 4.

**Recommend status quo with cleanup**: plumb the existing config into `pipeline.ts`'s retry counters so the hardcoded counts become defaults overridable by `RetryConfig`. Defer the broader "engine owns retry" question to its own ADR.

### P2 — Pipelined-executor extraction (L, multi-session, design-doc-required)

Triggered when a second content type needs download-overlap (cloud-hosted video collections, podcast handlers, etc.). Until then, defer.

When it triggers:
- Extract `MusicPipeline`'s three-stage machinery (downloader, preparer, consumer + queue coordination) into `engine/pipelined-executor.ts`.
- Generic over operation type — accepts a `PipelineConfig` with per-stage callables.
- `MusicHandler` and the new handler both opt in via a `wantsPipelinedExecution?: boolean` flag (or similar) on `ContentTypeHandler`.
- Likely needs its own ADR — file `ADR-020` when the trigger fires.

---

## 4. Tech debt + code smells noticed during this stream

Recording these because they would be expensive to rediscover. None are blockers; all are candidates for separate cleanup tasks. If you do any of them, file the task as you go (the user prefers "do it" over "file it").

### Confirmed debt

1. **`genericSyncCollection` takes 14 positional args** (`sync-presenter.ts:392`). The previous lead chose not to convert to options-object during TASK-423 because the blast radius (7 test call-sites in `sync-empty-source.test.ts` + 2 production callers) was disproportionate to the scope. Now that the helper contains the awkwardness to one site, the cost-benefit changes. Easy cleanup; do it next time someone touches `sync-presenter.ts` for any other reason.

2. **Music's conditional header gating** (`sync.ts:1119` — `renderPerCollectionHeader: musicCollections.length > 1`). Music suppresses the `=== Music: NAME ===` header when there's only one music collection; video always shows it. The asymmetry is now visible at the call site (intentional — TASK-423 preserved current behaviour). A separate task should debate alignment. Worth a Q to the user when they next touch sync output: "should music always show the per-collection header, matching video?"

3. **`packages/demo/src/mock-core.ts:1016` re-implements `MusicPipeline`** as a demo mock. It has its own counting bug (`progress.phase !== 'complete'` is the inverted check — see Sonnet review of commit `bddb2406`). The demo is not production but it surfaces as `executeMusicPlan` for the demo's purposes. Pre-existing bug; not in scope for ADR-019 phases.

4. **Three `ResolvedCollection` interfaces with the same shape** (`sync.ts:200`, `sync-presenter.ts:80`, `music-presenter.ts:99`, `video-presenter.ts:40`). Trivial dedup — export from `sync.ts` only (it already does at line 200). Drive-by candidate.

5. **`pipeline.ts` is 2094 lines and growing**. Several internal helpers (`getPhaseForOperation`, `categorizeError`, the per-stage class privates) could move to sibling files for module-boundary clarity. ADR-019 phases give natural cut points: post-Phase 3, save coordination is gone; post-Phase 4, abort + retry policy is gone; what remains is the 3-stage queue machinery, which is the core value.

6. **`pipeline.test.ts` is 3000+ lines**. Many tests pin pipeline-internal behaviour that should arguably live at the engine integration boundary (e.g., the save-count assertions before ADR-019 phase 2 was a pipeline-internal pin of an engine-owned contract). When Phase 3 lands and removes the saveInterval logic, audit the test file for similar mis-scoped assertions.

### Smells I didn't have time to fully confirm

7. **MusicHandler.executeBatch creates a `new MusicPipeline(deps)` PER batch call** (`handler.ts:1024`). This means per-collection sync gets a fresh pipeline, which means fresh artwork extraction caches (`MusicArtworkManager.clearCaches`). For multi-collection music syncs, the cache is invalidated between collections. Is this intentional? Plausible for memory reasons (large iPods, many collections); also plausible bug (artwork could be re-extracted across collections of the same library). Worth a confirm with the user — if it's intentional, document it; if it's a bug, file a task.

8. **`saveInterval` plumbing inconsistency**. `engine/executor.ts:168` defaults to 10. `pipeline.ts:839` defaults to 50. `MusicPresenter.executeSync` doesn't pass `saveInterval` (music-presenter.ts:787-791). When Phase 3 lifts the checkpoint into engine, the inconsistency surfaces — pick a number or plumb it through. The previous lead recommends 50 (preserve music's cadence) but didn't ship it.

9. **`OperationProgress` vs `ExecutorProgress` phase taxonomy**. There are two `phase` enums:
   - `OperationProgress.phase` — `'starting' | 'in-progress' | 'complete' | 'failed' | ...` (what `handler.executeBatch` yields).
   - `ExecutorProgress.phase` — `'copying' | 'transcoding' | 'removing' | 'updating-metadata' | ...` (what engine yields upward to presenter, derived from `operation.type`).
   - The two taxonomies don't overlap. Music's pipeline yields `'copying'/'transcoding'/'removing'/'updating-metadata'` directly as `ExecutorProgress` because it predates the engine wrapping. The handler's `bridgeProgress` collapses these to `OperationProgress.phase = 'complete'`. Then engine remaps `OperationProgress` to `ExecutorProgress` via `getDefaultPhaseForOperation(progress.operation.type)`. So music's per-track-phase information makes a round trip through `'complete'` and back.
   - This is invisible because the round trip is lossless (operation type is preserved). But it's architecturally weird. Worth documenting in `documents/architecture/sync/save-transactions.md` next time someone touches it.

10. **The dead-code `'updating-db'` filter in `MusicHandler.executeBatch:1046`** — I cleaned this up in commit `bddb2406`, but the comment in `pipeline.ts:1337` references it. The pipeline file's narrative about save coordination is still scattered. Phase 3 is the right time to do a single pass and either consolidate the comments or move them into a top-of-file module docstring.

---

## 5. Things we explicitly did NOT consider

Surface these before deciding scope for any of the above.

### Performance

- **Did we measure the I/O cost of the double-save introduced and removed?** No. libgpod `save()` is a full DB rewrite. For a 1000-track iPod that's maybe ~50ms on USB 2.0. We "fixed" it because it was an obvious correctness violation, but the actual perf impact was uncharacterised. If the user wants Phase 3 prioritised for perf reasons, give them a number first (run a sync with N tracks before/after, time the save block).

- **`saveInterval=10` vs `saveInterval=50`** — never benchmarked. Engine's 10 means 5x more saves during a sync. For a 1000-track sync that's ~100 saves vs ~20 saves. Wall-clock impact: probably negligible compared to track transfer time, but worth confirming.

### Crash recovery

- **Music's `saveInterval=50` was chosen to balance "data loss on crash" against "I/O overhead"**. Phase 3 changes this contract. If you swap to 10, music sync becomes more crash-resilient at higher I/O cost. The trade-off should be explicit in the commit message, not buried.

### Subsonic / remote-source specifics

- **The 3-stage pipeline's killer feature is downloader-preparer overlap for Subsonic.** Phase 3 doesn't touch this. Phase 4 (abort handling) does — be careful: the cross-stage queue coordination is the hardest part of `MusicPipeline` to get right. Abort propagation across queues was painful in the original implementation; preserve the existing semantics carefully.

### Mass-storage vs iPod adapters

- **Engine save invokes `device.save()`**. For iPod, this writes iTunesDB. For mass-storage, what does it do? Search for `class MassStorageAdapter` — confirm `save()` is implemented. If it's a no-op, the engine's save logic is iPod-specific in effect. If it's a manifest write, the save count matters differently per adapter. Worth verifying before Phase 3 lands.

### Daemon mode

- **Per `agents/docker.md` and `packages/podkit-daemon`**, podkit can run as a background daemon performing periodic syncs. Daemon-side, does the increased save cadence (Phase 3 → 10x more saves) interact with the lock contract (see `documents/architecture/sync/planning.md` §6)? Probably not — saves don't reacquire the lock — but confirm.

### The `compact buffer` problem

- The previous session ran for ~38% of the 1M context window. Phase 3 + Phase 4 + their reviews will fit in one session; P2 will not. **Plan compaction breakpoints.** Land each phase as its own commit, push if asked, and consider `/clear` between phases if you're past 50% context.

---

## 6. Files of interest — map of the territory

### Core sync engine

- `packages/podkit-core/src/sync/engine/executor.ts` — `SyncExecutor`. Owns save coordination per ADR-019. Two execution paths (per-op, batch).
- `packages/podkit-core/src/sync/engine/content-type.ts` — `ContentTypeHandler` interface. Music + video implement it.
- `packages/podkit-core/src/sync/engine/types.ts` — shared types (`SyncPlan`, `Warning`, `ExecuteResult`, `WarningSink`).

### Music

- `packages/podkit-core/src/sync/music/pipeline.ts` — `MusicPipeline` (2094 lines, big). Three-stage execution. Phase 3 + 4 work happens here.
- `packages/podkit-core/src/sync/music/handler.ts` — `MusicHandler` extends `ContentTypeHandler`. `executeBatch` (line 1009) wraps `MusicPipeline`.
- `packages/podkit-core/src/sync/music/pipeline.test.ts` — 3000+ lines. Has been updated for ADR-019 phases 1+2; will need more updates for Phase 3.
- `packages/podkit-core/src/sync/music/pipeline.integration.test.ts` — has the new "routes save through engine" test (line 485). Pattern this for Phase 3's integration test.

### Video

- `packages/podkit-core/src/sync/video/handler.ts` — `VideoHandler`. Per-op execution (no pipeline). Already engine-symmetric.
- `packages/podkit-core/src/sync/video/estimation.ts` — was `planner.ts`, renamed.

### CLI

- `packages/podkit-cli/src/commands/sync.ts` — `runSync` orchestrator. Phase calls use `runCollectionPhase`.
- `packages/podkit-cli/src/commands/sync-collection-phase.ts` — the helper from TASK-423.
- `packages/podkit-cli/src/commands/sync-collection-phase.test.ts` — 16 focused unit tests.
- `packages/podkit-cli/src/commands/sync-presenter.ts` — `ContentTypePresenter` interface + `genericSyncCollection`.
- `packages/podkit-cli/src/commands/music-presenter.ts` / `video-presenter.ts` — concrete presenters.

### Architecture + design docs

- `adr/adr-019-music-pipeline-engine-symmetry.md` — the ADR. Update Phase 3+ as they land.
- `documents/architecture/sync/save-transactions.md` — needs updating to reference ADR-019's engine-owned save contract. Do this after Phase 3 (or as part of it).
- `documents/architecture/sync/planning.md` — was updated for the video/planner.ts rename; otherwise still accurate.

### Tests (likely to need updates)

- `packages/podkit-core/src/sync/engine/executor.test.ts` — extensive coverage; the `mockDevice()` factory is the helper to reuse for new tests.
- `packages/podkit-core/src/sync/music/pipeline.test.ts` — has many save-coordination assertions still pinned at pipeline-internal level. Phase 3 will need a similar mechanical update sweep.

---

## 7. How the previous lead used sub-agents (do this)

### Pattern A — Planning Opus before starting

Before touching code, the previous lead dispatched **one** Opus sub-agent to audit + propose a stepped plan. The brief was deliberately self-contained (the sub-agent has no conversation context). It included:

- The current understanding of the problem.
- A specific list of areas to audit (file paths, line ranges).
- Concrete questions to answer (Q1-Q8 format).
- An instruction to push back on the original task description, the prior lead's framing, AND the user's framing if any of them are wrong.
- A word cap (under 1500 words).

The result was a critical second opinion that caught 5+ factual errors in the original TASK-423 description and reframed the symmetry conversation in a way that the previous lead adopted wholesale.

**Reuse for Phase 3 + 4**: dispatch an Opus agent before each phase. Brief shape:

```
You are an Opus sub-agent helping me plan refactor work in `/Users/james/Development/projects/podkit`.

## Background
Read backlog/docs/doc-NNN (this handover doc) sections 3-4 + adr/adr-019-music-pipeline-engine-symmetry.md.
This is Phase 3 of ADR-019. The previous lead audited the pipeline and wrote up findings.

## Read first (read-only, write nothing)
- packages/podkit-core/src/sync/music/pipeline.ts:1240-1260 (the checkpoint save block)
- packages/podkit-core/src/sync/engine/executor.ts:260-275 + :360-375 (engine checkpoints)
- packages/podkit-cli/src/commands/music-presenter.ts:780-800 (where saveInterval would be plumbed)
- packages/podkit-core/src/sync/music/pipeline.test.ts — grep for `saveInterval`

## Return a stepped plan answering
1. Is the previous lead's checkpoint-lift plan still correct, or did the codebase shift?
2. Should saveInterval default change (10 vs 50)?
3. What tests need updating?
4. Anything in the audit that's wrong?

Under 1000 words.
```

### Pattern B — Sonnet review at commit boundaries

After each commit's code is ready but BEFORE committing, dispatch a Sonnet reviewer. Same pattern, different brief:

- Hand it the diff (`git diff main -- <paths>`).
- Tell it what context the commit is in (TASK / ADR phase).
- Ask for specific correctness checks (byte-identical behaviour, missing test pins, etc.).
- Ask for honest pushback with severity tags `[blocker]` / `[bug]` / `[nit]` / `[suggestion]`.
- Cap under 800-1000 words.

In the previous session, Sonnet caught:
- The missing music-end-to-end save test (real coverage gap).
- The `executeMusicPlan` library contract regression (would have shipped a silent break for library users).
- A dead filter branch left behind after the cleanup.

You should action review feedback in the order: blockers → bugs → nits → suggestions, **with judgment**. Not all feedback needs action. The previous lead skipped some style nits (e.g., a proposed rename) when the existing name was already clear.

### Anti-patterns the previous lead avoided

- **Don't farm out the diff** — don't dispatch sub-agents to write the implementation. The user wants you in the diff.
- **Don't run sub-agents in parallel for sequential work** — Phase 3 and Phase 4 should NOT be parallel sub-agents. They share the pipeline file and would conflict.
- **Don't trust sub-agent summaries blindly** — always check the actual diff or the file. The team-lead skill says "trust but verify".

---

## 8. User collaboration preferences observed

These are observations from one session. Treat as priors, not laws.

- **Caveman mode active.** The user has the caveman skill in `full` mode. Keep responses terse (drop articles, fragments OK, technical terms exact). Code/commits/PRs and documents like this one are NOT caveman — those are written normal.
- **Tasks > plans.** When you have a choice, do the work and update the task, don't draft a plan. The user dislikes plan-update cycles.
- **Verbose handover documents = welcome.** This one was explicitly requested ("verbose and detailed"). When the user asks for a doc, give them substance.
- **Honest pushback expected.** The user invited disagreement with task descriptions, framings, and prior recommendations. When you have a real concern, raise it.
- **Smart sequencing matters.** "Sequence smartly" was a user instruction. Don't do work that immediately gets undone by the next step (the previous lead nearly fell into this with the `savesInternally` flag — added it, then removed it within the same commit because Phase 2 superseded Phase 1).
- **Worktrees disabled.** Per memory `feedback_no_worktrees`, run sub-agents in the main directory, not worktrees.
- **Sonnet review before commit.** Per memory `feedback_sonnet_review_before_commit`, dispatch a Sonnet agent for refactor coverage + simplification before committing. Already integrated into the pattern above.
- **No "phase N" suffix in code comments.** Per memory `feedback_code_agnostic_to_tasks`. Reference ADR-019 instead. The previous lead initially wrote "ADR-019 phase 2" everywhere; cleaned it up in response to Sonnet review.

---

## 9. Memory entries to consider adding

The previous lead did not add new memories from this session. Consider whether any of the following are worth saving (use the auto-memory format from your system instructions):

- **`project_adr_019_symmetry.md` (project)** — current Phase status of ADR-019 (1+2 done, 3+4 open, P2 deferred). Update as phases land.
- **`feedback_double_save_audit.md` (feedback)** — the lesson that "music goes through engine" was non-obvious and required reading the executeBatch wrapper to confirm. Saving this might prevent the next lead from making the same wrong initial assumption.

Don't save memories for: the pipeline file paths (derivable from grep), the test counts (will change), the commit hashes (in git).

---

## 10. Quick-start checklist for your first hour

1. Read this entire document.
2. `git log --oneline main..HEAD~10` — confirm the four commits (`8e0fffd9`, `94edb756`, `3ff70a17`, `bddb2406`) are present.
3. Read ADR-019 (`adr/adr-019-music-pipeline-engine-symmetry.md`) end-to-end. Skim the prior lead's design decisions.
4. Run baseline: `bunx turbo run typecheck test:unit lint --filter podkit --filter @podkit/core`. Confirm 3165 unit pass, no fails.
5. Run integration: `bunx turbo run test:integration --filter podkit --filter @podkit/core`. Confirm clean.
6. Decide scope: Phase 3 alone? Phase 3 + 4? Or pause and ask the user?
7. Dispatch the planning Opus sub-agent (Section 7, Pattern A brief).
8. Read its report. Trust but verify any path/line references it surfaces.
9. Implement.
10. Dispatch Sonnet review (Section 7, Pattern B).
11. Action feedback with judgment.
12. Commit. Tell the user. Decide on next phase or stop.

---

## 11. Open questions for the user (queue up for next conversation)

If you get a chance early on, surface these. Otherwise they can wait until the relevant phase needs the decision.

1. **`saveInterval` cadence — engine's 10 or music's 50 after Phase 3?** (Default: 50 = preserve current behaviour. Document either way.)
2. **Music's single-collection header suppression — preserve or align with video?** (Cosmetic; user-visible; debate-worthy.)
3. **Per-batch `MusicArtworkManager` cache invalidation between collections — intentional?** (See Section 4 item 7.)
4. **`executeMusicPlan` library export — keep, deprecate, or mark @internal?** (It now silently differs from the engine path in subtle ways. Library consumers depending on it should be told the contract is best-effort.)
5. **`genericSyncCollection`'s 14 positional args — convert to options-object now or wait?** (The previous lead deferred this in TASK-423. Cost-benefit has shifted now that the helper contains the awkwardness.)

You do not need to answer all of these before working. They're prompts for the next time the user is at the keyboard.

---

Good luck. The pipeline is large and the audit took the previous lead longer than the actual fix. If you're going to make any architectural assumption about how music execution flows, **read the file paths in Section 6 before trusting your mental model**. The previous lead got music's engine integration wrong on the first pass and spent the bulk of the session correcting course.
