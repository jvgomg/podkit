---
id: TASK-396
title: >-
  Warning surface gap: MusicPipeline warnings never reach executor → presenter
  (TASK-380 finding)
status: To Do
assignee: []
created_date: '2026-06-07 10:54'
labels:
  - bug
  - warning-sink
  - pipeline
  - executor
  - music-presenter
  - surface
dependencies: []
references:
  - packages/podkit-core/src/sync/music/handler.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
  - packages/podkit-core/src/sync/engine/executor.ts
  - packages/podkit-cli/src/commands/music-presenter.ts
  - packages/podkit-core/src/device/ipod-adapter.integration.test.ts
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - documents/architecture/sync/error-handling.md
priority: medium
ordinal: 109200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Surfaced by the TASK-380 chmod-fault-fix worker (2026-06-07) while verifying that the chattr-immutable track-readonly fault correctly triggers the typed warning path. The fault triggers correctly — `IpodAdapter.save()` emits a structured `tag-write` Warning into its `WarningSink`. But **the CLI never renders it**.

The wiring gap, traced through the layers:

1. `MusicPipeline.execute()` accumulates execute-phase warnings into a pipeline-local `warnings` array; exposes them via `MusicPipeline.getWarnings()`.
2. `MusicHandler.executeBatch` (`handler.ts:944`) instantiates a **fresh `MusicPipeline` per call** and never re-exposes its `getWarnings()` to the layer above.
3. `SyncExecutor` (the layer the presenter consumes) has no method to surface pipeline-local warnings.
4. `MusicPresenter` (`music-presenter.ts:834`) duck-types `getWarnings()` against the `SyncExecutor`. The duck never quacks — the executor has no such method. The pipeline's warnings get GC'd with the pipeline instance.

Net effect: every soft warning the adapters emit through their `WarningSink` (TASK-381 design) is dropped between the pipeline and the presenter. `SyncOutput.warnings[]` in `--json` mode and the CLI summary's "Warnings:" line are both empty even when warnings did fire.

## Why it stayed hidden

The `ipod-adapter.integration.test.ts:839` test (TASK-381 ACs) inspects the `WarningSink` mock directly — it never exercises the `MusicPipeline → MusicHandler.executeBatch → SyncExecutor → MusicPresenter` chain. The contract was met at the unit-test layer but the integration test stopped one layer short of the presenter.

The save-failure matrix's iPod portable cells (`ipod-noart × mp3 × prefer-copy × portable × track-readonly` and the artwork sibling) are the first tests to exercise the chain end-to-end. They observe `portableTagWarn: expected=true, observed=false` — the warning fires through the sink but never lands on stdout/JSON.

## Adjacent

Related to but DISTINCT from TASK-378's "JSON envelope drops typed-error-class info" finding:
- TASK-378: typed `CategorizedSyncError.causes` doesn't reach `SyncOutput.errors[]`. Hard errors.
- This task: soft `Warning` objects emitted through `WarningSink` don't reach `SyncOutput.warnings[]`. Soft warnings.

Both root-cause to architecture/sync/error-handling.md's "warnings flow through the sink" contract not being honoured end-to-end through the pipeline → executor → presenter layers.

## Investigation needed

1. **Exactly where is the seam broken?** Three candidates:
   - `MusicHandler.executeBatch` should forward `pipeline.getWarnings()` to its caller
   - `SyncExecutor` should grow a `getWarnings()` surface that aggregates across handlers
   - `MusicPresenter` should consume that surface instead of duck-typing
2. **Are video-handler warnings affected the same way?** `VideoHandler.executeBatch` likely has the same pattern.
3. **Is `--json` mode affected?** Likely yes (same presenter consumes the same surface).
4. **Other adapters' warnings**: the mass-storage adapter has `setWarningSink` (TASK-381) but doesn't emit yet. When it does, will those reach the presenter?

## Fix direction

The cleanest fix follows the existing TASK-381 contract:
- `MusicHandler.executeBatch` returns or stashes pipeline warnings into a per-batch accumulator
- `SyncExecutor.getWarnings()` aggregates across all handler batches
- `MusicPresenter` calls `executor.getWarnings()` (no duck typing — typed method)
- `SyncOutput.warnings[]` populated from there in both `--json` and text modes

## Acceptance

- Root cause documented: which seam in handler.ts / executor.ts / music-presenter.ts is broken
- Fix: `MusicPipeline.getWarnings()` reach `SyncOutput.warnings[]` for both CLI text and `--json` modes
- New integration test: pipeline emits a warning → executor → presenter renders it in stdout `Warnings:` line AND `--json` `warnings[]` array
- Save-failure matrix `track-readonly × ipod-{noart,artwork} × mp3 × prefer-copy × portable` cells observe `portableTagWarn: true` and the skipBug fences are removed
- Audit: confirm video-handler warnings + future mass-storage warnings reach the presenter through the same fix
- Update `documents/architecture/sync/error-handling.md` if the responsibility-boundary table needs amending
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Root cause documented: which method on `SyncExecutor` is missing, or which `MusicHandler.executeBatch` seam drops the warnings
- [ ] #2 Fix: `MusicPipeline.getWarnings()` reach `SyncOutput.warnings[]` for both CLI text and `--json` modes
- [ ] #3 New integration test: pipeline emits a warning → executor → presenter renders it in stdout `Warnings:` line AND `--json` `warnings[]` array
- [ ] #4 Save-failure matrix `track-readonly × ipod-{noart,artwork} × mp3 × prefer-copy × portable` cells observe `portableTagWarn: true`; skipBug fences removed
- [ ] #5 Audit `VideoHandler.executeBatch` for the same pattern; fix if broken
- [ ] #6 Confirm mass-storage adapter's WarningSink emissions (when they land) will also reach `SyncOutput.warnings[]` through the same fix path
- [ ] #7 Update `documents/architecture/sync/error-handling.md` responsibility-boundary table to name which layer owns warning forwarding
<!-- AC:END -->
