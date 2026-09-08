---
id: TASK-499
title: 'Native aac VBR discards the target bitrate, so the quality cap is not enforced'
status: Done
assignee: []
created_date: '2026-09-08 18:20'
updated_date: '2026-09-08 21:43'
labels:
  - transcoding
  - correctness
dependencies: []
references:
  - docs/adr/adr-023-lossy-reduction-down-only.md
  - docs/adr/adr-010-quality-preset-redesign.md
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/docs-site/src/content/docs/reference/quality-presets.md
modified_files:
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/transcode/ffmpeg.test.ts
  - packages/podkit-core/src/transcode/ffmpeg.integration.test.ts
  - packages/docs-site/src/content/docs/reference/quality-presets.md
  - .changeset/native-aac-bitrate-ceiling.md
priority: high
type: bug
ordinal: 278000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while diagnosing an unrelated e2e failure during task-495. **podkit silently exceeds the quality preset's ceiling on every host without `aac_at` or `libfdk_aac`** — i.e. all stock Linux, the mise-pinned conda FFmpeg 9.0.1, and `ubuntu-latest` CI.

`packages/podkit-core/src/transcode/ffmpeg.ts:93-117`, `buildVbrArgs`:

```ts
case 'libfdk_aac': return ['-vbr', String(quality), '-cutoff', '18000'];
case 'aac_at':     return ['-q:a', String(aacAtQualityFromBitrate(targetKbps))];
case 'aac':
default:           return ['-q:a', String(quality)];   // targetKbps DISCARDED
```

`targetKbps` is in scope and is used for `aac_at`, but the native path throws it away and reuses libfdk's 1–5 number on native `aac`'s `global_quality` scale — a completely different axis that saturates around 230 kbps by q≈3.

Measured `-q:a` → kbps on native `aac` (goldberg fixture): 0.1→20, 0.5→52, 1→104, 1.5→142, 2→187, 3→226, 4→227, 5→230.

Measured end-to-end through the CLI onto a dummy iPod (FLAC source, on-device ffprobe):

| preset | cap (ADR-023 ceiling) | actual on-device | |
|---|---|---|---|
| `low` | 128 | **187 kbps** | 46% over |
| `medium` | 192 | **227 kbps** | 18% over |
| `high` | 256 | 230 kbps | within, by luck |

This violates `docs/principles/` ("settings are ceilings") and ADR-023 §2 ("the quality preset's bitrate is a hard ceiling that bounds every target"). **It is silent** — the sync tag records the preset *name*, so re-sync is idempotent and the user is never told the file exceeds what they asked for.

`packages/docs-site/src/content/docs/reference/quality-presets.md` documents `low` as "~128 kbps / ~3.8 MB", which is wrong on those hosts.

**Why it was never caught:** `packages/podkit-core/src/transcode/ffmpeg.test.ts:27-36` pins the *implementation* (`buildVbrArgs('aac', 5) === ['-q:a','5']`) rather than the contract. This is the test-pins-contract rule in `docs/architecture/conventions.md` being inverted.

**Fix direction (a decision, not settled here):** either a calibrated target-bitrate → `-q:a` mapping for native `aac`, analogous to the existing `aacAtQualityFromBitrate`, or fall back to `-b:a`/CBR on native `aac`. The calibration table above is a starting point but was measured on one fixture — native `aac` is largely content-insensitive at a given `-q:a`, which is what makes a mapping viable at all.

Also fix the incidental doc drift: `quality-presets.md` says `low` → libfdk `-vbr 3`, but `AAC_PRESETS.low.quality = 2` is what is passed.

**Needs a changeset** — user-facing behaviour change to `podkit` and `@podkit/core`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Native `aac` VBR honours targetKbps rather than reusing libfdk's quality number
- [x] #2 For every preset, the measured on-device bitrate is at or below the preset's cap on a host with only native `aac`
- [x] #3 A contract-level regression test asserts the measured-bitrate-vs-cap relationship per preset, rather than pinning buildVbrArgs' argv
- [x] #4 The existing ffmpeg.test.ts implementation-pinning assertions are re-pointed at the contract
- [x] #5 quality-presets.md corrected: the documented bitrates hold on native aac, and the `low` preset's libfdk quality number matches AAC_PRESETS
- [x] #6 A changeset is added for podkit and @podkit/core
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decision: ABR, not a calibrated `-q:a` table

The description offered two directions. The calibration table it proposed was measured on `goldberg-selections/01-harmony.flac`, which is **mono** — that is why the numbers saturate at ~230. Re-measured on stereo (`multi-format/03-flac-track.flac`) and on stereo pink noise, native `aac -q:a` is worse than the description suggests:

| `-q:a` | stereo fixture | pink noise |
|---|---|---|
| 1 | 93 | 107 |
| 1.5 | 147 | — |
| 2 | 195 | 230 |
| 3 | 245 | 247 |
| 4 | 241 | — |
| 5 | 241 | 216 |

It is **not monotonic** (noise: q=3 → 247, q=5 → 216) and it saturates below the `high` cap, so no mapping from a target bitrate onto it can be both faithful and stable. A calibrated table would have been fitting a curve that does not exist.

`-b:a` on the same encoder tracks the request exactly, including on noise:

| `-b:a` | stereo fixture | pink noise |
|---|---|---|
| 128k | 128 | 128 |
| 192k | 191 | 192 |
| 256k | 218 (content-limited) | 220 |

So native `aac` is now driven in ABR mode at the resolved target. This is also what FFmpeg's own guidance says: the native encoder's VBR mode is experimental and worse than its rate-controlled mode.

## `libfdk_aac` had the same defect, milder

`buildVbrArgs` discarded `targetKbps` for `libfdk_aac` too. For the three presets its fixed `-vbr` level happened to sit under the cap, so it was invisible — but a **planner-reduced** target (ADR-023 §3: a lossy source capped below the preset) still got the full preset's level, e.g. target 96 → `-vbr 5` ≈ 208 kbps. It now picks the richest level whose published bitrate band fits under the target. That mapping independently produces `low → -vbr 3`, which is what `quality-presets.md` documented all along — so the "doc drift" in AC #5 resolved in the docs' favour, not the code's.

`aac_at` already mapped from `targetKbps` and is untouched.

## Residual: `aac_at` overshoots on its own terms

`aac_at`'s map picks the *closest* quality index, not the highest one under the cap, so `medium` → q=4 ≈ 200 kbps against a 192 cap (~4% over). Changing it to a ceiling-respecting pick would drop `medium` to q=5 ≈ 155 — a 22% quality cut justified only by a rough nine-point table measured on three albums. Left alone deliberately; AC #2 scopes this task to native `aac`. The integration test allows true-VBR encoders 15% headroom over the cap and says why. Worth its own task if someone wants to re-measure `aac_at` properly.

Note the repo's pinned FFmpeg (`conda:ffmpeg` in `mise.toml`) is built without AudioToolbox and without libfdk, so `aac_at` is only reachable on a macOS dev box using a system FFmpeg.

## Contract tests

- `ffmpeg.test.ts` — the argv pins are gone. What replaces them asserts the *contract*: native aac is asked for the target bitrate, two different quality levels at one target produce one request, a changing target changes the request, and no preset asks for more than its cap.
- `ffmpeg.integration.test.ts` → `quality preset bitrate ceiling` — real encodes of stereo pink noise (incompressible by design, so the encoder spends every bit its rate control allows; a sine or a quiet fixture would sail under any cap and prove nothing). Asserts measured ≤ cap per preset, that the presets stay *ordered*, and that a planner-reduced target is honoured. Measures the **audio stream** bitrate rather than `probe()`'s `format.bit_rate`, which carries a kbps or two of MP4 container overhead that is not the encoder's to control.

Verified red-before-green with the fix stashed: `medium` 244/192, `low` 231/128, reduced-target 217/96, and the ordering test failing outright (`high` 217 < `low` 231) — the non-monotonicity, caught.

## Verification

- `packages/podkit-core` unit: 3440 pass / 0 fail
- `packages/podkit-core` integration: 12 files pass, including the new ceiling suite
- `bun run test:e2e`: 37/37 pass
- lint, typecheck, prettier clean
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Native `aac` and `libfdk_aac` now honour the resolved target bitrate, so a quality preset is a real ceiling (ADR-023 §2) on hosts without `aac_at` — which is every stock Linux host, the mise-pinned conda FFmpeg, and CI.

Native `aac` is driven in ABR mode at the target (`-b:a`) rather than being handed our internal 1-5 quality number as `-q:a`, an axis with no bitrate meaning. `libfdk_aac` picks the richest `-vbr` level whose published bitrate band fits under the target instead of ignoring it. Measured `low` moves from ~190 kbps to 128 and `medium` from ~230 to 192, against caps of 128 and 192.

The implementation-pinning `buildVbrArgs` assertions are replaced by contract assertions, and a new integration suite encodes stereo pink noise and measures the result against each preset's cap.
<!-- SECTION:FINAL_SUMMARY:END -->
