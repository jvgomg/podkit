---
id: TASK-423
title: Collapse music+video collection loops in runSync
status: To Do
assignee: []
created_date: '2026-06-12 10:55'
updated_date: '2026-06-12 10:59'
labels:
  - tech-debt
  - refactor
  - cli
  - sync
dependencies:
  - TASK-420
references:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/music-presenter.ts
  - packages/podkit-cli/src/commands/video-presenter.ts
ordinal: 138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from TASK-420. The two collection loops inside `runSync` share ~75% structure and were deliberately left untouched in that task.

## Problem

`packages/podkit-cli/src/commands/sync.ts` has near-identical loops for music (currently ~lines 1131-1175) and video (currently ~lines 1205-1244). Both:

1. Iterate over the collection list
2. Build a type-specific content config (`MusicContentConfig` / `VideoContentConfig`)
3. Call `genericSyncCollection(presenter, out, collection, sourcePath, devicePath, dryRun, removeOrphans, config, adapter, core, signal, shutdown, undefined, preliminaries)`
4. Emit JSON on `result.jsonOutput && out.isJson`
5. Accumulate `totalCompleted`, `totalFailed`, `allWarnings`, `allErrors`, `anyError`
6. Handle `result.interrupted`: save device DB (non-dry-run), print "Sync interrupted." or "Video sync interrupted.", `setExitCode(130)`, break

The actual divergence is small:
- Music block has extra accumulators: `totalArtworkMissingBaseline`, `totalTransferModeMismatch`
- Music's interrupt message says `"Sync interrupted."`; video's says `"Video sync interrupted."`
- Each loop instantiates its own presenter (`new MusicPresenter()` / `new VideoPresenter()`) and its own content-config shape
- Video has a `supportsVideo` gate before the loop opens

## Proposed shape

Extract a single `runCollectionPhase` helper. Key design points to commit to up-front (the original task draft left these open; the picker-up needs concrete answers):

### `CollectionPhaseInput`

The music content config (`musicConfig`) is built OUTSIDE the loop, ≈ line 1099, capturing 15+ outer-scope variables (`effectiveQuality`, `effectiveTransferMode`, `decisions`, `transcoder`, `resolvedLossyCodec`, etc.). Pre-build the config at the call site and pass it in directly — do NOT thread it as a `(collection) => Config` closure. The closure shape would either capture the entire outer scope (defeating the abstraction) or force every captured variable into explicit parameters (noisy).

```ts
interface CollectionPhaseInput<TConfig extends MusicContentConfig | VideoContentConfig> {
  kind: 'music' | 'video';
  collections: ResolvedCollection[];
  presenter: ContentTypePresenter<...>;
  /** Pre-built content config. The caller assembles it outside the loop. */
  contentConfig: TConfig;
  preSyncPreliminaries: PlanPreliminaries | undefined;
}
```

### `deps` — fully enumerated

```ts
interface CollectionPhaseDeps {
  out: OutputContext;
  adapter: DeviceAdapter;
  core: typeof import('@podkit/core');
  shutdown: ShutdownController;
  signal: AbortSignal;
  dryRun: boolean;
  removeOrphans: boolean;
  devicePath: string;
}
```

### `CollectionPhaseResult` — discriminated union, not loose `Record`

```ts
type CollectionPhaseResult =
  | {
      kind: 'music';
      completed: number;
      failed: number;
      warnings: Warning[];
      errors: CategorizedError[];
      anyError: boolean;
      interrupted: boolean;
      artworkMissingBaseline: number;
      transferModeMismatch: number;
    }
  | {
      kind: 'video';
      completed: number;
      failed: number;
      warnings: Warning[];
      errors: CategorizedError[];
      anyError: boolean;
      interrupted: boolean;
    };
```

This is consistent with the strict-TypeScript conventions elsewhere in the codebase — the music-specific accumulators are typed, not stringly-accessed via `extra?.foo`.

### The `preliminariesConsumed` one-shot flag

`runSync` has a `preliminariesConsumed` boolean (≈ line 1126 for music, ≈ line 1199 for video) that ensures the pre-sync sweep's `PlanPreliminaries` are passed to the FIRST collection only — subsequent collections get `undefined`. After the music phase consumes them, the video phase must NOT see them again. Two options:

- **(Recommended)** Have the caller flip the flag between music and video calls. The helper accepts `preSyncPreliminaries: PlanPreliminaries | undefined` and uses it for the first iteration only, returning a `consumedPreliminaries: boolean` field so the caller knows whether to clear its flag.
- Pass a callback or shared state object. Avoid — leaks the cross-phase concern into the helper's interface.

Either way, the helper itself uses the preliminaries on the first iteration of its own loop and passes `undefined` to subsequent iterations.

## Caller composition

```ts
const musicResult = await runCollectionPhase({
  kind: 'music',
  collections: musicCollections,
  presenter: new MusicPresenter(),
  contentConfig: musicConfig,  // pre-built above
  preSyncPreliminaries: preliminariesConsumed ? undefined : preSyncPreliminaries,
}, deps);
preliminariesConsumed ||= musicResult.consumedPreliminaries;
totalCompleted += musicResult.completed;
totalFailed += musicResult.failed;
totalArtworkMissingBaseline += musicResult.kind === 'music' ? musicResult.artworkMissingBaseline : 0;
// ...etc

if (hasVideoToSync && !shutdown.isShuttingDown) {
  if (!deviceCapabilities?.supportsVideo) { /* existing gate */ }
  else {
    const videoResult = await runCollectionPhase({
      kind: 'video', collections: videoCollections, presenter: new VideoPresenter(),
      contentConfig: videoConfig,
      preSyncPreliminaries: preliminariesConsumed ? undefined : preSyncPreliminaries,
    }, deps);
    // accumulate
  }
}
```

The interrupted-message wording is selected inside the helper by `kind`:

```ts
const interruptedMessage = input.kind === 'music' ? 'Sync interrupted.' : 'Video sync interrupted.';
```

## Why this was deferred from TASK-420

The maintainer's pragmatic concern (in TASK-420's final summary): "extracting requires threading a presenter-specific config builder closure that obscures the music-vs-video distinction." Reconsidered: pre-building the config at the call site (per the proposed shape above) keeps the music-vs-video specifics in plain view at the call site. The helper handles only the loop scaffold + accumulation. The duplication is real (~75% structural overlap) and a future maintainer adding a third content type (audiobooks? podcasts?) would otherwise need a third copy.

## Sequencing relative to TASK-422 (runSync phase decomposition)

This task and TASK-422 are complementary. **TASK-423 first is preferred** so TASK-422's PR 4 extracts a single thin wrapper instead of two parallel functions that this task would then re-merge.

## Verification — pinning byte-identical output

`sync.test.ts` covers the orchestrator's text + JSON output. For the per-collection headers (`=== Music: ${name} ===` / `=== Video: ${name} ===`) and the interrupted-flow messages, the simplest check is `bun test sync.test.ts` before and after — diff the JSON envelope manually if any assertion looks off. If no existing test specifically pins the header line, add a regression test inside `sync-collection-phase.test.ts` (or wherever the helper lands) that asserts the rendered output of a single iteration includes the expected header for each `kind`.

## Constraints

- **Behaviour-preserving**. `sync.test.ts` text + JSON output line-for-line unchanged.
- The interrupted-flow message wording must stay byte-identical (`"Sync interrupted."` for music, `"Video sync interrupted."` for video).
- The `supportsVideo` gate stays where it is (it's the precondition for entering the video phase at all, not part of the inner loop).
- The `=== Music: ${collection.name} ===` / `=== Video: ${collection.name} ===` per-collection headers stay byte-identical.
- **The `genericSyncCollection` call shape must not change** — it's the underlying primitive and lives in `sync-presenter.ts`. This task wraps it, doesn't refactor it.
- **Order of operations inside the loop body matters** — render header → call `genericSyncCollection` → emit JSON → accumulate → check `interrupted`. Don't reorder.

## References

- `packages/podkit-cli/src/commands/sync.ts:1131-1175` (music loop, approximate)
- `packages/podkit-cli/src/commands/sync.ts:1205-1244` (video loop, approximate)
- `packages/podkit-cli/src/commands/sync-presenter.ts` — `MusicPresenter`, `VideoPresenter`, `ContentTypePresenter`, `genericSyncCollection`
- TASK-420 final summary — context on why this was deferred
- TASK-422 — the broader runSync decomposition this complements

## Acceptance Criteria
<!-- AC:BEGIN -->
Listed below.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 A single runCollectionPhase helper exists (in sync.ts, sync-collection-phase.ts, or wherever fits the current sync.ts structure) and both music + video phases delegate to it
- [ ] #2 Music + video divergent fields (kind, presenter, contentConfig, interrupted-message variant) are inputs to the helper, not duplicated logic in the helper body
- [ ] #3 Music's artworkMissingBaseline and transferModeMismatch accumulators are tracked via a discriminated-union result type (CollectionPhaseResult with `kind: 'music' | 'video'`), not via a loose Record<string, number>
- [ ] #4 The supportsVideo gate stays at the call site, not inside the helper (it's a precondition for entering the video phase at all)
- [ ] #5 Per-collection headers '=== Music: NAME ===' and '=== Video: NAME ===' render byte-identically to before — verified by sync.test.ts diff or a new focused test in the helper's test file
- [ ] #6 Interrupted-flow messages 'Sync interrupted.' (music) and 'Video sync interrupted.' (video) render byte-identically to before — verified by sync.test.ts diff or a new focused test
- [ ] #7 Focused unit test for runCollectionPhase covers: empty collections array, single collection happy path, interrupt mid-loop, and error-accumulation path
- [ ] #8 The preliminariesConsumed one-shot flag is handled correctly: the first iteration receives PlanPreliminaries, subsequent iterations (within the helper's own loop AND across music→video calls) receive undefined
- [ ] #9 sync.test.ts text + JSON output is line-for-line unchanged before/after the refactor
<!-- AC:END -->

- [ ] #10 bun run typecheck / bun run test / bun run lint all pass
<!-- AC:END -->
