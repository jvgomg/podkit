---
id: TASK-437.02
title: 'S1: Lossy cap-down enforcement'
status: Done
assignee: []
created_date: '2026-06-25 22:37'
updated_date: '2026-06-27 17:26'
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
priority: high
ordinal: 194000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK. The headline gap.** See PRD doc-051.

Make a lowered device bitrate cap actually shrink **lossy** tracks already on the device. Today lossy sources are copied as-is and excluded from cap enforcement (`if (!isSourceLossless) return null` in `postProcessPresetChanges`). Remove that exclusion for the down direction: when `encoded.bitrate > target.bitrate` for a lossy source, re-encode down to the new cap, reusing the existing `transferUpgradeToIpod` executor. A second sync with no change must be a no-op (idempotent).

**Context:** user stories 1 (lower cap shrinks lossy tracks), 21 (idempotent re-sync).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Lossy source + lowered cap: existing device track re-encodes down to min(source,cap) via transferUpgradeToIpod (no new executor code)
- [x] #2 Re-sync after the re-encode is a no-op (idempotent; sync-tag updated to new encoded value)
- [x] #3 Classifier unit tests cover lossy cap-down direction/reason
- [x] #4 E2E in upgrades.test.ts: lower cap on a lossy collection -> device file bitrate/size drops
- [x] #5 Changeset added
- [x] #6 User docs updated (quality/bitrate behaviour now applies to lossy)
- [x] #7 Architecture doc upgrades.md updated for lossy cap-down
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
S1 implemented. Lossy cap-DOWN now enforced; cap-up/source-down deliberately left dormant for S2.

WHAT CHANGED (core):
- `engine/upgrades.ts`: `classifyDeviceBound` now routes lossy sources to a new `classifyLossyDeviceBound(source, device, target)` instead of the blanket `if (!sourceLossless) return null`. The lossy branch reads the authoritative `encoded = device.syncTag?.bitrate` (NEVER the DB bitrate — no guessing), cap = `target.presetBitrate` (already folds customBitrate via getPresetBitrate). `encoded > cap` -> `{reason:'cap-down', direction:'down', reEncodes:true, targetBitrate:cap, encodedBitrate, sourceBitrate}`. `encoded === undefined` (untagged/pre-S0 copy) -> null (opt out; full opt-out is S6). `encoded <= cap` -> null with TODO(S2) for cap-up.
- `sync/music/handler.ts`: `postProcessPresetChanges` split into lossy vs lossless paths. Lossy path calls `classifyDeviceBound` directly (no expectedSyncTag, ignores the copy->copy short-circuit which is lossless-only). New `resolveUpgradeAction(source, qualityChange)` in `planUpdate`: for a lossy `cap-down` it OVERRIDES the classifier's copy routing and builds a `transcode` action at resolvedQuality with `bitrateOverride = presetBitrate` (the cap), so the existing `transferUpgradeToIpod` runs it as `upgrade-transcode` — no new executor code. `planUpdate` gained a `qualityChange?` param (threaded from `planner.ts` via `update.qualityChange`; interface in `content-type.ts`; video handler signature updated, param unused).
- `sync/music/transfer.ts`: `buildSyncTagForPreset` now takes `bitrateOverride` and prefers `bitrateOverride ?? customBitrate` (symmetric with `expectedSyncTagFromClassification`). Both add-transcode and upgrade-transcode call sites pass `operation.preset.bitrateOverride`. This makes the post-re-encode sync tag record the cap as the new encoded bitrate -> idempotent, and supports repeated cap-downs.

ENCODING-LEAK FIX (the carried-over caveat): `metadata/sync-tags.ts` `buildCopySyncTag` now authoritatively emits `encoding: undefined` (mirror of S0's authoritative `bitrate` on `buildAudioSyncTag`). Both adapters merge `{...existing, ...update}`, so a transcode->copy transition no longer keeps a stale `encoding=vbr`; `undefined` wins the merge and is dropped on serialization. Verified Bun `toEqual` ignores undefined props so existing buildCopySyncTag tests still pass.

IDEMPOTENCY VERIFICATION (both device types):
- iPod (dummy): e2e in `upgrades.test.ts` — sync 192k MP3 at `--quality high` (copied .mp3), dry-run `--quality low` reports exactly one `quality-change-down`, sync at low re-encodes to AAC (.m4a, no .mp3 left, count unchanged), re-sync at low -> completed=0.
- Mass-storage (generic, sidecar/comment tag): e2e in `preset-change.test.ts` — same flow; on-device measured bitrate drops below 170 after cap-down; idempotent re-sync dry-run reports tracksToUpdate=0. Confirms sync-tag-as-truth works with no device DB.

SCOPED OUT: lossy cap-UP (S2) — `classifyLossyDeviceBound` returns null at/below cap; source-down-suppressed (S2); encoding-mismatch CBR/VBR (S2); untagged opt-out + force-sync-tags-transcode (S6). NEW lossy adds above the cap are still copied as-is on first sync (planAdd unchanged) and converge via cap-down on the next sync — acceptable for S1 scope.

TESTS: unit `engine/upgrades.test.ts` lossy cap enforcement cases (above/at/below cap, no-tag-bitrate, no-cap, idempotent-after-reencode, composed cap-down); handler `planUpdate` routes lossy cap-down to upgrade-transcode with bitrateOverride=cap. The two scaffold `test.todo`s remaining are S2 only.

GATES (all pass): `bun run lint` 0 errors; build @podkit/core + podkit OK; core unit 3288 pass / 0 fail; cli unit 1902 pass / 0 fail; e2e (dummy) upgrades+mass-storage+preset-change+artwork-sync-tags 40 pass / 0 fail.

Done + reviewed. Implementation: classifyLossyDeviceBound (cap-down only; fires when sync-tag recorded bitrate > cap; null when at/below cap, no tag bitrate, or lossless); routed via resolveUpgradeAction forcing transcode with bitrateOverride=cap through the existing transferUpgradeToIpod (no new executor). Carried-over encoding merge-leak fixed (buildCopySyncTag authoritatively emits encoding). Sonnet review: APPROVE-WITH-NITS, no blocking. Idempotency verified on iPod + mass-storage (write bitrateOverride=cap vs compare encoded-vs-cap are symmetric). Lead addressed nits: added buildCopySyncTag encoding-clear unit test; added explicit dry-run tracksToUpdate=0 idempotency assertion to the iPod e2e; documented two-pass convergence for fresh over-cap adds (changeset + user docs) and filed TASK-437.08 for add-time enforcement; logged the source-degraded-below-cap edge on S3 (TASK-437.04). Also scrubbed all task/slice/phase references from the quality-change code + arch doc (standing repo rule). Gates: build OK, @podkit/core 3288/0, CLI 1902/0, lint 0, e2e upgrades 8/0 + mass-storage idempotent. Scoped out (later): lossy cap-up, source-down-suppressed, encoding-mismatch, untagged opt-out.
<!-- SECTION:NOTES:END -->
