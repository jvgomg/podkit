---
id: TASK-422
title: Phase-decompose runSync (~800 LoC orchestrator → testable phase functions)
status: To Do
assignee: []
created_date: '2026-06-12 10:54'
updated_date: '2026-06-12 10:58'
labels:
  - tech-debt
  - refactor
  - cli
  - sync
dependencies:
  - TASK-420
references:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/sync-presenter.ts
  - packages/podkit-cli/src/commands/sync-output-types.ts
  - packages/podkit-cli/src/commands/sync-summary-render.ts
ordinal: 137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from TASK-420. The sync.ts JSON envelopes + summary render are out, but `runSync` itself is still ~800 LoC of intertwined orchestration. The natural shape is a sequence of phases, each independently testable.

## Problem

`packages/podkit-cli/src/commands/sync.ts runSync` (currently ~lines 600-1410) does too many distinct things in one async function:

1. Parse + validate the CLI options
2. Resolve sync targets (device, collections, transforms, decisions) — spans pre-load + post-auto-match re-derive
3. Open the device, run preflight (free space, debris/phantom cleanup)
4. Loop over music collections + accumulate results
5. Loop over video collections + accumulate results (near-identical structure — see TASK-423)
6. Render the summary + emit JSON envelope
7. Optionally eject

Each phase reads + mutates shared state inline. The function ends up as one long state machine that's hard to navigate, hard to test in isolation, and hard to extend (adding a new phase or reordering existing ones means editing the middle of an 800-LoC function).

## Proposed shape (illustrative — names not prescriptive)

Decompose into phase functions. The type names below are **illustrative** — pick whatever shape the threaded state actually wants. What matters is the *decomposition*, not the labels:

```ts
function parseAndValidateSyncOptions(options, config): SyncRunConfig
async function resolveSyncTargets(runConfig, deps): Promise<ResolvedSync>
async function runSyncPreflight(targets, deps): Promise<PreflightResult>
async function runMusicPhase(targets, preflight, deps): Promise<PhaseResult>
async function runVideoPhase(targets, preflight, deps): Promise<PhaseResult>
function buildSyncOutput(targets, results, duration): SyncOutput
async function maybeEjectDevice(targets, results, deps): Promise<EjectResult>
```

`runSync` becomes the conductor calling these in sequence, threading state forward. Each phase is independently unit-testable against the upstream return shape.

The "music + video phase collapse" (TASK-423) lands as a primitive that `runMusicPhase` + `runVideoPhase` delegate to — see "Sequencing" below.

## Hidden complexity to flag for the picker-up

**`resolveSyncTargets` is the hardest cut.** Looking at the current `runSync`:

- Device settings are derived BEFORE collections resolve (`deriveSettings` ≈ lines 434-560)
- `deriveSettings` may be called AGAIN after auto-detection completes (≈ lines 616-635)
- `decisions` (via `buildSyncDecisions`) is built PER-COLLECTION inside the music loop (≈ lines 1055-1093), not once up-front

Don't assume `resolveSyncTargets` is one tidy synchronous call. Expect to either:
(a) split it into `resolveDeviceSettings` + `resolveCollectionTargets` (two sub-phases), or
(b) leave the post-auto-match re-derive in the conductor as a step between resolve and preflight

Either is fine; pick whichever produces cleaner intermediate types.

## Scope guidance

- This is a **structural refactor, not a behaviour change**. `sync.test.ts` line-for-line text output must remain unchanged.
- Don't pre-optimise the phase boundaries to be perfect — the right granularity emerges as you extract. Start with the obvious cuts (parse → resolve → preflight → run → finalize) and let the threaded state shape itself.
- Each phase function ends up testable independently; new focused tests are encouraged but not required for every phase as long as `sync.test.ts` + the integration suite cover the composition.
- Don't refactor `MusicPresenter` / `VideoPresenter` (see `packages/podkit-cli/src/commands/sync-presenter.ts`) — they're the per-collection layer below this and should stay where they are.

## Pointers (since the task references several constructs by name)

- `genericSyncCollection`, `MusicPresenter`, `VideoPresenter`, `ContentTypePresenter` → `packages/podkit-cli/src/commands/sync-presenter.ts`
- `buildSyncDecisions`, `SyncDecisions` → `packages/podkit-cli/src/commands/sync-decisions.ts`
- `SyncOutput` + JSON envelopes → `packages/podkit-cli/src/commands/sync-output-types.ts`
- `printSuccessSummary`, `printInterruptedSummary` → `packages/podkit-cli/src/commands/sync-summary-render.ts`

## What this enables

- Adding a new phase (e.g. pre-sync diff cache, post-sync verification) becomes a single function insert at the call site rather than surgery in the middle of `runSync`.
- Each phase can grow / get extracted to its own file when it justifies it. Today's monolith makes "what should be a file" invisible.
- JSON envelope assembly (`buildSyncOutput`) lifts to a pure function, easy to snapshot-test against fixture inputs.

## Constraints / non-goals

- **Behaviour-preserving**: `sync.test.ts` is the regression gate. Snapshot output unchanged.
- **No new commander options or JSON envelope fields**.
- Don't extract `MusicPresenter` / `VideoPresenter` — out of scope.
- Don't unify with the doctor command's flow — sync and doctor are deliberately separate orchestrators.
- **Do not move the `shutdown.install()` / `shutdown.uninstall()` boundary out of `runSync`'s top-level scope.** The shutdown controller's lifecycle covers the entire orchestrator; relocating its install/uninstall inside a phase would silently break interrupt handling for phases that run before/after.
- **Resource cleanup must stay in the conductor's `finally` block.** `adapter.close()`, `lockHandle.release()`, and any other resource releases are acquired during preflight but must be released at the end of `runSync` regardless of which phase threw. Don't push the release into a phase's own finally — that fragments lifecycle.
- Don't change the dynamic `@podkit/core` import approach (kept for cold-start latency on the read-only commands; sync is no exception).

## Suggested PR ordering

1. **PR 1**: Extract `parseAndValidateSyncOptions` (pure-function-shaped, no I/O). Smallest cut.
2. **PR 2**: Extract `resolveSyncTargets`. *Expect to split into two sub-steps* (see "Hidden complexity" above); the re-derive after auto-detection may stay in the conductor as the bridge between resolve and preflight.
3. **PR 3**: Extract `runSyncPreflight`. The free-space + debris-cleanup block.
4. **PR 4**: Extract `runMusicPhase` + `runVideoPhase` as named functions. **Land TASK-423 first** so PR 4 extracts a single thin wrapper instead of duplicating the same extraction across two functions that TASK-423 will then merge.
5. **PR 5**: Extract `buildSyncOutput` (pure function) + `maybeEjectDevice`.

Each PR independently revertable; each leaves `runSync` shorter than before.

## References

- `packages/podkit-cli/src/commands/sync.ts` — the orchestrator (currently 1416 LoC)
- `packages/podkit-cli/src/commands/sync-presenter.ts` — per-collection class-based render (out of scope; home of `MusicPresenter`, `VideoPresenter`, `ContentTypePresenter`, `genericSyncCollection`)
- `packages/podkit-cli/src/commands/sync-decisions.ts` — `buildSyncDecisions` + `SyncDecisions` type
- `packages/podkit-cli/src/commands/sync-output-types.ts` — JSON envelope types
- `packages/podkit-cli/src/commands/sync-summary-render.ts` — orchestrator-level summary helpers
- TASK-345 final summary — context on the original primitive extraction
- TASK-420 final summary — context on why this was deferred
- TASK-423 — the music+video loop collapse, complementary to this work (preferred to land before PR 4)

## Acceptance Criteria
<!-- AC:BEGIN -->
Listed below.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 runSync's body contains only phase calls and their return-value bindings; no inline business logic block exceeds ~5 lines
- [ ] #2 Each phase function lives in sync.ts or a sibling file (sync-phases.ts is fine; or per-phase modules if size justifies)
- [ ] #3 Phase functions thread structured intermediate types rather than mutating shared state. The exact type names are illustrative — pick whatever shape fits the actual threaded data; what matters is that state flows by parameter, not by closed-over mutable variables
- [ ] #4 buildSyncOutput (or its equivalent) is a pure function — given (targets, results, duration), returns a SyncOutput; no I/O, no side effects, snapshot-testable
- [ ] #5 Focused unit tests added for: parseAndValidateSyncOptions, resolveSyncTargets, runSyncPreflight, and buildSyncOutput — each covering happy path + at least one edge case
- [ ] #6 sync.test.ts text + JSON output is line-for-line unchanged before/after the entire decomposition
- [ ] #7 shutdown.install() / shutdown.uninstall() stays at the conductor (runSync) scope; no phase owns the lifecycle
- [ ] #8 Resource cleanup (adapter.close(), lockHandle.release(), etc.) stays in runSync's finally block; no phase pushes release into its own finally
<!-- AC:END -->

- [ ] #9 bun run typecheck / bun run test / bun run lint all pass
- [ ] #10 No new commander options or JSON envelope fields added
<!-- AC:END -->
