---
id: TASK-409
title: withDeviceWriteLock should skip lock for --dry-run repairs
status: Done
assignee: []
created_date: '2026-06-07 23:05'
updated_date: '2026-06-07 23:09'
labels:
  - bug
  - doctor
  - sync-engine
  - follow-up
dependencies:
  - TASK-407
references:
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-cli/src/commands/sync.ts
  - documents/architecture/sync/planning.md
priority: low
ordinal: 124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-407 added `withDeviceWriteLock` in `packages/podkit-cli/src/commands/doctor.ts` to gate doctor repairs behind the per-device sync lock. The wrapper unconditionally acquires — including for `--dry-run` repair invocations. This is inconsistent with `podkit sync`, which TASK-404 explicitly carved out so `--dry-run` skips the lock (rationale: dry-run is read-only by design; making it contend on writes blocks user inspection of state during a real sync).

Not a behaviour bug today, but a small UX regression: a user trying to inspect what `--repair orphan-files --dry-run` would do, against a device currently being synced, gets `LOCK_HELD` instead of a plan preview.

## Scope

1. Audit which doctor repair commands accept `--dry-run` (read `packages/podkit-cli/src/commands/doctor.ts` and the repair-dispatch surface — some repairs may not have a dry-run path).
2. Thread the `dryRun` flag into `withDeviceWriteLock` (or just guard the call site). On dry-run, skip lock acquire entirely; run the repair fn directly.
3. Tests:
   - Pin: two parallel dry-run repairs against the same device — both succeed, neither blocks.
   - Pin: parallel real-sync + dry-run repair — both succeed (dry-run doesn't take lock; sync's lock isn't contended).
   - Pin: non-dry-run behaviour unchanged (still LOCK_HELD on contention).
4. Update `documents/architecture/sync/planning.md` §6: remove the "known imperfection" note about doctor over-acquiring on dry-run.

## Acceptance

- `withDeviceWriteLock` (or its call site) skips lock acquire when `dryRun: true`.
- Existing in-process + cross-process tests for non-dry-run paths still pass.
- New test pins parallel dry-run + dry-run (no contention) and dry-run + real-write (no contention).
- planning.md §6 no longer mentions the known imperfection.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 withDeviceWriteLock skips lock acquire when dryRun is true; matches sync's surface
- [x] #2 Parallel dry-run+dry-run test pins: both succeed, neither blocks
- [x] #3 Parallel dry-run+real-write test pins: dry-run does not contend on the lock
- [x] #4 Non-dry-run regression suite unchanged
- [x] #5 planning.md §6 known-imperfection note removed
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`withDeviceWriteLock` accepts `{ dryRun?: boolean }`; when `dryRun === true`, returns `fn()` directly with no lock acquire and no `finally` release. Matches `podkit sync --dry-run`'s carve-out.

Both call sites in `runDoctorAction` (mass-storage + iPod branches) thread `options.dryRun ?? false`.

3 new tests in `doctor-lock.test.ts`: dry-run doesn't create lock file, parallel dry-run+dry-run both succeed, held-lock + concurrent dry-run both complete without contention. Existing 8 non-dry-run tests pass unchanged.

planning.md §6 known-imperfection note removed; replaced with settled prose describing the policy.

Changeset `.changeset/doctor-repairs-acquire-sync-lock.md` amended (still pending release) to mention the dry-run carve-out so the user-facing release notes are accurate when this ships.
<!-- SECTION:FINAL_SUMMARY:END -->
