---
title: Error Handling
description: How errors and warnings flow through podkit's sync engine — typed errors, warning sinks, and the responsibility boundaries between adapter, pipeline, and CLI.
sidebar:
  order: 1
---

Describes how errors and warnings flow through the sync engine, where the
responsibility for each sits, and what conventions a new adapter or sync
stage must follow.

Cross-cutting rules (typed errors, no `console.warn` in core, sink-not-stderr)
live in [conventions](../conventions.md).

Companion reading — open rough-edges journal: [doc-041 — Save-Transaction Design and State of Play](../../../backlog/docs/doc-041%20-%20Save-Transaction-Design-and-State-of-Play.md).

---

## 1. The two channels

Sync code communicates non-success in exactly two ways:

| Channel       | Carries                        | Where it goes                                    |
|---------------|--------------------------------|--------------------------------------------------|
| **Thrown error** (typed)  | A hard failure that the caller must handle. | Caught by the executor, becomes a `CategorizedError` in `ExecuteResult.errors` and the per-op progress event. |
| **Emitted warning** (data) | A soft signal — sync still completes. | Pushed into a `WarningSink`, accumulated into `ExecuteResult.warnings`, surfaced in `SyncOutput.warnings`. |

Nothing else. Adapters do not log to stdout/stderr. There is no third
"silent failure" or "diagnostic" path. If a behavior matters to the user
or another machine consuming `--json`, it goes through one of these two.

---

## 2. Hard failures — `CategorizedSyncError`

### The shape

Every error thrown out of an adapter, a content-type handler, or any
sync-engine stage extends `CategorizedSyncError`:

```ts
abstract class CategorizedSyncError extends Error {
  abstract readonly category: ErrorCategory;
  readonly causes: readonly string[];
}
```

The `category` lives on the **class**, not the message. The pipeline's
categorizer reads `error.category` directly — it does not (and must not)
inspect the message body.

### Why typed errors

Before this convention, `categorizeError` worked by lowercased substring
matching: `message.includes('database') → 'database'`, `message.includes('ipod') → 'database'`,
and so on across a 60-line keyword bank. A failing tag write whose path
happened to contain `"iPod"` (because the mass-storage device was mounted
at `/Volumes/iPod`) would mis-classify as a database error and follow the
wrong retry policy.

Typed errors close that hole. They also document the policy at the
**throw site**: a writer that intentionally throws `MoveError` is
declaring "this is a file I/O failure with category `'copy'`" — no remote
keyword bank required.

### Current subclasses

| Class                | Category   | Thrown from                                                | Aggregation |
|----------------------|------------|------------------------------------------------------------|-------------|
| `TagWriteError`      | `copy`     | `MassStorageAdapter.save()` — aggregated `writeTags` failures. | per-file |
| `SidecarWriteError`  | `copy`     | `MassStorageAdapter.save()` — aggregated sidecar `cover.jpg` failures. | per-album |
| `PictureWriteError`  | `copy`     | `MassStorageAdapter.save()` — aggregated embedded-picture failures (OGG/Opus). | per-file |
| `MoveError`          | `copy`     | `MassStorageAdapter.save()` — file move (`renameSync`) failures, wrapped from raw fs error. | single-cause (throw on first non-ENOENT) |
| `DatabaseWriteError` | `database` | `IpodAdapter` — wraps libgpod failures in `save()`, `addTrack`, `updateTrack`, `removeTrack`. | single-cause |

The aggregation granularity matches the natural unit of the underlying write:
tag and picture writes are per-file operations, sidecar writes are per-album
operations (one `cover.jpg` per directory), and move/database failures terminate
on the first hard error rather than aggregating across the batch. See
[save-transactions.md §save() stage asymmetries](./save-transactions.md#save-stage-asymmetries-intentional)
for the rationale behind the move-stage and sidecar-stage deviations.

### The categorizer

```ts
function categorizeError(error: Error, operationType: string): ErrorCategory {
  if (error instanceof CategorizedSyncError) {
    return error.category;
  }
  return categoryForOperationType(operationType);
}
```

Two rules, in order:

1. **Typed error** → read `error.category`. This is the recommended path.
2. **Untyped error** → fall back to a small operation-type table
   (`add-transcode` → `transcode`, `add-direct-copy` → `copy`, etc.).
   `update-metadata`, `remove`, `update-sync-tag` fall through to
   `unknown` — the call site intentionally chose the op-type, so it's
   the next-best signal when the throwing code hasn't yet wrapped.

There is **no message-keyword inspection**. Strings like `'ffmpeg'`,
`'database'`, `'ENOSPC'` in `error.message` do not change the category.
If you want a category, throw a `CategorizedSyncError`.

### Retry policy

The category drives retry:

| Category   | Music retry budget | Video retry budget |
|------------|--------------------|--------------------|
| `transcode` | 1 | 0 (too expensive) |
| `copy`     | 1 | 1 |
| `database` | 0 | 0 |
| `artwork`  | 0 | 0 |
| `unknown`  | 0 | 0 |

`database` does not retry by design — a genuine iTunesDB corruption will
not heal in 1 second. This is why wrapping libgpod errors in
`DatabaseWriteError` is a **correctness** fix, not just symmetry: without
the wrap, a libgpod failure inside `addTrack` would categorize as `copy`
via op-type fallback and retry once.

---

## 3. Soft signals — `Warning` + `WarningSink`

### The shape

```ts
interface Warning {
  phase: 'plan' | 'execute';
  type: WarningType;
  message: string;
  tracks: WarningTrackRef[];
}

interface WarningSink {
  emit(warning: Warning): void;
}
```

One shape across both phases. Discriminated by `phase`. Track refs are
structured (`{artist, title, album?}`) so JSON consumers can format as
they wish, rather than pre-formatted strings.

### Plan-phase warnings (return values)

Plan warnings are generated synchronously during diff/plan construction:

- `SyncPlan.warnings: Warning[]` — populated by `SyncPlanner` from the
  handler's `collectPlanWarnings()` and adapter's `getPlanWarnings()`.
- Examples: `lossy-to-lossy` (OGG/Opus → AAC), `space-constraint`,
  `embedded-artwork-resize`, `artwork-detection-disabled` (Subsonic fast
  mode).

Plan warnings are returned as data, not emitted through a sink, because
there's no fan-in — the planner is a single sequential pass.

### Execute-phase warnings (sink)

Execute warnings come from many places during a run — the transfer
manager, the artwork manager, the adapter's `save()`. They go through
a `WarningSink` so the executor can accumulate them in order:

- `MusicArtworkManager` takes a sink at construction; emits `'artwork'`
  warnings when extraction/transfer fails (non-fatal: artwork is
  optional).
- `IpodAdapter.setWarningSink(sink)` — pipeline calls this at execute
  start; the adapter emits `'tag-write'` warnings for best-effort
  portable-mode file-tag writes that drop or fail.
- `MusicPipeline.warnings` accumulates everything emitted into its
  internal sink and exposes them via `getWarnings()` at the end of a
  run.

The sink **chains across two layers** so a single Warning emission
reaches the CLI envelope:

1. The **engine executor** (`SyncExecutor`) owns the outer sink — it
   builds one per `execute()` call, threads it through
   `ExecutionContext.warningSink`, accumulates emissions on
   `this.warnings`, surfaces them on the `ExecuteResult.warnings` array
   AND on the typed `executor.getWarnings()` method that presenters
   read. Reset at the top of every `execute()` call so reuse on the
   same instance doesn't leak warnings across runs.
2. The **music pipeline** still owns its own inner sink (passed into
   `MusicArtworkManager`, wired into the adapter at execute start). At
   the end of `MusicHandler.executeBatch`, the handler drains
   `pipeline.getWarnings()` into `ctx.warningSink`, forwarding the
   inner accumulator's contents to the outer one. The drain runs in a
   `finally` so an early break (e.g. fatal stage error) still surfaces
   warnings that fired before the throw.

Without that handler-level drain the pipeline's sink stays private to
the pipeline instance and the warnings GC with it — the failure mode
the matrix's iPod portable cells observed before the fix.

### Adapters never touch stderr

`console.warn` / `console.error` are forbidden in adapters. All
non-fatal output flows through the sink, which means it lands in
`SyncOutput.warnings` (JSON) and the CLI summary renderer — never in
silent stderr that JSON consumers will miss.

---

## 4. Responsibility boundaries

Drawing the line between layers:

### Adapter

- **Knows:** its device, what failure category a given operation belongs
  to.
- **Throws:** typed `CategorizedSyncError` subclasses for hard failures.
- **Emits:** `Warning` objects through its injected `WarningSink` for
  soft signals.
- **Never:** logs to console, infers categories by string match, decides
  retry policy.

### Content-type handler (music, video)

- **Knows:** the operation type semantics.
- **Implements:** `collectPlanWarnings()` for plan-time warnings (returns
  `Warning[]` with `phase: 'plan'`).
- **Calls into adapter:** for execution; receives typed errors and
  propagates them up.
- **Forwards execute-phase warnings to the executor's sink.** The
  music handler instantiates a fresh `MusicPipeline` per batch and
  drains `pipeline.getWarnings()` into `ctx.warningSink` (in `finally`)
  when the batch completes. The video handler wires `ctx.warningSink`
  into the device adapter directly via `setWarningSink` at the start
  of the batch — its own batch loop has no pipeline-local accumulator.
  Without this forwarding step, adapter-emitted Warnings never reach
  `SyncOutput.warnings[]`.

### Pipeline (music)

- **Knows:** transcode/copy/transfer mechanics, per-album artwork
  cache.
- **Owns:** an inner `WarningSink` it wires into the artwork manager
  and the device adapter at execute start.
- **Accumulates:** every emission into `this.warnings`; exposes via
  `getWarnings()` at end of run.
- **Does not** know about the engine-level executor — the handler is
  responsible for forwarding the accumulator outward.

### Engine executor (`SyncExecutor`)

- **Knows:** retry policy (per-op path), warning accumulation, progress
  event shape.
- **Builds the outer `WarningSink`** once per `execute()` call and
  threads it through `ExecutionContext.warningSink`.
- **Catches:** typed errors → reads category → consults retry config →
  decides retry vs. surface.
- **Accumulates:** warnings into `this.warnings`; surfaces them on
  `ExecuteResult.warnings` (for callers reading the generator return
  value) AND on the typed `executor.getWarnings()` method (for callers
  iterating the progress stream and discarding the return value, e.g.
  the CLI presenters).

### CLI

- **Consumes:** `SyncOutput` (warnings + errors + result).
- **Drains** `executor.getWarnings()` at end of `presenter.executeSync`,
  forwarding into the presenter's returned `warnings` field. `sync.ts`
  aggregates those across collections into `allWarnings` and renders
  both the text `Warnings:` summary (grouped by type, expanded under
  `-v`) and the `--json` `warnings[]` envelope.
- **Renders:** text + JSON. Doesn't duplicate-deduplicate stderr against
  JSON because adapters never write stderr.

---

## 5. Conventions for new adapters

When adding a new device adapter:

1. **Implement `setWarningSink(sink)`** if you'll emit any warnings. If
   you won't, omit it (the interface declares it optional).
2. **Throw typed errors.** Create a new `CategorizedSyncError` subclass
   if no existing class fits. Set `category` on the class. Aggregate
   per-entry failures into `causes`.
3. **Wrap raw library errors at the boundary.** If your device uses a
   native binding that throws raw `Error`, wrap each call in a typed
   error like `IpodAdapter` does with `DatabaseWriteError`. The wrap
   protects against op-type-fallback mis-categorization.
4. **Use `runWithConcurrency` for flush stages.** All `save()` flush
   stages should follow the shape: settle-all + concurrency cap +
   typed aggregate + clear-before-throw. See doc-041 §7.1.
5. **Don't touch the console.** Use the sink.

When adding a new sync stage:

1. **Pin behaviour with tests before refactoring.** doc-041 §4.2 lists
   the gaps; close them.
2. **Decide hard vs. soft.** Hard → throw a typed error. Soft → emit a
   `Warning` via the sink the executor passes you.
3. **Match the existing shape.** If your stage's flush story differs
   from the other flushes in the same `save()`, the asymmetry should be
   either eliminated or documented in doc-041 §3.

---

## 6. What this convention does not cover

This document describes the **sync engine's** error/warning model. It
does not cover:

- **Scan-time errors** (file parsing failures during directory walk).
  These have their own `ScanWarning` channel — a separate concern from
  sync-engine warnings, intentionally not unified.
- **CLI-level errors** (invalid arguments, device-not-found). These use
  `CliError` in `packages/podkit-cli/`. The CLI layer translates
  sync-engine errors into exit codes + user-friendly messages.
- **Library-binding errors** (libgpod's `LibgpodError`, taglib's raw
  errors). These are wrapped at the adapter boundary into the
  CategorizedSyncError hierarchy.

---

## 7. Open work

Tracked outside this document:

- **`MassStorageAdapter` doesn't yet implement `setWarningSink`.** It
  doesn't emit any warnings today, so the optional interface accepts
  this. Add a stub when the first warning needs emission (e.g. partial
  picture writes, transient sidecar failures).
- **iPod sync mutators (`addTrack`, `updateTrack`, `removeTrack`) are
  wrapped synchronously via `wrapDatabaseError`.** If a future code path
  introduces async libgpod calls, an async-aware wrapper is needed.

---

## 8. References

- `packages/podkit-core/src/sync/engine/errors.ts` — `CategorizedSyncError` base.
- `packages/podkit-core/src/sync/engine/types.ts` — `Warning`, `WarningSink`, `ErrorCategory`.
- `packages/podkit-core/src/sync/engine/error-handling.ts` — `categorizeError`, retry config.
- `packages/podkit-core/src/device/mass-storage-tag-writer.ts` — `TagWriteError`, `SidecarWriteError`, `PictureWriteError`, `MoveError`.
- `packages/podkit-core/src/device/ipod-adapter.ts` — `setWarningSink`, `wrapDatabaseError`.
- `packages/podkit-core/src/sync/music/pipeline.ts` — sink wiring at execute start.
- doc-041 — Save-Transaction Design and State of Play (companion).
