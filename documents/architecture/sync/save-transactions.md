---
title: Save Transactions
description: How save() works in podkit's device adapters, what survives a partial failure, and how the next sync's rescan self-heals.
sidebar:
  order: 2
---

Describes how each device adapter's `save()` flushes in-memory mutations
into device-persistent state, what happens when a stage fails partway,
and the eventual-consistency contract the next sync relies on to recover.

Cross-cutting rules (typed errors, no `console.warn` in core,
sink-not-stderr) live in [conventions](../conventions.md). The error and
warning model is described in
[sync/error-handling](./error-handling.md) — read that first if you're
new to the codebase.

Companion reading — open rough-edges journal:
[doc-041 — Save-Transaction Design and State of Play](../../../backlog/docs/doc-041%20-%20Save-Transaction-Design-and-State-of-Play.md).

---

## 1. Map

A sync run ends with one or more `device.save()` calls. `save()` is the
moment podkit's in-memory mutations cross into the device's persistent
state. Each device adapter (`IpodAdapter`, `MassStorageAdapter`) owns its
own `save()`; the sync engine treats it as an opaque boundary — call it,
catch the typed errors, accumulate the warnings, move on.

"Transaction" is aspirational. Today `save()` is closer to
**best-effort flush + eventual-consistency-via-rescan**: each stage
flushes what it can, throws a typed error on hard failure, leaves any
half-completed state visible on the device so the next sync's diff
engine re-detects the gap and re-queues. The file system IS the
write-ahead log. This document describes the settled shape of that
contract; the rough-edges still under debate live in the doc-041 journal.

---

## 2. Primitives

### `DeviceAdapter.save()`

Both adapters expose the same signature:

```ts
save(): Promise<void>
```

Returns void. Throws a typed `CategorizedSyncError` on hard failure.
Emits structured `Warning` objects through the injected `WarningSink`
for soft signals. Nothing else — no return tuple, no result type, no
status enum.

### `MassStorageAdapter.save()` flush stages

Six stages, in order. Each stage gates the next: if a stage throws,
later stages do not run. Within a stage, all writes settle before the
typed aggregate is thrown. `save()` is the orchestration shell —
each stage lives in its own private method (`flushMoves`,
`flushTagWrites`, `flushPictureWrites`, `flushSidecarWrites`,
`flushSidecarDeletes`, `writeManifest`) so the contract per row reads
off the code.

| Stage              | Pending source            | Shape                                      | Typed error          | Map cleared    |
|--------------------|---------------------------|--------------------------------------------|----------------------|----------------|
| 1. File moves      | `pendingMoves`            | for-loop, serial, ENOENT skip emits warning | `MoveError`          | only on success |
| 2. Tag writes      | `pendingTagWrites`        | `runWithConcurrency` (cap 16), settle-all  | `TagWriteError`      | before throw   |
| 3. Picture writes  | `pendingPictureWrites`    | `runWithConcurrency` (cap 16), settle-all  | `PictureWriteError`  | before throw   |
| 4. Sidecar writes  | `pendingSidecarWrites`    | `runWithConcurrency` (cap 16), settle-all  | `SidecarWriteError`  | before throw   |
| 5. Sidecar deletes | `pendingSidecarDeletes`   | for-loop, per-entry predicate re-check, ENOENT silent | `SidecarWriteError` (reused) | before throw   |
| 6. Manifest        | `manifest` (in-memory)    | atomic write (tmp + rename)                | n/a (throws raw fs)  | n/a            |

Stages 2–4 share a single private helper, `flushPending<K, V>(map, work,
formatPath, ErrorCtor)`. Each stage's caller is three lines (map +
per-entry work + error class); the helper owns the
`runWithConcurrency` cap, the settle-all loop, the
clear-before-throw, and the `ErrorCause[]` construction. Adding a new
flush stage that follows the convention is an Nth line in the table,
not an Nth copy of the boilerplate.

Stage 5 (sidecar deletes) is bespoke — see §asymmetries below.

Stage 6's atomic write means a SIGKILL mid-write leaves either the old
manifest or no manifest — `loadManifest` treats an absent or
unparseable manifest as "empty manifest, rebuild from filesystem walk".
There is no torn-manifest failure mode.

### Errno on aggregate errors

Each aggregate flush error (`TagWriteError`, `PictureWriteError`,
`SidecarWriteError`, `MoveError`) carries two cause channels in
lockstep: a string array `causes: readonly string[]` that surfaces
verbatim into the `--json` envelope (`SyncOutput.errors[].causes`), and
a structured `structuredCauses: readonly ErrorCause[]` for in-process
consumers that need the underlying errno (`ENOSPC`/`EACCES`/`EROFS`/…).
The single-cause wrap `CopyError` populates both channels the same way.

The errno is what the categorizer's "ENOSPC → `'space'`" override reads
off — see [`error-handling.md` §2](./error-handling.md#2-hard-failures--categorizedsyncerror).
Without it, a mid-save ENOSPC inside a tag write would categorize as
`'copy'` (1 retry) and waste a second before the executor surfaces the
real failure. The structured channel keeps the routing decision out of
message-body inspection.

### `IpodAdapter.save()` flush stages

Two stages, in order:

| Stage                   | Source                  | Shape                                      | Failure handling                          |
|-------------------------|-------------------------|--------------------------------------------|-------------------------------------------|
| 1. iTunesDB write       | libgpod N-API binding   | atomic from podkit's perspective (libgpod tmp + rename) | wrap raw error → throw `DatabaseWriteError` |
| 2. Portable tag writes  | `pendingTagWrites`      | `runWithConcurrency` (cap 16), settle-all  | emit `tag-write` `Warning` via sink (soft) |

Stage 1 is hard: if libgpod fails, the run cannot continue — the
authoritative metadata didn't land. The raw native error is wrapped in
`DatabaseWriteError` at the boundary so the executor's categorizer
reads `'database'` (no retry) without inspecting the message body.

Stage 2 is soft. iTunesDB is the authoritative metadata store for
playback; the file-tag write is for "portable" mode where the user
pulls files off the device and expects them tag-complete. Failures
degrade portability but not playback. They emit a structured `Warning`
through the `WarningSink` rather than throwing.

### Why hard-vs-soft is adapter-specific

A given operation's hard/soft status depends on whether the device
treats that data as authoritative:

- Mass-storage **file tags ARE the source of truth.** A tag-write
  failure means the device will read the wrong metadata. Hard.
- iPod **iTunesDB IS the source of truth.** A file-tag write only
  matters when the user copies files off the device. Soft.

The *shape* (typed errors vs warning-sink) is uniform across adapters
even when the *classification* differs. See
[error-handling §2](./error-handling.md#2-hard-failures--categorizedsyncerror)
for the typed-error hierarchy.

### save() stage asymmetries (intentional)

The four flush stages in `MassStorageAdapter.save()` share the same broad
contract — typed aggregate error, clear-before-throw, self-heal via rescan —
but two intentional deviations exist. Neither is a deferred clean-up; both
are correct by design for their stage's natural unit.

#### Asymmetry 1: MoveError throws on first non-ENOENT

**Source:** `mass-storage-adapter.ts` line 1310 — the move stage is a
`for...of` loop. On the first `renameSync` failure that is not `ENOENT`, it
immediately throws `new MoveError([...])` with a single-entry `causes` array
and exits the loop. Later entries in `pendingMoves` are not attempted.

**Contrast:** tag, picture, and sidecar stages use `runWithConcurrency` /
`Promise.allSettled` and settle every pending write before checking failures.

**Rationale:** Each `renameSync` is an atomic, in-kernel operation — either
the file moved or it didn't; there is no torn intermediate state. Re-attempting
remaining moves after the first failure would start from stale assumptions
about parent-directory state (the failed rename may have been caused by
`ENOSPC` or `EACCES` on the directory tree, meaning every subsequent rename
would fail too). Settle-all would buy nothing except a longer error list that
hides the one cause that mattered. The self-heal path is clean: the source
file still exists at its old path (the rename never ran), so the next sync's
diff re-detects the gap and re-queues the move.

**Self-heal:** the next sync's rescan sees the file at its old path and
re-queues the move — no additional mechanism required. This is why the
`pendingMoves` map is cleared on success but NOT cleared on throw: the
surviving entries re-fire themselves on the next `save()` via their
ENOENT-skip path (moved entries now missing → skip; unmoved entries → retry).

#### Asymmetry 2: SidecarWriteError aggregates per-album, not per-file

**Source:** `pendingSidecarWrites` (line 574) is keyed by `albumDir` (a
relative directory path). When `queueSidecarWrite` is called for multiple
tracks in the same album directory, they collapse to a single entry: the
last queued image wins, and only one `writeSidecarAtomically` call fires per
album at save time. Consequently, `SidecarWriteError.causes` carries one
entry per failing **album**, not one entry per failing track.

**Contrast:** `pendingTagWrites` and `pendingPictureWrites` are both keyed by
file path (lines 527 and 534). `TagWriteError.causes` and
`PictureWriteError.causes` each carry one entry per failing **file**.

**Rationale:** The sidecar's natural unit of work IS the album directory —
one `cover.jpg` per directory, shared by all tracks in it. There is no such
thing as a "per-file sidecar write"; per-file aggregation would mean the same
album entry appearing N times in `causes` (once per track). The
per-album key at queue-time is not an implementation shortcut; it is the
correct model.

**Implication for diagnostics:** a `SidecarWriteError` surfaces as "Album X
cover failed", not "Track 1, Track 2, Track 3 cover failed". This is better
signal for the repair action (re-examine the album directory or the source
image, not individual tracks).

#### Asymmetry 3: Sidecar deletes re-evaluate the predicate per entry at flush time

**Source:** `pendingSidecarDeletes` (a `Set<albumDir>`) is populated by
`removeTrack` (last managed track leaves the dir) and `relocateTrack`
(cross-album move, source dir loses its last track). The check is
optimistic at queue time: if the dir is still occupied by a sibling, no
entry is added. But subsequent plan steps can re-occupy the dir before
save: a `relocateTrack` whose destination is the same dir, an `addTrack`
on a new track for that album, even a re-add after a same-cycle remove.

**Behaviour:** `flushSidecarDeletes` re-checks `albumDirStillOccupied`
per entry against the final `this.tracks` state AND pending-move
destinations. Stale queue entries (the dir is occupied again) are
skipped silently — the manifest entry stays. The unlink happens AND
`managedFiles` is mutated only for entries whose predicate still holds.

The same `SidecarWriteError` class wraps unlink failures (an EACCES /
EROFS that the user needs to know about) — symmetric with the
write-side handling. `ENOENT` is silent success: legacy device data
from before sync-time cleanup existed has manifest entries with no
on-disk file; the drop-from-manifest happens regardless so the next
sync's symmetric pass doesn't flag a phantom.

**Contrast:** stages 2–4 act on every queue entry unconditionally
because the entry IS the source of truth (the bytes to write, the tag
fields to apply). The delete stage's source of truth is "is this dir
abandoned NOW?", which the queue entry only optimistically asserts.

**Rationale:** an artwork pipeline that skips `writeSidecar` (e.g. the
hash matched and no re-write is needed) would otherwise let a stale
delete kill a cover.jpg the new track depends on. Re-evaluation is the
clean fix; restoring `managedFiles` from a queue-time mutation would
require a fragile second-bookkeeping channel.

---

These are intentional exceptions to the §4 convention on normalizing the
failure shape. A future refactor proposing to unify these stages would need to
refute the rationales above explicitly before doing so.

### The rescan contract (self-heal across runs)

Mass-storage's source of truth is **the file tags on the device**, not
podkit's in-memory model or even the manifest. The manifest is a
cache: podkit re-derives `managedFiles` from
`manifest.managedFiles ?? walk(mount)` at `open()` time.

This drives the eventual-consistency behaviour every flush stage
relies on:

| Stage failure         | What's on the device after fail                  | What the next sync sees on rescan                                  |
|-----------------------|--------------------------------------------------|--------------------------------------------------------------------|
| Tag write             | File still has the previous sync's tag           | `detectUpgrades` sees source/device delta → re-queues tag write    |
| Picture write         | File still has the previous embedded picture (or none) | Diff re-detects the missing/stale picture → re-queues                |
| Move                  | File still at old path                           | Diff sees it at old path → re-queues move if path template still wants it |
| Sidecar write         | No `cover.jpg` (or stale cover) in album dir      | Sync re-fires `artwork-added`                                       |
| Sidecar delete        | `cover.jpg` still on disk in an empty album dir; manifest no longer claims it | Orphan check flags it; `podkit doctor --repair orphan-files` cleans |

The cost of "self-healing via rescan" is one extra sync. The win is
that podkit doesn't have to maintain a write-ahead log or two-phase
commit machinery — the file system IS the log.

**Limit:** self-healing only works if the diff engine notices the gap.
If a write silently succeeds-then-rots (taglib writes a tag the device
firmware ignores), no rescan will detect it. That's a separate concern
tracked outside this doc (see ADR-009 for the broader rationale).

### Free-space contract — execute-time

The execute side of the free-space contract complements the plan-time
gate described in
[`planning.md` §2 "Free-space contract — plan-time"](./planning.md#free-space-contract--plan-time).
Plan-time decides "should we even try"; execute-time handles "what
happens when reality diverges from the plan".

Three execute-time pathways carry ENOSPC signal today:

1. **Post-sweep recompute** (ADR-018, landed TASK-378). After
   `runPreliminariesPreFlight` finishes, the executor re-reads
   `storage.free` via `statfsSync` and re-runs `willFit` against the
   fresh value. If insufficient, it throws a typed
   `InsufficientSpaceAfterCleanup` (subclass of `CategorizedSyncError`,
   category `space`). This closes the sweep-partial-fail gap: the
   user gets a single coherent ENOSPC failure before any track is
   attempted, instead of N consecutive per-track ENOSPC errors as the
   transfer phase exhausts a not-quite-recovered device. See
   [ADR-018](../../../adr/adr-018-free-space-pre-flight-strategy.md).
2. **Per-track ENOSPC at atomic write.** The atomic-write helper
   writes to `<target>.podkit-tmp`, fsyncs, then renames. An ENOSPC
   during the write throws inside the stage; the stage wraps it in its
   typed error (`MoveError`/`TagWriteError`/`PictureWriteError`/
   `SidecarWriteError` per the asymmetry table above, or `CopyError`
   for the track-body copy in `copyTrackFile`/`replaceTrackFile`) and
   propagates to the executor. The aggregates carry the underlying
   errno on `structuredCauses[i].errno`, so the categorizer's
   "any-cause-ENOSPC → `'space'`" override routes to category
   `'space'` (no retry) instead of the class's declared `'copy'`
   (1 retry). The half-written `.podkit-tmp` survives on disk until
   the next pre-sync sweep removes it. This handles estimate-drift
   and source-added-between-plan-and-execute cases — the post-sweep
   recompute can't catch them because the planner's own estimate is
   what underestimated.
3. **Sweep failure as a warning, not a hard fail.** When the pre-flight
   `rm` itself fails for some debris paths, the failures are emitted
   as `Warning('debris-cleanup-failure')` rather than fatal errors —
   the sync continues. ADR-018's post-sweep recompute is what
   converts a *consequential* sweep failure (one that leaves the
   device unable to fit the plan) into a hard error; *inconsequential*
   sweep failures (enough space recovered anyway) stay as warnings.

#### Atomic-write contract under ENOSPC

The per-track atomic-write contract is honoured under ENOSPC: a
mid-write failure leaves the target file unchanged and the
`.podkit-tmp` partial on disk. Two consequences:

- **No torn target.** The user's prior version of the track stays
  intact. The next sync's diff re-detects the failed update and
  re-queues it.
- **`.podkit-tmp` accumulates until the next sweep.** TASK-398's
  pre-sync sweep (see [§3 Pre-sync sweep](#pre-sync-sweep)) cleans
  this debris automatically on the next run; `podkit doctor --repair
  debris-files` is the manual backstop.

#### What the user sees

| Situation                                  | Surfaced as                                              |
|--------------------------------------------|----------------------------------------------------------|
| Device full at start                       | Plan-time `"Not enough space. Need X, have Y"` (CLI exit)|
| Sweep partial-fail + still insufficient    | `InsufficientSpaceAfterCleanup` (post ADR-018)           |
| Sweep partial-fail + still sufficient      | `Warning('debris-cleanup-failure')` + sync continues     |
| Estimate drift / mid-batch ENOSPC          | Per-track typed errors (`MoveError`/`TagWriteError`/...) |
| iPod libgpod ENOSPC at database write      | `DatabaseWriteError` (single hard fail; rescan recovers) |

The first row exits before any device-state change; rows 2-3 exit
after the sweep but before any track is attempted; rows 4-5 surface
through the executor's per-operation typed-error channel. The
boundary between rows 3 and 4 is the only one that has changed
recently — see ADR-018 for the rationale.

---

## 3. Responsibility boundaries

### Adapter

- **Knows:** which mutations are pending, what failure category each
  stage's operations belong to, whether each stage is hard or soft.
- **Throws:** a typed `CategorizedSyncError` subclass for hard
  failures, aggregated per-entry into `causes`.
- **Emits:** structured `Warning` objects through the injected
  `WarningSink` for soft signals (ENOENT-skipped relocates,
  best-effort portable tag failures on iPod).
- **Never:** logs to console, retries internally, decides next-run
  recovery — the rescan contract owns recovery.

### Pipeline / executor

- **Awaits:** `save()` at the executor's chosen save checkpoint
  (e.g. `MusicPipeline` saves every `saveInterval` ops + once at end).
- **Catches:** typed errors → reads category → applies retry policy
  per [error-handling §2.5](./error-handling.md#retry-policy).
- **Accumulates:** warnings into `ExecuteResult.warnings`.
- **Never:** opens the manifest, infers what landed on disk, looks
  inside the typed error's `causes`.

### Next-sync rescan

- **Owns:** the retry path for everything the previous save() didn't
  flush.
- **Drives:** `detectUpgrades` reads device tags, compares against
  source, queues whatever's missing.
- **Assumes:** the device-side state after a partial save is "what
  actually landed" — not the manifest's pre-save snapshot.

### Sidecar lifecycle (mass-storage, sidecar-primary)

- **Invariant:** every managed sidecar (`<albumDir>/cover.jpg` recorded
  in `managedFiles`) has at least one managed audio sibling in the
  same dir at flush time. Doctor's orphan check is the backstop if the
  invariant is ever violated by a partial save or by external
  manipulation.
- **Sync-time enforcement.** `removeTrack` and `relocateTrack` call
  `maybeQueueSidecarDelete(albumDir)` when their mutation drops the
  last managed audio from a dir. The queue-time predicate is
  optimistic; the authoritative re-check fires in `flushSidecarDeletes`
  against the final track-list + pending-move destinations.
- **replaceTrackFile is dir-stable.** Codec swaps regenerate the
  filename in the same album dir (path = `track.filePath.replace(/\.[^.]+$/, newExt)`,
  and the dedupe loop only appends `-N` suffixes within the same parent).
  Sidecar lifecycle is unaffected — no `maybeQueueSidecarDelete` call
  needed. If a future change makes codec-swap cross dirs, this
  invariant breaks silently; the contract must be revisited.
- **Write wins over delete in one save cycle.** `writeSidecar` clears
  any pending delete for the same dir. Stale queue entries that survive
  to flush (re-add bypassed `writeSidecar` because the artwork pipeline
  short-circuited on a hash match) are dropped at flush-time via the
  predicate re-check.

### Pre-sync sweep

- **Owns:** debris cleanup at sync start (TASK-398). Before any track
  ops run, `runPreSyncSweep` calls the same walkers the doctor
  `debris-files-*` checks consume and produces a `PlanPreliminaries`.
  The executor's pre-flight unlinks every path in the `debrisCleanup`
  bucket before transferring tracks.
- **Co-owner with doctor of the rescan-recovery responsibility.** doctor
  used to be the only path to clean `.podkit-tmp` residue between
  failed syncs; the pre-sync sweep now does it by default for any
  device the user actually syncs. doctor stays the backstop for
  devices that aren't being synced and for the edge case where the
  sweep itself failed (failures are non-fatal — the next sync retries).
- **Device-scoped, runs once per `runSyncAction`.** Music + video
  collections against the same device share one sweep — only one walk,
  only one cleanup. The orchestrator stamps the result onto the FIRST
  collection's plan and leaves subsequent collections' plans without
  preliminaries.
- **Free-space envelope.** Estimated debris bytes are added to the
  available side of the `willFit` check (not subtracted from
  `estimatedSize`). The plan-time math lives in
  [planning.md "Free-space contract — plan-time"](./planning.md#free-space-contract--plan-time);
  the post-sweep recompute decision is captured in
  [ADR-018](../../../adr/adr-018-free-space-pre-flight-strategy.md)
  and the user-visible failure modes are tabled in
  [§2 "Free-space contract — execute-time"](#free-space-contract-execute-time).

### `podkit doctor`

- **Owns:** cleanup of debris a save() may leave on partial failure
  (`.podkit-tmp` files from a torn atomic write, orphaned sidecar
  covers, manifest-vs-filesystem drift). Now SHARED with the pre-sync
  sweep above — doctor is the backstop for devices that don't get
  synced and for cases where the sweep itself failed.
- **Not in the save() path.** Doctor is an opt-in recovery tool, not
  an automatic post-save sweeper.
- **Orphan vs debris split (TASK-397).** Doctor's view of "stale stuff
  on disk" now distinguishes two categorically different concerns:
  - **Orphans** — media files on disk that aren't in the manifest /
    iTunesDB. May be user-placed (intentional) or pre-podkit content.
    Repair is confirmation-gated.
  - **Debris** — podkit's own incomplete-write residue (`.podkit-tmp`,
    adapter-failure `.Audio file`). Always podkit-owned, always
    incomplete by construction. Repair is safe-by-design — no prompt.
  Both classes are produced by the same FS traversal (one walker per
  device surface) but surfaced under separate check IDs
  (`orphan-files`, `debris-files`) so the pre-sync sweep (TASK-398)
  can safely auto-clean debris without ever touching user-owned
  orphans.

### Scanner registry

- **Owns:** the read-only "what podkit residue is here?" survey.
  Mirrors the `DiagnosticCheck` registry shape but answers a
  different question — every path a scanner returns is safe to
  delete because it represents an atomic-write tmp that never
  completed.
- **Consumers:** the doctor `debris-*` checks reach the same walkers
  the scanner registry exposes (no double traversal). The pre-sync
  sweep (TASK-398) consumes the scanner registry directly at sync
  start, so debris cleanup happens by default — doctor is the
  backstop, not the primary surface.

---

## 4. Conventions for new contributors

When adding a new flush stage to an existing `save()`, or a new
adapter's `save()`:

1. **Normalize the failure shape.** Every flush stage should
   - use `runWithConcurrency` with a documented cap (EMFILE safety on
     large libraries),
   - settle ALL writes before checking failures (no fail-fast — one
     failure must not black-hole the rest of the batch),
   - aggregate per-entry failures into a typed
     `CategorizedSyncError` subclass whose `category` is read by
     `instanceof`, not by message inspection.
   - clear the pending map BEFORE throwing (exception: the move stage
     retains for-loop semantics and does not clear on hard failure —
     see [§2 save() stage asymmetries](#save-stage-asymmetries-intentional)
     for the full rationale). Self-healing via rescan is the retry
     path; in-adapter retry is not.

2. **Atomic writes for on-file mutations.** All on-file mutations
   (tag writes, picture writes, sidecar writes, new flushes) must
   write to `<file>.podkit-tmp` then rename over the target via
   `atomicWriteFileWithSync`. A SIGKILL mid-write leaves a
   `.podkit-tmp` behind (cleaned by `podkit doctor`), never a torn
   target. All three existing mutation stages use this pattern:
   `writeSidecarAtomically`, `TagLibTagWriter.writeTags`, and
   `TagLibTagWriter.writePicture` all delegate to
   `atomicWriteFileWithSync`.

3. **Pin the failure behaviour with tests.** Each new stage should
   land with a "save-failure behaviour pinning" describe block in the
   adapter's test file: which stage throws, what landed on disk before
   the throw, whether the pending map cleared, what the typed error's
   `causes` carry. The mass-storage adapter's
   `mass-storage-adapter.test.ts` "Save-failure behaviour pinning"
   block is the template; the broader cross-adapter coverage matrix
   is tracked in doc-041 §4.3.

When deciding hard vs. soft:

- Authoritative metadata failures (mass-storage tags,
  iTunesDB write) are **hard.**
- Best-effort or "portable" data failures (iPod file tags, ENOENT
  during move) are **soft** — emit a `Warning` via the sink.

When in doubt, copy what an existing flush stage of the same shape
does. If your stage's flush story differs from the others in the same
`save()`, the asymmetry should be either eliminated or filed as a
rough-edge entry in doc-041 §3.

---

## 5. Scope boundaries

This document describes the settled `save()` contract. It does not
cover:

- **The rough-edges catalogue.** Open inconsistencies between stages
  (sidecar EMFILE risk, missing per-stage progress events, etc.) live
  in [doc-041 §3](../../../backlog/docs/doc-041%20-%20Save-Transaction-Design-and-State-of-Play.md).
- **The test-coverage state of play.** What's tested and what isn't
  for save-failure paths lives in
  [doc-041 §4](../../../backlog/docs/doc-041%20-%20Save-Transaction-Design-and-State-of-Play.md).
  The save-failure matrix is being driven out by TASK-380.
- **The failure-modes catalogue.** Per-symptom behaviour for
  transient I/O, ENOSPC, SIGKILL, SIGINT, concurrent runs against
  one device, etc. lives in [doc-041 §5](../../../backlog/docs/doc-041%20-%20Save-Transaction-Design-and-State-of-Play.md).
- **Open design questions.** Lockfiles, per-stage progress events,
  daemon-mode semantics, dry-save mode live in
  [doc-041 §8](../../../backlog/docs/doc-041%20-%20Save-Transaction-Design-and-State-of-Play.md).
- **The error/warning model itself.** How typed errors flow through
  the engine, how warnings reach the CLI, what categories drive retry
  — covered in [sync/error-handling](./error-handling.md).
- **Daemon-mode lifecycle.** Whether the daemon retries a failed
  cycle vs. proceeds to the next is an open question — see
  [doc-041 Q5](../../../backlog/docs/doc-041%20-%20Save-Transaction-Design-and-State-of-Play.md).

---

## 6. Open work

Tracked outside this document:

- **Daemon-mode `save()` semantics.** Should a failed save() retry
  inside the daemon loop (eats CPU until success) or proceed to the
  next cycle? Today the adapter is identical between CLI and daemon
  contexts; the call site decides. See doc-041 Q5.
- **Per-stage progress events** (`{stage, completed, total}`). The
  CLI currently renders an opaque "saving…" — surfacing per-stage
  granularity would let it show "writing tags (12/47)" without the
  adapter taking on rendering responsibility. See doc-041 Q1.

Settled work moved out of this section:

- ~~Sidecar flush stage uses bare `Promise.allSettled`~~ — closed by
  TASK-390 (`runWithConcurrency` cap, EMFILE-safe).
- ~~`lookupTrackRef` O(N²) at save-time~~ — closed by TASK-392 (lazy
  memoization at first ENOENT); superseded by TASK-417 (eager plan-time
  capture in `pendingMoves`, no flush-time lookup at all — memo and
  helper both deleted).
- ~~Cross-adapter asymmetry write-up~~ — closed by TASK-393
  (asymmetries documented in §2 above).
- ~~Save-failure matrix as a coherent test surface~~ — closed by
  TASK-380 (`save-failure-matrix.e2e.test.ts`); extended for mid-save
  ENOSPC paths by TASK-412.
- ~~Flush-stage triplicate boilerplate~~ — closed by TASK-416
  (`flushPending<K,V>` helper).
- ~~Pending-map rekey duplication across `relocateTrack` /
  `replaceTrackFile`~~ — closed by TASK-416 (`rekeyPendingWrites`
  private helper).
- ~~Errno lost on aggregate errors~~ — closed by TASK-416
  (`structuredCauses: ErrorCause[]` channel + `ENOSPC → 'space'`
  categorizer override).

---

## 7. References

- `packages/podkit-core/src/device/mass-storage-adapter.ts` —
  `save()` plus `flushMoves` / `flushTagWrites` / `flushPictureWrites` /
  `flushSidecarWrites` / `writeManifest` private stages, and the
  shared `flushPending<K, V>` helper they delegate to.
- `packages/podkit-core/src/device/ipod-adapter.ts` — `save()` at
  line 224.
- `packages/podkit-core/src/device/mass-storage-tag-writer.ts` —
  `TagWriteError`, `SidecarWriteError`, `PictureWriteError`,
  `MoveError`.
- `packages/podkit-core/src/utils/atomic-fs.ts` — `atomicWriteFile`
  primitive used by the manifest stage and the sidecar stage.
- `packages/podkit-core/src/sync/engine/errors.ts` —
  `CategorizedSyncError` base, `DatabaseWriteError`.
- [`sync/error-handling`](./error-handling.md) — companion doc for the
  error / warning model.
- [`adr/adr-009-self-healing-sync`](../../../adr/adr-009-self-healing-sync.md)
  — the design rationale behind eventual-consistency-via-rescan.
- [`backlog/docs/doc-041`](../../../backlog/docs/doc-041%20-%20Save-Transaction-Design-and-State-of-Play.md)
  — living journal for the rough-edges catalogue (§3), test state
  (§4), failure modes (§5), and open design questions (§8).
