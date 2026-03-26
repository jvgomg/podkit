---
id: doc-010
title: Content Type Handler Pattern — Sync Pipeline Unification
type: other
created_date: '2026-03-21 23:18'
---
## Problem

The sync pipeline has parallel implementations for music and video at every stage (differ, planner, executor), with ~20 duplicate type pairs. Adding a new content type requires duplicating all of this. Developers frequently forget to update one branch when making changes.

## Decision: Content Type Handler Pattern

Introduce a generic `ContentTypeHandler<TSource, TDevice>` interface that each media type implements, and a shared pipeline that delegates type-specific decisions to the handler.

### Key Design Decisions

1. **Generics over discriminated unions** — The handler is generic `<TSource, TDevice>` for type safety
2. **Execution strategy lives in the handler** — The handler's `execute()` returns an async generator, so music can use its pipeline internally while video stays sequential
3. **Upgrade video first** — Add retries, error categorization, and self-healing to video before unification, bringing the two implementations closer together
4. **Generic CollectionAdapter with typed implementations** — `CollectionAdapter<TItem, TFilter>` as a shared interface, with separate implementation classes per source type

### Generic CollectionAdapter

```typescript
interface CollectionAdapter<TItem, TFilter = undefined> {
  readonly name: string;
  readonly adapterType: string;
  connect(): Promise<void>;
  getItems(): Promise<TItem[]>;
  getFilteredItems(filter: TFilter): Promise<TItem[]>;
  getFileAccess(item: TItem): FileAccess | Promise<FileAccess>;
  disconnect(): Promise<void>;
}

type MusicAdapter = CollectionAdapter<CollectionTrack, TrackFilter>;
type VideoAdapter = CollectionAdapter<CollectionVideo, VideoFilter>;
```

Video gets `FileAccess` instead of `getFilePath(): string`, unblocking future remote video sources.

### ContentTypeHandler Interface (Sketch)

```typescript
interface ContentTypeHandler<TSource, TDevice> {
  readonly type: string;

  // Diffing
  generateMatchKey(source: TSource): string;
  generateDeviceMatchKey(device: TDevice): string;
  applyTransformKey?(source: TSource): string;
  detectUpdates(source: TSource, device: TDevice, options: HandlerDiffOptions): UpdateReason[];

  // Planning
  planAdd(source: TSource, options: HandlerPlanOptions): SyncOperation;
  planRemove(device: TDevice): SyncOperation;
  planUpdate(source: TSource, device: TDevice, reasons: UpdateReason[]): SyncOperation[];
  estimateSize(op: SyncOperation): number;
  estimateTime(op: SyncOperation): number;

  // Execution
  execute(op: SyncOperation, ctx: ExecutionContext): AsyncGenerator<OperationProgress>;

  // Display
  getDisplayName(op: SyncOperation): string;
  formatDryRun(plan: SyncPlan): string;
}
```

### What Stays Separate

- `CollectionTrack` / `CollectionVideo` entity types (different metadata shapes)
- Transcoding internals (audio and video FFmpeg invocations are genuinely different)
- Adapter implementations (directory scanning + metadata extraction varies per type)

### Migration Order

1. Unify plan/result types (low risk, immediate dedup)
2. Upgrade video (retries, error categorization, self-healing) — brings implementations closer
3. Define generic CollectionAdapter, refactor video adapter
4. Define ContentTypeHandler interface, implement MusicHandler and VideoHandler
5. Unify differ with generic pipeline
6. Unify planner with generic pipeline
7. Unify executor with generic pipeline
8. Unify CLI orchestration

### Files Affected

**Core types:** `packages/podkit-core/src/sync/types.ts`
**Music pipeline:** `differ.ts`, `planner.ts`, `executor.ts`, `matching.ts`
**Video pipeline:** `video-types.ts`, `video-planner.ts`, `video-executor.ts`
**Adapters:** `packages/podkit-core/src/adapters/interface.ts`, `packages/podkit-core/src/video/directory-adapter.ts`
**CLI:** `packages/podkit-cli/src/commands/sync.ts`
