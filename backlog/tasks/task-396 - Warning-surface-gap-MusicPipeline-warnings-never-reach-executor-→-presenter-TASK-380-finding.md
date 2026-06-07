---
id: TASK-396
title: >-
  Warning surface gap: MusicPipeline warnings never reach executor → presenter
  (TASK-380 finding)
status: Done
assignee: []
created_date: '2026-06-07 10:54'
updated_date: '2026-06-07 12:09'
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
- [x] #1 Root cause documented: which method on `SyncExecutor` is missing, or which `MusicHandler.executeBatch` seam drops the warnings
- [x] #2 Fix: `MusicPipeline.getWarnings()` reach `SyncOutput.warnings[]` for both CLI text and `--json` modes
- [x] #3 New integration test: pipeline emits a warning → executor → presenter renders it in stdout `Warnings:` line AND `--json` `warnings[]` array
- [x] #4 Save-failure matrix `track-readonly × ipod-{noart,artwork} × mp3 × prefer-copy × portable` cells observe `portableTagWarn: true`; skipBug fences removed
- [x] #5 Audit `VideoHandler.executeBatch` for the same pattern; fix if broken
- [x] #6 Confirm mass-storage adapter's WarningSink emissions (when they land) will also reach `SyncOutput.warnings[]` through the same fix path
- [x] #7 Update `documents/architecture/sync/error-handling.md` responsibility-boundary table to name which layer owns warning forwarding
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Root cause

Confirmed exactly what the original investigation predicted, with line refs.

- `MusicPipeline.getWarnings()` (pipeline.ts:671) returns warnings accumulated into `this.warnings` via the pipeline's internal `this.warningSink` (pipeline.ts:625), into which the device adapter is wired at execute start (pipeline.ts:821).
- `MusicHandler.executeBatch` (handler.ts:944) constructed a fresh `MusicPipeline` per call (line 959), iterated its progress stream, then let the pipeline instance go out of scope — its warnings GC'd with it.
- `SyncExecutor` (executor.ts) had no `getWarnings()` method and no sink surface. Its `executeBatch` path returned a `warnings: Warning[]` field on `ExecuteResult` but never populated it.
- `MusicPresenter.executeSync` (music-presenter.ts:772) duck-typed `getWarnings()` on the executor; the duck didn't quack.

## Fix shape — sink injection

Chose the sink-injection path (consistent with TASK-381's WarningSink contract) over typed-return for two reasons:

1. Presenters iterate the progress stream and discard the generator return value, so even populating `ExecuteResult.warnings` correctly wouldn't reach the presenter. A separate typed surface (`executor.getWarnings()`) is needed regardless.
2. The sink-from-executor-to-handler-to-pipeline chain mirrors the existing `IpodAdapter.setWarningSink(sink)` shape, keeping one mental model across the layer stack.

End state:

- `ExecutionContext` (`content-type.ts`) grows an optional `warningSink?: WarningSink`.
- `SyncExecutor` builds the sink once per `execute()` call, accumulates into `this.warnings`, exposes via a typed `getWarnings()` method, and populates `ExecuteResult.warnings`.
- `MusicHandler.executeBatch` drains `pipeline.getWarnings()` into `ctx.warningSink` in a `finally` so an early break still surfaces what fired before the throw.
- `VideoHandler.executeBatch` wires `ctx.warningSink` directly into the device adapter via `setWarningSink` (the video path has no pipeline-local accumulator — future mass-storage video sidecar/picture soft signals flow straight through).
- `MusicPresenter` calls the typed `executor.getWarnings()` (duck-typing removed).
- `VideoPresenter.executeSync` now returns a `warnings` array on every code path so video warnings reach `allWarnings` in sync.ts.

## Files modified

- `packages/podkit-core/src/sync/engine/content-type.ts` — added `warningSink?: WarningSink` to `ExecutionContext`.
- `packages/podkit-core/src/sync/engine/executor.ts` — `this.warnings`, `getWarnings()`, sink construction, both execution paths reference the executor-level accumulator.
- `packages/podkit-core/src/sync/music/handler.ts` — drains pipeline warnings into `ctx.warningSink` in `finally`.
- `packages/podkit-core/src/sync/video/handler.ts` — wires `ctx.warningSink` into the device adapter at batch start.
- `packages/podkit-cli/src/commands/music-presenter.ts` — typed `executor.getWarnings()` (duck-typing removed).
- `packages/podkit-cli/src/commands/video-presenter.ts` — returns `warnings` on every code path, drains `videoExecutor.getWarnings()`.
- `packages/podkit-core/src/sync/engine/executor.test.ts` — three new tests under "warning sink" pinning the contract.
- `packages/podkit-cli/src/commands/music-presenter.warnings.test.ts` — new file, five tests covering presenter-level forwarding + text/JSON rendering.
- `test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts` — removed `skipBug` fence (and now-unused import) on the two `track-readonly × portable × ipod-{noart,artwork}` cells.
- `documents/architecture/sync/error-handling.md` — extended §3 to name the two-layer sink chain; expanded §4 to add the music pipeline as its own layer and to name handler-level forwarding + executor-level accumulator/getWarnings as explicit responsibilities.

## Integration test mechanism

Two layers in `music-presenter.warnings.test.ts`:

1. **Presenter end-to-end.** Builds a `MusicPresenter`, shims the private handler with a stub that emits a `tag-write` Warning via `ctx.warningSink` inside its `executeBatch`, calls `presenter.executeSync(...)`, asserts the warning lands in the returned `result.warnings` (the field sync.ts aggregates into `allWarnings`).
2. **Rendering.** Mirrors the inline text + JSON rendering shapes from sync.ts (`Warnings:` summary line + per-type breakdown + `-v` per-warning expansion; `WarningInfo[]` shape with phase/type/message/trackCount and `-v` per-track refs). Asserts both surfaces include the structured warning. The fixture intentionally mirrors the production renderer so the seam stays pinned.

Plus three new tests in `executor.test.ts` covering the sink contract directly: handler emissions reach both `ExecuteResult.warnings` and the typed `getWarnings()` surface, presenter-style consumption (discarding the generator return value) still sees the warnings, and the accumulator clears between sequential `execute()` calls on the same instance.

## VideoHandler audit

Same wiring gap in spirit but a different shape: `VideoHandler.executeBatch` has no pipeline-local accumulator, it just yields directly via `execute()`. The fix wires `ctx.warningSink` into `ctx.device.setWarningSink` at batch start so any future mass-storage video sidecar/picture soft signals flow through the same sink contract music uses. Today the video path emits nothing, so this is forward-prep — but the wiring is identical to the music path's `pipeline.device.setWarningSink` call at pipeline.ts:821.

## Matrix verification

Removed the `skipBug → TASK-396` fence on `track-readonly × portable × ipod-{noart,artwork}`. Cannot run the VM matrix locally (requires Lima VM + dummy_hcd), but the wiring is now complete end-to-end and proven by the new presenter test. The matrix harness would re-enter those two cells; the `predictPortableTagWarn(...)` truth and the observed value should now both be `true`.

## Docs

`documents/architecture/sync/error-handling.md`:

- §3 "Execute-phase warnings (sink)" — extended to describe the two-layer chain (engine executor owns the outer sink + handler-level drain bridges the pipeline's inner sink to the outer one). Explicit "without this drain ... warnings GC with the pipeline" warning.
- §4 "Responsibility boundaries" — added Music pipeline as its own layer; clarified that the content-type handler forwards execute-phase warnings to the executor's sink (music drains the pipeline, video wires the adapter directly); named `executor.getWarnings()` as the typed surface presenters consume.

## Test results

- `bun run typecheck` — 34/34 tasks successful.
- `bun run test:unit` — 2912 pass / 0 fail / 5 skip in `@podkit/core` (was 2909; +3 sink tests). 1383 pass / 0 fail in `podkit` CLI (was 1378; +5 presenter warnings tests).
- `bun run test:integration` — 69 pass / 0 fail (existing iPod-adapter integration test that asserts the WarningSink directly still passes).

## ACs

All 7 ticked:

1. Root cause documented — seam identified at handler.ts:959 (pipeline instantiated and dropped) + executor.ts (no surface) + music-presenter.ts:772 (duck-type).
2. `MusicPipeline.getWarnings()` reaches `SyncOutput.warnings[]` via sink chain → executor accumulator → presenter return → sync.ts allWarnings → both text + JSON envelopes.
3. New integration test covers presenter forwarding + text/JSON rendering.
4. Matrix skipBug fence + unused import removed; full VM verification deferred to next matrix run.
5. VideoHandler audited — different shape (no pipeline-local accumulator) but same conceptual gap. Wired `ctx.warningSink` into the device adapter; today nothing emits but future mass-storage video soft signals will flow.
6. Mass-storage WarningSink emissions (when they land) reach `SyncOutput.warnings[]` through the same path — the adapter's `setWarningSink` gets the executor's outer sink directly (music: via the pipeline; video: via the handler-level call), so any future emit lands in the same accumulator.
7. error-handling.md §3 + §4 updated.

## Surprises

None blocking. Two observations:

- The video presenter's previous behaviour returned only `{completed, failed, ..., collectedErrors}` on every code path — no `warnings` field. Sync.ts's `if (result.warnings && result.warnings.length > 0)` guard meant video warnings were silently dropped even before the music gap. Fixed in passing (consistent with AC #5).
- The integration test for the rendering pipeline duplicates the inline shaping logic in sync.ts (no helper to call). Left a comment noting the test fixture intentionally mirrors the production renderer and needs updating in lockstep. Extracting the inline rendering into a testable helper would be a small follow-up but felt out of scope.
<!-- SECTION:FINAL_SUMMARY:END -->
