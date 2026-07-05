---
id: TASK-437.08
title: Enforce lossy bitrate cap at add time (avoid two-pass convergence)
status: Done
assignee: []
created_date: '2026-06-27 17:25'
updated_date: '2026-06-29 17:03'
labels:
  - sync
  - transcoding
  - quality
dependencies: []
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
parent_task_id: TASK-437
priority: low
ordinal: 201000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up surfaced during the lossy cap-down review.

Cap-down enforcement currently applies to tracks **already on the device**. A newly added lossy track whose bitrate is above the cap is copied as-is on the first sync, then re-encoded down on the **next** sync — so a fresh library converges to the cap over two syncs rather than one. This is self-healing and documented (changeset + docs/user-guide/transcoding/audio.md), not silent, but it's a UX wart.

Enforce the cap on the **add** path too: when a lossy source's bitrate exceeds the device cap, transcode-down on first add (mirroring the cap-down upgrade path's `bitrateOverride`) so a brand-new library lands at the cap in one sync.

**Care:** must NOT cap a lossy source that is at/below the cap (keep copying as-is), and must not interfere with the source-improved path (a source above an existing device copy). Verify idempotency and that a fresh add at/under cap still copies. Add e2e for fresh-add-above-cap → single-sync convergence.

Out of scope for the headline cap-down slice; low priority since it self-heals on the second sync.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Enforce the lossy bitrate cap on the ADD path so a fresh over-cap library converges in one sync.

Change (add-only; does not touch the source-improved path):
- `MusicTrackClassifier` now caps a compatible/device-native lossy source on first add. New `ClassifierContext.presetBitrate` (the cap) and `bitrateSync` (policy), forwarded by `classifierFromConfig`. Both copy branches (#1 device-native and #2 compatible-lossy) route through `resolveCopyOrCapAction` → `resolveLossyCapTranscode`: when the source is lossy, the cap > 0, the source bitrate is known and > cap, and the bitrate-sync policy would fire a downward move, it returns a `transcode` action with the resolved lossy codec and `bitrateOverride = min(source.bitrate, cap)` — the SAME shape `MusicHandler.resolveUpgradeAction` builds for a device-bound cap-down. Otherwise copy as-is.
- Guards (each keeps a copy): lossless source; no cap (presetBitrate 0 / lossless target); unknown/0 bitrate; source at/below cap; and `bitrate.sync = off`/`up-only` (the add-cap is a down move, gated by `applyBitrateSyncPolicy('down','cap-down',mode)` so it is suppressed exactly where a device-bound cap-down would be).
- Extracted shared `buildLossyPreset()` in the classifier so the lossy-transcode (4–5) path and the on-add cap can't drift (drift would break idempotency). `warnLossyToLossy` unchanged — a compatible-lossy cap (MP3→AAC) does not raise the OGG/Opus warning, matching cap-down.

Idempotency (verified end-to-end): add-transcode → `buildSyncTagForPreset(..., bitrateOverride)` records bitrate = cap; next sync `classifyLossyDeviceBound` computes effectiveTarget = min(source,cap) = cap === encoded → in sync (no-op). Confirmed on both dummy iPod (file becomes .m4a, second dry-run 0 add/0 update) and mass-storage (sidecar sync tag, measured bitrate < 170 from 320 source, converges).

Target codec / preset: name = resolvedQuality, targetCodec = resolvedLossyCodec, bitrateOverride = cap — identical to the cap-down path, which is what makes re-sync a no-op. (Decision: matched cap-down deliberately for idempotency; an MP3 over-cap on an MP3-native device is re-encoded to the resolved lossy codec, same as a cap-down on that device.)

Tests:
- Unit `classifier.test.ts`: over-cap → transcode at cap; over-cap on MP3-native device (branch #1) → transcode at cap w/ targetCodec; at-cap / under-cap / unknown-bitrate / no-cap → copy; policy matrix (match-cap, match-all, down-only → cap; off, up-only → copy); capped add raises no lossy-to-lossy warning; `presetBitrate` forwarded by `classifierFromConfig`.
- E2E `upgrades.test.ts`: new dummy-iPod single-sync convergence test (dry-run tracksToTranscode=1/tracksToCopy=0 → real sync .m4a → second dry-run 0/0). Also updated two pre-existing tests whose setup relied on the old two-pass behavior (the "off freezes cap-down" and "source-down above-cap edge" now seed the over-cap device copy via a higher-cap first sync, since first-add now caps).
- E2E `preset-change.test.ts`: new mass-storage convergence test (generic preset) mirroring the cap-down mass-storage test.

Gates run green: lint; full `turbo run typecheck`; `test:unit --filter @podkit/core` (3387) and `--filter podkit` (1915); e2e `IPOD_TARGET=dummy` upgrades + preset-change + mass-storage-sync + artwork-sync-tags (53 pass).

Deliverables: changeset `.changeset/lossy-cap-on-add.md` (minor podkit + @podkit/core); user docs `docs/user-guide/transcoding/audio.md` ("converges in one sync" bullet + intro); architecture `documents/architecture/sync/upgrades.md` (new "Cap enforcement on the add path" subsection).

Sonnet review: no blockers; nits addressed (preset-builder extraction, match-all coverage). Noted side-effect: a non-quality-change file-replacement (e.g. transfer-mode-changed) on an over-cap compatible-lossy source previously copied the over-cap file back via the resolveUpgradeAction fallback; it now caps via the classifier — quality-change still wins as primaryReason so this only affects the genuinely-no-quality-change fallback.

Team-lead review pass (Sonnet) + fixes. No blockers. Reviewer verified idempotency (add-path bitrateOverride = min(source,cap) uses the same formula as classifyLossyDeviceBound's effectiveTarget, with the shared buildLossyPreset preventing drift -> re-sync no-op is structural, not coincidental), all four guards, the policy-gating judgment call (add-cap gated by applyBitrateSyncPolicy('down','cap-down',mode) so off/up-only copy as-is, consistent with device-bound cap-down -- the cap is a quality preference, not a hard device constraint), the two modified pre-existing tests (legitimate -- they previously leaned on the old two-pass copy-as-is wart to seed an over-cap device copy; now seeded via a higher-cap first sync, core assertions unchanged), the device-native lossless safety, and the benign transfer-mode-changed side-effect (now converges a sync earlier; quality-change still wins as primaryReason). Fixes I applied (3 SHOULD-FIX, all from one real inaccuracy): a lossless target resolves to presetBitrate ~900, NOT 0, so the `!cap` guard is a defensive fallback (no real preset is 0) and lossless protection actually comes from the at/below-cap guard (320 <= 900 -> copy). Corrected the ClassifierContext.presetBitrate docstring and the resolveLossyCapTranscode guard comment; renamed the misleading 'lossless target -> presetBitrate 0' test to a zero-cap-guard test and ADDED a real-production lossless test (presetBitrate 900, 320 kbps MP3 -> direct-copy); added the missing ctx.bitrateSync passthrough assertion to classifierFromConfig; and added warnLossyToLossy=false to the device-native cap test (NIT). Gates green: classifier 34 pass, lint OK, full typecheck 36/36, @podkit/core unit pass, e2e dummy 53 pass.

SUPERSEDED / regressed: this slice's add-path cap was later found to break 16 codec-matrix cells (codec.test.ts / codec-preference.test.ts) — it transcodes device-native lossy sources that must be copied, violating ADR-010 ("compatible lossy → copy as-is") and ignoring transfer mode. The branch is currently RED because of this. The behaviour is being reconsidered under the redesign in TASK-437.09 (transfer-mode-primary, down-only, two-tolerance), which will revert/reshape this add-path cap (fast = copy, never reduce). Do not treat this slice's behaviour as final.
<!-- SECTION:NOTES:END -->
