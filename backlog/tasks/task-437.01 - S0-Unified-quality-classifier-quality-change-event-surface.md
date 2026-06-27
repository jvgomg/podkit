---
id: TASK-437.01
title: 'S0: Unified quality classifier + quality-change event surface'
status: Done
assignee: []
created_date: '2026-06-25 22:37'
updated_date: '2026-06-27 16:11'
labels:
  - sync
  - transcoding
  - quality
  - hitl
dependencies: []
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
  - packages/podkit-core/src/sync/engine/upgrades.ts
  - packages/podkit-core/src/sync/music/handler.ts
modified_files:
  - packages/podkit-core/src/sync/engine/upgrades.ts
  - packages/podkit-core/src/sync/engine/upgrades.test.ts
  - packages/podkit-core/src/sync/engine/types.ts
  - packages/podkit-core/src/sync/engine/diff-utils.ts
  - packages/podkit-core/src/sync/engine/content-type.ts
  - packages/podkit-core/src/sync/music/handler.ts
  - packages/podkit-core/src/sync/music/transfer.ts
  - packages/podkit-core/src/metadata/sync-tags.ts
  - packages/podkit-core/src/index.ts
  - packages/podkit-cli/src/commands/sync-output-types.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/music-presenter.ts
  - packages/podkit-cli/src/output/formatters.ts
  - packages/demo/src/mock-core.ts
  - .changeset/quality-change-unified.md
  - documents/architecture/sync/upgrades.md
  - docs/developers/quality-preset-testing.md
parent_task_id: TASK-437
priority: high
ordinal: 193000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**HITL — architectural consolidation + event rename; blocks all other slices.** See PRD doc-051.

Consolidate the three quality-decision paths — `detectUpgrades` (source-vs-device, up-only), `detectPresetChange` (device-vs-target, lossless-only, DB-bitrate fallback) and `determineSyncTagDirection` (exact-when-tagged) — into **one pure `classifyQualityChange`** module using the three-separate-bounds model (encoded / target / source compared independently, never collapsed to `min`). Returns `{reason, direction} | null`.

Introduce the unified **`quality-change`** event + `qualityChanges[]` JSON skeleton as a **clean rename** of the old reason vocabulary (`preset-upgrade`/`preset-downgrade`/`quality-upgrade`) — **no parallel-fire deprecation window** (minor bump, per project policy). Ensure the sync-tag always writes `encoding` + effective `bitrate`, including for **lossy** transfers (needed so later slices have authoritative `encoded` data).

**No behaviour change in this slice** — existing lossless preset-change cases must produce identical re-encode decisions; this is a refactor + surface consolidation that all existing tests still pass against. HITL gate: review the classifier interface and the event rename before fan-out.

**Context:** user stories 3 (lossless keeps working), 19 (exhaustively unit-testable classifier), 16/17 (output surface foundation).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Single pure `classifyQualityChange` replaces detectUpgrades / detectPresetChange / detectBitratePresetMismatch / determineSyncTagDirection; old exports removed (no deprecation shims)
- [x] #2 Classifier uses three separate bounds (encoded vs target, encoded vs source) — never min-collapsed; returns {reason, direction} | null
- [x] #3 Existing lossless preset-change behaviour is unchanged: same tracks re-encode with same direction; full existing test suite green
- [x] #4 Unified `quality-change` event + `qualityChanges[]` JSON replace the old preset-upgrade/preset-downgrade/quality-upgrade vocabulary via clean rename (no parallel-fire); consumers (CLI render, JSON) updated
- [x] #5 Sync-tag always records `encoding` + effective `bitrate`, including lossy transfers; round-trip verified
- [x] #6 Exhaustive classifier unit tests scaffold in place (cases extended by later slices)
- [x] #7 Changeset added (podkit + @podkit/core — event/JSON surface is user-facing)
- [x] #8 User docs updated for the renamed event / JSON output field
- [x] #9 Architecture doc documents/architecture/sync/upgrades.md updated to describe the unified classifier + three-bound model
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Lead review (post-worker): Sonnet review verdict APPROVE-WITH-NITS, no blocking issues — behaviour-preservation confirmed (no threshold drift, three-bound model genuine, lossy device-bound dormant/returns null, untagged DB-bitrate fallback retained, non-quality reasons untouched). Lead applied nits directly: (a) added two 1.5x-multiplier boundary unit tests in upgrades.test.ts (the one coverage gap that could hide a threshold regression) — now 23 pass/4 todo/0 fail; (b) fixed changeset doc `trackId`->`track`; (c) documented QualityTarget.customBitrate as S1-consumed so it isn't pruned. AC#5 clarification: effective BITRATE is recorded for lossy transfers in S0; ENCODING MODE for pure lossy COPIES is deferred to S1 (TODO in transfer.ts) since source CBR/VBR isn't reliably known without new probing — transcoded tracks already record encoding. Verified: adding bitrate to copy sync-tags is forward-only (new adds), does NOT cause a sync-tag-write storm or any re-encode on existing libraries.

E2e sweep gap found + fixed (lead): the worker's test update missed the entire `test-packages/e2e-tests` package because the host e2e never ran (pre-existing macOS libgpod/libusb IOKit hang in `gpod-tool init` — 67 stuck uninterruptable processes; diagnosed as ENVIRONMENT, not an S0 regression — the untouched metadata/normalization e2e paths hang identically). Found 4 stale assertions against the renamed breakdown keys; 2 were genuinely broken (would fail once env works): upgrades.test.ts:690 ['quality-upgrade']->['quality-change-up']; artwork-sync-tags.test.ts:512 ['preset-downgrade']->['quality-change-down']. 2 were stale-but-trivially-passing (asserting now-absent keys): preset-change.test.ts re-keyed to quality-change-up/down/suppressed to keep real coverage. e2e-tests package typechecks clean (tsc --noEmit exit 0). NOTE: preset-upgrade/preset-downgrade are correctly RETAINED in the UpgradeReason union + detectBitratePresetMismatch because VIDEO still uses them (video/handler.ts) — so AC#1 'old exports removed' applies to the AUDIO path only; video preset detection is untouched and out of S0 scope. OUTSTANDING: host e2e cannot be validated on this Mac (broken libgpod env); needs a Linux run (mise run test:linux / Lima VM / CI) to confirm green end-to-end.

Host e2e now GREEN: after TASK-438 (libusb removal) fixed the macOS gpod-tool hang, `bun test src/features/upgrades.test.ts` (IPOD_TARGET=dummy) runs 7 pass / 0 fail in 9.9s (was 7x timeout). Confirms S0's re-keyed e2e assertions (quality-change-up/down) and behaviour-preservation end-to-end. S0 fully validated on all gates.

Regression found by `bun run quality` (mass-storage e2e) + fixed: re-sync was non-idempotent (tracksToUpdate=3, reason quality-change/cap-up firing forever). Root cause: copy->transcode sync-tag MERGE LEAK. buildCopySyncTag stamps bitrate into copy tags (S0); device adapters merge tags `{...existing, ...update}` (mass-storage-adapter.ts:1424, ipod-adapter.ts:204); buildAudioSyncTag OMITTED the bitrate key for non-custom presets, so a later transcode kept the stale copy bitrate; compare side (expectedSyncTagFromClassification) expected no bitrate -> syncTagMatchesConfig mismatch -> cap-up every sync. Only bit mass-storage (echo-mini supports FLAC: max=direct-copy then high=transcode triggers the copy->transcode merge; iPod never copies-then-transcodes a lossless source so it passed). FIX: buildAudioSyncTag now authoritatively emits `bitrate` (customBitrate value or undefined) so the merge clears stale copy bitrate; undefined drops on serialize -> persisted tag stays clean; write+expected symmetric by construction (both use buildAudioSyncTag). Verified: mass-storage 19/19, iPod upgrades+preset-change+artwork 19/19, @podkit/core unit 3280/0, CLI 1902/0, build OK. Added pinning test in mass-storage-adapter.integration.test.ts. This fix is part of the uncommitted S0 diff.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## S0 complete

### What the prior worker built
- `classifyQualityChange`, `classifySourceBound`, `classifyDeviceBound` landed in `packages/podkit-core/src/sync/engine/upgrades.ts` (lines 233–416). The three-bound model is implemented: source-vs-device (Bound 1) runs first, device-vs-target (Bound 2) only runs when Bound 1 returns null.
- `QualityChange` and `QualityTarget` types exported from `upgrades.ts` and from `packages/podkit-core/src/index.ts`.
- `UpgradeReason` in `engine/types.ts` now has `quality-change`; old `format-upgrade`/`quality-upgrade`/`preset-upgrade`/`preset-downgrade` are removed.
- `DiffUpdateEntry.qualityChange?: QualityChange` added in `diff-utils.ts`.
- `sync-output-types.ts` has `quality-change-up`/`quality-change-down`/`quality-change-suppressed` breakdown keys + `QualityChangeInfo` interface + per-collection `qualityChanges[]` array.
- `music-presenter.ts`, `formatters.ts`, `sync.ts`, `handler.ts`, `transfer.ts`, `content-type.ts` all updated to the new vocabulary.
- `buildCopySyncTag` in `sync-tags.ts` now accepts and writes `bitrate` for lossy copy operations (Bound 2 in later slices will use this as authoritative `encoded` data).
- `packages/podkit-core/src/sync/engine/upgrades.test.ts` (new file) — exhaustive classifier unit matrix: 21 passing tests + 4 `test.todo` scaffolds for S1/S2/S3.

### What this worker finished
- Verified all unit tests pass (engine: 192, sync/music: 281, metadata: 175+, all 0 failures).
- Confirmed lint is clean: `Found 0 warnings and 0 errors`.
- Confirmed build passes: `bunx turbo run build --filter=@podkit/core --filter=podkit` exits 0 (all cached, no errors).
- Added changeset at `.changeset/quality-change-unified.md` (podkit: minor, @podkit/core: minor).
- Updated `documents/architecture/sync/upgrades.md` to describe the unified classifier, three-bound model, new vocabulary, and S0 scope.
- Updated `docs/developers/quality-preset-testing.md`: replaced `preset-upgrade`/`preset-downgrade` in the Audio Stress Test table and the JSON output note with `quality-change-up`/`quality-change-down` and the new sub-reason vocabulary.

### AC #5 bitrate/re-encode verification
Adding `bitrate` to lossy copy sync-tags is forward-only: `buildCopySyncTag` is called in `transfer.ts` only for NEW copy operations (`add-direct-copy`, `add-optimized-copy`). Existing tracks with `quality=copy` tags have no bitrate in their tag; `postProcessSyncTags` only adds/updates `artworkHash` — it does NOT inject a bitrate into existing copy tags. The lossy branch of `classifyDeviceBound` returns `null` unconditionally in S0, so even if an existing track were re-tagged with a bitrate, it would NOT trigger a re-encode. No one-time benign `sync-tag-write` storm occurs for existing libraries.

### Deferred to later slices
- Lossy cap-down/up enforcement: `classifyDeviceBound` lossy branch is dormant (S1/S3).
- `encoding-mismatch` (CBR/VBR flip) precondition class: dormant (S2).
- `source-down-suppressed`: dormant (S2).
- DB-bitrate fallback removal: S6.
- `encoding` mode on lossy copy sync-tags: `buildCopySyncTag` has a TODO(S1) for recording source encoding mode (CBR/VBR probing not yet available).
<!-- SECTION:FINAL_SUMMARY:END -->
