---
id: TASK-511
title: >-
  aac_at quantises every bitrate target below ~112 kbps onto one quality rung,
  so preserve and convert are indistinguishable on macOS
status: Done
assignee: []
created_date: '2026-09-13 15:47'
updated_date: '2026-09-13 16:54'
labels:
  - transcoding
  - macos
  - quality
dependencies: []
references:
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - test-packages/e2e-tests/src/features/lossy-preserve-efficiency.test.ts
priority: high
type: bug
ordinal: 290000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`lossy-preserve-efficiency.test.ts` fails on macOS, and the cause is in the product rather than the test.

## The failure

```
expect(preserveBitrate).toBeGreaterThan(convertBitrate)
Expected: > 67
Received: 67
```

Observed 12 times out of 13 runs on Mavis (FFmpeg 9.0.1, the same version the test's inline numbers were measured on), always exactly 67 vs 67. It fails identically under the old `retry = 1` and under `retry = 0`, so it is **not** something the retry-policy change (TASK-506) caused or revealed — it is a pre-existing failure that happens to fail on almost every attempt. The one observed pass in 13 runs is unexplained and worth keeping in mind.

## Cause

`ENCODER_PRIORITY = ['aac_at', 'libfdk_aac', 'aac']` (`transcode/ffmpeg.ts:58`), so macOS picks AudioToolbox. `aac_at` has no `-b:a`; the target is mapped to a `-q:a` rung by `aacAtQualityFromBitrate` (`transcode/ffmpeg.ts:205`), whose scale has **five points**:

```
320→q0, 256→q2, 192→q4, 128→q6, 96→q8
```

The function picks the nearest point. The test's two targets are ~92 kbps (preserve: probed 69 ÷ 0.75) and ~69 kbps (convert: min(probed, cap)). Both are nearest to 96, so **both emit `-q:a 8`** — byte-identical encoder arguments, and therefore the same output bitrate. The assertion cannot hold on an `aac_at` host for any pair of targets that share a rung.

The general shape: every target below ~112 kbps collapses onto q8, every target above 288 onto q0, and in between the rungs are 32-64 kbps apart. On macOS, podkit's AAC bitrate targeting has a resolution of five values.

## Why this is a product bug, not a test bug

TASK-499's premise was that all three AAC encoders take the seam's target, and the test's own docstring says "the two runs now issue different requests everywhere". That is true for native `aac` (`-b:a`) and `libfdk_aac`, and only *approximately* true for `aac_at` — at five-rung resolution two materially different targets routinely become one request. The efficiency-matching and cap behaviour ADR-023 promises is therefore honoured coarsely on macOS, in a way nothing currently states.

Worth checking while in here whether the cap can be *exceeded* by rung rounding: a target of 288 rounds to q0 (~350 measured), which would put the output above a 256 cap. If so, that is a ceiling violation, and [ADR-023](docs/adr/) §2 says the ceiling is hard. The rung table's own comment records the measured bitrates (q0 ~350, q2 ~265), so the rounding is upward in at least two places.

## Not addressed here

The test is red on macOS today. Do not fix it by loosening the assertion to `toBeGreaterThanOrEqual` — that would assert nothing. Either the mapping gets enough resolution for the two targets to differ, or the test declares that it needs an encoder with continuous bitrate control and says so.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The rung-collapse is confirmed directly — two different targets that map to the same `-q:a` are shown producing byte-identical encoder arguments
- [x] #2 It is established whether upward rung rounding can push output above the quality preset's cap, and if it can, that is treated as the ceiling violation it is
- [x] #3 `aac_at`'s bitrate-targeting resolution is stated wherever TASK-499's 'every encoder takes the target' claim is made, so the approximation is not read as exactness
- [x] #4 `lossy-preserve-efficiency.test.ts` passes on macOS, or explicitly declares the encoder capability it requires — not by weakening the inequality
- [x] #5 The one pass observed in 13 runs is explained or dismissed with evidence
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Fix

`aac_at` is driven in ABR mode at the resolved target (`-aac_at_mode abr -b:a …`) instead of having that target translated into a `-q:a` quality index. Same mechanism the native `aac` branch already used, for the same stated reason.

The quality-index path survives only for callers with no target at all, which is the one case where a quality level is the right axis. `aacAtQualityFromBitrate` is deleted rather than left unused.

## AC #1 — the rung collapse, confirmed

`-q:a` is not a bitrate axis, so the five-point map was only ever valid for the material it was calibrated on. The table in the code was measured on music; on stereo pink noise the same rungs produce **190/150/111/80/62 kbps**, not 350/265/200/145/107.

Nearest-point rounding then put every target below ~112 kbps on `q=8`. The failing test's two targets (~92 preserve, ~69 convert) both landed there, producing byte-identical arguments — pinned now by a unit test that asserts the two targets yield different args.

## AC #2 — the ceiling was being breached, and the tests could not see it

Measured on uncorrelated stereo white noise: a 256 kbps target picked `q=2`, which produces **282 kbps** — 10% over a cap ADR-023 §2 calls hard. The repo's own published measurements agree and go further: `docs-site` records the `high` preset ranging to **305 kbps** across a 44-track sample.

The `quality preset bitrate ceiling` integration tests did not catch this because their fixture was one pink-noise channel duplicated by `-ac 2`. Joint stereo codes the redundant side channel for almost nothing, so `q=2` sat at ~150 kbps there — a hundred kbps clear of the line. The fixture is now two independent seeded white-noise channels, and the assertions bind: restoring the old mapping fails all three presets (285 > 269, 205 > 202, 149 > 134) and passes with the fix.

Tolerances tightened to match the encoder's real behaviour: `aac_at` moves from 15% to 5% in both `aacCeilingKbps` and the integration test's `ceilingFor`.

## The ladder — found in review, not by me

ABR does not accept arbitrary rates. AudioToolbox takes a fixed ladder (stereo @44.1k: **64, 72, 80, 96, 112, 128, 144, 160, 192, 224, 256, 288, 320**) and rounds anything else **upward** — a 171 kbps target became a 192 request, measuring 198 out. That would have reintroduced the very overshoot this task was closing, by a new route, for every off-ladder target: `customBitrate` accepts any integer 64-320, and the efficiency-matched path divides a source bitrate by a codec ratio, so off-ladder values are the normal case rather than the exotic one.

`aacAtAbrBitrate` now snaps the target down to the highest rung at or below it. Verified against the encoder end to end — no request is off-ladder, and each lands under its target:

| target | asked | measured |
|--------|-------|----------|
| 171 | 160 | 161 |
| 200 | 192 | 197 |
| 240 | 224 | 230 |
| 100 | 96 | 97 |
| 69 | 64 | 64 |
| 92 | 80 | 78 |

Mono accepts a finer set that includes every stereo rung, so rounding down against the stereo ladder is safe for both.

**One limit remains and is documented rather than papered over:** 64 kbps is the lowest stereo rate this encoder offers, so a target below it cannot be honoured on macOS. And ABR keeps ~2% of its own slack — an on-ladder 256 request measures 262 — which is why the tolerance is 5% rather than cap+1, and why the docs now say "within about 2%" instead of "never exceeds".

## AC #3 — the claim, corrected where it was made

TASK-499's "all three encoders take the seam's target" was true of native `aac` and only approximately true of `aac_at`. Corrected in the test's own docstring, in `aacCeilingKbps`'s rationale, in the integration test's `ceilingFor` docblock, and in the two published pages (`reference/quality-presets.md`, `developers/quality-preset-testing.md`). The latter's observed-range table is kept with a caution marking it as pre-change evidence — it is what motivated the fix, and re-measuring it against the 44 tracks is noted as outstanding.

ADR-010 also describes the old mapping and is deliberately left alone: ADRs are frozen at decision time.

## AC #4 — the test passes, assertion untouched

`lossy-preserve-efficiency.test.ts` now passes **5 runs out of 5** (was 1 out of 13), and the full host e2e lane is **37 passed / 0 failed** on macOS. The inequality was not weakened — the two runs now genuinely issue different requests (80k vs 64k after ladder snapping).

## AC #5 — the single pass in 13 runs

Not explained, but narrowed and now moot.

Ruled out: source nondeterminism. The fixture's `anoisesrc` has no seed, so the obvious theory was that an unusually dense noise file lifted the preserve target across the q8/q6 boundary. It is deterministic in practice — 12 independent generations of the exact command probe 88-89 kbps, a 1 kbps spread nowhere near a rung edge.

It is moot because the assertion no longer sits on a boundary: preserve and convert resolve to different ladder rungs by construction, so an outlier of this shape cannot recur. Worth noting the observation was a single run and I reported it as "retry hides this" before three further runs on the unmodified tree showed the opposite.

## Verification

- `bun run lint` clean; `bun run typecheck` 38/38
- `bun run test --force` — 65/65 tasks, `Cached: 0` (one unrelated one-off in `@podkit/virtual-ipod-server`, filed as TASK-512, did not recur across a second full run or 10 loaded runs of that package)
- transcode unit 155 pass / 0 fail; transcode integration 53 pass / 0 fail
- host e2e 37 passed / 0 failed, `Cached: 0`
- Changeset added — this changes what macOS-encoded files sound like, which is user-facing
<!-- SECTION:NOTES:END -->
