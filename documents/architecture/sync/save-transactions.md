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

Five stages, in order. Each stage gates the next: if a stage throws,
later stages do not run. Within a stage, all writes settle before the
typed aggregate is thrown.

| Stage             | Pending source            | Shape                                      | Typed error          | Map cleared    |
|-------------------|---------------------------|--------------------------------------------|----------------------|----------------|
| 1. File moves     | `pendingMoves`            | for-loop, serial, ENOENT skip emits warning | `MoveError`          | only on success |
| 2. Tag writes     | `pendingTagWrites`        | `runWithConcurrency` (cap 16), settle-all  | `TagWriteError`      | before throw   |
| 3. Picture writes | `pendingPictureWrites`    | `runWithConcurrency` (cap 16), settle-all  | `PictureWriteError`  | before throw   |
| 4. Sidecar writes | `pendingSidecarWrites`    | `Promise.allSettled` (no cap), settle-all  | `SidecarWriteError`  | before throw   |
| 5. Manifest       | `manifest` (in-memory)    | atomic write (tmp + rename)                | n/a (throws raw fs)  | n/a            |

Stage 4 is the one stage that still uses bare `Promise.allSettled` with
no concurrency cap. The typed-aggregate and clear-before-throw
conventions are met; the EMFILE-safety normalisation is tracked
separately (see §6).

Stage 5's atomic write means a SIGKILL mid-write leaves either the old
manifest or no manifest — `loadManifest` treats an absent or
unparseable manifest as "empty manifest, rebuild from filesystem walk".
There is no torn-manifest failure mode.

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

The cost of "self-healing via rescan" is one extra sync. The win is
that podkit doesn't have to maintain a write-ahead log or two-phase
commit machinery — the file system IS the log.

**Limit:** self-healing only works if the diff engine notices the gap.
If a write silently succeeds-then-rots (taglib writes a tag the device
firmware ignores), no rescan will detect it. That's a separate concern
tracked outside this doc (see ADR-009 for the broader rationale).

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

### `podkit doctor`

- **Owns:** cleanup of debris a save() may leave on partial failure
  (`.podkit-tmp` files from a torn atomic write, orphaned sidecar
  covers, manifest-vs-filesystem drift).
- **Not in the save() path.** Doctor is an opt-in recovery tool, not
  an automatic post-save sweeper.

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

2. **Atomic writes for on-file mutations.** New on-file mutations
   (tag writes, picture writes, sidecar writes, new flushes) should
   write to `<file>.podkit-tmp` then rename over the target. A
   SIGKILL mid-write leaves a `.podkit-tmp` behind (cleaned by
   `podkit doctor`), never a torn target. The sidecar stage already
   uses this pattern (`writeSidecarAtomically`); other on-file
   mutations are being retrofitted.

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

- **Sidecar flush stage uses bare `Promise.allSettled`.** No
  concurrency cap. Normalize to `runWithConcurrency` for EMFILE
  safety and symmetry with the other stages — TASK-390.
- **No atomic-write helper for on-file mutations.** Tag-write,
  picture-write currently open the target file in-place via
  node-taglib-sharp; only the sidecar stage uses tmp+rename. TASK-391
  promotes the helper as prep for the retrofit (TASK-376).
- **`lookupTrackRef` is O(N²) at save-time** for the ENOENT-vanished
  warning path. Fine for hundreds of pending moves, latent for
  thousands. TASK-392.
- **Cross-adapter asymmetry write-up.** What's still asymmetric
  between `IpodAdapter` and `MassStorageAdapter` at the contract
  level (concurrent execute, deferred-load timing, etc.) — TASK-393,
  depends on this doc landing.
- **Save-failure matrix as a coherent end-to-end test surface.**
  Sweep device × failure-mode × recovery-strategy. TASK-380, cites
  this doc directly.

---

## 7. References

- `packages/podkit-core/src/device/mass-storage-adapter.ts` —
  `save()` at line 1302.
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
