---
id: TASK-457
title: >-
  Source-down track with a concurrent artwork-added is silently downgraded
  (audio re-copied from the worse source)
status: To Do
assignee: []
created_date: '2026-07-05 13:41'
labels:
  - sync
  - quality
  - artwork
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - documents/principles/library-safety.md
priority: medium
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
