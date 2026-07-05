---
id: TASK-453.05
title: maxAudioBitrate capability seam + efficiency path exercised + adoption dedup
status: Done
assignee: []
created_date: '2026-06-30 16:52'
updated_date: '2026-07-05 14:10'
labels:
  - sync
  - transcoding
  - device-types
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - >-
    backlog/docs/doc-055 -
    PRD-Lossy-Reduction-Redesign-—-Down-Only-Transfer-Mode-Defaulted-Axis.md
parent_task_id: TASK-453
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 5. Prereq: slice 1. The deviceMax seam and the preserve-necessity efficiency path; fold the adoption path onto the shared seam.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Optional maxAudioBitrate? added to DeviceCapabilities (absent → unbounded → preserve-necessity targets the source bitrate); no device profile populates it yet
- [x] #2 The preserve cross-codec necessity path is fully exercised (efficiency math + deviceMax clamp) in resolveLossyReduction unit tests and one e2e (forced transcode of an incompatible-codec source under preserve)
- [x] #3 Handler adoption path (--force-sync-tags-transcode) routes its lossy target through resolveLossyReduction (the third duplicated min(source,cap) site removed)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (no commits — left for review).

maxAudioBitrate capability seam (AC#1):
- Added optional `maxAudioBitrate?: number` to `DeviceCapabilities` (packages/device-types/src/capabilities.ts) with doc: kbps ceiling, absent → unbounded. NO device profile populates it (iPod/mass-storage/Rockbox untouched), per ADR "no device data wired yet".
- Threaded to BOTH seam call sites: `resolveMusicConfig` reads `capabilities.maxAudioBitrate` into `ResolvedMusicConfig.deviceMaxBitrate` (config.ts) → `classifierFromConfig` → `ClassifierContext.deviceMaxBitrate` → `resolveLossyAction` passes `deviceMax` (add path); and `qualityTargetFromConfig` → `QualityTarget.deviceMax` → `classifyLossyDeviceBound` passes `deviceMax` (re-sync path). Conditional spread so undefined stays absent.
- Tests: classifier.test.ts "deviceMaxBitrate threads to the seam and clamps a preserve-necessity target" (present=112 clamps to 112; absent=unbounded → efficiency 128). upgrades.test.ts "deviceMax is threaded but inert on the device bound" (device-bound is always deviceNative=true, so deviceMax structurally cannot clamp — with/without produce identical cap-down=128, NOT the lower 64). handler.test.ts "maxAudioBitrate clamps a preserve-necessity adoption target" (=112).

Preserve-necessity efficiency path (AC#2):
- lossy-reduction.test.ts already had the full efficiency matrix + deviceMax clamp block (slice 1) — verified comprehensive (incl. deviceMax-below-efficiency clamp, above=no-op, absent=unbounded, and the convert-ignores-deviceMax case).
- New focused e2e: test-packages/e2e-tests/src/features/lossy-preserve-efficiency.test.ts — syncs an incompatible-codec Opus source (128k, from pink noise so VBR stays measurable) under preserve (--bitrate-reduce never) vs convert (--bitrate-reduce always) at quality=high. Asserts: device file is .m4a (forced transcode, never .opus), preserve on-device AAC bitrate > convert (encoder-agnostic efficiency fingerprint: preserve target 171 = 128/0.75 lands in a higher aac_at quality bucket than convert target 128), preserve ≤ cap 256, and re-sync is a no-op (idempotent). Runs green and deterministic locally (verified 3x).

Adoption dedup (AC#3) + D4 reason fix:
- postProcessSyncTagsTranscode (handler.ts): removed the inline `Math.min(source.bitrate, cap)` (the third duplicated decision site). A lossy untagged source with a known bitrate + cap now routes through `resolveLossyReduction` (deviceNative = isDeviceCompatible(source), axis = config.reductionAxis, tolerance = config.reductionTolerance, deviceMax threaded). Lossless / no-bitrate / no-cap fall through to a cap re-encode (classifier owns lossless routing).
- D4: direction now derives from the seam target vs the SOURCE (an untagged track has no recorded bitrate), not the unreliable device DB bitrate. An over-cap source is a DOWN reduction → emits `cap-down` (reEncodes:true), never `cap-up`. Added a test pinning cap-down even when the DB bitrate sits below the target (the old code would have mislabelled `cap-up`).
- New seam behaviour: when the seam returns `copy` (device-native under preserve / within tolerance), adoption is now tag-only — stamps an authoritative copy tag (buildCopySyncTag with the source bitrate) via `sync-tag-write`, no needless re-encode. Test: "device-native preserve adoption is tag-only". WHICH tracks are adopted is unchanged; only the target computation / op type changed.
- Idempotency preserved: adopted+reduced track records bitrate==cap in its tag → device-bound (sharing the seam) sees recorded==cap → copy → no-op.

Grep proof: the only `Math.min(...cap...)` lossy-target computations left in the codebase are inside resolveLossyReduction (lossy-reduction.ts:195, :202). classifier.ts, upgrades.ts, handler.ts carry none.

Gates: `bunx turbo run typecheck lint build` (all 42 packages) clean; `bun run test:unit --filter @podkit/core` 3384 pass / 0 fail; podkit + device-types green; the new e2e runs green.

Deviation: device-types maxAudioBitrate is optional (`?`) rather than required-but-undefined — a ResolvedMusicConfig test fixture constructs the config inline, and optional matches the surrounding field ergonomics (resolvedLossyCodec etc.). The existing adoption unit test that asserted bitrateOverride=256 was updated to pin the seam's actual output: reduce=always (convert) keeps 256 with cap-down; a new preserve test pins the efficiency value 246. Per the task this is "how the target bitrate is computed", sanctioned.

Files: packages/device-types/src/capabilities.ts; packages/podkit-core/src/sync/music/{config.ts,classifier.ts,handler.ts}; packages/podkit-core/src/sync/engine/upgrades.ts; tests: classifier.test.ts, upgrades.test.ts, handler.test.ts; test-packages/e2e-tests/src/features/lossy-preserve-efficiency.test.ts.
<!-- SECTION:NOTES:END -->
