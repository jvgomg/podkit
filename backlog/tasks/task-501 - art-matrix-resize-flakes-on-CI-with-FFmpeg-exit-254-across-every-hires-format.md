---
id: TASK-501
title: art-matrix suites flake with FFmpeg exit 254 across every hires format
status: To Do
assignee: []
created_date: '2026-09-08 19:35'
updated_date: '2026-09-08 21:12'
labels:
  - testing
  - ci
dependencies: []
references:
  - test-packages/e2e-tests/src/features/art-matrix-resize.test.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
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
- [ ] #1 The FFmpeg exit-254 cause is identified — specifically whether the missing path is an input or an output
- [ ] #2 The failure is reproducible on demand (e.g. under forced concurrency or an induced delay) rather than only observed
- [ ] #3 The race is fixed, or the test made robust to it, without weakening what it asserts about resize behaviour
- [ ] #4 The fix is validated across enough consecutive CI runs to be meaningfully better than 1-in-4
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
<!-- SECTION:NOTES:END -->
