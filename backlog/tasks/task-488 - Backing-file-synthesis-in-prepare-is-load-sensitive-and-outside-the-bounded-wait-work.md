---
id: TASK-488
title: >-
  Backing-file synthesis in prepare() is load-sensitive and outside the
  bounded-wait work
status: To Do
assignee: []
created_date: '2026-08-28 17:22'
updated_date: '2026-08-28 19:32'
labels:
  - testing
  - vm
  - flaky
  - performance
dependencies: []
references:
  - test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts
  - test-packages/device-testing/src/vm/dual-daemon-lifecycle.e2e.test.ts
  - test-packages/lima/src/progress.ts
priority: medium
ordinal: 267000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Observed 2026-08-28.** A `bun run test:vm` failed with `@podkit/device-testing#test:vm` at 44 pass / 1 fail: `VM: dual-daemon lifecycle`'s `beforeAll` timed out at **69s** against a 60s limit (`VM_COLD_TIMEOUT_MS`), inside `ensureBackingFilesForPersonas` (`test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts:611`). A clean re-run was 239/0.

**Confounded, and the confound is known:** a `bun run typecheck` was running concurrently, which triggered a real `podkit:build`. The device VM is 2 CPU / 2 GiB, and TASK-483's own conclusion was that load is the differentiator. So this is consistent with residual load-sensitivity rather than a regression.

**Why it is still worth a task.** TASK-483 bounded the waits it found — enumeration probes get the caller's remaining deadline, daemon start/stop 45s, journal dump 15s, apply-state 5min — and TASK-486 bounded the lifecycle operations. Neither covers backing-file synthesis in `prepare()`. That path does real work in the guest (`truncate`, `mkfs.vfat`, `mmd`/`mcopy` per persona) under a single coarse 60s hook budget, with no per-step bound and no heartbeat. Under load it can exceed the hook budget and surface as exactly the shape both of those tasks set out to eliminate: a hook timeout that names nothing useful.

So the failure mode those tasks fixed is not fully eliminated — it has retreated to the one VM-driving path they did not touch.

**Worth considering:**
- Whether the 60s hook budget is right for a path whose cost scales with persona count and image size, or whether it should derive from the work rather than being a flat constant.
- Per-step bounds plus a heartbeat inside `ensureBackingFilesForPersonas`, so a slow synthesis reports which persona and which step rather than a bare hook timeout. `test-packages/lima/src/progress.ts` already provides the heartbeat.
- Whether synthesis results can be cached across runs — the images are deterministic (`--invariant`, fixed `SOURCE_DATE_EPOCH`), and a content-addressed skip would remove most of the cost rather than merely bounding it. This is likely the highest-value option: the fastest work is work not done.

**Repro:** run `bun run test:vm` while something else saturates the host (a full `typecheck` or `build` is enough). Not deterministic.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## A second, worse instance of the same shape — and it is not the persona loop

Observed 2026-08-28 during the transport-bounding work: `mass-storage-binding.e2e.test.ts`'s `beforeEach` ran for **20.1 minutes** and died on an unbounded `limactl shell … sha256sum` in `ensureBackingFile` (`test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts:288`), reporting only `Command failed: …` with no further detail.

The file is 256 MB and hashing it takes about a second. So this was a **wedged SSH session, not slow work** — the same diagnosis as the original incident behind the wait-bounding work, in the one module that work did not reach. It passed standalone in 25s, and the full re-run was 239/0 with the device-testing suite taking 80s rather than 1292s.

This sharpens the task. Two distinct call sites in the same file are unbounded:
- `ensureBackingFilesForPersonas` (line ~611) — the synthesis loop, which is genuinely slow work under load
- `ensureBackingFile` (line ~288) — a `sha256sum` that should take a second and has no business running for twenty minutes

The second is the clearer bug and the cheaper fix: it is exactly the "should finish in seconds" bucket that `transport.ts` and `docker-image.ts` were just classified into, and the same instrument applies. Route it through `runLimactl` with a bound derived from the file size, and the failure becomes a named timeout in seconds instead of a twenty-minute hook.

The first still needs the judgement the task describes — whether to bound per step, derive the hook budget from the work, or make synthesis content-addressed so most of it is skipped.

**Also worth noting from the same session:** `stageSourceTree` into `podkit-builder-musl` failed twice with `exit=255` (SSH transport failure, sub-second) while `build:linux-prebuild` was compiling in `podkit-builder-glibc` concurrently, then succeeded when run alone. A second data point that concurrent staging into two VMs on this host is fragile — unrelated to the bounds, since a sub-second failure is not a timeout.
<!-- SECTION:NOTES:END -->
