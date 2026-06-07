---
id: TASK-400
title: e2e-vm SIGKILL round-trip fixture for pre-sync sweep
status: To Do
assignee: []
created_date: '2026-06-07 16:00'
updated_date: '2026-06-07 16:55'
labels:
  - testing
  - e2e-vm
  - sync-engine
  - follow-up
dependencies:
  - TASK-398
  - TASK-405
references:
  - test-packages/e2e-vm-tests/src/
  - packages/podkit-core/src/sync/engine/pre-sync-sweep.ts
  - packages/podkit-cli/src/commands/sync.ts
priority: low
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-398 landed the pre-sync debris sweep with strong unit-level coverage:
- `pre-sync-sweep.test.ts` — 17 tests covering the sweep + pre-flight, including the failure-becomes-warning path, abort-signal mid-loop, dry-run no-op, file-vs-directory rm semantics, and the phantom-manifest advisory.
- Per-scanner tests cover mass-storage debris, iPod debris, transcode-tmp with mtime concurrency safety.
- `doctor-flag-matrix.test.ts` AC #15b pins `debris-transcode-tmp` through the system-repair fast-path.

What's NOT covered: an end-to-end "SIGKILL a real sync mid-flight, observe debris on disk, run next sync, assert the cleanup line + that the previous sync's tracks complete" round-trip. The orchestrator-level threading (preliminaries → first plan → executor pre-flight → cleanup) is exercised by unit tests for each layer independently, but not in a single VM-backed sync invocation.

## Scope

1. New `test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts`.
2. Use the existing `limaTestVmRunner` + persona infrastructure (see `save-failure-matrix.e2e.test.ts` for the pattern).
3. Scenarios:
   - **SIGKILL round-trip (mass-storage)**: stage a small source, kick off `podkit sync`, send SIGKILL once a `.podkit-tmp` file appears under the content directory, run `podkit sync --dry-run`, assert the dry-run text output contains `Cleaning N incomplete-write files`.
   - **SIGKILL round-trip (iPod)**: same shape but for an iPod persona — needs a `.podkit-tmp` to land under `iPod_Control/` (currently TASK-376's portable tag-writes can produce these; alternatively manually create one before re-syncing).
   - **transcode-tmp round-trip**: kill a sync that creates an `os.tmpdir()/podkit-transcode-*` directory; on the next sync, assert the dir is reaped + the cleanup line includes it.
   - **Concurrent-process safety**: a separate "live" podkit-transcode-* dir (mtime > session start) is NOT reaped by the sweep.

## Why deferred

Implementing the SIGKILL trigger reliably requires:
- A foreground sync process with a known PID (the existing harness runs commands via `runJsonCommand` which captures stdout — doesn't expose the PID for kill -9).
- Synchronization between "the sync has progressed enough to write a tmp" and the SIGKILL. Polling for the tmp file existence is one approach.
- A way to assert post-SIGKILL state without the harness aborting on non-zero exit codes.

TASK-398 unit coverage exercises every code path the e2e-vm fixture would exercise — this follow-up is for end-to-end completeness, not behavioural confidence.

## Acceptance

- Tests live in `test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts`.
- Run as part of `mise run test:linux` and `bun run test:vm`.
- Each scenario asserts both the cleanup line in stdout AND the final state on disk (debris removed, source tracks present).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New e2e-vm test file pre-sync-sweep.e2e.test.ts
- [ ] #2 SIGKILL round-trip (mass-storage): debris on disk → next sync surfaces cleanup line + final state clean
- [ ] #3 SIGKILL round-trip (iPod): same pattern against iPod persona (manual-plant variant until TASK-376 lands; promote to real SIGKILL after)
- [ ] #4 transcode-tmp round-trip: orphaned podkit-transcode-* with dead `.owner` reaped + reported in cleanup line (requires TASK-402)
- [ ] #5 Concurrent-process safety: live podkit holding pre-rename-transcode pause is NOT reaped by sibling sweep (test pins safety floor via TASK-402's PID-liveness probe)
- [ ] #6 Tests use bin/podkit-debug (TASK-405) for the SIGKILL scenarios; production binary used for assertion runs
- [ ] #7 Tests run under `mise run test:linux` + `bun run test:vm` with no flakes across 5 runs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Pinned design (decided 2026-06-07)

**Consumes TASK-405's debug build** for deterministic SIGKILL timing. Tests opt into `bin/podkit-debug` via the e2e CLI runner; production binary is unchanged.

### Pause keys used (added in podkit-core)

- `pre-rename-track` — after `target.podkit-tmp` exists, before rename to final path. Test polls for the tmp file, sends SIGKILL once observed (no need to resume — we want the dir to die mid-write).
- `pre-rename-transcode` — analogous, inside `podkit-transcode-<uuid>/` after transcode output exists but before move-out.

### Scenario mapping

- **AC #2 mass-storage SIGKILL**: arm `pre-rename-track`, kick sync, kill once `.podkit-tmp` lands. Next sync sees debris in content dir, sweep surfaces cleanup line.
- **AC #3 iPod SIGKILL**: **scope adjustment** — `.podkit-tmp` is mass-storage-only today (TASK-376 hasn't wired portable tag-writes into the iPod adapter). Two options:
  - Plant debris manually before re-syncing (simulates the post-crash state without an actual crash). Less faithful but exercises the same sweep code path.
  - Defer this AC behind TASK-376 landing and add an explicit blocker note.
  - **Recommended**: do the manual-plant variant now; mark it as "synthetic debris, not crash-induced" in a test comment. When TASK-376 lands, the test can be promoted to a real SIGKILL round-trip.
- **AC #4 transcode-tmp SIGKILL**: arm `pre-rename-transcode`, kill mid-transcode. Next sync's walker sees the dead-`.owner` dir (after TASK-402 — needed for the assertion), reaps it, surfaces cleanup line.
- **AC #5 concurrent-process safety**: spawn a live podkit holding `pre-rename-transcode`, run a separate `podkit sync --dry-run` in parallel, assert the live one's dir is NOT reaped.

### Dependency graph

- TASK-405 (debug build + devPause primitive) — blocker for AC #2/#3/#4.
- TASK-402 (PID-file `.owner` on transcode dirs) — blocker for AC #4/#5 (walker logic changes).
- TASK-376 (iPod portable tag-writes) — soft blocker for AC #3 fidelity; recommended workaround above.
<!-- SECTION:PLAN:END -->
