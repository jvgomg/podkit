---
id: TASK-505
title: >-
  Triage fixed-duration sleeps in tests and convert the racing ones to
  wait-for-condition
status: To Do
assignee: []
created_date: '2026-09-09 20:25'
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
- [ ] #1 Every one of the fifteen files is classified as legitimate-sleep or racing-sleep, with a one-line reason recorded per file
- [ ] #2 Racing sleeps are converted to wait-for-condition with a ceiling that fails loudly and a message naming what was being waited for
- [ ] #3 Legitimate sleeps are left alone and carry a comment saying why, so the next sweep does not re-litigate them
- [ ] #4 A genuinely broken interval or callback still fails the converted tests — verified by breaking one deliberately, not assumed
- [ ] #5 The rule (what makes a sleep legitimate vs racing) is written into docs/agents/testing.md so new tests get it right
<!-- AC:END -->
