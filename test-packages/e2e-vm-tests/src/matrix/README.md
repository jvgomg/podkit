# Save-failure matrix (VM tests)

VM-resident sibling to `test-packages/e2e-tests/src/matrix/` (the host matrix
harness). The save-failure concern runs **inside a Lima VM** because the
failure modes it asserts (`ENOSPC`, `EACCES` from chmod, lazy-unmount races)
require a real Linux filesystem and root-level provisioning that the host
matrix can't reach without becoming non-portable.

The pattern is the same: each cell carries a `predict()` → expected
observation, the `runPass()` performs a real sync sequence inside the VM and
returns the observed observation per cell, the harness asserts `predict ===
observe` cell-by-cell with a precise diff on mismatch.

## Status — full mass-storage + iPod fan-out

This matrix now spans:

  - Mass-storage shapes: `embedded`, `embedded-vorbis`, `sidecar-mixed`.
  - iPod shapes: `ipod-noart` (mini 1G, no artwork), `ipod-artwork` (5G,
    ArtworkDB).
  - Source formats: `flac`, `ogg` (mass-storage); `flac`, `mp3` (iPod).
  - Codec configs: `prefer-copy`, `transcode-aac`.
  - Transfer modes: `fast`, `portable` (iPod-only — warn-only file-tag
    semantics; iTunesDB is authoritative).
  - Failure modes: `enospc`, `track-readonly`, `album-readonly`,
    `cover-collision`, `manifest-dir-readonly` (mass-storage),
    `itunesdb-readonly` (iPod), `move-parent-readonly` (Stage D —
    MoveError throw-on-first asymmetry).

Faults flagged `preseed: 'first-sync'` (track-readonly, itunesdb-readonly,
move-parent-readonly) sequence the harness so that a clean first sync
lands a managed file, the source is mutated (genre tweak for in-place
tag-write; albumArtist tweak for relocate), and only THEN is the fault
applied — so chmod 0444 lands on the inode the second sync's tag-write
actually opens, rather than getting bypassed by `atomicCopyFile`'s
fresh-inode semantics. See `save-failure-faults.ts` for the `preseed`
contract.

The ENOSPC cell is unchanged (Phase C.1): provisioned by the
`device-mount-near-full` SystemState rather than a per-cell fault.

## Carve-out catalogue (long-term scope)

Save-failure axis values the matrix targets across phases. The catalogue is
**derived from doc-041 §4.3 + §5 and TASK-380's "Initial axes" list** (the
task description does not pin a verbatim 15-row table; the rows below were
enumerated to cover one cell per intersection of doc-041's named failure
mode + a save-transaction stage that can plausibly fire it). Treat the list
as the working scope for Phases 2/3; Phase 1 (ENOSPC cell) has landed — see
TASK-380 implementation notes.

1. **SIGKILL mid-file-copy → tmp debris**: copy interrupted by signal between
   `copyFileSync` and `renameSync`. Atomic-tmp helper means the target file
   never holds a partial body, but `.podkit-tmp` debris is left behind for
   `podkit doctor` to clean. (TASK-375 covers the doctor recovery side; the
   atomic copy contract is unit-tested in `utils/atomic-fs.test.ts`.)
2. **SIGKILL mid-TAG-write / mid-PICTURE-write → torn audio file**: tag and
   picture writes are still **in-place** via node-taglib-sharp (no atomic
   helper yet — `TagLibTagWriter.writeTags`/`writePicture` modify files in
   place). A SIGKILL mid-write leaves a torn audio file — the file-copy
   atomic contract does NOT protect this path. doc-041 §3.4 + §5.4 calls
   this out; TASK-376 (atomic on-file writes retrofit, helper landed via
   TASK-391) tracks the closure. Until TASK-376 lands, this is a real
   integrity gap that the matrix cannot fence and unit tests cannot
   substitute for.
3. **SIGKILL mid-manifest-write**: process killed during the manifest's
   tmp+rename step. Either the prior manifest survives or none;
   `loadManifest` treats an absent manifest as "rebuild from filesystem
   walk", so this is self-healing.
4. **ENOSPC during file copy** (Phase 1 thin-slice — embedded-flac × flac ×
   prefer-copy × fast): destination filesystem fills mid-`atomicCopyFile`.
   Actual current behaviour (surfaced by Phase 1): podkit's planner-level
   pre-flight free-space check fires BEFORE save() runs, so the error
   surfaces as `{success: false, error: "Not enough space..."}` from the
   planner — NOT as a save() typed error. TASK-378 audits the broader
   free-space handling strategy.
5. **ENOSPC during rename in save() (move stage)**: file copy already
   landed; the cross-directory rename to the final path fails because no
   contiguous space exists for the inode rewrite (rare, but possible on full
   ext4). Expects `MoveError`. NOT reachable in v1 because the planner
   pre-flight gates ENOSPC out — see TASK-378.
6. **ENOSPC during tag write**: tag write opens the file in-place via
   node-taglib-sharp; ENOSPC inside the file write surfaces as a per-file
   rejection collected into `TagWriteError.causes`. Same v1 caveat as row 5.
7. **ENOSPC during sidecar write**: tmp+rename of the `cover.jpg` fails;
   `SidecarWriteError` aggregates per album. Same v1 caveat as row 5.
8. **ENOSPC during picture write** (OGG/Opus only): in-file picture frame
   write fails; surfaces as `PictureWriteError`. Same v1 caveat as row 5.
9. **EACCES on the audio file (chmod 0444)**: tag write fails because the
   target file is read-only. Expects `TagWriteError`. Phase 2 (chmod fault
   `track-readonly`).
10. **EACCES on the album directory (chmod 0555)**: sidecar write fails
    because the album dir can't be written. Expects `SidecarWriteError`.
    Phase 2 (chmod fault `album-readonly`).
11. **EACCES on the mount root (chmod 0555 + remount-ro)**: every save stage
    fails. Expects `MoveError` on the first move attempt, or the file copy
    failing earlier if no moves are pending. Phase 2.
12. **EACCES on a `.podkit-tmp` siblings the rename target**: rename source
    exists but `unlinkSync(tmp)` on retry hits EACCES; the doctor's
    `.podkit-tmp` cleanup pathway is the recovery seam. (TASK-375 anchors
    the doctor side.)
13. **iTunesDB write fails (libgpod returns non-zero)**: iPod adapter's
    stage 1 hard failure. Wrapped in `DatabaseWriteError`; the next sync's
    rescan rebuilds the diff but cannot self-heal the database write — user
    must rerun. Phase 3 (iPod cells via dummy_hcd).
14. **Concurrent runs against one device**: two `podkit sync` invocations
    against the same mountpoint; second one sees a half-mutated state.
    (TASK-379 — device lockfile + concurrent-sync detection — anchors the
    closure path.)
15. **Manifest absent on next sync**: previous sync's manifest write was
    killed before rename; rescan reads `walk(mount)` and re-derives
    managedFiles. Expects the next sync to converge in one pass.
16. **Manifest references missing file (orphan)**: previous sync's
    `copyTrackFile()` failed after `managedFiles.add` but before the
    surrounding `try` reached its rollback (or the rollback itself failed).
    `podkit doctor` should surface the orphan; the next sync should re-fire
    the add. (TASK-375 anchors the doctor side.)

### Failure modes outside this matrix's scope

doc-041 §5 names seven failure modes; the rows above cover the ones the
matrix can assert end-to-end via VM provisioning + fault injection. Three
named modes are deliberately out of scope:

- **§5.1 Transient I/O failure (EAGAIN / network mounts)** — this is a
  retry-policy concern, handled by the executor's typed retry logic and
  unit-tested at the categorizer level. The matrix would have to choreograph
  transient timing (fail-once-then-succeed) which v1's chmod-and-loopback
  toolbox cannot do without CharybdeFS-class fault injection (deliberately
  excluded — see TASK-380 description).
- **§5.6 SIGINT mid-sync (Ctrl-C)** — timing-dependent process-signal
  contract; not exercised here. Separate area, may warrant its own test
  surface later.
- **§5.7 Concurrent `execute()` on one `MusicPipeline`** — closed by
  `PipelineBusyError` (commit 2161dbda, listed in doc-041 §9 "Recently
  closed"); no longer an open failure mode.

Each in-scope row maps to a SystemState (provisioned ahead of the sync) or
a fault (applied per-test) in `save-failure-faults.ts`. Phase 1 uses one
SystemState (`device-mount-near-full`) and zero faults; Phase 2 will add
the chmod-based faults for rows 9–11.

## Modules

| File | Role |
|------|------|
| `harness.ts` | Inlined `defineMatrix` + `diffCell` + skip taxonomy. Mirrors `test-packages/e2e-tests/src/matrix/harness.ts` minus the artwork-/track-specific helpers. Inlined rather than imported so the VM test package doesn't transitively depend on `@podkit/e2e-tests`. |
| `save-failure-rules.ts` | The save-failure concern: cell type, expectation/observation shapes, `predictSaveFail()`. |
| `save-failure-faults.ts` | Fault registry. Empty in Phase 1 (ENOSPC is provisioned by a SystemState, not a fault); Phase 2 populates it with chmod-based faults. |

The test entry point is `src/save-failure-matrix.e2e.test.ts`.
