---
title: "ADR-018: Free-Space Pre-Flight Strategy"
description: Recompute willFit post-sweep using a fresh statfs read so the executor surfaces a single coherent ENOSPC failure before any track is attempted, instead of leaking accounting drift into the transfer-phase per-track error stream.
sidebar:
  order: 19
---

# ADR-018: Free-Space Pre-Flight Strategy

## Status

**Proposed**

## Context

Podkit gates a sync on a free-space pre-check before any transfer runs.
The current chain:

1. **Plan-time** (`SyncPlanner.plan` →
   `packages/podkit-core/src/sync/engine/planner.ts:139-167`): sums
   `handler.estimateSize(op)` for every operation. Music estimates use
   typical-bitrate × duration (`estimateCopySize` in `sync/music/planner.ts:282`)
   or target-bitrate × duration (`estimateTranscodedSize`,
   `planner.ts:265`). The result is `plan.estimatedSize`.

2. **Plan-time envelope** (`genericSyncCollection` →
   `packages/podkit-cli/src/commands/sync-presenter.ts:477-479`):
   ```ts
   const debrisFreedEstimate = plan.preliminaries?.debrisCleanup?.totalBytes ?? 0;
   const effectiveFreeSpace = (storage?.free ?? 0) + debrisFreedEstimate;
   const hasEnoughSpace = presenter.willFit(plan, effectiveFreeSpace, core);
   ```
   `willFit` is `estimatedSize <= effectiveFreeSpace`. On false, the
   sync exits early with `"Not enough space. Need X, have Y"`
   (`sync-presenter.ts:591` for JSON, `:595-601` for text). No track is
   attempted.

3. **Execute-time pre-flight** (`runPreliminariesPreFlight` →
   `packages/podkit-core/src/sync/engine/pre-sync-sweep.ts:195-294`):
   actually deletes the debris paths and returns `PreFlightResult.freedBytes`.
   Per-path failure becomes a `Warning('debris-cleanup-failure')` and
   the loop continues — the pre-flight never throws. **The returned
   `freedBytes` is currently only used to format a log line; it is not
   fed back into any free-space recalculation.**

4. **Transfer-phase** (`packages/podkit-core/src/sync/engine/executor.ts:218-300`):
   atomic-write helpers write to `.podkit-tmp` then rename. An ENOSPC
   inside an individual operation throws a typed error
   (`MoveError`/`TagWriteError`/`PictureWriteError` per ADR-009 +
   TASK-381). The executor catches it per-track, accumulates the
   typed error, and continues if `continueOnError` is set.

### The gap this ADR closes

TASK-398's implementation plan (filed 2026-06-07) flagged the
unresolved decision:

> Plan-time estimate is generous (assumes sweep will free
> `totalBytes`). Execute-time `PreFlightResult.freedBytes` returns
> *actual* freed bytes but is NOT fed back into any free-space
> recalculation. Decide:
>
> 1. Recompute `willFit` after the pre-flight using actual freed
>    bytes (re-fail the sync if space is now insufficient).
> 2. Trust the plan-time generosity + rely on per-track ENOSPC
>    handling at the transfer phase (current behaviour).

### Why current behaviour (option 2) hurts

When the sweep partially fails — `rm` returns EACCES/EIO/ENOENT-race
for some paths — the plan-time envelope is over-counted by the bytes
those paths would have freed. The transfer phase then runs, and the
first track that pushes the device over the actual free-space limit
ENOSPCs in the middle of its write. The executor catches it as a
single per-track typed error. Subsequent tracks in the same batch
ALSO ENOSPC (the device is full) and each surfaces as a separate
per-track failure. The user sees N consecutive typed-error rows
without a coherent "the device filled up after debris cleanup
fell short" signal.

The same shape happens when the planner estimate is itself drifted
— transcode produces files larger than `estimateTranscodedSize`
predicts, source files were added between plan and execute, etc.
— but those are orthogonal concerns: option 1 closes the
sweep-partial-fail gap specifically.

## Decision Drivers

- The user-facing error surface should report ENOSPC **once**, at
  the boundary that decides "we cannot proceed", not N times in the
  transfer stream.
- The pre-check primitive (`willFit`) already exists. Re-using it
  costs nothing in code volume.
- A post-sweep recompute MUST read fresh disk state (not just
  subtract `freedBytes` from the plan-time envelope) — concurrent
  processes and OS background reclaim can move free-space between
  the two reads. `freedBytes` is a lower bound on the recovery, not
  a complete accounting.
- The recompute MUST be tolerant of `statfs` failure. A re-read that
  itself errors should not turn a recoverable sweep-partial-fail
  into an opaque crash; falling back to the current "trust the plan"
  behaviour on statfs failure is acceptable.
- The recompute does NOT close the planner-estimate-drift class of
  bugs (transcode-bigger-than-estimate, etc.). Those need separate
  audit work; out of scope for this ADR.

## Options Considered

### Option 1: Recompute willFit post-sweep (Chosen)

After `runPreliminariesPreFlight` returns, re-read `storage.free` via
`statfsSync` and re-run `presenter.willFit(plan, freshFree, core)`.
If false, abort the sync with a typed `InsufficientSpaceAfterCleanup`
error (subclass of `CategorizedSyncError` per the ADR-009/TASK-381
typed-error model). No track has been attempted at this point;
the device's only state change is the debris removal, which is
beneficial regardless.

**Pros:**
- Single coherent ENOSPC error before any track attempt.
- Honest accounting — reads real disk state, not a derived estimate.
- Composes cleanly with the existing `--json` errors[] contract.
- Captures sweep-partial-fail without requiring the user to dig
  through per-track typed-error noise.

**Cons:**
- New exit point in the executor's pre-flight phase. One more
  place that can fail the sync.
- Doesn't address planner-estimate drift (transcode > estimate).
  That gap remains and still leaks into per-track transfer errors.
- Adds a statfs call. Negligible cost on local filesystems;
  noticeable on slow network mounts but irrelevant for the
  device sync surface (local USB / SATA in every supported case).

### Option 2: Trust the plan, surface ENOSPC per-track (status quo)

Leave the current behaviour: `PreFlightResult.freedBytes` stays a
log-line input only; ENOSPC reaches the transfer phase and surfaces
as per-track typed errors.

**Pros:**
- Zero new code. The infrastructure is already there.
- Per-track resolution is technically richer — the user knows
  which specific track failed.

**Cons:**
- Noisy error surface — N tracks fail with identical ENOSPC noise.
- No coherent "device filled mid-sync" signal.
- The partial state on the device is wider — every attempted-but-
  failed track leaves a `.podkit-tmp` for the next sweep, instead
  of zero attempted tracks under option 1.

### Option 3: Hybrid — recompute only when `failedPaths` is non-empty

Skip the statfs re-read on a fully-successful sweep; only recompute
when `PreFlightResult.failedPaths.length > 0`.

**Pros:**
- Eliminates the statfs cost on the common path.

**Cons:**
- The statfs cost was already negligible. Optimising it adds branch
  complexity without measurable savings.
- A successful sweep still doesn't mean disk state matches
  `effectiveFreeSpace` — concurrent writers can change it. The
  "honest read" argument applies to the happy path too.

## Decision

**Option 1.** Recompute `willFit` after `runPreliminariesPreFlight`
using a fresh `statfsSync` read. On insufficient space, throw a
typed `InsufficientSpaceAfterCleanup` error (a new subclass of
`CategorizedSyncError`, category `space`). The error's payload
carries `bytesNeeded`, `bytesAvailable`, `bytesFreedBySweep`, and
`failedSweepPaths` so the `--json` envelope can render structured
detail.

### Implementation outline

In `packages/podkit-core/src/sync/engine/executor.ts` around line
210 (after `runPreliminariesPreFlight`):

```ts
if (plan.preliminaries) {
  const preflight = await runPreliminariesPreFlight(plan.preliminaries, {...});
  const freshFree = safeStatfsFree(devicePath);
  if (freshFree !== undefined && plan.estimatedSize > freshFree) {
    throw new InsufficientSpaceAfterCleanup({
      bytesNeeded: plan.estimatedSize,
      bytesAvailable: freshFree,
      bytesFreedBySweep: preflight.freedBytes,
      failedSweepPaths: preflight.failedPaths,
    });
  }
}
```

The recompute runs **unconditionally** when `preliminaries` is
present, not just when the sweep removed something. The "concurrent
processes can shift free-space between plan and execute" rationale
in Decision Drivers applies to the no-debris case too — a clean
sweep doesn't prove disk state matches the plan-time envelope. The
cost of an unconditional statfs is negligible on the local
filesystems podkit targets.

`safeStatfsFree` returns `undefined` on statfs failure; the caller
falls back to the plan-time envelope (current behaviour). The new
error class lives alongside the other typed errors in
`packages/podkit-core/src/sync/engine/errors.ts`.

### What this does NOT change

- `handler.estimateSize` accuracy. Estimate drift remains a
  separate audit item (TASK-378 AC #2 situation #3).
- Per-track ENOSPC handling in the transfer phase. If estimate
  drift or a concurrent writer pushes the device over after this
  recompute, the per-track typed errors still fire. The recompute
  catches the sweep-partial-fail case specifically.
- Doctor's free-space surface. Doctor reports remain a separate
  read of `storage.free`.

## Consequences

### Positive

- Sweep-partial-fail produces a single coherent error.
- `--json` errors[] gains a structured ENOSPC payload that
  `sync-presenter.ts:591`'s string-error path doesn't currently
  carry (paving the way for TASK-378 AC #8's broader JSON envelope
  work).
- Device state on rejection is narrower — only the debris was
  removed; no half-written tracks.

### Negative

- One new typed-error class to maintain (low cost — the hierarchy
  already exists).
- One new statfs call per sync (negligible on local filesystems).

### Open follow-ups

- Estimate-drift gap (transcode-bigger-than-estimate, etc.). File
  separate work if the audit's situations catalogue (TASK-378 AC #2)
  warrants it.
- Mid-save ENOSPC reachability test (TASK-378 AC #7). Requires a
  new `SystemState` variant that forces estimate drift, since
  device-full-at-start is now caught by both the plan-time and
  post-sweep checks.

## References

- TASK-378 (free-space handling audit; AC #4 + AC #8 anchor this ADR)
- TASK-398 (pre-sync sweep — left the freedBytes hand-off open)
- TASK-381 / ADR-009 (typed-error model this extends)
- `documents/architecture/sync/planning.md` §3 + §6 (current free-space math + degradation note)
- `documents/architecture/sync/save-transactions.md` §3 (pre-sync sweep responsibility)
- `backlog/docs/doc-041` §5.3 (the original ENOSPC gap entry)
