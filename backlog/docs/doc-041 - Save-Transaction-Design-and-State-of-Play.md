---
id: doc-041
title: Save-Transaction Design and State of Play
type: specification
created_date: '2026-06-03 09:03'
tags:
  - specification
  - architecture
  - save-transaction
  - device-adapter
  - self-healing
  - testing-strategy
---
# Save-Transaction Design + State of Play

A living engineering reference for podkit's `save()` semantics across device
adapters. Read this before changing flush logic; update it as the design
evolves. New failure modes, test gaps, and refactor ideas belong here.

Companion docs:
- [doc-012](./doc-012 - Spec-Transfer-Mode-Behavior-Matrix.md) — Transfer mode behaviour matrix
- [doc-039](./doc-039 - E2E-Sync-Matrix-Testing-Strategy.md) — Sync matrix testing strategy
- [ADR-009](../../adr/adr-009-self-healing-sync.md) — Self-healing sync rationale

Cross-referenced tasks: see §9 (Open tasks anchored here / Recently closed).

---

## 1. What "save transaction" means in podkit

A sync run ends with one or more `device.save()` calls. `save()` is the moment
podkit's in-memory mutations cross into the device's persistent state:

- **iPod**: write the iTunesDB (libgpod → SQLite-like database files) +
  best-effort writes of on-file ID3/Vorbis tags.
- **Mass-storage**: rename queued files into place + write modified tags
  (textual + replay-gain) + write embedded pictures + persist the podkit
  manifest.

"Transaction" is aspirational. Today `save()` is closer to **best-effort flush
+ eventual-consistency-via-rescan**. We rely on the next sync's diff engine to
re-detect anything that didn't land. That works because mass-storage's source
of truth IS the file tags on the device, and the iPod's iTunesDB write is
atomic from the user's perspective (libgpod writes a tmp database then renames).

This doc is the place to argue for, and incrementally land, a more honest
contract: **bounded partial-failure, no torn files, no silent state drops,
all of it tested**.

---

## 2. Adapter-specific save() flows (current state)

### 2.1 `MassStorageAdapter.save()`
**Source:** `packages/podkit-core/src/device/mass-storage-adapter.ts:1092`

Three flush stages + a manifest write, in this order:

#### Stage 1: Pending file moves (relocations)

```
for ([oldPath, newPath] of pendingMoves):
  fs.mkdirSync(parent, recursive)
  fs.renameSync(absOld, absNew)         // ENOENT → continue, others → throw
  // best-effort cleanup of empty parent dirs of oldPath
pendingMoves.clear()                     // only on success
```

**Failure shape:** for-loop, throws on first non-ENOENT error. Earlier
successful renames stay on disk. Map NOT cleared on throw → next `save()`
retries the entire list; succeeded entries ENOENT-skip themselves. Eventually
self-clears.

#### Stage 2: Pending textual + replay-gain tag writes

```
entries = [...pendingTagWrites.entries()]
settled = runWithConcurrency(entries.map(writeTags), DEFAULT_TAG_WRITE_CONCURRENCY=16)
pendingTagWrites.clear()                 // BEFORE failure check
if failures.length > 0: throw new TagWriteError(failures)
```

**Failure shape:** concurrency-capped, all promises settle before throw. The
map IS cleared first, then `TagWriteError` aggregates per-file failures. No
in-adapter retry. The comment at the throw site says:

> The next sync will re-detect any unwritten diffs and retry — mass-storage
> reads file tags as the source of truth on rescan.

**Error type:** `TagWriteError extends Error` with `causes: readonly string[]`.
The sync executor's error categorizer matches on `instanceof TagWriteError`
and classifies as `copy` (file-I/O), not `database`, so retry policy is correct
even when error paths contain device names like "iPod".

#### Stage 3: Pending embedded-picture writes

```
const writes = [...pendingPictureWrites.entries()].map(([fp, data]) =>
  tagWriter.writePicture(mountPoint + fp, data)
)
await Promise.all(writes)                // fail-fast on first rejection
pendingPictureWrites.clear()             // only on success
```

**Failure shape:** `Promise.all` rejects on first failure but all promises
**have already been created** (they're constructed synchronously in `.map()`,
so the I/O starts immediately). Successes land on disk, failures don't, map
NOT cleared. Next `save()` re-writes the entire batch including succeeded
ones — taglib write is byte-idempotent so safe by accident.

**No typed error.** Failures surface as the raw rejection — the executor
classifies as `copy` only because the error message tends to contain a file
path, which is fragile.

#### Stage 4: Manifest write

```
manifest.managedFiles = [...managedFiles].sort()
manifest.lastSync = new Date().toISOString()
// Atomic write: tmp + rename (SIGKILL mid-write cannot leave torn manifest)
writeJsonAtomic(stateDir / podkit.json, manifest)
```

Atomic by design — `loadManifest` treats a missing or unparseable manifest as
"empty manifest, rebuild from filesystem walk".

### 2.2 `IpodAdapter.save()`
**Source:** `packages/podkit-core/src/device/ipod-adapter.ts:199`

Two stages:

#### Stage 1: iTunesDB write (libgpod)

```
await this.ipod.save()
```

Delegates to the libgpod N-API binding. Atomic from podkit's perspective —
libgpod writes a tmp iTunesDB then renames over the real one.

#### Stage 2: Best-effort on-file tag writes (iPod "portable" tags)

```
entries = [...merged.entries()]   // deduped by absolute path
results = runWithConcurrency(entries.map(writeTags), DEFAULT_TAG_WRITE_CONCURRENCY)
if failures.length > 0: warningSink.emit({phase:'execute', type:'tag-write', tracks, message})
```

**Failure shape: warn-only via `WarningSink`.** iTunesDB has authoritative
metadata; the file tag write is for "portable" mode where the user pulls files
off the device and expects them tag-complete. Failures degrade portability but
not playback. Warnings flow through the pipeline's accumulator and surface in
`SyncOutput.warnings` (closes §3.2 below; see
`documents/architecture/sync/error-handling.md` for the model).

---

## 3. Rough edges (the catalogue)

### 3.1 ~~Three inconsistent failure shapes within one `MassStorageAdapter.save()`~~ — CLOSED (TASK-381)

| Stage | Shape | Concurrency | Aggregation | Map clear timing |
|---|---|---|---|---|
| Moves | for-loop, typed `MoveError` on first non-ENOENT; ENOENT skip emits warning via sink | serial | wrapped in `MoveError` | only on success |
| Tag writes | `runWithConcurrency` + `TagWriteError` | 16-capped | per-file aggregated | before throw |
| Picture writes | `runWithConcurrency` + `PictureWriteError` | 16-capped | per-file aggregated | before throw |
| Sidecar writes | `runWithConcurrency` + `SidecarWriteError` | 16-capped | per-album aggregated | before throw |

All four flush stages now use `runWithConcurrency` with a 16-cap, typed aggregate
error, and clear-before-throw semantics. The remaining asymmetries (MoveError
throw-on-first vs others' settle-all; SidecarWriteError per-album vs per-file
aggregation) are intentional — see save-transactions.md §save-stage-asymmetries.

### 3.2 ~~Asymmetry between IpodAdapter and MassStorageAdapter~~ — CLOSED (TASK-381)

Settled by the architecture sweep. Both adapters now follow the same shape at
the contract level: hard failures throw a `CategorizedSyncError` subclass
(`TagWriteError`, `SidecarWriteError`, `PictureWriteError`, `MoveError`,
`DatabaseWriteError`) carrying its own category; soft failures emit a
structured `Warning` through the injected `WarningSink`. Whether a particular
failure mode is hard or soft is still adapter-specific (mass-storage's
file-tag failure is hard because file tags ARE the source of truth there;
iPod's portable file-tag failure is soft because iTunesDB is the source of
truth), but the *shape* is now uniform. See
`documents/architecture/sync/error-handling.md`.

### 3.3 ~~Picture writes have no typed error~~ — CLOSED (TASK-381)

`PictureWriteError` (extends `CategorizedSyncError`, category `'copy'`) wraps
per-file failures. Categorization is now `instanceof`-based; the substring
matcher is gone.

### 3.4 ~~No atomic writes for on-file mutations~~ — CLOSED (TASK-376)

All three on-file mutation stages now route through
`atomicWriteFileWithSync` (tmp + fsync + rename):

- `writeSidecarAtomically` — landed earlier (TASK-391 helper).
- `TagLibTagWriter.writeTags` — now uses `BufferFileAbstraction` +
  `atomicWriteFileWithSync`: taglib modifies an in-memory buffer seeded
  with the original file bytes, then the result lands atomically.
- `TagLibTagWriter.writePicture` — same shape.

A SIGKILL mid-write now leaves either the original file or the fully-written
new file. A `.podkit-tmp` left behind by a kill-between-write-and-rename is
cleaned by `podkit doctor` (TASK-375).

### 3.5 ~~Cleared-then-thrown vs thrown-then-cleared~~ — CLOSED (TASK-381)

All save() flush stages now clear their pending map BEFORE throw — matches
the tag-write convention. Self-healing via rescan is the retry path; no
in-adapter retry. Move-stage asymmetry intentional — see
[save-transactions.md §save() stage asymmetries](../../documents/architecture/sync/save-transactions.md#save-stage-asymmetries-intentional).

### 3.6 No `executeOnce` guard

`MusicPipeline.execute()` stores per-call state (`this.adapter`,
`this.transferMode`, etc.) on the instance. Two concurrent `execute()` calls
on the same instance race silently — no caller does this today, but
podkit-core is a library and external consumers could hit it. See §6.

### 3.7 Sidecar writes (TASK-370) — fourth inconsistent path

Adding sidecar device-writes naively would create a fourth flush with its own
failure semantics. The fix is to normalize Stage 3 (picture writes) AND make
sidecar writes share that shape — see §7.

---

## 4. Test coverage (state of play)

### 4.1 What's covered

| Behaviour | Test |
|---|---|
| TagWriteError happy path | `mass-storage-adapter.test.ts:1658` "aggregates per-file failures into a typed TagWriteError" |
| TagWriteError categorization | `error-handling.test.ts:63` "categorizes TagWriteError as copy" |
| Picture write happy path | `mass-storage-adapter.test.ts:2060` "updateTrack with embeddedPictureData queues a pending write" |
| Picture write through relocate | `mass-storage-adapter.test.ts:2103` "replaceTrackFile updates pending picture write path" |
| Tag write replay-gain coalescing | `mass-storage-adapter.test.ts:1944` describe block |
| iPod tag-write best-effort warn | `ipod-adapter.ts:204` — exercised in integration tests |
| Atomic manifest write | implicit in `loadManifest` tests handling truncated input |

### 4.2 What's NOT covered

| Gap | Why it matters |
|---|---|
| Picture write failure for 1/N | Today: `Promise.all` fail-fast, map not cleared, others succeed. UNTESTED. Refactor risk. |
| Move failure partway through batch | Today: for-loop, throws on first non-ENOENT, earlier moves stay. UNTESTED. |
| Move ENOENT skip behaviour | Documented at the catch site, no test. |
| Crash mid-tag-write (torn file) | No atomic write today. No test for partial-write recovery. |
| Crash between flush stages | What does next-run rescan recover? UNTESTED. |
| Crash between tag write and manifest write | Manifest is atomic, but the relationship between manifest state and what landed on disk isn't asserted. |
| TagWriteError surfaces only after pendingTagWrites.clear() | Lock the order — a future refactor that flips it would silently change semantics. |
| Picture write retry behaviour across `save()` calls | Save 1 fails for picture X; save 2 should re-write X (current behaviour by accident). |
| Concurrent `execute()` on one MusicPipeline | Silent state corruption today; no test. |
| Sync run interrupted mid-batch by SIGINT | Engine signal handling exists; what's the device-state contract? UNTESTED for save partial. |

### 4.3 Coverage matrix to drive iteration

A useful target shape:

```
device × failure-mode × recovery-strategy

devices:           [ipod-MA147, ms-echo-mini, ms-generic, ms-rockbox]
failure-modes:     [tag-write-fail, picture-write-fail, move-fail, sidecar-write-fail, SIGKILL-mid-write, ENOSPC, EACCES]
recovery:          [next-save-retries, rescan-redetects, doctor-cleans, user-reports-bug]
```

The matrix harness (doc-039) is the right pattern. A dedicated "save-failure
matrix" test file (or expansion of existing matrix concerns) would close 4.2
systematically.

---

## 5. Failure modes catalogue

The taxonomy podkit needs to handle, with current behaviour + gaps.

### 5.1 Transient I/O failure (EAGAIN, network drop on remote mount)

**Today:** Tag writes throw `TagWriteError` → sync executor's retry policy
fires (1 retry by default). If retry succeeds, sync completes. If still
failing, error bubbles up, sync exits non-zero. Next manual run re-detects
the diff on rescan + re-queues.

**Gap:** Picture write failures aren't typed → error categorizer may
mis-classify the retry policy.

### 5.2 Permanent I/O failure (EROFS, EACCES on a read-only mount)

**Today:** Same as transient — retried, then bubbles up. User sees the error
message + diagnostic hint to check mount permissions.

**Gap:** No upfront capability probe. The user discovers it only at save time
after a full diff + transcode has happened. Wasted work.

### 5.3 Out of space (ENOSPC) mid-save

**Today:** `renameSync` or `writeFile` returns ENOSPC. Move stage throws,
later stages don't run. Tag/picture writes that already partially landed stay.

**Gap:** ENOSPC isn't pre-checked. The free-space probe at plan time would
catch most cases; today's only line of defence is the executor's error message.

### 5.4 Process killed mid-write (SIGKILL, OOM, OS reboot)

**Today:** Manifest is atomic — never torn. Audio files / tag writes / picture
writes are NOT atomic — a partial write IS possible. Next run's rescan reads
the file's tag block, which may be corrupted, and the file may be unparseable
by music-metadata.

**Gap:** No atomic write helper. No test that exercises this path.

### 5.5 Concurrent processes hitting the same device — RESOLVED (TASK-404/407/409)

Per-device PID-file lock at `.podkit/sync.lock` (mass-storage) or
`iPod_Control/.podkit-sync.lock` (iPod). Contents: `{pid, startTimeMs}` JSON.
Kernel-atomic `open(wx)` acquire; `kill(pid,0)` + start-time read liveness
probe with single-retry stale-takeover. Every writer surface holds it: sync
executor, pre-sync sweep auto-prune, all device-scoped doctor repairs. Reads
(`device scan/info/music`, diagnostic-only `doctor`) and `--dry-run` carve
out. Daemon recognises exit code 4 as contention skip — no retry-spin.
Cross-host (NFS/SMB) explicitly out-of-scope. Full design + writer inventory
in `documents/architecture/sync/planning.md` §6.

### 5.6 SIGINT (user pressed Ctrl-C) mid-sync

**Today:** The executor checks `signal.aborted` between operations and breaks
the loop. `save()` runs at `saveInterval` (default 50 ops). So aborting
mid-batch loses the in-flight batch's writes, keeps what's already saved.

**Gap:** The signal contract for `save()` itself isn't defined — if SIGINT
arrives during `runWithConcurrency`, in-flight writers complete but new ones
don't start. Map state at that point is ambiguous.

### 5.7 Library consumer misuse (TASK-372 area)

**Today:** A library consumer calling `MusicPipeline.execute()` twice
concurrently on one instance corrupts per-execute state. No error, no warning.

**Gap:** No defensive guard. See §6.

---

## 6. Self-healing across runs (the rescan contract)

Mass-storage's source of truth is **the file tags on the device**, not
podkit's in-memory model or even the manifest. The manifest is a cache:
podkit re-derives `managedFiles` from `manifest.managedFiles ?? walk(mount)`
at `open()` time.

This drives the eventual-consistency behaviour:

- Tag write fails → file's tag still reflects the previous sync's content →
  next sync's `detectUpgrades` sees the source/device delta → re-queues the
  diff. Self-healing.
- Picture write fails → same shape.
- Move fails → file's still at the old path → next sync sees it there → if
  the path template still wants it moved, queues it again.
- Sidecar write fails (TASK-370) → no cover on the device → next sync sees
  the gap and re-fires `artwork-added`. Same shape.

The cost of "self-healing via rescan" is one extra sync. The win is that
podkit doesn't have to maintain a write-ahead log or two-phase-commit
machinery — the file system IS the log.

**Limit:** self-healing only works if podkit's diff engine notices the gap.
If a write silently succeeds-then-rots (taglib writes a tag that the device
firmware ignores), no rescan will detect it. The artwork matrix (TASK-356)
exercises this for artwork.

---

## 7. Direction / principles for incremental work

Three ground rules:

### 7.1 Normalize the failure shape, don't add a third one

Every flush stage should:

1. Use `runWithConcurrency` with a documented cap.
2. Settle ALL writes before checking failures (no fail-fast).
3. Aggregate per-entry failures into a typed error.
4. Document the map-clear-vs-throw order (cleared before throw, per the tag
   write convention — relies on rescan for retry, not in-adapter retry).

After this, picture writes + sidecar writes + future flushes all have the
same story. TASK-371 / TASK-370 can land their behaviour by extending the
shape, not duplicating it.

### 7.2 Atomic writes for on-file mutations

Tag-write, picture-write, sidecar-write should write to `<file>.podkit-tmp`
then `rename` over the target. A SIGKILL mid-write leaves a `.podkit-tmp`
behind (cleaned by `podkit doctor`), never a torn target. Same pattern
already used for transcode output (`PODKIT_TEMP_SUFFIX`).

### 7.3 The save-failure test matrix

A small matrix test file (`features/save-failure.test.ts`) sweeping:

- device × failure-mode × recovery-strategy (§4.3 axes)
- Each row pins: which `save()` stage throws, what landed on disk, what the
  next sync sees on rescan, what `podkit doctor` could clean.

The harness from doc-039 (typed `skip()` + reference-model predictions) can
host it. New failure modes get filed as added rows.

---

## 8. Open design questions

Things this doc doesn't answer yet. Each is a candidate task.

**Q1: Should `MassStorageAdapter.save()` write a per-stage progress event?**
Today it's opaque — caller awaits, gets back or throws. A progress event
(`{stage, completed, total}`) would let the CLI render "writing tags (12/47)"
instead of "saving..."

**Q2: Should we add a device lockfile?** — RESOLVED (TASK-404/407/409).
Per-device PID-file lock at `.podkit/sync.lock` / `iPod_Control/.podkit-sync.lock`
with `{pid, startTimeMs}` contents and `kill(pid,0)` + start-time liveness probe.
Cross-host case punted — advisory file locks aren't honoured uniformly across
NFS/SMB, and podkit's deployment is laptop-local. No `--ignore-device-lock`
override flag; manual `rm <lockfile>` is the escape hatch and is rarely needed
because the liveness probe auto-takes-over on unsupported platforms (Windows)
and dead-pid stale locks. See `documents/architecture/sync/planning.md` §6.

**Q3: Should `pendingTagWrites.clear()` move to AFTER the throw?**
Today: clear-then-throw means the adapter forgets failed writes. Rescan
re-detects. The other shape (throw-then-clear) lets the same `save()` instance
retry on the next call without rescan. Cleaner for daemon mode? Worse for the
one-shot CLI case (next process re-walks the FS anyway).

**Q4: Should `IpodAdapter.save()` throw on tag-write failures instead of warning?** — RESOLVED (TASK-381, as data not flow).
`save()` keeps `Promise<void>`. Failures emit a structured `Warning`
through the injected `WarningSink` — pipeline accumulates, JSON output
surfaces. iTunesDB write success is preserved (playback unaffected); user
sees a `tag-write` warning in `SyncOutput.warnings` and the CLI summary.

**Q5: How does daemon mode change the contract?**
Daemon mode runs continuous sync cycles. If `save()` fails mid-cycle, does
the daemon retry the same cycle (eats CPU until success) or proceed to the
next cycle (eventual consistency)? Today there's no daemon-specific behaviour
in the adapter — it's whatever the caller does. Worth pinning.

**Q6: Should we add a "dry-save" mode?**
Today there's `dryRun` at the executor level. The adapter doesn't have an
equivalent — it can't preview "if I call save() now, what would I write?"
Useful for diagnostics + the doctor flow.

---

## 9. Cross-references

### Open tasks anchored here

- **TASK-375** — `podkit doctor` orphan sidecar image detection. Reference
  §4.3 (recovery: doctor-cleans).
- **TASK-378** — Pre-save free-space probe + early ENOSPC error. Reference §5.3.

### Future task candidates (not yet filed)

(Empty — every previously-listed candidate has been filed.)

### Recently closed

- ~~Settled doc-041 sections (§1/§2/§6/§7) → architecture doc~~ — closed by
  TASK-389 (`documents/architecture/sync/save-transactions.md`). The journal
  retains §3/§4/§5/§8 as the living catalogue; §1/§2/§6/§7 are now
  forward-pointers into the architecture doc.
- ~~`MusicPipeline.execute()` concurrent-call defensive guard for library
  users~~ — closed by `PipelineBusyError` (commit 2161dbda, landed alongside
  doc-041 itself). Reference §3.6 / §5.7.
- ~~Picture-write `Promise.all` → `runWithConcurrency` normalization + typed
  `PictureWriteError`~~ — closed by TASK-381.
- ~~IpodAdapter `IpodPortableTagWriteResult` typed return~~ — closed by
  TASK-381 (resolved as a `WarningSink` channel rather than a typed return,
  keeping the result `Promise<void>`).
- ~~Sidecar flush `Promise.allSettled` → `runWithConcurrency` normalization for EMFILE safety~~ — closed by TASK-390.
- ~~No atomic writes for on-file tag/picture mutations~~ — closed by TASK-376.
  `TagLibTagWriter.writeTags` and `writePicture` now use `BufferFileAbstraction`
  + `atomicWriteFileWithSync`. Reference §3.4.
- ~~Promote `writeSidecarAtomically` → `utils/atomic-fs.ts` generic helper~~ —
  closed by TASK-391 (`atomicWriteFileWithSync` now shared by sidecar +
  tag-write + picture-write callsites).
- ~~Save-failure matrix (VM-hosted, capability-shape axes)~~ — closed by
  TASK-380. 23 cells GREEN; 44 skip; 0 fail. Two `[BUG] TASK-395` cells
  document a planner-codec-comparison gap. Reference §4.3 / §7.3.
- ~~Document `save()` stage asymmetries (MoveError throw-on-first;
  SidecarWriteError per-album aggregation)~~ — closed by TASK-393. Reference §3.5.
- ~~O(N²) `lookupTrackRef` inside `save()` move loop~~ — closed by TASK-392.
  Lazy memoization at first ENOENT.
- ~~Device lockfile + concurrent-sync detection (§5.5, Q2)~~ — closed by
  TASK-404 (primitive + sync executor) / TASK-407 (doctor repairs) / TASK-409
  (dry-run carve-out). Originally tracked as TASK-379, which is closed as
  superseded. See `documents/architecture/sync/planning.md` §6 for the settled
  design.

### Tests to add (not yet filed as tasks)

Each row in §4.2 that's currently uncovered. The most valuable to do first:

1. Picture-write failure for 1/N — pins current fail-fast behaviour so any
   refactor must intentionally change it.
2. Move-failure partway — pins ENOENT-skip semantics.
3. TagWriteError surfaces only after pendingTagWrites.clear() — pins the
   convention §7.1 wants to standardise on.

---

## 10. How to use this doc

- **Adding a new device adapter?** Read §2 + §3 first. Decide which §7 ground
  rules apply. Add a row to §2 for your adapter's save() flow.
- **Refactoring `save()`?** Pin the current behaviour with tests (§4.2) before
  touching code. Add a §3 entry if your change exposes a new rough edge. Move
  open questions in §8 forward where you've resolved them.
- **Hit a new failure mode in the wild?** Add it to §5. File a follow-up task
  in §9.
- **Reviewing a save-related PR?** Check the rows in §4.1 grow, not §4.2.
