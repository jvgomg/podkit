---
id: TASK-500
title: Re-derive the encoder-calibrated bitrate assertions in the e2e suite
status: Done
assignee: []
created_date: '2026-09-08 18:20'
updated_date: '2026-09-09 21:16'
labels:
  - testing
dependencies:
  - TASK-499
references:
  - docs/architecture/conventions.md
modified_files:
  - test-packages/e2e-shared/src/audio-probe.ts
  - test-packages/e2e-shared/src/index.ts
  - test-packages/e2e-tests/src/features/lossy-preserve-efficiency.test.ts
  - test-packages/e2e-tests/src/features/preset-change.test.ts
  - test-packages/e2e-tests/src/features/upgrades.test.ts
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
- [x] #1 lossy-preserve-efficiency.test.ts:158 asserts something that is true by construction rather than by encoder noise
- [x] #2 The `< 170` thresholds in preset-change.test.ts are re-derived against the post-task-499 behaviour, with the derivation recorded
- [x] #3 The measured-vs-measured inequalities at preset-change.test.ts:763 and upgrades.test.ts:1056 still express a real contract after task-499, or are replaced
- [x] #4 A decision is recorded on whether encoder-calibrated assertions must declare the encoder they assume
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What actually needed fixing, versus what the description said

The comment on this task was right that task-499 moved the numbers helpfully, and wrong about one thing: `lossy-preserve-efficiency.test.ts` was not running at all on this host. Commit `de6e5bf8` (during task-495) had gated the whole file behind `describe.skipIf(!hasTargetAwareAacEncoder())`, so on every stock Linux host and on CI the "coin flip" assertion was simply skipped. Post-499 that gate is stale — all three AAC encoders now take the seam's target — so the fix was to delete the gate, not to weaken the assertion.

Two further facts the description did not have, both of which changed the shape of the work:

1. **The old thresholds were measuring the MP4 container, not the encoder.** `MassStorageTarget.getTracks()` reports ffprobe's `format.bit_rate`, which charges the `moov` atom and tags to the audio. On a two-second fixture that is ~9 kbps: a file encoded exactly at the 128 kbps cap measures **137**. No cap assertion can be tight while reading that number.
2. **The fixtures made the caps unfalsifiable.** Every site used a 2 s 440 Hz sine. A sine gives the encoder almost nothing to spend bits on, so it lands under any cap regardless of what podkit asked for — `measured <= cap` cannot fail. Same argument task-499 made when it chose pink noise for its own ceiling suite.

So the work was: measure the *stream*, make the cap *bind*, and derive the bound from the *encoder*. No threshold was widened.

## Sites, and the derivation of every number

All figures: FFmpeg 9.0.1 (the mise-pinned `conda:ffmpeg`), native `aac` (this host has neither `aac_at` nor `libfdk_aac`), ffprobe `stream=bit_rate` unless stated. Fixtures are stereo pink noise, `anoisesrc=color=pink:sample_rate=44100:duration=2:amplitude=0.8:seed=500 -ac 2`.

**1. `lossy-preserve-efficiency.test.ts` — `preserveBitrate > convertBitrate` (AC #1).**
Gate removed; the file now runs everywhere. The premise is true by construction: preserve targets `round(probed / 0.75)` and convert targets `min(probed, 256)`, and since task-499 every encoder is handed that target (native `aac` via `-b:a`, `libfdk_aac`/`aac_at` via their quality indices). Measured **preserve 93 / convert 69** — a ratio of 1.35 against the efficiency table's 1.33. Before task-499 this was 232 vs 231. Both absolute values sit well under their nominal 171/128 because libopus undershoots `-b:a` heavily on pink noise, so podkit probes the source at ~69 rather than 128; that scales both targets equally and does not touch the relationship under test. Filed to task-502.

**2. `lossy-preserve-efficiency.test.ts` — `toBeLessThanOrEqual(256)`.**
Literal replaced with `aacCeilingKbps(HIGH_CAP_KBPS)`. Kept and labelled as a *guard, not a proof*: on this fixture the lifted target never reaches 256, so the clamp never fires and the assertion cannot fail. Making it bind needs a source whose lifted target crosses the cap, which on synthetic noise depends entirely on libopus's rate control — task-502's corpus. The clamp itself is pinned at the unit level in `lossy-reduction.test.ts`. Recorded on task-502 rather than bodged here.

**3 & 4. `preset-change.test.ts` — the two `toBeLessThan(170)` sites (AC #2).**
`170` was an `aac_at` number guarding a **128 kbps** cap — 33% of slack nobody could derive. Replaced with `measured <= aacCeilingKbps(QUALITY_CAP_KBPS.low)`, read off the audio stream via a new `soleDeviceStreamBitrateKbps()` helper. On native `aac` that ceiling is **129** (`cap + 1`, the one kbps being ffprobe's rounding — task-499's `ceilingFor` established this and it is deliberately the same figure).

- 192 kbps MP3 → `quality=low`: measured **128** (was 137 on the container, 187 before task-499).
- 320 kbps MP3 → `quality=low` on first add: measured **128** (was 137).

Both land exactly on the resolved target, so the margin is 1 kbps and the assertion is as tight as the measurement allows.

**5. `preset-change.test.ts` — `lifted > reduced` (AC #3).**
Still a real contract, and now structural rather than incidental: the reduced copy is encoded at the `low` cap (128) and the lift at the source-bounded high target (`min(192, 256) = 192`). Measured **128 → 192** — each run lands exactly on its resolved target, a margin of 64 kbps where the pre-existing sine fixture gave 13. Added `lifted <= aacCeilingKbps(QUALITY_CAP_KBPS.high)` alongside it, and turned the `reduced` liveness check (`> 0`) into the same low-cap assertion, since it was already measuring a capped re-encode and asserting nothing about it.

The fixture also moved from `-b:a 200k` to `-b:a 192k`: 200 is not an MPEG-1 Layer III bitrate and lame was silently snapping it to 192, so the comment describing "a 200 kbps MP3" was wrong.

**6. `upgrades.test.ts` — `lifted > reduced` (AC #3).**
Same contract, iPod target, so the figure is the iTunesDB record (container-inclusive) rather than a stream probe — deliberate, because a relative comparison does not need the container overhead removed and the DB value is the on-device truth. `generateMp3AtBitrate` gained a `content: 'tone' | 'noise'` option (default unchanged) and this one test asks for noise. Measured **134 → 241**, against 128 → 143 with the sine. Left the DB reading in place and did *not* add a cap assertion there, because the container overhead would make it dishonest; noted where the cap is actually pinned.

**7. `upgrades.test.ts` — `expect(bitrate).toBe(reducedBitrate)`.**
Left exactly as-is. It asserts that a no-op sync left the same bytes on the device, which is true by construction and correctly exact.

**8. `upgrades.test.ts:1527` — `<= HIGH_CAP_KBPS`.**
Out of scope per the brief, untouched. Its neighbouring comment justified *not* asserting `lossy < lossless` by citing "what FFmpeg's native `aac` encoder emits at `-q:a 5` (~228 kbps)" — behaviour task-499 deleted. Corrected the explanation; the assertion is unchanged.

**9. Fixture channel count.** All the noise fixtures are `-ac 2`. Native `aac` ABR overshoots `-b:a` by ~10% on a *mono* stream (mono pink noise via a 320 kbps MP3: `-b:a 192k` → **210** kbps) while tracking it to within 1% in stereo at every target from 96 to 256. A mono fixture would have failed the new `cap + 1` ceiling for a reason that has nothing to do with podkit. Full mono/stereo table recorded on task-502, since it means the `cap + 1` ceiling is only established for stereo.

## AC #4 decision: yes, and it is implemented

**An assertion on a measured bitrate must derive its bound from the resolved encoder, not hard-code a number observed on one machine.** Recorded as §6a of `docs/architecture/conventions.md`, with the two corollaries above (measure the stream not the container; a cap assertion needs a fixture that makes the cap bind).

Implementing it was the cheaper half, because every site here needed *some* bound and the alternative was another undocumented literal. `test-packages/e2e-shared/src/audio-probe.ts` adds `resolveAacEncoder()` (mirrors core's `ENCODER_PRIORITY` against `ffmpeg -encoders`, cached), `aacCeilingKbps(cap, encoder?)` and `probeAudioStreamBitrateKbps(file)`. `aacCeilingKbps` is a deliberate duplicate of `ceilingFor()` in `ffmpeg.integration.test.ts` — core cannot depend on a test package — and both are flagged as needing to move together.

The decision explicitly rejects the alternative that was already in the tree: **skipping the test on hosts whose encoder cannot express the contract.** That is what `de6e5bf8` did, and the cost was that the assertion stopped running on Linux and CI, which is every host that matters.

The FFmpeg *version* half of the question (nothing pins one; `checkFfmpeg` is a bare `ffmpeg -version` probe) is left to task-502 AC #6, which already owns it.

## Verification

Red-before-green, with task-499's fix reverted in `buildVbrArgs` and the CLI rebuilt:

- `preset-change` cap-down: `Expected: <= 129, Received: 220`
- `preset-change` first-add: `Expected: <= 129, Received: 233`
- `preset-change` below-cap: `Expected: <= 129, Received: 220`
- `lossy-preserve-efficiency`: `Expected: > 222, Received: 221` — the original coin-flip failure mode, reproduced on demand

All four fail on both attempts, so `bunfig.toml`'s `retry = 1` does not mask them. Restored and rebuilt after.

Green: `bun run test:e2e` 37/37; `bun run test` all pass with `--force` on `@podkit/e2e-shared` + `@podkit/e2e-tests` (`Cached: 0, 18 total`); `bun run lint` clean (oxlint, CLI stderr conventions, shellcheck); `bunx turbo run typecheck --force` on both packages clean; prettier clean.

No changeset: nothing under `packages/` changed.
<!-- SECTION:NOTES:END -->

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
