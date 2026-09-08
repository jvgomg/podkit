---
id: TASK-499
title: 'Native aac VBR discards the target bitrate, so the quality cap is not enforced'
status: To Do
assignee: []
created_date: '2026-09-08 18:20'
labels:
  - transcoding
  - correctness
dependencies: []
references:
  - docs/adr/adr-023-lossy-reduction-down-only.md
  - docs/adr/adr-010-quality-preset-redesign.md
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/docs-site/src/content/docs/reference/quality-presets.md
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
- [ ] #1 Native `aac` VBR honours targetKbps rather than reusing libfdk's quality number
- [ ] #2 For every preset, the measured on-device bitrate is at or below the preset's cap on a host with only native `aac`
- [ ] #3 A contract-level regression test asserts the measured-bitrate-vs-cap relationship per preset, rather than pinning buildVbrArgs' argv
- [ ] #4 The existing ffmpeg.test.ts implementation-pinning assertions are re-pointed at the contract
- [ ] #5 quality-presets.md corrected: the documented bitrates hold on native aac, and the `low` preset's libfdk quality number matches AAC_PRESETS
- [ ] #6 A changeset is added for podkit and @podkit/core
<!-- AC:END -->
