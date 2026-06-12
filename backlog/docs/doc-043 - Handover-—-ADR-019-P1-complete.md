---
id: doc-043
title: Handover — ADR-019 P1 complete; open questions and follow-ups
type: guide
created_date: '2026-06-13'
tags:
  - handover
  - adr-019
  - tech-debt
  - sync
  - engine
---

## Purpose

ADR-019 P1 (MusicPipeline ↔ engine save / abort coordination symmetry) is complete. This document captures (a) what landed across this stream, (b) the open follow-ups that were intentionally deferred, and (c) the trigger conditions for P2. Read [doc-042](./doc-042%20-%20Handover-—-TASK-423-follow-up-ADR-019-Phase-3.md) for the pre-Phase-3 picture if you need archaeology.

This doc is much shorter than doc-042 because the roadmap is done — what's left is a punch list, not multi-phase work.

---

## 1. What landed in this stream

In chronological order on `main`:

### TASK-423 follow-ups (preceded ADR-019)

- `8e0fffd9` — TASK-423: extract `runCollectionPhase` helper. CLI music+video phase loops collapsed.
- `94edb756` — Rename `video/planner.ts` → `video/estimation.ts`. No behaviour change.
- `3ff70a17` — Engine owns final-save. Introduced a transitional double-save for music (resolved next commit).

### ADR-019 P1 phases

- `bddb2406` — **Phase 1 + 2.** Pipeline's `'updating-db'` yield + final `device.save()` deleted; music persists via the engine's final save. `executeMusicPlan` (library convenience) got its own final save so the "fully persisted" contract survives on the non-engine path.
- `45a21b8e` — **Phase 3.** Pipeline's per-track checkpoint save + orphan `saveInterval` plumbing deleted. Music inherits engine's `saveInterval=10` default (changed from pipeline's historical 50; never benchmarked, never explicitly chosen). New integration test pins checkpoint cadence at engine boundary.
- `0f6f386a` — **Phase 4c.** Removed dead `SyncExecuteOptions.retryConfig` field — declared, never read by any execution path. Music retry policy stays handler-owned via `MusicSyncConfig.retryConfig`.
- `e49db159` — **Phase 4b.** Typed `AbortError` (new class in `engine/errors.ts`). Pipeline throws it after queue drain on signal abort; engine batch + per-op catch blocks recognise it and set `aborted=true` instead of recording a synthetic failure. **Surfaced and fixed a silent contract violation**: `ExecuteResult.aborted` was previously `false` after music abort, masked by `music-presenter.ts` reading `signal.aborted` directly.

### Phases that needed no commit

- **Phase 4a (warning sink)** — verified shared at `pipeline.ts:688` + `handler.ts:1062-1064`. No code change.
- **Phase 5 (`savesInternally` flag deletion)** — N/A. The flag was never merged; the lift was inlined during Phase 1+2.

ADR-019 status: **Accepted**.

---

## 2. What's NOT done (deferred, optional, or open)

### P2 — Pipelined-executor extraction (deferred, multi-session)

**Trigger**: a second content type needs download-overlap. Most plausible triggers:

- Subsonic-style remote-source video collections (cloud-hosted media servers).
- Podcast handler with remote downloads.
- Any handler whose source resolution is materially slower than CPU work.

When triggered:

- Extract `MusicPipeline`'s 3-stage machinery (downloader / preparer / consumer + queue coordination) into `engine/pipelined-executor.ts`.
- Generic over operation type — accepts a `PipelineConfig` with per-stage callables.
- `MusicHandler` and the new handler opt in via a flag like `wantsPipelinedExecution?: boolean` on `ContentTypeHandler`.
- File **ADR-020** when the trigger fires; the queue tuning, abort propagation, and error categorisation across stages are non-trivial and warrant their own decision log.

Until trigger, defer.

### Open questions (from doc-042 §11, still unanswered)

These are not blockers. Surface them when the relevant code is being touched.

1. **Music single-collection header suppression** (`sync.ts:1119`) — music suppresses `=== Music: NAME ===` when only one music collection exists; video always shows it. Align to video, or document the asymmetry?
2. **Per-batch `MusicArtworkManager` cache invalidation between collections** (`handler.ts:1024` creates fresh `MusicPipeline` per batch → fresh artwork caches). Intentional (memory) or bug (re-extraction across collections of same library)? Confirm.
3. **`executeMusicPlan` library export status** — keep public, deprecate, or mark `@internal`? Its contract now subtly differs from the engine path (no checkpoint cadence). JSDoc carries a `@remarks` block; if no external consumers, marking `@internal` would let it evolve without surface concerns.
4. **`genericSyncCollection`'s 14 positional args** (`sync-presenter.ts:392`) — TASK-423 deferred the options-object conversion because the blast radius was disproportionate at the time. Now that the helper contains the awkwardness, the cost-benefit has shifted. Convert next time someone is in `sync-presenter.ts` for any reason.

### Sonnet-suggested follow-ups (Phase 4b)

- **Per-op-path `AbortError` test in `executor.test.ts`** — covers the symmetric per-op catch behaviour. The Phase 4b commit only exercises the batch path. The per-op path's logic is identical and visually obvious from the source, but a unit test would pin it explicitly. Low priority.

### Tech debt from doc-042 §4 (still optional, not actioned this stream)

The 10 items in doc-042 §4 remain as drive-by candidates. Most relevant to ADR-019's footprint:

- **`pipeline.ts` size** (now ~2070 lines after Phase 1+2+3 lifts). The 3-stage queue machinery is the irreducible core. Internal helpers (`getPhaseForOperation`, `categorizeError`, per-stage class privates) could move to sibling files for module-boundary clarity. Natural cut points exist now that save coordination + abort + warning sink are no longer pipeline concerns. Deferred.
- **`pipeline.test.ts` size (~3000 lines)** — the audit during this stream confirmed the test file's save-related assertions are correctly scoped (most pin "no save" because save is engine-owned). The broader question of which tests should move to integration / engine-level isn't critical post-P1.
- **Three `ResolvedCollection` interfaces with the same shape** (`sync.ts:200`, `sync-presenter.ts:80`, `music-presenter.ts:99`, `video-presenter.ts:40`) — trivial dedup, export from `sync.ts` only. Drive-by candidate.

---

## 3. What is now correct vs what was correct-by-coincidence

This section is for the next contributor — what assumptions can you now safely make?

### Safe to rely on

- **`ExecuteResult.aborted` is honest** for both music and video. Pre-Phase-4b, music returned `aborted=false` after any user-cancel and `music-presenter.ts:850` papered over it. Now `aborted=true` flows correctly through every consumer that reads it.
- **The engine owns ALL save coordination** for music. `MusicPipeline.execute` never calls `device.save()` directly. The only exception is `executeMusicPlan` (library convenience that bypasses the engine entirely) — and that path is documented in JSDoc.
- **`MusicPipeline.execute` throws typed `AbortError`** on signal abort, not a bare string-matched `Error`. Tests should assert `instanceof AbortError`, not `.message === 'Sync aborted'`.
- **The engine's `saveInterval=10` is the music default now**, not 50. If you see "music does ~5× more DB rewrites than I remember", this is why; if it surfaces as a perf concern, ADR-020 (or a config knob in a separate ADR) is the answer.

### Still load-bearing (don't break casually)

- **`MusicHandler.bridgeProgress` maps every successful pipeline event to `phase: 'complete'`**. The engine's checkpoint cadence depends on this. If the bridge changes, audit `engine/executor.ts:373` and the Phase 3 integration test.
- **Music's three-stage pipeline (downloader / preparer / consumer)** is the actual valuable thing in `MusicPipeline`. P2 may extract it; until then, the cross-stage queue coordination is the most subtle part of the file. The abort propagation in particular took two passes to land — see the Phase 4b commit for what NOT to change at the leaf abort-observation sites (only the post-`Promise.all` outer guard's throw type changed; the in-stage `break` sites stayed).
- **`music-presenter.ts:832-852`'s belt-and-suspenders `signal?.aborted` checks** stay. They handle generator-level exceptions that escape the `for await` and the race where the signal fires between the last `yield` and the engine's `return`. Removing them would tighten the presenter's dependency on `result.aborted` but the presenter doesn't actually consume `result` directly — it iterates events and builds its own `interrupted` flag.

---

## 4. Patterns that worked (do this if you continue)

This section deliberately mirrors doc-042 §7. The patterns that worked for the prior lead worked again this session — no need to reinvent.

### Pattern A — Opus planner before each phase

For Phase 3 and Phase 4b, an Opus sub-agent was dispatched before any code change. The brief:

- Concrete read-list with file:line ranges.
- Numbered audit questions (Q1-Q9 shape).
- Explicit invitation to push back on the handover, the prior session, and my framing.
- Word cap (~1000-1500).

In both cases the Opus pass caught material gaps:
- Phase 3: clarified that `saveInterval` was a 1-line plumb-or-delete decision, not a multi-call-path lift.
- Phase 4b: surfaced the silent `result.aborted=false` bug. The phase was reframed from "stylistic symmetry" to "bug fix in symmetry's clothing".

### Pattern B — Sonnet review before commit

After implementation, before `git commit`, dispatch a Sonnet reviewer with the diff in context. Tag findings `[blocker]/[bug]/[nit]/[suggestion]`.

In this session Sonnet caught:
- Phase 3: one optional JSDoc improvement (added).
- Phase 4b: a real concurrent-failure swallow case in the engine's catch — split the AbortError-vs-signal-aborted check so non-AbortError failures during the abort window are preserved in `result.errors`.

### Anti-patterns (consistent with doc-042)

- Don't farm out the diff. The user wants you in the implementation.
- Don't run Opus + Sonnet in parallel for the same phase — review is meant to be adversarial to the *finished* diff.
- Don't trust sub-agent summaries blindly — verify against the actual file or the actual diff.
- Don't update plans / write "what I'll do next" docs when you can just do the thing.

---

## 5. User preferences observed (delta from doc-042)

Doc-042 §8 captured the priors. Restating only what was confirmed or refined this session:

- **Caveman mode stays on** (per session-start hook). Code, commits, and documents (including this one) are written normal.
- **"Do work, don't plan"** held throughout. The user said "continue work" twice; I made the saveInterval-default decision via a single AskUserQuestion instead of writing up a planning doc.
- **Decisions get surfaced briefly, not deferred to user-as-decider-of-everything**. For Phase 4c I auto-decided "delete dead surface" rather than asking; user accepted. For the `saveInterval=10 vs 50` decision I did ask, because the Opus audit and the handover disagreed and the choice was actually user-facing. Heuristic: ask when reasonable people disagree on user-visible impact; decide silently when the answer is "obviously the smaller change".
- **Sub-agent review before commit** (per memory `feedback_sonnet_review_before_commit`) — dispatched for both substantive phases (3 and 4b). Skipped for the trivial 4c deletion. Judgement call worked.
- **No "phase N" / task-ID suffix in code comments** (per memory `feedback_code_agnostic_to_tasks`). All comments in this stream reference "ADR-019" or "ADR-019 Phase 4b" only where the phase identifies a known surface (commit messages). Code comments say "ADR-019".

---

## 6. Memory entries worth adding (recommendation)

The previous lead recommended (and did not add) `project_adr_019_symmetry.md` and `feedback_double_save_audit.md`. Neither is needed now:

- `project_adr_019_symmetry.md` — would track in-flight phase status. P1 is done; the ADR itself is the source of truth. Memory would just become stale.
- `feedback_double_save_audit.md` — the lesson "music goes through engine" is now load-bearing convention (per save-transactions.md and ADR-019). Anyone reading either doc gets it.

Potential addition worth considering:
- `feedback_handover_doc_pattern.md` — that handover docs accelerated this stream measurably (Phase 3 + 4b both had concrete audit findings ready to action), and the cost was one file written at the end of each session. Worth saving as a pattern recommendation.

Optional. Don't write it if it doesn't survive your own "would I read this in 30 days?" filter.

---

## 7. Quick-start checklist (if you're picking up next)

If the trigger condition for P2 fires:

1. Read [adr/adr-019-music-pipeline-engine-symmetry.md](../../adr/adr-019-music-pipeline-engine-symmetry.md) end-to-end. Read this doc.
2. File `ADR-020` with the new content type's requirements before touching code. Pipelined-execution extraction has a real design surface (queue depths, abort propagation across stages, retry semantics) that benefits from being written down first.
3. Dispatch an Opus planning pass on the extraction. The 3-stage abort coordination is the hardest part of MusicPipeline; if it doesn't survive the extraction cleanly, the abstraction is wrong.

If you're picking up one of the open follow-ups from §2:

1. Find the surface — most are 1-3 file changes.
2. Make the change. If it touches the engine-handler boundary, run integration tests (`bun run test:integration --filter @podkit/core`).
3. Update ADR-019 only if the change affects a documented contract.

If you're just here for general podkit work:

1. Read [AGENTS.md](../../AGENTS.md).
2. Read [documents/architecture/README.md](../../documents/architecture/README.md) and the per-subsystem doc for the area you're touching.
3. The ADR-019 stream is done. You don't need to know it intimately unless the work is in `sync/engine/` or `sync/music/`.

---

## 8. Files of interest

### Final state after this stream

- `packages/podkit-core/src/sync/engine/executor.ts` — `SyncExecutor`. Owns save coordination (final + checkpoint) and the typed abort protocol for both content types.
- `packages/podkit-core/src/sync/engine/errors.ts` — `AbortError` class (Phase 4b).
- `packages/podkit-core/src/sync/music/pipeline.ts` — `MusicPipeline`. Three-stage execution. No longer calls `device.save()` from `execute()`; throws typed `AbortError` on signal abort. `executeMusicPlan` (library convenience) keeps a final save for its non-engine callers.
- `packages/podkit-core/src/sync/music/handler.ts` — `MusicHandler.executeBatch`. The bridge: wraps `MusicPipeline.execute`, maps progress events to engine's `phase: 'complete'` protocol, drains warnings into `ctx.warningSink`.
- `packages/podkit-core/src/sync/music/pipeline.integration.test.ts` — has both the Phase 3 checkpoint-cadence test and the Phase 4b abort-routing test.
- `adr/adr-019-music-pipeline-engine-symmetry.md` — the ADR. Status: Accepted.
- `documents/architecture/sync/save-transactions.md` — companion architecture doc. Phase 4b update reflects engine-owned save coordination.

### Stable but worth knowing

- `packages/podkit-core/src/sync/engine/content-type.ts` — `ContentTypeHandler` interface. No `savesInternally` flag (never merged).
- `packages/podkit-core/src/sync/video/handler.ts` — `VideoHandler`. Per-op execution; the engine-symmetric counterpart to music.
- `packages/podkit-cli/src/commands/music-presenter.ts` — keeps belt-and-suspenders `signal?.aborted` checks at lines 832-852. Now redundant with `result.aborted` but covers generator-level exception cases that don't go through the engine's return value.

---

Good luck. The 4-commit P1 stream took about half a session start-to-finish for Phase 3+4b+4c — most of that was the Phase 4b bug investigation. If you do P2, plan on it being several sessions and at least one ADR.
