---
id: TASK-505
title: >-
  Triage fixed-duration sleeps in tests and convert the racing ones to
  wait-for-condition
status: Done
assignee: []
created_date: '2026-09-09 20:25'
updated_date: '2026-09-09 20:39'
labels:
  - testing
  - flakiness
dependencies: []
references:
  - docs/agents/testing.md
  - test-packages/lima/src/heartbeat.test.ts
priority: medium
type: task
ordinal: 284000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`a6964fcd` fixed one instance of this and the pattern is repo-wide. That commit is the model:

> The test slept a fixed 35ms against `intervalMs: 10` and expected at least two ticks. On a loaded 4-vCPU runner timer callbacks coalesce, so two ticks are not guaranteed in that window. **The very next test in the same file already avoids exactly this** — "Force one tick deterministically rather than racing the interval" — so the technique was known, just not applied here.

That last sentence is the whole problem: the correct technique exists in the codebase and gets reached for inconsistently.

## Scope

Fifteen test files contain a fixed-duration sleep:

```
packages/virtual-ipod-server/src/watcher.test.ts
packages/podkit-cli/src/context.test.ts
packages/podkit-cli/src/commands/doctor-lock.test.ts
packages/podkit-core/src/device/mass-storage-tag-writer-helpers.test.ts
packages/podkit-core/src/utils/async-queue.test.ts
packages/podkit-core/src/lib/sync-lock-path.test.ts
packages/podkit-core/src/lib/pid-file.test.ts
packages/podkit-core/src/sync/music/pipeline.test.ts
packages/libgpod-node/src/__tests__/tracks.integration.test.ts
packages/podkit-daemon/src/sync-orchestrator.test.ts
test-packages/lima/src/progress.test.ts
test-packages/lima/src/streaming-runner.test.ts
test-packages/e2e-tests/src/docker-source/playlist-scoped-sync.test.ts
test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts
test-packages/e2e-vm-tests/src/vm-docker/daemon.docker-dist.test.ts
```

## This is a triage, not a find-and-replace

**Most of these are probably fine.** A sleep is legitimate when the thing being asserted *is* the passage of time — `pid-file.ts`'s bounded 5ms backoff, a debounce window, "prove `stop()` really stopped by observing nothing for a while". Converting those would be churn, and in the negative-assertion case ("nothing happened") there is no condition to wait for.

A sleep is a **bug** when it stands in for a condition that could be observed directly: sleep-then-assert-a-tick-count, sleep-then-assert-a-file-exists, sleep-then-assert-a-callback-fired. Those are the ones a loaded runner breaks.

Judge each on that line and record the verdict, including for the ones left alone, so this does not have to be re-derived next time.

## Watch for

- **The negative assertion.** `a6964fcd` *lengthened* the sleep that proves `stop()` stops rather than removing it — sometimes the honest fix is a longer sleep, not a wait loop.
- **Timer coalescing** is the mechanism, not slowness in general: under load a 10ms interval does not fire 3 times in 35ms even though 35 > 30.
- Every wait loop needs a ceiling that fails loudly, so a genuinely broken interval still fails rather than hanging to the suite timeout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every one of the fifteen files is classified as legitimate-sleep or racing-sleep, with a one-line reason recorded per file
- [x] #2 Racing sleeps are converted to wait-for-condition with a ceiling that fails loudly and a message naming what was being waited for
- [x] #3 Legitimate sleeps are left alone and carry a comment saying why, so the next sweep does not re-litigate them
- [x] #4 A genuinely broken interval or callback still fails the converted tests — verified by breaking one deliberately, not assumed
- [x] #5 The rule (what makes a sleep legitimate vs racing) is written into docs/agents/testing.md so new tests get it right
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Per-file verdicts

| # | File | Verdict | Reason |
|---|---|---|---|
| 1 | `packages/virtual-ipod-server/src/watcher.test.ts` | **mixed — 2 converted** | "write file, sleep 250/400ms, expect callCount === 1" was sleep-then-assert-a-callback-fired: fs-event latency + debounce, both unbounded under load. Now waits for `callCount > 0` with a 5s ceiling. The 50ms gaps *between* rapid writes stay (they space the writes into distinct fs events inside the 200ms debounce window). The unsubscribe test stays a sleep — negative assertion — lengthened 250→500ms. |
| 2 | `packages/podkit-cli/src/context.test.ts` | legitimate | The 10/5ms delays exist to interleave two ALS scopes; the assertion is *which context each scope sees*, which coalescing cannot change. `setTimeout(r, 1)` is a macrotask boundary, not a duration. Commented. |
| 3 | `packages/podkit-cli/src/commands/doctor-lock.test.ts` | legitimate | Both sleeps are *holds* inside the locked body, not waits. Both racers are launched together and the loser fails inside `acquire()`, so there is no "the other side has tried" signal to observe. A slow host lengthens the hold, never shortens it. Commented. |
| 4 | `packages/podkit-core/src/device/mass-storage-tag-writer-helpers.test.ts` | legitimate | 5ms of simulated work keeping tasks in flight so `peak` means something. The assertion is an upper bound (`peak <= 4`), which coalescing can only make easier to satisfy. Commented. |
| 5 | `packages/podkit-core/src/utils/async-queue.test.ts` | legitimate (all 5) | Every one is a negative assertion — "pop is still blocked", "push is still blocked". Nothing to wait for. Also structurally safe: a queue that failed to block would settle on the next microtask, far inside 10ms. File-level comment added. |
| 6 | `packages/podkit-core/src/lib/sync-lock-path.test.ts` | legitimate — already the model | Already has `waitForLockFile()` (poll + 15s ceiling + throw); the child's `holdMs` is a gated hold. Note added to `spawnLockChild`'s docstring. (`acquireDelayMs` is dead — default 0, never passed — kept as documentation of the superseded approach.) |
| 7 | `packages/podkit-core/src/lib/pid-file.test.ts` | **racing — converted** | `sleep 50ms` then `expect(isAlive(child)).toBe(true)` — "the kernel has published the process" is a condition. Now polls `isAlive` to a 5s ceiling, then asserts (so a child that never registers still fails on the assertion). The bounded 5ms backoff the description mentions is in `pid-file.ts` (production), not the test. |
| 8 | `packages/podkit-core/src/sync/music/pipeline.test.ts` | **mixed — 1 converted** | `downloadDelayMs` / the 30ms transcode are simulated work durations that create the overlap the prefetch assertion is about — legitimate, commented. `setTimeout(() => controller.abort(), 30)` against 3 × 50ms of transcoding was racing **and the test asserted nothing** (see below). Abort now fires from inside the first transcode. |
| 9 | `packages/libgpod-node/src/__tests__/tracks.integration.test.ts` | legitimate — untouched | 1100ms across libgpod's 1-second `time_modified` resolution. The passage of time is precisely what is asserted, and the existing comment already says so. |
| 10 | `packages/podkit-daemon/src/sync-orchestrator.test.ts` | **racing — 9 of 10 converted** | 7 × `sleep 10ms` then assert/depend on `isSyncing`; 2 × `sleep 50ms` to let a queued sync drain. All replaced with a local `waitFor(what, predicate, 5s)` that throws naming what it waited for. The 10th (after `abort()`) is a negative assertion — "no follow-on sync started" — kept and lengthened 50→200ms. |
| 11 | `test-packages/lima/src/progress.test.ts` | **mixed — 2 converted** | `a6964fcd` fixed the first test; the two below it still slept a fixed 5ms against `intervalMs: 1` for a tick. Extracted `waitForLines(lines, n)` (ceiling + named throw) and used it in all three. The `Bun.sleep(20)` for "no timer at all" is a negative assertion — kept, commented. |
| 12 | `test-packages/lima/src/streaming-runner.test.ts` | **mixed — 1 converted** | "reports progress for a buffered call" ran `sh -c 'sleep 0.2'` with `heartbeatMs: 15` and asserted ≥ 2 ticks — the a6964fcd pattern with more margin, and unfixable by waiting longer because the child's exit stops the heartbeat. The child is now held open by a marker file until 2 ticks are observed (with an `i < 2000` backstop so a failed release cannot orphan it). The 1400ms SIGKILL-escalation sleep and the "stops reporting once complete" sleep are negative assertions — kept, the latter lengthened 60→300ms. |
| 13 | `test-packages/e2e-tests/src/docker-source/playlist-scoped-sync.test.ts` | legitimate — untouched | Both sleeps are the *interval* inside already-correct bounded poll loops (`waitForStableSongCount`, the playlist-entry poll). Both already carry docstrings. |
| 14 | `test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts` | legitimate — untouched | The single sleep is `POLL_INTERVAL_MS` inside `pollForOutput`, which has a 30s ceiling and throws naming the context. Exemplary. |
| 15 | `test-packages/e2e-vm-tests/src/vm-docker/daemon.docker-dist.test.ts` | legitimate — untouched, one flagged | `SYNC_WAIT_POLL_MS` sleeps are poll intervals in bounded loops; `sleep 4` is a deliberate dwell to let checkpoints accumulate (gated behind `waitForDaemonLog` first). **`sleep 1` in `startMockApprise()` is a genuine sleep-then-use** ("wait for the mock server to bind"), but converting it means editing a VM+nerdctl e2e file that cannot be verified on this host, and it would need `test:vm` to prove. Left alone deliberately — worth a follow-up if that suite ever flakes at startup. |

## Deliberate breakage (AC #4) — two, both observed red

1. **`sync-orchestrator.ts`**: commented out `void this.handleDeviceAppeared(next)` in `processQueue()`. Result: `error: Timed out after 5000ms waiting for the queued device (sdc1) to be mounted by the follow-on sync`, `(fail) SyncOrchestrator > queues new devices while syncing (one-at-a-time)` after all 3 retry attempts. Reverted; green again.
2. **`pipeline.ts`**: disabled the post-drain `if (signal?.aborted) throw new AbortError()`. Result: `(fail) … cleans up prefetched files on abort` — `expect(caught).toBeInstanceOf(AbortError)`, received `undefined`. Then, with the *same* break in place, I checked out the pre-change test file and re-ran it: **1 pass, 0 expect() calls**. The old test could not fail. Both reverted; green again.

## Two things the description had wrong

- The task references `test-packages/lima/src/heartbeat.test.ts`, which does not exist — the file is `src/progress.test.ts`.
- The description quotes a6964fcd approvingly: "The very next test in the same file already avoids exactly this — 'Force one tick deterministically rather than racing the interval'." That comment overclaims. What is deterministic in those two tests is the *clock* (injected `now`), not the tick: they slept a fixed 5ms against `intervalMs: 1` and read `lines[0]`. Same class of bet, just 5× the margin. Converted both.

## Also found

`pipeline.test.ts`'s "cleans up prefetched files on abort" ended with a bare comment — `// Pipeline should have been aborted — not all operations completed (exact count depends on timing…)` — and **no assertion**. The only `expect` was inside a `catch` that a non-aborting pipeline never enters. It has never been able to fail, and it does not check cleanup at all despite its name. It now asserts that an `AbortError` surfaced and that fewer than 3 transcodes started. Asserting the temp dir is actually empty is still not covered — the mock deps expose no transcode dir — so the name still overpromises.

## Verification

- `bun run test` (unit + integration): 65/65 turbo tasks green.
- `bun run lint`: clean (oxlint, CLI stderr check, shellcheck).
- `bunx turbo run typecheck`: 38/38 green.
- `bunx prettier --write` on every touched file.
- `test:e2e` / `test:vm` deliberately not run: no file in `e2e-tests` or `e2e-vm-tests` was modified.
- `graphify update .` run.
<!-- SECTION:NOTES:END -->
