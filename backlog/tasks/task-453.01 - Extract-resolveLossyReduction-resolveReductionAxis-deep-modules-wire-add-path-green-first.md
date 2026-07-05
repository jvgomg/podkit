---
id: TASK-453.01
title: >-
  Extract resolveLossyReduction + resolveReductionAxis deep modules; wire add
  path (green-first)
status: Done
assignee: []
created_date: '2026-06-30 16:51'
updated_date: '2026-07-05 14:10'
labels:
  - sync
  - transcoding
  - quality
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - >-
    backlog/docs/doc-055 -
    PRD-Lossy-Reduction-Redesign-—-Down-Only-Transfer-Mode-Defaulted-Axis.md
modified_files:
  - packages/podkit-core/src/sync/engine/lossy-reduction.ts
  - packages/podkit-core/src/sync/engine/lossy-reduction.test.ts
  - packages/podkit-core/src/sync/music/classifier.ts
  - packages/podkit-core/src/sync/music/classifier.test.ts
  - packages/podkit-core/src/index.ts
  - packages/demo/src/mock-core.ts
parent_task_id: TASK-453
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 1. The deep-module extraction + the add-path wiring that restores the 16 regressed codec-matrix cells. No re-sync/config/CLI changes yet.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 resolveLossyReduction(pure) implements the full ADR-023 table: native+preserve→copy; native+convert→cap when source>cap×(1+tol) else copy; necessity+preserve→min(round(source×eff[T]/eff[S]),cap,deviceMax); necessity+convert→min(source,cap). Down-only; cap is a hard ceiling; lossless sources never enter it
- [x] #2 resolveReductionAxis(pure) maps (reduce: auto|always|never, transferMode) → convert|preserve (auto: optimised→convert, fast/portable→preserve)
- [x] #3 Codec-efficiency table (aac 1.0 / opus 0.75 / vorbis 0.90 / mp3 1.30) is a constant consumed ONLY by resolveLossyReduction (preserve-necessity row)
- [x] #4 Exhaustive unit matrix for resolveLossyReduction: every table row × edges (at/below cap, just inside vs outside tolerance, native vs necessity, convert vs preserve, deviceMax present/absent, efficiency per (source,target) pair); invariants asserted (no output above cap; no output above source)
- [x] #5 Full 3×3 truth-table test for resolveReductionAxis
- [x] #6 MusicTrackClassifier add path routes through resolveLossyReduction; device-native lossy is copied untouched under preserve (the default for fast/portable); no bitrate.sync gating on the add path
- [x] #7 The 16 regressed codec-matrix cells return to green (fast/portable copy device-native lossy; optimised may convert)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 1 of ADR-023 landed (no commit; left for review).

New pure module `packages/podkit-core/src/sync/engine/lossy-reduction.ts` (not music-specific — shared by add/re-sync/adoption paths) exports:

- `resolveReductionAxis(reduce: 'auto'|'always'|'never', transferMode: TransferMode): 'convert'|'preserve'` — always→convert, never→preserve, auto→optimized=convert / fast|portable=preserve. (Note: uses the codebase's `TransferMode` = `'fast'|'optimized'|'portable'` — American 'optimized', not the ADR prose 'optimised'.)
- `resolveLossyReduction(input: LossyReductionInput): LossyReductionResult` — implements the ADR-023 §3 table exactly:
  - device-native + preserve → {action:'copy'}
  - device-native + convert → reduce iff source > cap×(1+tol) → {transcode, cap}; else copy
  - necessity + preserve → {transcode, min(round(source×eff[T]/eff[S]), cap, deviceMax?)}
  - necessity + convert → {transcode, min(source, cap)}
  - Throws on sourceBitrate ≤ 0 (lossless + unknown-bitrate filtered by caller).
- Types: `LossyReductionInput`, `LossyReductionResult`, `ReductionAxis`, `ReductionMode`.
- Codec-efficiency table `{aac:1.0, opus:0.75, vorbis:0.90, mp3:1.30}` is a private const consumed ONLY by the preserve-necessity row, with a defensive `?? 1.0` for unknown/vorbis-style codecs. All exported from `index.ts`.

Add-path wiring (`classifier.ts`): the lossy copy-vs-cap decision and the incompatible-codec (necessity) branch both route through `resolveLossyReduction`. Removed the `applyBitrateSyncPolicy`/`BitrateSyncMode` gate and the `bitrateSync` field from `ClassifierContext`/`classifierFromConfig` (now unused on the add path; still defined in upgrades.ts + on the config for the re-sync path — slice 2 owns deletion there). Axis is computed via `resolveReductionAxis('auto', transferMode)` with `tolerance = 0.25` (named const `LOSSY_REDUCTION_TOLERANCE`); a clearly-commented seam marks where slice 3 injects the configured `[bitrate].reduce`/`tolerance`. deviceMax passed undefined (slice 5 capability seam).

DEVIATION from brief's stated invariant: the "output ≤ source (down-only)" invariant does NOT hold for the preserve-necessity row, which intentionally targets the source's *quality* in a less-efficient codec (e.g. opus@96 → aac@128) and so can exceed the source's raw kbps, bounded by the cap. This follows the ADR-023 §3 formula and the "stops a small forced source from being under-encoded" consequence exactly. Tests assert ≤cap universally and ≤source for all rows except preserve-necessity.

Quality gates:
- `bun run test:unit --filter @podkit/core`: 3421 pass / 0 fail (incl. 36 new lossy-reduction tests + rewritten classifier cap tests).
- typecheck (all 36 packages), oxlint, prettier, core integration (12/12): clean.
- AC#7 codec matrix (`test-packages/e2e-tests/src/features/codec.test.ts`): 79 pass / 1 fail / 112 skip. The 16 regressed fast/portable device-native-lossy copy cells are GREEN. The single failure is `ipod-MA147 / aac / aac-first / optimized`: under convert the 256k AAC fixture is now correctly REDUCED to the 128 cap, but the e2e reference-model still predicts copy. Updating that prediction is explicitly slice 6 ("codec-matrix expectations + add to the e2e gate" per doc-055); not in scope here. Matches AC#7's "optimised may convert".
<!-- SECTION:NOTES:END -->
