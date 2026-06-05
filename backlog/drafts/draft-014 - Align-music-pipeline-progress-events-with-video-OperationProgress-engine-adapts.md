---
id: DRAFT-014
title: >-
  Align music pipeline progress events with video (OperationProgress, engine
  adapts)
status: Draft
assignee: []
created_date: '2026-06-05 19:37'
labels:
  - refactor
  - music-pipeline
  - video-pipeline
  - music-video-symmetry
dependencies: []
references:
  - packages/podkit-core/src/sync/music/pipeline.ts
  - packages/podkit-core/src/sync/music/handler.ts
  - packages/podkit-core/src/sync/video/handler.ts
  - packages/podkit-core/src/sync/engine/executor.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-383's symmetry pass identified that:

- **Music**: `MusicPipeline.execute` yields rich `ExecutorProgress` events directly. These are consumed by `MusicHandler.executeBatch` which bridges them to `OperationProgress`.
- **Video**: `VideoHandler` yields lean `OperationProgress` events; the engine's `executeBatch` does the adaptation to `ExecutorProgress`.

The music pipeline carries the engine's responsibilities (translating to executor-shape events) inside the pipeline. Video doesn't. The video shape is cleaner — pipelines yield operation-level progress, the engine adapts.

## Scope

Migrate music to the video shape:

1. `MusicPipeline.execute()` yields `OperationProgress<MusicOperation>` events instead of `ExecutorProgress`.
2. `MusicHandler.executeBatch` drops the bridging logic; the engine's `SyncExecutor.executeBatch` (already in place for video) adapts the music events to `ExecutorProgress`.
3. Update progress-consuming tests in `pipeline.test.ts` to assert against the new shape.

## Concerns

- The pipeline's three-stage prefetch/prepare/consumer events (`phase: 'preparing'`, etc.) currently carry richer info than the operation-progress shape allows. Need to confirm the lean shape is sufficient. If not, the lean shape may need an `OperationPhase` extension to preserve fidelity.
- Test surface impact is medium. Every test that does `for await (const p of executor.execute(plan))` and inspects `p.phase` may need updates.

## Acceptance criteria

- Music pipeline yields `OperationProgress<MusicOperation>` events.
- Engine bridges to `ExecutorProgress` (or whichever shape downstream consumers expect).
- Tests green; no behaviour change in the CLI's progress display.

## Reference

- TASK-383 Phase 3 symmetry finding (Worker's recommended follow-up #2).
- Decided 2026-06-05 in team-lead session.
<!-- SECTION:DESCRIPTION:END -->
