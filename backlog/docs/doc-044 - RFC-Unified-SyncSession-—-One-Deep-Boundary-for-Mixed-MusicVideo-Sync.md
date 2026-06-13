---
id: doc-044
title: 'RFC: Unified SyncSession — One Deep Boundary for Mixed Music+Video Sync'
type: specification
created_date: '2026-06-12 23:55'
tags:
  - rfc
  - architecture
  - sync-engine
  - refactor
---
# RFC: Unified SyncSession — One Deep Boundary for Mixed Music+Video Sync

**Status:** Proposed
**Origin:** Architecture-deepening review (module-deepening exercise, Ousterhout "deep modules"), combining three friction candidates: (1) shallow music handler dispatch stack, (2) ADR-019 leftover dual checkpoint-save ownership, (3) the 2k-LOC MusicPipeline monolith — plus the product goal of running music and video collections through a single sync plan/pipeline.

## Problem

### Friction today

**1. Shallow triple-dispatch handler stack.** The generic engine (`SyncDiffer` → `SyncPlanner` → `SyncExecutor`) delegates to content types via the 20-method `ContentTypeHandler` interface (`sync/engine/content-type.ts`). `MusicHandler` (`sync/music/handler.ts`, 1183 LOC) is mostly one-line pass-throughs to `MusicTrackClassifier`, `MusicOperationFactory`, and `MusicPipeline`. The interface is nearly as wide as the implementation. A reader must hold eight concepts (Differ, Planner, Executor, ContentTypeHandler, Classifier, OperationFactory, Pipeline, ExecutionContext) to follow one sync.

**2. Dual checkpoint-save ownership (ADR-019 incomplete).** The engine owns checkpoint `device.save()` calls (`engine/executor.ts` — every N completed ops, plus final save). But the legacy library convenience `executeMusicPlan()` (`sync/music/pipeline.ts`, end of file) bypasses the engine and saves itself to preserve a "historic fully persisted contract." Two save owners, two contracts, and the legacy path has no test coverage.

**3. Dual warning collection.** Warnings flow through two collection points: a `WarningSink` closure owned by `SyncExecutor`, and a private `warnings[]` array inside `MusicPipeline` that the handler drains in a `finally` block. If the pipeline crashes before returning, warnings are lost. Sub-components (artwork manager, transfer ops) cannot emit directly to the run's sink.

**4. MusicPipeline monolith.** `sync/music/pipeline.ts` (2082 LOC) owns three async-queue stages (downloader → preparer → consumer) plus transcoding, artwork extraction/resize/caching, and device transfer. It imports FFmpeg arg-builders and spawns subprocesses directly. Testing the transcode stage requires instantiating the whole pipeline including a device adapter. The queue logic itself has no direct tests.

**5. Split music/video orchestration.** The CLI (`podkit-cli/src/commands/sync.ts`, 1345 LOC) splits collections by type and runs two sequential `runCollectionPhase` calls (MusicPresenter, then VideoPresenter), each driving `genericSyncCollection()` in `sync-presenter.ts`. Music and video are architecturally symmetric (both implement `ContentTypeHandler`, both run through the same engine) — the split is pure caller-side duplication. The daemon cannot embed any of this: it shells out to the CLI binary, scrapes stdout JSON, and duplicates `SYNC_LOCK_HELD_EXIT_CODE = 4` by integer comparison.

### Integration risk in the seams

- A crash between the handler's finally-drain and the executor's sink silently drops warnings.
- The untested `executeMusicPlan()` save path can diverge from the engine's checkpoint semantics without any test failing.
- The CLI's two-phase loop means a failure in the music phase leaves video unsynced with no unified result; totals are merged by hand.
- Presenter interfaces pass `any`-typed plans between layers, defeating the type system at exactly the boundary that matters.

### Product goal

Select a set of collections (mixed music + video) and sync them all in one run: one diff, one plan, one execution, one progress stream, one warning stream, engine-owned saves interleaved across content types.

## Proposed Interface

Hybrid of three explored designs: a CLI-shaped session surface, explicit transcoder port internally, and "dry-run = stop after plan" discipline.

### Public surface (the only sync exports from `@podkit/core`)

```ts
export function createSyncSession(req: SyncSessionRequest): SyncSession;

export interface SyncSessionRequest {
  device: DeviceAdapter;                          // opened by caller (shared with other commands)
  collections: CollectionSpec[];                  // mixed music + video, any order
  config: { music?: MusicSyncConfig; video?: VideoSyncConfig };  // per-type, stays split
  options?: {
    removeOrphans?: boolean;
    saveInterval?: number;                        // checkpoint cadence, default 10 (ADR-019)
    continueOnError?: boolean;                    // default true
    tempDir?: string;
    lock?: boolean;                               // default true; session owns acquire/release
  };
  deps?: SyncSessionDeps;                         // ports, see Dependency Strategy
}

export interface CollectionSpec {
  name: string;
  contentType: 'music' | 'video';
  source: CollectionSourceConfig | CollectionAdapter;  // config in prod, adapter in tests
}

export interface SyncSession {
  /** Scan all sources, diff, plan. Read-only and idempotent. */
  plan(opts?: { signal?: AbortSignal; onProgress?: (e: PlanEvent) => void }): Promise<SyncPlanView>;
  /** Execute the plan. One stream; engine owns all saves. Final event is { kind: 'done', result }. */
  execute(opts?: { signal?: AbortSignal }): AsyncIterable<SyncEvent>;
  close(): void;
}
```

### Plan view (presentation-shaped, mixed-type)

```ts
export interface SyncPlanView {
  collections: CollectionPlanView[];              // per collection: counts, op list, scan warnings
  totals: { add: number; remove: number; update: number; existing: number;
            estimatedSize: number; estimatedTime: number };
  space: { free: number; needed: number; fits: boolean; debrisReclaimable: number } | null;
  warnings: Warning[];                            // plan-phase, all types, one stream
  collisions: CollisionReport[];
  isEmpty: boolean;
}

export interface CollectionPlanView {
  name: string; contentType: 'music' | 'video';
  sourceCount: number; deviceCount: number;
  counts: Record<string, number>;                 // op-type label → count (granularity preserved)
  operations: Array<{ type: string; displayName: string; size?: number }>;
  updateBreakdown: UpdateBreakdown;               // reasons, for verbose dry-run
}
```

### Events and result

```ts
export type SyncEvent =
  | { kind: 'preflight'; debrisRemoved: number; bytesFreed: number }
  | { kind: 'op'; collection: string; contentType: 'music' | 'video';
      opType: string; displayName: string;
      phase: 'starting' | 'in-progress' | 'complete' | 'failed' | 'skipped';
      index: number; total: number;
      transcode?: { percent: number; speed?: number };
      error?: CategorizedError }
  | { kind: 'warning'; warning: Warning }         // single live stream, both types
  | { kind: 'checkpoint'; opsSaved: number }
  | { kind: 'done'; result: SyncResult };

export interface SyncResult {
  status: 'ok' | 'partial-failure' | 'aborted';
  completed: number; failed: number; skipped: number;
  bytesTransferred: number; durationSeconds: number;
  warnings: Warning[];                            // full accumulation (plan + execute)
  errors: CategorizedError[];
  perCollection: Array<{ name: string; contentType: string; completed: number; failed: number }>;
}
```

### Typed errors (replace exit-code scraping)

```ts
export class SyncLockHeldError extends PodkitError { pid: number; lockPath: string }
export class InsufficientSpaceError extends PodkitError { needed: number; available: number }
export class EmptyCollectionError extends PodkitError { collection: string }
```

### Usage — CLI sync command (the dominant caller)

```ts
const session = core.createSyncSession({
  device: adapter,
  collections: selected.map(c => ({ name: c.name, contentType: c.type, source: c.config })),
  config: { music: settings.music, video: settings.video },
  options: { removeOrphans: options.delete, lock: !options.dryRun },
});
try {
  const plan = await session.plan({ signal, onProgress: renderScanProgress });
  renderPlanSummary(out, plan);
  if (options.dryRun || plan.isEmpty) return;     // dry-run = simply don't execute

  let result!: core.SyncResult;
  for await (const ev of session.execute({ signal })) {
    if (ev.kind === 'op') progressBar.render(ev);
    if (ev.kind === 'done') result = ev.result;
  }
  renderResultSummary(out, result);
} catch (err) {
  throw mapSyncError(err);                        // SyncLockHeldError → exit 4, etc.
} finally { session.close(); }
```

Daemon embeds the same session in-process (no shell-out, no stdout scraping). Library consumers use the same two calls and inherit the checkpoint-save contract.

### Key design decisions

1. **Session owns scanning, locking, debris sweep, space gate, collision check.** Every caller repeats the same scan → diff → gate dance today; that repetition is the shallow glue being deleted. Preconditions surface as typed errors, not per-presenter if-trees.
2. **Dry-run is not a flag.** Plan is read-only; dry-run = render `SyncPlanView` and stop. The dry-run flag threading through five layers disappears.
3. **No plugin registry.** Internal hard-wired `{ music, video }` handler registry. A third content type does not exist; an extension seam would be speculative. When one lands, the registry is one internal edit.
4. **Segments stay contiguous per content type; checkpoint counter and warning sink are global.** Music's three-stage batch pipeline keeps its prefetch/transcode/consume concurrency. Cross-type op interleaving was considered and rejected — it breaks batch contiguity for no demonstrated benefit. Removes-first ordering across types happens at segment ordering level.
5. **Op-type labels survive as strings** in plan views and events (the CLI's per-op-type display granularity is preserved), but the 15 concrete operation types (10 music + 5 video) and their unions become internal.

## Dependency Strategy

Category: **mixed — in-process orchestration over local-substitutable and true-external dependencies**, handled with explicit ports. Every port has ≥2 real adapters today; nothing speculative.

```ts
export interface SyncSessionDeps {
  transcoder?: MediaTranscoder;                   // default: FFmpeg adapter
  statfs?: (path: string) => SpaceInfo;
  clock?: () => number;
}

/** Absorbs every FFmpeg invocation. Pipeline stages type against this, never spawn. */
export interface MediaTranscoder {
  detect(): Promise<TranscoderCapabilities>;
  probe(file: string): Promise<MediaMetadata>;
  transcodeAudio(input: string, output: string, preset: AudioPresetSpec,
    opts?: TranscodeJobOptions): Promise<TranscodeResult>;
  transcodeVideo(input: string, output: string, profile: VideoProfile,
    opts?: TranscodeJobOptions): Promise<TranscodeResult>;
  remux(input: string, output: string, opts: RemuxOptions): Promise<TranscodeResult>;  // optimized-copy path
}
```

| Port | Category | Production adapter | Test adapter |
|---|---|---|---|
| `DeviceAdapter` (existing, kept whole) | true-external (native libgpod / mounted fs) | libgpod iPod; mass-storage fs | `gpod-testing` real-DB temp-dir env; in-memory `TrackWriter` slice for stage tests |
| `MediaTranscoder` (new) | true-external (subprocess) | one FFmpeg adapter (audio + video + remux — same binary) | instant fake: copyFile + canned `TranscodeResult` |
| `CollectionAdapter` source (existing, ADR-004) | fs local-substitutable; Subsonic true-external | directory; Subsonic/Navidrome | `test-fixtures` directory adapter over real temp dirs |
| staging fs, clock, statfs | local-substitutable | real `node:fs` | real temp dirs — deliberately **not** a port |

`DeviceAdapter` is not split: persistence/artwork/tag sub-ports would be three single-implementation interfaces. Internally, the pipeline's consumer stage narrows its dependency to a `TrackWriter` slice of the adapter so stage unit tests need no full adapter.

## Testing Strategy

Principle: **replace, don't layer.**

### New boundary tests

1. **Session contract tests** (with `gpod-testing` real-DB device + fake transcoder + fixture sources):
   - Mixed music+video plan: one `SyncPlanView` with correct per-collection counts and merged totals.
   - Execution: final device state correct for both types; checkpoint saves fire at global cadence across segments; final save always fires.
   - Single warning stream: warnings from artwork failures, transcode failures, and plan phase all arrive via events AND in `result.warnings` — including when a stage crashes mid-run.
   - Abort honesty: `signal` abort → `status: 'aborted'`, device persisted at last checkpoint (pins ADR-019 typed AbortError behavior).
   - Typed preconditions: lock held → `SyncLockHeldError`; insufficient space → `InsufficientSpaceError`.
   - Dry-run equivalence: `plan()` mutates nothing (device state hash unchanged).
2. **Stage unit tests** (no device adapter): preparer stage against fake `MediaTranscoder` (retry on transient failure, error categorization); consumer stage against in-memory `TrackWriter`; the three-stage queue gets its first direct tests (ordering, backpressure, drain on abort).
3. **End-to-end seam previously untested:** preset-upgrade detected → operation type chosen → executed (the pure `detectUpgrades()` is well-tested; its call site is not).

### Old tests to delete

- `sync/music/handler.test.ts` — pins the pass-through structure method-by-method; replaced by session contract tests.
- `sync/video/handler.test.ts`, `handler-execute.test.ts` — same.
- `sync/video/executor.test.ts` — placeholder for a legacy interface that dies.
- Executor checkpoint tests that mock `device.save()` directly — replaced by boundary checkpoint tests observing real save effects.
- Pipeline tests that instantiate `MusicPipeline` with mocked adapters to reach transcode logic — replaced by stage unit tests.
- CLI presenter tests for `genericSyncCollection` / per-type presenters — replaced by renderer tests over `SyncEvent` fixtures.

### Test environment needs

Already in place: `gpod-testing` (temp-dir iPod environments, no hardware), `test-fixtures` (real tiny audio/video). New: fake `MediaTranscoder` (trivial), in-memory `TrackWriter` (small).

## Implementation Recommendations

Durable guidance, not coupled to current file layout:

### The session owns
- The full sync lifecycle: lock → scan → diff → plan → preflight sweep → execute → save → release.
- Save ownership, exclusively. Checkpoint cadence counts completed operations globally across content types; `device.save()` is atomic across media types so no per-type gating exists.
- One `WarningSink`, constructor-injected into every component that can warn (pipeline stages, artwork manager, transfer ops). No component buffers warnings privately; no finally-block drains.
- Per-type dispatch. Content-type handlers, classifiers, operation factories, sync-tag formats, and retry configs are implementation details behind the session.

### The session hides
- The engine phases (diff/plan/execute) as named concepts.
- All concrete operation types and their unions — callers see string labels and counts.
- FFmpeg: every invocation goes through the `MediaTranscoder` port; no module inside the session spawns subprocesses.
- The music pipeline's three-stage concurrency model.

### The session exposes
- `plan()` → presentation-shaped `SyncPlanView`; `execute()` → `AsyncIterable<SyncEvent>` ending with `SyncResult`; typed precondition errors. Nothing else.
- The event union is a public contract: adding kinds is cheap, changing shapes is breaking; renderers must default-case unknown kinds.

### Migration path for callers
1. **CLI:** replace the two `runCollectionPhase` calls and the type-split with one session. Presenters collapse into one event-driven renderer; `sync.ts` should shrink toward ~300 LOC.
2. **Daemon:** replace CLI shell-out + stdout scraping with in-process session; replace exit-code-4 comparison with `SyncLockHeldError`. (CLI runner may remain temporarily for device scan only.)
3. **Library consumers:** `executeMusicPlan()` is removed in the same change — its "fully persisted" contract is superseded by the session's checkpoint contract. This is a breaking change to `@podkit/core` exports (minor bump per project convention).
4. **Engine internals** (differ/planner/executor) stop being re-exported from the package root. They may remain as internal modules; deep-importing is at consumers' own risk.

### Deletions (the point of the exercise)
- `executeMusicPlan()` and its self-save — dual save ownership dies.
- `MusicPipeline.getWarnings()`, its private warnings array, the handler finally-drain — dual warning collection dies.
- Both handler files' pass-through layers (classifier/factory get called by the session's internal planner directly); `ContentTypeHandler` as a public concept.
- CLI: `sync-presenter.ts`, `music-presenter.ts`, `video-presenter.ts`, `sync-collection-phase.ts`, the `any`-typed plan plumbing.
- Public exports: `createSyncExecutor/Differ/Planner`, `createMusicHandler/createVideoHandler`, `MusicOperation`/`VideoOperation` unions, `ExecutionContext`, `executeMusicPlan`.

Estimated net deletion: ~3000 LOC. Concepts a reader must hold drops from eight (Differ, Planner, Executor, ContentTypeHandler, Classifier, OperationFactory, Pipeline, ExecutionContext) to three (session, plan view, event stream).

## Alternatives Considered

1. **Minimal two-function surface** (`planSync()` returning a `PlannedSync` with `.execute()`): rejected only for collapsing 15 op types into 4 generic actions — the CLI's dry-run op-type breakdown is a real feature. Its dry-run discipline was adopted.
2. **Plugin registry for content types** (`ContentTypePlugin` + type-erased `CollectionSpec`): rejected as speculative — no third content type exists; the extension point is not earned. Its segment-contiguous execution model with a global checkpoint counter was adopted.
3. **Globally interleaved cross-type operation ordering**: rejected — breaks the music batch pipeline's contiguity for no demonstrated benefit. The explicit `MediaTranscoder` port from the same design was adopted.

## Relationship to Existing Decisions

- **ADR-019** (engine-owned checkpoint saves, typed AbortError): this RFC completes it by removing the last competing save owner and pinning abort honesty at the new boundary.
- **ADR-004** (collection source adapter pattern): unchanged; sources become one of the session's ports.
- Architecture conventions (`documents/architecture/conventions.md`): single-sink warning flow aligns with sink-not-stderr; typed errors align with the typed-errors rule. The sync architecture doc under `documents/architecture/sync/` should be updated in the implementing PR.
