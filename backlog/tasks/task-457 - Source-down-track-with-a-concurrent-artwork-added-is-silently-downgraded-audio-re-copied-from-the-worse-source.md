---
id: TASK-457
title: >-
  Source-down track with a concurrent artwork-added is silently downgraded
  (audio re-copied from the worse source)
status: Done
assignee: []
created_date: '2026-07-05 13:41'
updated_date: '2026-10-03 22:27'
labels:
  - sync
  - quality
  - artwork
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - documents/principles/library-safety.md
priority: medium
type: bug
ordinal: 208000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CONFIRMED behaviour (not just a lost report). When a lossy source is re-ripped BELOW the device's recorded copy (`source-down-suppressed`) AND the same track newly needs artwork (`artwork-added`), the track is routed to `toUpdate`. `artwork-added` is a file-replacement upgrade (`isFileReplacementUpgrade`), so `MusicHandler.planUpdate` builds `createUpgrade(source, device, 'artwork-added', action)` where `action = classifier.classify(source).action` → for a device-native lossy source that is `optimized-copy` (FFmpeg passthrough **from the source file**). The device's better audio is replaced by the worse re-ripped source (plus artwork) — a silent audio downgrade, violating the library-safety "never silently degrade" promise (user story 12).

The source-down safety only runs over `diff.existing`; a track already in `toUpdate` bypasses it. `MusicHandler.postProcessSourceDownReports` (added for TASK-454) deliberately does NOT report this case because the audio is not kept — but the underlying downgrade still happens.

Scope: pre-existing interaction (not introduced by the ADR-023 redesign), and rare (requires a worse re-rip AND newly-needed artwork on a previously-synced track — which was likely synced with artwork already).

Fix options (needs a product decision on the tradeoff):
1. **Protect audio (recommended):** for a source-down track, suppress the audio-replacing artwork operation (keep the better device copy), keep any in-place metadata change, and report source-down. Cost: artwork is not added until the source is fixed. Upholds "never degrade".
2. **Artwork-only path:** route `artwork-added` for a source-down track through the artwork-only operation (`createArtworkUpgrade`, used today for `artwork-updated`/`artwork-removed`) IF the executor can embed artwork into the EXISTING device track without re-reading the source audio. Preserves both — needs executor verification.

Surfaced during the ADR-023 lossy-reduction redesign (post-.05 review, item #4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A source-down track that newly needs artwork keeps its device audio (no file replacement)
- [x] #2 The artwork is written onto the existing device track for every artwork sink
- [x] #3 The source-down is reported for that track
- [x] #4 A following sync is a no-op apart from the source-down report
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Went with option 2, the artwork-only path. I checked the executor first: `MusicArtworkManager.transferArtwork` hands off to `adapter.setTrackArtwork`, which writes artwork onto the existing device track for every sink (iPod ArtworkDB, a mass-storage embedded tag rewrite of the device file, a sidecar, or a no-op). The source audio is never re-read into the device file, so option 2 keeps both the audio and the artwork, and the option-1 tradeoff wasn't needed.

Changes (commit fb1d7e04):
- `MusicHandler.plansArtworkOnlyAdd` is now the single rule for when an update is planned artwork-only. It applies when `artwork-added` is the primary reason and the source is down. `planUpdate` (which emits `upgrade-artwork` with reason `artwork-added`) and Pass 1.4 `postProcessSourceDownReports` (which now reports the track) both use it, so the plan and the report can't drift apart. The guard runs whatever the config; only the report keeps its preset gate.
- `transfer.ts`: the artwork-only branch keys on `operation.type === 'upgrade-artwork'` instead of `reason === 'artwork-updated'`, so `upgrade-artwork` can never replace audio. The sync-tag write merges only `artworkHash`, so the recorded bitrate is preserved.
- `planner.ts`: an artwork-only `artwork-added` is sized as artwork bytes, not a full track.

Tests:
- `handler.test.ts`: the plan and the report for a source-down track, `artwork-added` leading other reasons, and the not-down control.
- `pipeline.test.ts`: artwork bytes reach `setTrackArtwork`, the audio is not replaced, and the tag merge carries only `artworkHash`.
- e2e `upgrades.test.ts`: on a dummy iPod, a 192 kbps track is re-ripped to 96 kbps with art. Artwork lands, the bitrate and the `.mp3` file are unchanged, the source-down is reported, and the next sync has no updates. Verified red against a CLI build without the fix.

Docs: `docs/architecture/sync/upgrades.md` and the user-guide upgrades page. Changeset: patch for `podkit` and `@podkit/core`.

Known behaviour, unchanged: metadata changes that come with the artwork are applied on the next sync, the same as the existing `artwork-updated` early return.
<!-- SECTION:FINAL_SUMMARY:END -->
