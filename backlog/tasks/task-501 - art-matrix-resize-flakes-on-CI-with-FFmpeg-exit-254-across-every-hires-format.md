---
id: TASK-501
title: art-matrix suites flake with FFmpeg exit 254 across every hires format
status: In Progress
assignee: []
created_date: '2026-09-08 19:35'
updated_date: '2026-09-08 23:54'
labels:
  - testing
  - ci
dependencies: []
references:
  - test-packages/e2e-tests/src/features/art-matrix-resize.test.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
modified_files:
  - packages/podkit-core/src/diagnostics/scanners/transcode-tmp-walker.ts
  - packages/podkit-core/src/diagnostics/checks/debris-transcode-tmp.test.ts
  - packages/podkit-core/src/sync/engine/pre-sync-sweep.test.ts
  - >-
    packages/podkit-core/src/sync/engine/sweep-transcode-race.integration.test.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/transcode/ffmpeg.test.ts
  - docs/architecture/sync/planning.md
  - .changeset/transcode-scratch-sweep-race.md
priority: high
type: bug
ordinal: 280000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed on `ubuntu-latest` while landing task-495. **Not a regression** — it flaked on one attempt and passed on a re-run of byte-identical code, so it is pre-existing and timing-dependent.

**Rate so far: 1 failure in 4 CI attempts** (runs 34264912360 ✓, 34266500844 ✓, 34268183681 attempt 1 ✗, attempt 2 ✓). Far too small a sample to call a real rate; record further occurrences here.

Never reproduced on the Linux dev host, where `bun run test:e2e` is 37/37.

## Symptom

`test-packages/e2e-tests/src/features/art-matrix-resize.test.ts` fails via `observeResize` (`src/matrix/artwork-rules.ts:1288`):

```
error: resize sync failed (E2E Test iPod): exit=2
  status: "partial-failure",  result: { completed: 2, failed: 6, bytesTransferred: 0, duration: 7.56 }
```

All 12 recorded errors are the identical message, `category: "transcode"`:

```
FFmpeg exited with code 254
```

covering **every** format in the set — WAV, AIFF, ALAC, FLAC, OGG, Opus (`Multi-Format Hires - … Test Track`). `retryAttempts: 0`, `wasRetried: false`.

254 as a signed byte is −2, i.e. `AVERROR(ENOENT)` — FFmpeg could not open a file.

## What has been ruled out

- **Not the fixtures being absent.** `art-matrix-resize.test.ts:44` calls `ensureFixturesExist('multi-format-embedded-hires')` and it did not throw, so the directory was present.
- **Not a cross-test race on the static fixture root.** `art-matrix-resize.test.ts` is the only e2e consumer of the hires set, and nothing under `test-packages/e2e-tests/src` deletes anything inside `getStaticFixturesRoot()`.
- **Not the commit it appeared on.** It surfaced on the `@types/bun` pin, which is a types-only package and cannot affect runtime.
- **Not obvious contention.** The step ran *faster* on the failing attempt (215.7s, failing early) than on the two passing ones (270s, 265s).

Since the inputs were present, suspicion falls on the **output** path — a temp directory removed or not yet created when FFmpeg runs — rather than on the source fixtures. `bytesTransferred: 0` with `duration: 7.56` is consistent with six fast failures rather than a timeout.

## Notes for whoever picks this up

- `bunfig.toml` sets `retry = 1`, and the errors report `wasRetried: false` — so this failed at the *sync* level, beneath bun's retry, which is why the retry did not paper over it.
- Worth checking whether `TEST_CONCURRENCY` (2 on CI, 4 locally) changes the rate, and whether the resize pass shares a temp path with the file running alongside it — `gpod-tests-parallel` runs one `bun test` process per file, so a shared *path* rather than shared memory is the plausible seam.
- A flaky test is the specific way a backstop loses its authority; this is the main reason task-495's check stays advisory rather than required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The FFmpeg exit-254 cause is identified — specifically whether the missing path is an input or an output
- [x] #2 The failure is reproducible on demand (e.g. under forced concurrency or an induced delay) rather than only observed
- [x] #3 The race is fixed, or the test made robust to it, without weakening what it asserts about resize behaviour
- [x] #4 The fix is validated across enough consecutive CI runs to be meaningfully better than 1-in-4
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Rescoped and re-prioritised (2026-09-08): this is not resize-specific.** The first CI run on `main` after task-495 merged (run 34270021092) failed with the identical signature — 14 × `FFmpeg exited with code 254`, `category: "transcode"`, every hires format — but in **`art-matrix-transfer.test.ts`**, not `art-matrix-resize.test.ts`.

So the original framing was wrong in a way that matters: it is not one test racing its own temp dir, it is something in the shared art-matrix path. Whatever the cause, it can hit any file in that family, which also rules out the "only this file consumes the hires set" reasoning in the description above — that was true of resize but is not the boundary of the bug.

**Revised rate: 2 failures in 6 CI runs that reached `test:e2e`.**

| run | reached e2e | result |
|---|---|---|
| 34264912360 | yes | pass |
| 34266500844 | yes | pass |
| 34268183681 attempt 1 | yes | **fail — art-matrix-resize** |
| 34268183681 attempt 2 | yes | pass |
| 34269928947 | no (died earlier on the heartbeat flake) | — |
| 34270021092 (main) | yes | **fail — art-matrix-transfer** |
| 34270045074 (main) | yes | pass |

~33% is not a rare flake, and it is now failing on `main`, not just on a PR branch. Raised to High: at this rate the backstop cannot be made a required check, which defeats the point of task-495.

Still never reproduced on the Linux dev host (`bun run test:e2e` 37/37) or on macOS, so it is specific to the CI runner — 4 vCPU, `TEST_CONCURRENCY=2`, rootful Docker, mise-pinned conda FFmpeg 9.0.1.

A promising next step is to stop inferring from exit codes and capture the actual FFmpeg stderr: the sync layer reports only `FFmpeg exited with code 254`, and the argv-shim technique used while diagnosing task-499 (a logging wrapper ahead of ffmpeg on `PATH`) would show both the command and its diagnostics.

**Leading hypothesis from the repo owner: `TEST_CONCURRENCY` is implicated.** Worth treating as the first thing to test rather than one item on a list.

What makes it plausible:

- The flake has **only ever been seen on CI**, which is the only environment running `TEST_CONCURRENCY=2`. The Linux dev host and macOS both run the default of 4 and have never reproduced it — so the correlation, such as it is, points at the *lower* setting, not the higher one. That is counter-intuitive enough to be worth understanding before assuming "less parallelism is safer".
- Both observed failures were in the **art-matrix family**, whose files are the longest-running in the suite. Which files end up running *concurrently* is a function of the concurrency setting and of file ordering, so a different setting reshuffles which pairs overlap. A pairwise interaction would look exactly like this: stable for several runs, then a specific pairing lands and six transcodes fail at once.
- All six formats failing simultaneously, `bytesTransferred: 0`, `duration: 7.56` — consistent with a shared resource being unavailable for the whole pass rather than per-track bad luck.

Concrete way to test it: run `test:e2e` on CI at `TEST_CONCURRENCY` 1, 2 and 4 several times each via `workflow_dispatch`, and record failure rate per setting. If 1 is clean, that is strong evidence for a cross-file interaction and narrows the search to whatever the art-matrix files share — a temp path, the fixture root, or the artwork cache.

This also blocks task-495 AC #8: the concurrency tuning pass must not be attempted until this is understood, or the two changes confound each other and neither result means anything.

## Cause found: the pre-sync sweep deletes a sibling's live scratch directory

It is the **output** path, and it is not the art-matrix suites' fault — it is a production concurrency bug in `@podkit/core` that the e2e suite is simply the only thing here that runs concurrently enough to hit.

`sync/music/pipeline.ts` creates `<os.tmpdir()>/podkit-transcode-<uuid>/` and *then* writes the `.owner` marker into it:

```ts
await mkdir(transcodeDir, { recursive: true });
// A crash between mkdir and the write below leaves the dir without an
// `.owner` file, which the walker treats as orphaned and reaps — the
// worst-case is a just-created empty dir gets reaped, harmless.
await writeOwnership(join(transcodeDir, '.owner'), OWN_IDENTITY);
```

That comment is the bug. The dir is not "a just-created empty dir" — it is this process's **output directory for the rest of the run**. `walkAbandonedTranscodeDirs` classified any `podkit-transcode-*` dir with no `.owner` as debris, so a *sibling* `podkit sync` sweeping inside that window deleted it. Every subsequent transcode in the victim then wrote into a path that no longer existed.

Confirmed against the real code, no timing needed — `runPreSyncSweep` + `runPreliminariesPreFlight` on a scratch dir with no `.owner` leaves the tmp root empty — and carried through a real FFmpeg run:

```
exitCode: 254
message : FFmpeg exited with code 254: Error opening output …/podkit-transcode-gone/out.m4a: No such file or directory
```

That is the CI signature exactly — `category: "transcode"`, every track failing at once, `bytesTransferred: 0`, `retryAttempts: 0` (the failure is at the sync layer, beneath bun's `retry = 1`).

### Why the observations line up

- **All formats at once, `bytesTransferred: 0`, `duration: 7.56`** — one shared resource vanished for the whole pass, as the description suspected. `completed: 2` are the direct copies that need no scratch dir.
- **Only on CI** — the window is `mkdir` → `writeFile` → `rename`, so its width is set by how long a saturated host takes to schedule the continuations between them. On a 4-vCPU runner with two files each saturating FFmpeg that stretches from microseconds to tens of milliseconds; the dev host and macOS never get slow enough.
- **Both failures in the art-matrix family** — those files run by far the most syncs (device × transfer-mode × format), so they open the most windows *and* run the most sweeps. Likeliest victim and likeliest reaper at once.
- **`ensureFixturesExist` passing, nothing deleting the fixture root** — correct, and why "suspicion falls on the output path" was right.

### The `TEST_CONCURRENCY` hypothesis: half right

Concurrency is necessary — a sibling must be sweeping while another sets up, so `TEST_CONCURRENCY=1` would have been clean. But the "the *lower* setting is worse, which is counter-intuitive" reading was a coincidence of which machines run which setting. The discriminator is host **load**, not the number: CI is the only loaded machine and happens to be the only one running 2. The 1/2/4 matrix would have shown 1 clean and told us little else.

This unblocks task-495 AC #8 — the tuning pass is no longer confounded, because what it would have measured is fixed.

## Fix

`walkAbandonedTranscodeDirs` now leaves an `.owner`-less dir alone until it has gone `OWNERLESS_GRACE_MS` (60s) untouched. A missing `.owner` is only ever legitimate on debris — pre-`.owner` leftovers or a crash — and debris is by definition not brand new, so **age** is what separates the two cases. A *dead owner* stays unambiguous and is still reaped on sight, so SIGKILL leftovers are cleared by the very next sync and the daemon self-reaping behaviour TASK-402 added is untouched.

Rejected: staging the dir under a non-matching name and `rename()`ing it into place once stamped. That closes the window for the final name but just moves it to the staging name, which then either leaks forever or needs the same grace rule — more machinery for the same guarantee.

Also rewrote the pipeline comment that asserted the window was harmless; that belief is why this shipped.

`docs/architecture/sync/planning.md` §"Consumer B — transcode-tmp `.owner`" updated with the fourth rule.

## Diagnosability

`TranscodeError` carried FFmpeg's stderr in a field the sync error report never reached, so the message was the bare `FFmpeg exited with code 254` — and 254 is `-ENOENT`, which covers *both* an unreadable input and an unwritable output. Four CI runs went into inferring what one line of stderr says outright. `describeFFmpegFailure` now folds FFmpeg's first diagnostic into the message, stripped of its `[component @ 0xADDR]` prefix (which varies run to run and would make identical failures look distinct). The next occurrence of anything in this class names its own path.

## Residual, recorded not chased

`isAlive` compares the owner's start time within ±2s. A false negative there — a wall-clock step between the write and the read — would reap a *live* sibling's dir with the same consequences. No evidence it has ever fired, and the tuple check is deliberate PID-reuse defence, so it is noted rather than changed.

Separately: a transcode that fails with ENOENT on its own scratch dir is not retried. Having the pipeline re-create the dir on retry would have self-healed this, but it changes retry semantics for a case that should no longer arise.

## Verification

- `pre-sync-sweep.test.ts` — two seam tests reproducing the race deterministically: the sweep must not flag a mid-setup sibling, and a full sweep + pre-flight must leave its directory and its in-flight file on disk. Both fail on the unfixed walker.
- `debris-transcode-tmp.test.ts` — walker-level: fresh + unmarked skipped, fresh + half-written `.owner` skipped, aged + unmarked reaped, and fresh + **dead owner** still reaped (so freshness cannot become a blanket amnesty).
- `sweep-transcode-race.integration.test.ts` — the whole chain through a real FFmpeg: sweep the window, then transcode into the scratch dir. Fails on the unfixed walker.
- `bun run test` 65/65 tasks, `bun run test:e2e` 37/37, lint + typecheck + prettier clean.

## AC #4 is deliberately left open

It asks for validation across consecutive CI runs, which cannot be done from here — it needs runs after this merges. The deterministic reproductions above are stronger evidence than a run count, but they are not the thing the AC asks for, so the task stays In Progress until CI has actually been watched. Suggested bar: 6 consecutive green `test:e2e` runs on `main`, which at the observed ~33% would be a 1-in-730 fluke.

## Post-review correction

`/code-review` flagged that `firstFFmpegDiagnostic` duplicated a pre-existing `extractFFmpegError` in `video/transcode.ts` — same job, divergent keyword sets, same base message string, two extractors in core that would drift. Both paths now share `transcode/ffmpeg-error.ts`, whose keyword set is the union (it picks up video's `does not contain any stream`, which the audio version would have missed). Video's message shape changes with it, from a bare diagnostic to `FFmpeg exited with code N: <diagnostic>` — nothing pinned the old shape.

Also tightened the integration test: `runSiblingSweep` collected warnings it never asserted on; it now returns them and the test requires the sweep to be silent, not merely ineffective.

**Correction to the run-count above.** "6 consecutive green runs — a 1-in-730 fluke at ~33%" was wrong: `0.33^6` is the chance of six consecutive *failures*. Six consecutive **greens** at a 33% failure rate is `0.67^6` ≈ 9%, about 1 in 11 — nowhere near conclusive, and 6 was therefore far too low a bar.

The honest numbers, probability of N consecutive greens if the old rate still held:

| N | at p = 0.33 (observed) | at p = 0.25 (the AC's bar) |
|---|---|---|
| 6 | 9.0% | 17.8% |
| 8 | 4.1% | 10.0% |
| 11 | 1.0% | 4.2% |
| 12 | 0.7% | 3.2% |

AC #4 says "meaningfully better than 1-in-4", so p = 0.25 is the column that matters: **11-12 consecutive greens** to rule it out at 95%. Equivalently by the rule of three — zero failures in N trials puts the 95% upper bound at ~3/N — 12 runs bound the rate below 25%.

## AC #4: the CI evidence

Ran a purpose-built stress matrix (`.github/workflows/e2e-stress.yml`, 12 parallel samples per wave, ci.yml's exact env, no turbo cache — a restored `@podkit/e2e-tests#test:e2e` entry is keyed on `src/**` and would have let eleven samples replay one recorded pass).

| wave | tree | `TEST_CONCURRENCY` | run | result |
|---|---|---|---|---|
| control | grace check removed | 2 | 34291403111 | **1 red / 12** |
| fixed | as landed | 2 | 34291539101 | **0 red / 12** |
| control, amplified | grace check removed | 6 | 34292069757 | 0 red / 12 |

The control red is the bug by name, on the real runner:

```
"category": "transcode",
"message": "FFmpeg exited with code 254: Error opening output
  /tmp/podkit-transcode-679cca45-…/01-wav-track-….m4a.podkit-tmp: No such file or directory"
```

Every failing track names the **same** `podkit-transcode-679cca45-…` directory. That is the diagnosis confirmed in production rather than inferred — and it is only legible because of the `describeFFmpegFailure` change; on the old code this line read `FFmpeg exited with code 254` and named nothing. Spot-checked two fixed-wave samples to confirm they really ran (`37 passed, 0 failed`, 250s and 314s) rather than short-circuiting.

**What this does and does not establish.** Twelve consecutive greens rejects a 1-in-4 rate at 95% (`0.75^12` = 3.2%), which is what AC #4 asks for, so it is checked. But the control puts the true baseline nearer 8% than 25%, and against an 8% baseline twelve greens would happen 35% of the time with nothing fixed. Fisher's exact on the pooled control condition (3 failures / 18, counting the two historical CI runs) against 0 / 12 gives **p ≈ 0.20** — the waves alone do not separate the two conditions. The dispositive evidence remains the three deterministic reproductions, which fail on the unfixed walker and run in CI's unit+integration step on every push. AC #4 is met on its own terms; it is not the reason to believe the fix.

## Negative result: TEST_CONCURRENCY does not amplify this race

The obvious way to make a rare flake common is more concurrent processes — more open mkdir-to-stamp windows, more sweeps, and on 4 vCPUs longer event-loop stalls widening each window. Measured against the **pre-fix** walker it went the other way: 1/12 at `TEST_CONCURRENCY=2`, **0/12 at 6**, identical hardware and trees. Whatever sets the collision rate, it is not the process count. Recorded in the workflow header so nobody spends another wave on that lever.

This also walks back something asserted earlier in these notes. I called the repo owner's "the *lower* setting is worse, which is counter-intuitive" reading a coincidence of which machines run which setting. On identical hardware the lower setting is the one that reproduced. 1 versus 0 out of 12 is statistically nothing (Fisher p = 1.0), so this is not evidence *for* the original hypothesis either — but it is not the coincidence I claimed, and the mechanism behind the rate is still unexplained.

## Artifacts

Branches `stress/task-501-control`, `stress/task-501-control-c6` carry a DO-NOT-MERGE revert of the walker fix and exist only to make the control falsifiable. The waves' logs outlive them, so the branches can be deleted once read. `e2e-stress.yml` itself is worth keeping: it turns "is this flaky?" from weeks of organic pushes into one wave, and it now carries the negative result.
<!-- SECTION:NOTES:END -->
