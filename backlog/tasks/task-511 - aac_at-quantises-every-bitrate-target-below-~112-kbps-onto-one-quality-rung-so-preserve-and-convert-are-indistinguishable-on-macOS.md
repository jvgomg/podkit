---
id: TASK-511
title: >-
  aac_at quantises every bitrate target below ~112 kbps onto one quality rung,
  so preserve and convert are indistinguishable on macOS
status: To Do
assignee: []
created_date: '2026-09-13 15:47'
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
- [ ] #1 The rung-collapse is confirmed directly — two different targets that map to the same `-q:a` are shown producing byte-identical encoder arguments
- [ ] #2 It is established whether upward rung rounding can push output above the quality preset's cap, and if it can, that is treated as the ceiling violation it is
- [ ] #3 `aac_at`'s bitrate-targeting resolution is stated wherever TASK-499's 'every encoder takes the target' claim is made, so the approximation is not read as exactness
- [ ] #4 `lossy-preserve-efficiency.test.ts` passes on macOS, or explicitly declares the encoder capability it requires — not by weakening the inequality
- [ ] #5 The one pass observed in 13 runs is explained or dismissed with evidence
<!-- AC:END -->
