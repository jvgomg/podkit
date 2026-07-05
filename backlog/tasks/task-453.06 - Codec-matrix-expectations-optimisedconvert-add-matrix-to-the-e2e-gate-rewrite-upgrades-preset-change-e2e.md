---
id: TASK-453.06
title: >-
  Codec matrix expectations (optimised=convert) + add matrix to the e2e gate;
  rewrite upgrades/preset-change e2e
status: Done
assignee: []
created_date: '2026-06-30 16:52'
updated_date: '2026-07-05 14:10'
labels:
  - test
  - e2e
  - quality
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - >-
    backlog/docs/doc-055 -
    PRD-Lossy-Reduction-Redesign-—-Down-Only-Transfer-Mode-Defaulted-Axis.md
parent_task_id: TASK-453
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 6. Prereq: slices 2, 3, 5. The integration pins + the gate change that makes the 437.08 regression class impossible to merge unseen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Codec matrix expectations updated: optimised cells expect convert (reduce) where the fixture source exceeds cap×(1+tol); fast/portable expect copy for device-native lossy
- [x] #2 The codec matrix is added to the standard e2e gate set
- [x] #3 features/upgrades.test.ts and features/preset-change.test.ts rewritten to the new model (down-only, convert/preserve, report-only)
- [x] #4 Idempotency e2e pin: convert a track, re-sync, assert no second operation (add path and re-sync agree)
- [x] #5 Full branch returns to green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 6 — codec-matrix expectations made reduction-aware, upgrades/preset-change e2e rewritten to ADR-023, full branch green.

GATE FORENSICS (why 437.08 slipped):
- The codec matrix (codec.test.ts / codec-rules.ts) predates 437.08 (created in b2cf007c / TASK-356.04). At 437.08's parent it already used quality="low" (cap 128) and the 256k AAC fixture and predicted COPY for device-native lossy — so its `fast` cells WOULD have flipped to add-transcode and gone RED if exercised against 437.08's add-path reduction.
- 437.08 (c0cc659e) touched only upgrades.test.ts + preset-change.test.ts, never the codec matrix. The matrix IS in the standard gate (suffix `*.test.ts`, not `*.docker.test.ts`) — "add the matrix to the gate" was already satisfied by convention. The regression slipped because 437.08's verification did not run the e2e gate (the ADR's stated root cause).
- Real coverage hole closed: the reference model had NO reduction dimension — it only asserted the preserve-default (copy) path, never convert-reduce. It could not catch "copies when it should reduce" OR "reduces when it should copy". Now reduction-aware (reductionAxis, FIXTURE_SOURCE_BITRATE_KBPS, QUALITY_CAP_KBPS, lossyReductionAction) and the iPod/aac-first/optimized cells are asserted, pinning both directions.

REFERENCE MODEL (matrix/reference-model.ts, matrix/codec-rules.ts):
- Added reductionAxis(reduce, transferMode) mirror, FIXTURE_SOURCE_BITRATE_KBPS (mp3 105 / aac 218 / vorbis 224 / opus 116, as music-metadata reports), QUALITY_CAP_KBPS, DEFAULT_REDUCE_TOLERANCE (0.25), lossyReductionAction. codecOutcome now layers the axis: a device-native lossy copy flips to transcode under convert when source > cap×(1+tol).
- Exactly ONE cell flips: ipod-MA147 / aac / aac-first / optimized → add-optimized-copy → add-transcode, outputCodec m4a → aac (256k AAC > 160 band at quality=low). mp3 (105 < 160) stays copy under convert. fast/portable preserve → copy (the 16 regressed cells restored). skipCodecCell rationale updated (transfer mode now also drives the device-independent reduce gate).

E2E REWRITES (down-only, convert/preserve, report-only):
- upgrades.test.ts: createConfigFile gained an optional `reduce` axis. quality-change-up "MP3 bitrate increase" → "lossy source-rise is not followed up" (down-only, device copy kept). cap-down + cap-on-first-add opt into reduce=always. lossy cap-up block (removed behaviour) → "below a raised cap" report-only (quality-change-below-cap, no update) + --force-transcode lifts from source. source-down edge rewritten for preserve (mp3 copy). bitrate-sync policy block (removed --bitrate-sync flag) → 4 axis/precondition tests: convert never follows a degraded source down; a lossy CBR/VBR flip never re-encodes; lossless→lossy boundary fires under --bitrate-reduce never + --skip-upgrades vetoes; preserve freezes a cap-down.
- preset-change.test.ts: mass-storage cap-down + over-cap-on-add opt into reduce=always; mass-storage lossy cap-up → below-cap report-only + --force-transcode lift (source-bounded).

IDEMPOTENCY PIN (AC#4): the cap-on-first-add tests (iPod + mass-storage) convert an over-cap source on add then re-sync with no source change and assert zero second-pass ops — the add path and the device-bound re-sync agree because they share the resolveLossyReduction seam.

GATE RESULTS: unit 37/37 tasks 0 fail; typecheck+lint+build 42/42 0 fail; test:e2e 36 passed 0 failed. Codec matrix alone: 80 pass / 112 structural skip / 0 fail.

NOTE for review (not a blocker, consistent with ADR-023): a lossy source re-ripped at a HIGHER bitrate is a no-op by default — source-improved-up was removed (down-only, never grow) and a bitrate-only re-rip of a copied lossy track is not picked up by content-change detection. Pinned by the new "lossy source-rise is not followed up" test.

No core product code changed. Edits confined to test-packages/e2e-tests (matrix reference model + codec-rules + upgrades/preset-change features).
<!-- SECTION:NOTES:END -->
