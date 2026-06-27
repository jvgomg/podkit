---
id: TASK-437.03
title: 'S2: Lossy cap-up / source-improved re-encode'
status: Done
assignee: []
created_date: '2026-06-25 22:37'
updated_date: '2026-06-27 17:56'
labels:
  - sync
  - transcoding
  - quality
dependencies:
  - TASK-437.01
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
  - packages/podkit-core/src/sync/music/handler.ts
parent_task_id: TASK-437
priority: medium
ordinal: 195000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK.** See PRD doc-051.

Raise the device cap (or improve the source) and have existing **lossy** tracks re-encode **up**, bounded by what the source can supply: `want.bitrate = min(source.bitrate, target.bitrate)`. Fires when `encoded.bitrate < min(source, target)` and the source can support more. Reuses `transferUpgradeToIpod`.

**Context:** user story 2 (raise cap re-encodes lossy up to the new target, as far as source allows).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Lossy source + raised cap: device track re-encodes up to min(source,cap)
- [x] #2 Source-improved (source bitrate climbs) re-encodes up toward target; never exceeds source
- [x] #3 Classifier unit tests cover cap-up + source-improved direction/reason for lossy
- [x] #4 E2E in upgrades.test.ts: raise cap on a lossy collection -> device file re-encoded up (bounded by source)
- [x] #5 Changeset added
- [x] #6 User docs updated
- [x] #7 Architecture doc upgrades.md updated for cap-up / source-improved
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the UP direction for the lossy device-bound classifier (the DOWN direction was already landed).

What changed
- `classifyLossyDeviceBound` (engine/upgrades.ts): added cap-up. Gating is now: `encoded = device.syncTag?.bitrate` required (else null; never the DB bitrate); `cap = target.presetBitrate`. `encoded > cap` -> cap-down (UNCHANGED, checked first so cap-down behaviour is byte-identical). Then `effectiveTarget = min(source.bitrate, cap)`; `encoded < effectiveTarget` -> cap-up (re-encode up). `min(source,cap) <= encoded <= cap` -> null, which deliberately includes the source-degraded case (`source < encoded <= cap`): the good device copy is kept, not re-encoded down to the worse source. Missing `source.bitrate` -> null on the up direction only (nothing to bound toward).
- `MusicHandler.resolveUpgradeAction` (sync/music/handler.ts): cap-up now routes like cap-down — force a transcode at the resolved preset with `bitrateOverride = qualityChange.targetBitrate`. Crucially the override is the CHANGE's effective target, not the config preset bitrate, because cap-up to `min(source,cap)` may be the SOURCE bitrate when the source is below the cap. No new executor code.

Re-encode reads the source, not the device file
- Confirmed: `transferUpgradeToIpod` (transfer.ts) replaces the file with the freshly-transcoded-from-source temp (`replaceTrackFile(foundTrack, sourcePath)`), so the up direction genuinely recovers quality rather than re-compressing the smaller on-device copy.

Idempotency evidence (both device types)
- WRITE: upgrade-transcode -> `buildSyncTagForPreset(..., preset.bitrateOverride)` -> `buildAudioSyncTag` records bitrate = effectiveTarget. COMPARE: `classifyLossyDeviceBound` reads `device.syncTag?.bitrate`. Symmetric. After cap-up, `encoded == min(source,cap)` so neither branch fires -> null.
- iPod (dummy) e2e: raise cap re-encodes up, follow-up dry-run tracksToUpdate=0.
- mass-storage (generic/echo-mini path) e2e: source 200 / cap 256 -> effective target = source (200, the min(source,cap)=source edge); follow-up dry-run tracksToUpdate=0. The idempotency dry-run=0 is the load-bearing proof: a wrong recorded bitrate would re-fire cap-up.

cap-up vs source-improved complementarity (no double-fire)
- `classifyQualityChange` runs `classifySourceBound` first; the device bound only runs when it returns null. source-improved already covers a SAME-FAMILY lossy bitrate climb (>=64kbps / 1.5x), detected in the match loop so the track is already in toUpdate and post-process never reconsiders it. cap-up covers the case the source bound misses: a CROSS-family device copy below a raised cap (e.g. 320k MP3 source, 128k AAC device copy, cap->256 -> re-encode AAC up to 256). Pinned by a composed unit test and the iPod e2e. The existing same-family source-improved e2e (`quality upgrade (MP3 bitrate increase)`) was verified still green.

Tests
- upgrades.test.ts (unit): filled the cap-up rows (cap>source bounded by cap; cap<source bounded by source; encoded==effectiveTarget -> null; source-degraded -> null; no source bitrate -> null; cap-up idempotent), plus a composed cross-family cap-up. Removed the cap-up test.todo. cap-down rows intact.
- e2e: new iPod cap-up test in upgrades.test.ts and source-bounded mass-storage cap-up test in preset-change.test.ts. Measured-bitrate thresholds avoided (synthetic content compresses unpredictably) — assertions are dry-run quality-change-up=1, completed=1, and idempotent re-sync.

Docs / changeset
- .changeset/lossy-cap-up-enforcement.md (podkit + @podkit/core minor).
- docs/user-guide/transcoding/audio.md (cap section now both-directions, "down only for now" removed), docs/user-guide/syncing/upgrades.md, docs/developers/quality-preset-testing.md, documents/architecture/sync/upgrades.md (§4 both directions + min(source,cap) + source-degraded deliberately not acted on; removed the "Lossy cap-up" open-work item).

Deliberately left for later (unchanged, still return null): CBR/VBR encoding-mismatch, lossy/lossless boundary precondition re-encodes, and explicit source-down suppression with reEncodes:false (today a degraded source simply returns null).

Gates: lint 0/0; build @podkit/core + podkit; unit @podkit/core (3295 pass) + podkit (1902 pass); e2e dummy upgrades+preset-change+mass-storage-sync+artwork-sync-tags = 42 pass / 0 fail.

Reviewed (Sonnet): APPROVE-WITH-NITS, no blocking — gating correct at all boundaries, source-degraded suppression provably safe + tested, idempotency symmetric incl the min(source,cap)=source edge, re-encode reads source not device file, no double-fire with source-improved, no scope leak, no slice labels in diff. Lead folded in two nits: source-bounded unit case now asserts encodedBitrate/sourceBitrate (parallel with its sibling); cap-up e2e now asserts upTracks bitrate > cappedTracks bitrate (observable proof of the up re-encode, not just idempotency). Skipped: carry-over truthy-check on targetBitrate (type makes 0 impossible), redundant real-sync-after-dry-run step (harmless, stronger). Re-verified: classifier unit 36/0, e2e upgrades 9/0.
<!-- SECTION:NOTES:END -->
