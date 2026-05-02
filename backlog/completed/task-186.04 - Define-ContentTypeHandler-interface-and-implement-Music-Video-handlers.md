---
id: TASK-186.04
title: Define ContentTypeHandler interface and implement Music/Video handlers
status: Done
assignee: []
created_date: '2026-03-21 23:21'
updated_date: '2026-03-22 11:29'
labels:
  - refactor
  - architecture
dependencies:
  - TASK-186.01
  - TASK-186.02
  - TASK-186.03
references:
  - packages/podkit-core/src/sync/matching.ts
  - packages/podkit-core/src/sync/differ.ts
  - packages/podkit-core/src/sync/planner.ts
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/sync/video-differ.ts
  - packages/podkit-core/src/sync/video-planner.ts
  - packages/podkit-core/src/sync/video-executor.ts
documentation:
  - doc-010
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Goal:** Define the central `ContentTypeHandler<TSource, TDevice>` generic interface and create `MusicHandler` and `VideoHandler` implementations that wrap existing logic. This is the pivotal task — it creates the abstraction that all subsequent unification tasks build on.

**Depends on:** TASK-186.01 (unified types), TASK-186.02 (video feature parity), TASK-186.03 (generic CollectionAdapter)

---

### The Interface

Create `packages/podkit-core/src/sync/content-type.ts` with:

```typescript
/**
 * Options bag that the handler receives during diffing.
 * Each handler defines its own options shape.
 */
interface HandlerDiffOptions {
  // Base options shared by all handlers
  forceMetadata?: boolean;
  transforms?: Record<string, string>;  // generic transform map
}

interface HandlerPlanOptions {
  removeOrphans?: boolean;
  maxSize?: number;
}

interface ExecutionContext {
  ipod: IpodDatabase;
  signal?: AbortSignal;
  continueOnError?: boolean;
  retryConfig?: RetryConfig;
  onCheckpoint?: () => Promise<void>;
}

interface OperationProgress {
  phase: string;
  operation?: SyncOperation;
  index?: number;
  error?: Error;
  categorizedError?: CategorizedError;
  skipped?: boolean;
  retryAttempt?: number;
  transcodeProgress?: TranscodeProgress;
}

interface ContentTypeHandler<TSource, TDevice> {
  readonly type: string;

  // --- Diffing ---
  /** Generate a match key for a source item (used to find it on the device) */
  generateMatchKey(source: TSource): string;
  /** Generate a match key for a device item (must produce same key as generateMatchKey for a match) */
  generateDeviceMatchKey(device: TDevice): string;
  /** Optional: generate an alternate key after transforms are applied */
  applyTransformKey?(source: TSource): string;
  /** Given a matched pair, determine what updates are needed */
  detectUpdates(source: TSource, device: TDevice, options: HandlerDiffOptions): UpdateReason[];

  // --- Planning ---
  /** Create an add operation for a new source item */
  planAdd(source: TSource, options: HandlerPlanOptions): SyncOperation;
  /** Create a remove operation for an orphaned device item */
  planRemove(device: TDevice): SyncOperation;
  /** Create operations for an item that needs updating */
  planUpdate(source: TSource, device: TDevice, reasons: UpdateReason[]): SyncOperation[];
  /** Estimate the disk space an operation will consume */
  estimateSize(op: SyncOperation): number;
  /** Estimate the time an operation will take */
  estimateTime(op: SyncOperation): number;

  // --- Execution ---
  /** Execute a single operation, yielding progress updates */
  execute(op: SyncOperation, ctx: ExecutionContext): AsyncGenerator<OperationProgress>;

  // --- Display ---
  /** Human-readable name for an operation (used in progress output) */
  getDisplayName(op: SyncOperation): string;
  /** Format a plan for dry-run display */
  formatDryRun(plan: SyncPlan): string;
}
```

### MusicHandler Implementation

Create `packages/podkit-core/src/sync/handlers/music-handler.ts`:

This wraps the existing music logic. Each method delegates to existing functions:

- `generateMatchKey` → calls `getMatchKeys()` from `matching.ts`
- `generateDeviceMatchKey` → calls `getIpodMatchKey()` from `matching.ts`
- `applyTransformKey` → calls `getTransformMatchKeys()` from `matching.ts`
- `detectUpdates` → calls `detectUpgrade()` from `differ.ts` and the metadata comparison logic
- `planAdd` → extracts the source categorization logic from `planner.ts` (lossless → transcode, compatible → copy, etc.)
- `planRemove` → creates `{ type: 'remove', track }` operation
- `planUpdate` → extracts `planUpdateOperations()` logic from `planner.ts`
- `estimateSize` / `estimateTime` → delegates to `calculateOperationSize()` / `calculateOperationTime()` from `planner.ts`
- `execute` → wraps the music executor's per-operation logic as an async generator. The music handler can internally use the pipeline/queue architecture — the generator just yields progress events as operations complete.
- `getDisplayName` → delegates to existing `getOperationDisplayName()`
- `formatDryRun` → extracts `buildMusicDryRunOutput()` logic from `sync.ts`

**Important:** At this stage, the handler wraps existing code — it does NOT rewrite it. The goal is to get the interface right and prove it works, not to refactor internals.

### VideoHandler Implementation

Create `packages/podkit-core/src/sync/handlers/video-handler.ts`:

Same pattern, wrapping existing video logic:

- `generateMatchKey` → calls `generateVideoMatchKey()` from `video-differ.ts`
- `generateDeviceMatchKey` → calls the iPod-side key generation from `video-differ.ts`
- `detectUpdates` → calls the upgrade detection added in TASK-186.02
- `planAdd` → extracts compatibility check logic from `video-planner.ts` (passthrough → video-copy, incompatible → video-transcode)
- `planRemove` → creates `{ type: 'video-remove', video }` operation
- `planUpdate` → creates video-upgrade or video-update-metadata operations
- `execute` → wraps the video executor's sequential per-operation logic as an async generator
- `formatDryRun` → extracts the inline dry-run rendering from `syncVideoCollection()` in `sync.ts`

### Handler Registry

Create a simple registry in `content-type.ts`:

```typescript
const handlers = new Map<string, ContentTypeHandler<any, any>>();

function registerHandler(handler: ContentTypeHandler<any, any>): void;
function getHandler(type: string): ContentTypeHandler<any, any>;
```

Register `MusicHandler` and `VideoHandler` at module initialization. The unified pipeline (later tasks) will look up handlers by type string.

### What NOT to Do

- Do NOT rewrite the differ, planner, or executor yet — those happen in TASK-186.05, .06, .07
- Do NOT change the CLI orchestration yet — that's TASK-186.08
- The handlers should be thin wrappers that delegate to existing functions
- Do NOT remove the existing differ/planner/executor classes yet — they continue to work as-is

### Testing

- Unit test each handler method in isolation
- Verify `MusicHandler.generateMatchKey()` produces the same keys as `getMatchKeys()` directly
- Verify `VideoHandler.planAdd()` produces the same operations as `planVideoSync()` for the same inputs
- Run full test suite: `bun run test --filter podkit-core`

**Key files to create:**
- `packages/podkit-core/src/sync/content-type.ts` — interface + registry
- `packages/podkit-core/src/sync/handlers/music-handler.ts`
- `packages/podkit-core/src/sync/handlers/video-handler.ts`

**Key files to read (but not modify significantly):**
- `packages/podkit-core/src/sync/matching.ts` — music match key logic
- `packages/podkit-core/src/sync/differ.ts` — music update detection
- `packages/podkit-core/src/sync/planner.ts` — music planning logic
- `packages/podkit-core/src/sync/executor.ts` — music execution logic
- `packages/podkit-core/src/sync/video-differ.ts` — video match key + update detection
- `packages/podkit-core/src/sync/video-planner.ts` — video planning logic
- `packages/podkit-core/src/sync/video-executor.ts` — video execution logic
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ContentTypeHandler<TSource, TDevice> interface is defined in packages/podkit-core/src/sync/content-type.ts with all method signatures (diff, plan, execute, display)
- [x] #2 MusicHandler implements ContentTypeHandler<CollectionTrack, IPodTrack> and delegates to existing music logic
- [x] #3 VideoHandler implements ContentTypeHandler<CollectionVideo, IPodVideo> and delegates to existing video logic
- [x] #4 A handler registry exists to look up handlers by type string
- [x] #5 Handler methods produce identical outputs to the existing standalone functions for the same inputs
- [x] #6 Unit tests verify key handler methods (match key generation, planAdd, planRemove, detectUpdates) for both handlers
- [x] #7 Existing differ/planner/executor classes are untouched — handlers wrap them, not replace them
<!-- AC:END -->
