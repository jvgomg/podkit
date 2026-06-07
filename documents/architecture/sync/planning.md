---
title: 'sync: planning'
description: How podkit takes a source collection + a device state and produces an executable sync plan — the SyncDiffer + SyncPlanner pipeline, the per-collection SyncPlan, and the device-scoped pre-flight.
sidebar:
  order: 21
---

How podkit turns "here's my music collection" + "here's what's on the
device" into "here's a list of operations to run". One step on the
roadmap to a sync — see [`save-transactions.md`](./save-transactions.md)
for what happens once those operations start executing, and
[`error-handling.md`](./error-handling.md) for the warning/error
channels everything below funnels into.

This doc settled with the TASK-398 pre-sync sweep work that introduced
`PlanPreliminaries`. Prior to that, planning was purely a per-collection
concern. After: planning has a device-scoped pre-flight layer that
runs once per device regardless of how many collections share it.

---

## 1. Map

The planning pipeline is three primitives. Each is content-type-generic
and lives under `packages/podkit-core/src/sync/engine/`:

```
collection items        device items
       │                      │
       ▼                      ▼
   ┌────────────────────────────────┐
   │  SyncDiffer (differ.ts)        │  diff
   │  match → toAdd / toUpdate /    │  ─────
   │  toRemove / existing           │
   └────────────────┬───────────────┘
                    ▼
   ┌────────────────────────────────┐
   │  SyncPlanner (planner.ts)      │  plan
   │  classify each operation by    │  ─────
   │  device-codec compatibility    │
   │  + warnings + size + time      │
   └────────────────┬───────────────┘
                    ▼
              SyncPlan<TOp>
```

A *separate* device-scoped pre-flight produces `PlanPreliminaries` and
attaches it to the FIRST plan executed against the device. Music + video
collections against the same device share that pre-flight — only one
device walk, only one cleanup.

```
device adapter / contentPaths
       │
       ▼
   ┌──────────────────────────────────┐
   │  runPreSyncSweep                 │  PlanPreliminaries
   │  (pre-sync-sweep.ts)             │  ──────────────────
   │  scanner registry → debris paths │  attached to FIRST
   │  + phantom manifest entries      │  plan only
   └──────────────────────────────────┘
```

Planning does **not** own:
- Execution of the operations — that's the
  [pipeline/executor](./save-transactions.md).
- Source collection scanning — that's the collection adapter contract
  (pending architecture doc).
- Codec capability synthesis — that's the device capability resolver
  (pending architecture doc).

---

## 2. Primitives

### `SyncDiffer.computeDiff(...)` → `UnifiedSyncDiff`

Located in `sync/engine/differ.ts`. Takes source items + device items
and produces four buckets:

- `toAdd` — source items that don't appear on the device.
- `toUpdate` — items present on both, but the device copy is stale.
  Each carries an `UpdateReason` (see `types.ts:UpdateReason`).
- `toRemove` — device items the source no longer claims (typically
  acted on only when `--delete` / `removeOrphans` is set).
- `existing` — items already correct on the device.

The differ is dual-key matching aware: when transforms are enabled, a
track can match on its original metadata OR its transformed metadata.

### `SyncPlanner.plan(diff, options?)` → `SyncPlan<TOp>`

Located in `sync/engine/planner.ts`. Generic over operation type — music
operations and video operations are different shapes, so the planner is
parameterised on `TOp extends BaseOperation`. The planner:

1. Classifies each diff entry into a concrete operation type
   (`'add-transcode'` vs `'add-direct-copy'` vs `'add-optimized-copy'`,
   etc.) based on source format + device capabilities + user codec
   preferences.
2. Aggregates plan-phase `Warning`s (lossy-to-lossy conversions,
   space constraints, embedded-artwork resizes).
3. Computes `estimatedSize` + `estimatedTime` aggregates.

The classifier is the only place that knows about format → codec
mappings; downstream code (executor, presenter) consumes the operation
discriminant verbatim.

### `SyncPlan<TOp>` — the data the executor consumes

```ts
interface SyncPlan<TOp extends BaseOperation = SyncOperation> {
  operations: TOp[];
  estimatedTime: number;
  estimatedSize: number;
  warnings: Warning[];           // always phase: 'plan'
  preliminaries?: PlanPreliminaries;
}
```

A plan is **per-collection**. One sync run that spans music + video
produces two plans. Only the first plan carries `preliminaries`;
subsequent plans see `undefined` so the executor's pre-flight runs the
device-scoped cleanup exactly once.

### `PlanPreliminaries` — device-scoped pre-flight

```ts
interface PlanPreliminaries {
  debrisCleanup?: { paths: string[]; totalBytes: number };
  phantomPrune?: { paths: string[] };
}
```

Populated by `runPreSyncSweep` (see `sync/engine/pre-sync-sweep.ts`)
which calls the three diagnostic scanners from TASK-397:
mass-storage content debris, iPod content debris, and host
`os.tmpdir()` transcode-tmp residue. The scanner registry guarantees
**one FS walk per surface** — the doctor checks and the pre-sync sweep
reach the same walkers.

`debrisCleanup.paths` carries both individual files (`.podkit-tmp`
siblings) and abandoned directories (transcode-tmp dirs); the executor
uses `rm({ recursive: true, force: true })` for every entry so the
caller never has to discriminate kind.

`phantomPrune` is **advisory today** — the pre-flight emits a Warning
recommending `podkit doctor --repair orphan-files` but doesn't auto-prune
the manifest. Full prune execution is a follow-up; the manifest rewrite
crosses the adapter contract boundary which this sweep module
deliberately doesn't touch.

---

## 3. Responsibility boundaries

| Owner | Responsibility |
|---|---|
| Collection adapter | Surface source items + their metadata. No diff awareness. |
| `SyncDiffer` | Match source ↔ device. No codec / capability awareness. |
| `SyncPlanner` | Operation classification, plan-phase warnings, estimates. Stateless. |
| `runPreSyncSweep` | Device-scoped debris + phantom-manifest discovery. Stateless. Tolerant of every scanner failure. |
| `genericSyncCollection` (CLI) | Wires diff → planner → executor for one collection. Stamps the device-level preliminaries onto the FIRST plan only. |
| Sync orchestrator (`sync.ts`) | Runs the pre-sync sweep ONCE per device. Threads preliminaries to the first `genericSyncCollection` call; subsequent calls receive `undefined`. |
| Executor pre-flight | Consumes `plan.preliminaries` and runs the cleanup before any track ops. Emits `Warning('debris-cleanup-failure')` per failed unlink. |
| Presenter `buildDryRunJson` / `renderDryRunText` | Renders preliminaries summary alongside per-collection plan details. |

Two invariants the layout enforces:

- **No double walk.** The doctor `debris-files-*` checks and the
  pre-sync sweep reach the same walker functions (see
  `diagnostics/scanners/`). One scan, multiple consumers.
- **One cleanup per device sync.** The `preliminariesConsumed` flag in
  the orchestrator + the FIRST-plan-only stamping in
  `genericSyncCollection` together guarantee the executor's pre-flight
  fires exactly once even when music + video share a device.

---

## 4. Conventions for new contributors

1. **Plan-phase warnings flow as return values.** `SyncPlanner.plan()`
   returns `warnings: Warning[]` (always `phase: 'plan'`). Don't emit
   plan-phase warnings through `WarningSink` — sinks are for
   execute-phase only. See [`error-handling.md`](./error-handling.md).

2. **Operation types are exhaustive at planner-output time.** Adding a
   new content-type-specific operation means: (a) extend the operation
   union in `sync/<content>/types.ts`, (b) handle every operation in
   the planner's classifier, (c) extend the executor + presenter to
   render it. Compiler will scream at every step if you miss one.

3. **PlanPreliminaries is device-scoped.** Don't add per-collection
   data to it. If a new pre-flight step is per-collection (artwork
   pre-fetch, source-collection validation, etc.), it belongs in the
   collection's own planner/diff phase, not here.

4. **Scanner registry consumers must be passive walkers.** New entries
   in `diagnostics/scanners/index.ts` must be debris-only — every path
   the scanner returns must be safe to delete by construction. Orphan-
   style "could be user content" categories belong in the check
   registry, not the scanner registry.

5. **Adding a new pre-flight category** (e.g. a free-space probe under
   TASK-378) means extending the `PlanPreliminaries` shape, the
   `runPreliminariesPreFlight` consumer, and the presenter dry-run JSON
   shape. The orchestrator + per-collection plan stamping plumbing
   stays the same.

---

## 5. Scope boundaries

- **Source scanning** — not here; see the collection-adapters series
  (pending architecture docs).
- **Codec compatibility synthesis** — handled by the capability
  resolver upstream of `SyncPlanner`; the planner consumes already-
  resolved capabilities. Pending `device/capabilities.md` for the
  resolver itself.
- **Operation execution** — the planner stops at `SyncPlan`. The
  executor and the per-content pipeline handle execution; see
  [`save-transactions.md`](./save-transactions.md) and (pending)
  `execution-pipeline.md`.
- **Self-heal** — when a save partially fails, the *next* sync's diff
  re-detects the gap because the source ↔ device match no longer holds.
  Planning is the engine that powers self-heal but it doesn't *know*
  it's self-healing; the rescan contract is described in
  `save-transactions.md` §2.

---

## 6. Open work

- **Phantom-manifest auto-prune.** The pre-flight surfaces phantom
  entries but emits an advisory Warning rather than auto-pruning the
  manifest (the rewrite crosses the adapter contract boundary). A
  follow-up should add `MassStorageAdapter.prunePhantomManifest(paths)`
  and consume it from the pre-flight.
- **Free-space probe rewrite (TASK-378).** Today `willFit` is a single
  subtraction (`estimatedSize <= storage.free + debrisFreedEstimate`).
  The probe rewrite will expand this into a proper accounting model
  (reserved space for libgpod overhead, sync-tag overhead, etc.).
  `PlanPreliminaries` is the right place to extend with the probe's
  output.
- **Unified plan across content types.** Today one device sync produces
  N per-content-type plans (music + video). A future refactor may
  collapse `collections[]` into a single `operations[]` to enable
  cross-content batching (e.g. parallel music + video transfer queues).
  `PlanPreliminaries` lives at the right level for that refactor — it
  doesn't need to move when plans unify.
- **libgpod tmp-suffix coverage** (carried forward from TASK-397).
  libgpod's `g_file_set_contents` writes use random-suffix dotfiles
  (`.iTunesDB.tmpXXX`), which the existing dotfile filter skips. A
  separate detector for this class of residue is open work.

---

## 7. References

- **Code:**
  - `packages/podkit-core/src/sync/engine/differ.ts` — `SyncDiffer`.
  - `packages/podkit-core/src/sync/engine/planner.ts` — `SyncPlanner`.
  - `packages/podkit-core/src/sync/engine/types.ts` — `SyncPlan`,
    `PlanPreliminaries`, `Warning`.
  - `packages/podkit-core/src/sync/engine/pre-sync-sweep.ts` —
    `runPreSyncSweep` + `runPreliminariesPreFlight`.
  - `packages/podkit-core/src/diagnostics/scanners/` — the three
    debris scanners + shared walkers consumed by both doctor + the
    pre-sync sweep.
  - `packages/podkit-cli/src/commands/sync.ts` — orchestrator that
    runs the device-level sweep once per sync.
  - `packages/podkit-cli/src/commands/sync-presenter.ts` —
    `genericSyncCollection`, plan stamping, free-space envelope math.
- **Companion architecture docs:**
  - [`save-transactions.md`](./save-transactions.md) — what happens
    after the plan executes.
  - [`error-handling.md`](./error-handling.md) — how plan-phase + 
    execute-phase warnings flow.
- **Decisions:**
  - [ADR-009](../../../adr/adr-009-self-healing-sync.md) — the
    self-healing sync model that the planning layer enables.
- **Companion journals:**
  - `backlog/docs/doc-041` — save-transaction rough-edges journal
    (still active for the parts still in flux).
