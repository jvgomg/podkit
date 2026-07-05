---
id: TASK-455
title: Adoption labels a same-bitrate forced codec transcode as cap-up (cosmetic)
status: Done
assignee: []
created_date: '2026-06-30 23:25'
updated_date: '2026-07-04 23:11'
labels:
  - sync
  - quality
  - cli
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
priority: low
ordinal: 206000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In `MusicHandler.postProcessSyncTagsTranscode` (the `--force-sync-tags-transcode` adoption path), a necessity transcode (incompatible source codec) whose seam target equals the source bitrate (an at-or-below-cap source) resolves to `direction: 'format-only'` but is labelled `reason: 'cap-up'` (the `direction === 'down' ? 'cap-down' : 'cap-up'` ternary). The re-encode itself is correct (a codec conversion at the same bitrate), but the sync summary / JSON reports a misleading quality-up event.

This is COSMETIC only — the transcode and the resulting sync tag are correct. A clean fix needs a non-misleading reason for a same-bitrate forced codec change, which means touching the `QualityChangeReason` vocabulary, `resolveUpgradeAction`'s routing guard (currently keys on `cap-down`/`cap-up`), and the presenter — deferred to avoid a late vocabulary change during the ADR-023 redesign.

Surfaced during the ADR-023 lossy-reduction redesign (TASK-453.05 review).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented. The adoption path (`postProcessSyncTagsTranscode`) now emits `format-mismatch` (direction `format-only`) when the seam's target equals the source bitrate — a pure forced codec change (an at-or-below-cap incompatible-codec source), instead of the misleading `cap-up`. `cap-down`/`cap-up` remain for genuine down/up moves.

Wiring: `resolveUpgradeAction`'s guard gained `format-mismatch` so the change still re-encodes (the codec must change) rather than falling through to a copy. The presenter prints `qc.reason` verbatim, so `format-mismatch` surfaces honestly with no further change; report-only breakdown keys (below-cap/source-down) are unaffected (this is a `reEncodes:true` change). `QualityChangeReason` docstring updated — `format-mismatch` is now produced by adoption, no longer purely reserved.

Test (handler.test.ts): adoption of a Vorbis@200 source (below cap 256) under convert → `format-mismatch`/`format-only`, transcodes to 200 (bitrateOverride), NOT cap-up.

Gate: core+CLI unit green, typecheck/lint/build 42/42, e2e 18/18.
<!-- SECTION:NOTES:END -->
