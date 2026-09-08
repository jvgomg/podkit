---
id: TASK-500
title: Re-derive the encoder-calibrated bitrate assertions in the e2e suite
status: To Do
assignee: []
created_date: '2026-09-08 18:20'
updated_date: '2026-09-08 21:43'
labels:
  - testing
dependencies:
  - TASK-499
references:
  - docs/architecture/conventions.md
priority: medium
type: task
ordinal: 279000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Catalogued while diagnosing the `upgrades.test.ts` failure during task-495. Several e2e assertions read a **measured** bitrate from a real encode and are calibrated to macOS's `aac_at`, while the harness's stated contract is that native `aac` is enough. That mismatch is the general shape of the problem; task-499's fix will move the numbers, so these must be re-derived after it lands.

**Coin flip today, papered over by `bunfig.toml`'s `retry = 1`:**

- `test-packages/e2e-tests/src/features/lossy-preserve-efficiency.test.ts:158` — `expect(preserveBitrate).toBeGreaterThan(convertBitrate)`. The test's premise is that preserve (target 171) and convert (target 128) land in different encoder quality buckets, but an argv shim shows both runs issue the **byte-identical** `-c:a aac -q:a 5`. Observed failing `Expected: > 232 / Received: 231` on one attempt and passing on retry. It is measuring encoder noise. **Highest priority here.**
- `lossy-preserve-efficiency.test.ts:162` — `toBeLessThanOrEqual(256)` passes only because native `aac` happens to saturate at ~230.

**Passing but fragile — `aac_at` calibrations that a richer fixture or task-499's fix would flip:**

- `preset-change.test.ts:531` and `:632` — `expect(tracks[0]!.bitrate).toBeLessThan(170)` after a `quality=low` (cap 128) re-encode. 170 is an `aac_at` number; native `aac -q:a 2` gives 187 on denser content, so these survive only because their fixtures are simple.
- `preset-change.test.ts:763` and `upgrades.test.ts:1056` — `expect(lifted.bitrate).toBeGreaterThan(reducedBitrate)`. Strict measured-vs-measured inequality, surviving only because low(q2)=187 and high(q5)=230 differ on native `aac`. Would collapse if task-499 maps both closer to their caps.
- `upgrades.test.ts:1037` — `expect(bitrate).toBe(reducedBitrate)` exact equality. Low risk (asserts a no-op left the same bytes) but exact.

**Deliberately left alone:** `upgrades.test.ts:1527`'s `<= HIGH_CAP_KBPS` — that is the ceiling ADR-023 promises, so it *should* fail if the ceiling breaks.

**Checked and safe, recorded so nobody re-audits them:** the copied-CBR-MP3 bounds (`upgrades.test.ts:689,727,1151`), all `codec_name` assertions, all `size > 0` liveness checks, the self-relative file-size deltas in `mass-storage-sync.test.ts`, and every `targetBitrate`/sync-tag assertion in `podkit-core` unit tests (those read configured values, not measured ones, so they are deterministic). `test-packages/e2e-vm-tests/` has no bitrate, size or encoder-output assertions at all.

**Related gap:** nothing anywhere requires or detects `aac_at`/`libfdk_aac`, and no test pins an FFmpeg version. `test-packages/e2e-shared/src/preflight.ts`'s `checkFfmpeg` is a bare `ffmpeg -version` probe; the real encoder gate is `test-fixtures/scripts/check-ffmpeg.ts:34` (`flac, libmp3lame, aac, libvorbis, libopus, mjpeg`). Consider whether an assertion calibrated to a specific encoder should have to declare that encoder.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 lossy-preserve-efficiency.test.ts:158 asserts something that is true by construction rather than by encoder noise
- [ ] #2 The `< 170` thresholds in preset-change.test.ts are re-derived against the post-task-499 behaviour, with the derivation recorded
- [ ] #3 The measured-vs-measured inequalities at preset-change.test.ts:763 and upgrades.test.ts:1056 still express a real contract after task-499, or are replaced
- [ ] #4 A decision is recorded on whether encoder-calibrated assertions must declare the encoder they assume
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: Claude Opus 5
created: 2026-09-08 21:43
---
task-499 landed. `bun run test:e2e` is 37/37 on the Linux dev host with the fix in, and the fix moves most of the assertions catalogued here in the *right* direction rather than breaking them:

- `lossy-preserve-efficiency.test.ts:158` — the premise is now true by construction. Preserve (171) and convert (128) previously issued the byte-identical `-c:a aac -q:a 5`; they now issue `-b:a 171k` and `-b:a 128k`, so `preserveBitrate > convertBitrate` measures two different requests instead of encoder noise. Worth re-reading against AC #1 before closing it, but the noise is gone.
- `preset-change.test.ts:531,632` — a `quality=low` re-encode now lands at ~128 rather than 187, so `< 170` holds with real margin instead of resting on a simple fixture. The threshold is still an `aac_at` number and should still be re-derived per AC #2.
- `preset-change.test.ts:763` / `upgrades.test.ts:1056` — `lifted > reduced` is now 256-cap vs 128-cap rather than 230 vs 187. Wider, not narrower.

So this task is no longer urgent, but it is not done: the thresholds still encode `aac_at` calibrations nobody has re-derived, and AC #4 (whether an encoder-calibrated assertion must declare its encoder) is untouched. One data point for it — task-499's new ceiling suite in `ffmpeg.integration.test.ts` does branch on the resolved encoder and says why in a comment, which is a workable shape for that convention.
---
<!-- COMMENTS:END -->
