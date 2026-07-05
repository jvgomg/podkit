---
id: TASK-454
title: >-
  Surface source-down-suppressed when the track also has a concurrent
  metadata/artwork change
status: Done
assignee: []
created_date: '2026-06-30 19:44'
updated_date: '2026-07-04 23:11'
labels:
  - sync
  - quality
  - cli
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - documents/principles/library-safety.md
priority: low
ordinal: 205000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a re-ripped/degraded source (the `source-down-suppressed` safety case — podkit keeps the better device copy) coincides with an artwork or metadata change on the same track, the track is routed to `toUpdate` for the metadata change and never reaches the report-only pass over `diff.existing`, so the source-down report is silently skipped that run.

The device audio is still correctly KEPT (the worse source never replaces it) — this is a VISIBILITY gap, not a safety bug. See the KNOWN LIMITATION comment in `MusicHandler.detectSourceQualityChange` (`packages/podkit-core/src/sync/music/handler.ts`).

Fix direction: emit the source-down report-only entry even when the track is updated for an unrelated (non-audio) reason — e.g. attach it to the update's quality-change channel as a report-only annotation, or run the source-down report pass over `toUpdate` as well as `existing`.

Surfaced during the ADR-023 lossy-reduction redesign (TASK-453.04 review).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented. Added `MusicHandler.postProcessSourceDownReports` (Pass 1.4) — scans `diff.toUpdate` for lossy tracks with a `source-down-suppressed` condition and surfaces the report, which the existing preset pass only did for tracks left in `diff.existing`.

Scoped by outcome: only updates that keep the audio in place (NOT `isFileReplacementUpgrade` — so metadata-correction qualifies, but artwork-added/force-transcode/codec/preset changes do not). A file-replacement re-derives the file from the (worse) source, so a "kept the better copy" report would misrepresent the outcome — those are deliberately skipped (documented in a test). The KNOWN LIMITATION comment in `detectSourceQualityChange` is removed.

Tests (handler.test.ts): source-down + concurrent metadata-correction → update untouched, source-down reported; source-down + artwork-added (file replacement) → NOT reported.

Note: whether a file-replacement update on a source-down track actually downgrades the device audio is a deeper content-change/self-healing interaction, out of scope here (the source-down safety runs over `existing`; content-change routing predates this work).

Gate: core+CLI unit green, typecheck/lint/build 42/42, e2e 18/18.
<!-- SECTION:NOTES:END -->
