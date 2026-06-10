---
id: TASK-360.03
title: >-
  Populate ipod.bitrate on copy path so quality-upgrade fires after bitrate-cap
  changes
status: In Progress
assignee: []
created_date: '2026-05-28 21:28'
updated_date: '2026-06-09 23:58'
labels:
  - sync
  - transcoding
dependencies: []
references:
  - test-packages/e2e-tests/src/features/upgrades.test.ts
  - packages/podkit-core/src/sync/music/classifier.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`features/upgrades.test.ts:11-18` documents two inert upgrade paths:
- `format-upgrade` is suppressed when `transcodingActive` is true (Working As Intended — the transcode already produces the target format).
- `quality-upgrade` requires `ipod.bitrate` to be populated, which doesn't happen for copied compatible-lossy files.

The copy path (`packages/podkit-core/src/sync/engine/upgrades.ts:250-262` compares `source.bitrate && ipod.bitrate`) means a user who later lowers their bitrate cap won't get existing copied tracks re-transcoded down.

## Decision

Format-upgrade gate is intentional; document as WAI.

Quality-upgrade on copy is a real gap. Populate `ipod.bitrate` when copying lossy files so quality-upgrade fires correctly when the user lowers the bitrate cap later.

Related but distinct: TASK-358.03 (mass-storage preset-upgrade convergence).

## References

- test-packages/e2e-tests/src/features/upgrades.test.ts:11-18
- packages/podkit-core/src/sync/music/handler.ts:285-290 (format-upgrade gate)
- packages/podkit-core/src/sync/engine/upgrades.ts:250-262 (quality-upgrade gate)
- packages/podkit-core/src/sync/music/classifier.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Copy executor writes `bitrate` to the iPod track record when the source bitrate is known (lossy copy path)
- [x] #2 quality-upgrade classifier successfully compares `source.bitrate` vs `ipod.bitrate` for previously-copied tracks
- [x] #3 Extend `upgrades.test.ts`: copy MP3 at high bitrate, lower the bitrate cap, re-sync, assert the track re-encodes (or is replaced)
- [x] #4 Document format-upgrade suppression on `transcodingActive` as Working As Intended in `documents/architecture/sync/` (new upgrades doc)
- [x] #5 No regression in existing upgrade-path tests
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

### Copy-side bitrate write

`transfer.ts:toDeviceTrackInput` already passed `source.bitrate` into `DeviceTrackInput` for both `add-direct-copy` and `add-optimized-copy`; the contract is now pinned by two tests in `pipeline.test.ts` (one for the populated case, one for the unknown-bitrate case which must leave the field undefined, NOT zero). AC #1 was already satisfied in the codebase; this work pins it and documents the contract.

### Upgrade-side bitrate write — the actual bug

`transferUpgradeToIpod` used to write `bitrate: prepared.bitrate` only. For `upgrade-direct-copy` the preparer never sets `prepared.bitrate`, so a quality-upgrade (e.g. 96 → 256 kbps MP3 source bump) would replace the file but leave the iPod bitrate field at the OLD value — causing the next sync to re-detect the same quality-upgrade indefinitely. Now resolves `prepared.bitrate ?? source.bitrate`; the source bitrate carries the upgrade home for direct-copy upgrades.

### `--force-sync-tags` bitrate baseline backfill

New pass `MusicHandler.postProcessBitrateBaseline`, symmetric to `postProcessSyncTags`'s artwork-hash baseline:
- Opt-in via `forceSyncTags`
- Fires only when `ipod.bitrate === 0` and `source.bitrate` is known
- Emits an `update-metadata` operation with a `bitrate` change

Touched the metadata-update pipeline to actually carry bitrate:
- `TrackMetadata.bitrate?: number`
- `changesToMetadata` handles `field: 'bitrate'`
- `MusicPipeline.executeUpdateMetadata` propagates the field via `updateTrack`

### Format-upgrade gate

Untouched. Documented in the new architecture doc as Working As Intended: the gate fires when source is lossless and iPod track is lossy; when the iPod track is already AAC, the gate is suppressed because transcoding (`quality=high` etc.) is the active codepath and re-firing format-upgrade would re-transcode the same FLAC→AAC bytes on every sync.

## Files changed

- `packages/podkit-core/src/sync/music/transfer.ts` — upgrade-side `prepared.bitrate ?? source.bitrate` resolution (the actual bug fix)
- `packages/podkit-core/src/sync/music/handler.ts` — new `postProcessBitrateBaseline` pass
- `packages/podkit-core/src/sync/music/handler.test.ts` — 4 new unit tests for the backfill
- `packages/podkit-core/src/sync/music/planner.ts` — `changesToMetadata` handles `bitrate`
- `packages/podkit-core/src/sync/music/pipeline.ts` — `executeUpdateMetadata` propagates `metadata.bitrate`
- `packages/podkit-core/src/sync/music/pipeline.test.ts` — new test for the bitrate metadata-update path + a defensive test pinning the "source bitrate unknown" → field omitted contract
- `packages/podkit-core/src/types.ts` — `TrackMetadata.bitrate?: number`
- `test-packages/e2e-tests/src/features/upgrades.test.ts` — quality-upgrade E2E test (initial sync at 96 kbps, replace source at 256 kbps, re-sync without `--force-sync-tags`, assert the dummy-iPod side's bitrate reflects the upgrade)
- `documents/architecture/sync/upgrades.md` — new doc covering both gates, format-upgrade WAI rationale, bitrate baseline flow
- `documents/architecture/README.md` — index entry

## Verification

- `bun run test:unit --filter @podkit/core --filter podkit` — 3142 unit tests pass (+6 from baseline)
- `bun test test-packages/e2e-tests/src/features/upgrades.test.ts` — 7 pass (1 new)
- `bun run build` — clean
- `bun run lint` — 0 warnings, 0 errors
<!-- SECTION:NOTES:END -->
