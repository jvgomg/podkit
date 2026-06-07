---
id: TASK-407
title: Doctor --repair orphan-files must acquire the per-device sync lock
status: Done
assignee: []
created_date: '2026-06-07 22:37'
updated_date: '2026-06-07 22:53'
labels:
  - bug
  - reliability
  - sync-engine
  - doctor
  - mass-storage
  - follow-up
dependencies:
  - TASK-404
  - TASK-406
references:
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.ts
  - packages/podkit-core/src/lib/pid-file.ts
  - packages/podkit-cli/src/commands/sync.ts
  - documents/architecture/sync/planning.md
priority: medium
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-404 added a per-device sync lock at `.podkit/sync.lock` (mass-storage) / `iPod_Control/.podkit-sync.lock` (iPod) acquired by `podkit sync`. The lock's documented scope is "writes only" — the architecture doc says read commands like `device scan/info/music` are not gated.

The TASK-406 follow-up audit (opus, 2026-06-07) discovered that `podkit doctor --repair orphan-files` is **also** a writer of the manifest but does NOT acquire the sync lock. Concurrent failure mode:

1. User runs `podkit doctor --repair orphan-files` on TERAPOD while `podkit sync` is mid-flight (or while the daemon is cycling).
2. Doctor's `runMassStorageRepair` calls `pruneManifestRows` directly — writes the pruned `state.json` to disk.
3. Sync's eventual `save()` atomically writes `[...this.managedFiles].sort()` from in-memory state — clobbers the prune (because `managedFiles` was populated at `open()`, before the doctor pruned).
4. Doctor reports success. User believes the phantom rows are gone. On the NEXT sync's pre-flight sweep, the phantoms reappear because they're back in the manifest. User runs doctor again, same outcome. Mass-storage only.

The fix: doctor's repair path that writes the manifest must hold the same per-device lock as sync.

## Scope

1. **Move the lock-path helper to `@podkit/core`.** Today `resolveSyncLockPath` lives in `packages/podkit-cli/src/commands/sync.ts`. Doctor needs it too. Move to a new `packages/podkit-core/src/lib/sync-lock-path.ts` (or fold into `lib/pid-file.ts`) and import from both consumers.

2. **Doctor acquires the lock for `--repair orphan-files-mass-storage`** (and any other mass-storage repair that writes the manifest — audit the dispatch in `packages/podkit-cli/src/commands/doctor.ts` and `repair-dispatch.ts`).
   - Acquire AFTER device detection / before the repair function runs.
   - Release in `finally`.
   - On `LockHeldError` / `LockContestedError`: surface a clear CLI error mirroring `podkit sync`'s message ("Another podkit process is using /Volumes/TERAPOD…"). Reuse the existing `LOCK_HELD` exit code 4.

3. **iPod doctor repairs that mutate iTunesDB.** Audit. If they go through libgpod's save path, they're also writers — they need the lock too. Document the scope decision in the task notes if you find some are read-only.

4. **Add JSDoc warning to `pruneManifestRows`** (`packages/podkit-core/src/device/mass-storage-manifest.ts`): "Caller MUST hold the per-device sync lock before invoking; this util only touches disk and does not coordinate with concurrent writers."

5. **Architecture doc** `documents/architecture/sync/planning.md` §6:
   - Extend the "writes only" sub-section: list ALL writer surfaces (sync executor, doctor repairs, pre-sync sweep auto-prune) and confirm each takes the lock.
   - Update the cross-process coordination prose to reflect that doctor repairs are within scope.

6. **Tests:**
   - Parallel-process test: two `podkit` invocations against the same fixture — sync + doctor-repair, doctor + doctor-repair — assert exactly one acquires; the other gets LOCK_HELD.
   - Daemon coexistence test (optional but high-value): if the daemon is running a cycle, a concurrent doctor-repair gets LOCK_HELD and exits.
   - Existing doctor `--repair orphan-files` regression suite must still pass.

## Why a bug, not an enhancement

The current behaviour silently undoes a user-requested repair. Severity: **medium** because:
- Mass-storage only (iPod path may also be affected — audit during scope #3)
- Niche trigger (doctor + sync concurrently) but real for users running the daemon
- Failure mode is silent (no visible error; phantoms reappear next sync)
- The whole architectural premise of TASK-404 ("writes only take the lock") makes this an oversight in TASK-404's scope, not a new design problem.

## Acceptance

- `resolveSyncLockPath` lives in `@podkit/core`, consumed by both `podkit sync` and doctor repair paths.
- Doctor's manifest-writing repair paths acquire the per-device lock before writing, release in `finally`.
- iPod-side repair paths audited; any writer also takes the lock.
- `pruneManifestRows` has a JSDoc warning naming the lock requirement.
- Architecture doc §6 lists ALL writer surfaces with confirmed lock semantics.
- Tests pin: parallel sync+doctor, parallel doctor+doctor; both get LOCK_HELD where expected.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 resolveSyncLockPath helper moved to @podkit/core (lib/), consumed by sync.ts and doctor
- [x] #2 Doctor --repair orphan-files-mass-storage acquires the per-device lock before writing the manifest; releases in finally
- [x] #3 iPod-side doctor repair paths audited; any path that writes iTunesDB also takes the lock
- [x] #4 pruneManifestRows JSDoc names the lock requirement
- [x] #5 Architecture doc sync/planning.md §6 enumerates ALL manifest-writer surfaces and confirms each takes the lock
- [x] #6 Test pins parallel sync+doctor: one acquires, other exits LOCK_HELD (exit code 4)
- [x] #7 Test pins parallel doctor+doctor: same outcome
- [x] #8 Existing --repair orphan-files regression suite passes unchanged
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`resolveSyncLockPath` moved to `@podkit/core/lib/sync-lock-path.ts`; both `podkit sync` and `podkit doctor` consume from the same source.

New `withDeviceWriteLock` wrapper in `doctor.ts` acquires the per-device PID-file lock before any mutating repair runs, releases in `finally`. `LockHeldError`/`LockContestedError` → `CliError` with `LOCK_HELD` code, exit 4, message naming holder PID.

**iPod repair audit (all 6 repairs are writers; all locked):**
- `orphan-files` — deletes physical files in `iPod_Control/Music/F*`
- `artwork-rebuild`, `artwork-reset` — libgpod ArtworkDB/iTunesDB save
- `debris-files` (iPod) — deletes `.podkit-tmp` files
- `sysinfo-extended`, `sysinfo-consistency`, `sysinfo-modelnum-mismatch` — write `iPod_Control/Device/SysInfo*`

System-only repairs (`udev-rule`, `debris-transcode-tmp`) don't touch the device and don't acquire the lock — correct.

JSDoc on `pruneManifestRows` names the lock requirement for any future direct caller.

Architecture doc `documents/architecture/sync/planning.md` §6 rewrote the "writes only" subsection to enumerate every writer surface (sync executor, pre-sync sweep auto-prune, mass-storage doctor repairs, iPod doctor repairs incl sysinfo*) with lock confirmation.

Tests at two layers:
- `lib/sync-lock-path.test.ts` — layout pins (iPod vs mass-storage, mkdir vs no-mkdir, idempotent), 3 cross-process spawn tests (mass-storage contention, iPod contention, explicit sync+doctor naming).
- `doctor-lock.test.ts` — 8 in-process tests: happy paths both layouts, throws-release, return passthrough, `LockHeldError` translation both layouts, parallel doctor+doctor + parallel sync+doctor races.

**Known imperfection** (noted in planning.md §6 + flagged for follow-up): `withDeviceWriteLock` over-acquires for `--dry-run` repairs — fix is to thread `options.dryRun` through and short-circuit, matching the sync surface. No behaviour bug today; mechanical fix.
<!-- SECTION:FINAL_SUMMARY:END -->
