---
id: TASK-437.04
title: 'S3: Source-down suppression + visibility'
status: Done
assignee: []
created_date: '2026-06-25 22:37'
updated_date: '2026-06-27 18:25'
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
parent_task_id: TASK-437
priority: medium
ordinal: 196000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK.** See PRD doc-051.

When the **source** got worse (re-ripped lower) but the cap is unchanged (`encoded.bitrate <= target` AND `encoded.bitrate > source.bitrate`), do **not** re-encode the good device copy down to the worse source by default. Classify as `source-down-suppressed` (no-op for the track) and surface it: a `source-down-suppressed` entry in `sync --json qualityChanges[]`, a count in the default text per-collection summary, and a per-track line in verbose mode.

**Context:** user stories 6 (no quality-destroying surprises), 7 (visible in summary/JSON), 18 (JSON includes suppressed entries).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Source-down (source<encoded, cap unchanged) under default policy: track is NOT re-encoded
- [x] #2 qualityChanges[] JSON includes a source-down-suppressed entry (track, encoded, source, cap)
- [x] #3 Default text output shows a per-collection suppressed count; verbose lists each affected track
- [x] #4 Classifier unit tests cover source-down-suppressed (separate-bounds: distinguished from cap-down)
- [x] #5 E2E in upgrades.test.ts: re-rip source lower -> device track unchanged, suppressed entry emitted
- [x] #6 Changeset added
- [x] #7 User docs updated (explain source-down suppression + how to opt in via match-all, forward-ref S4)
- [x] #8 Architecture doc upgrades.md updated for source-down handling
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Refined the lossy device-bound (classifyLossyDeviceBound) to the three-bound model against effectiveTarget = min(source, cap):
- encoded < effectiveTarget -> cap-up (unchanged)
- encoded > effectiveTarget: source >= cap -> cap-down; source < cap -> source-down-suppressed (reEncodes:false)
- encoded === effectiveTarget -> null

CAP-DOWN EDGE FIX: previously `encoded > cap` fired cap-down regardless of source, so a copy recorded above the cap whose source later degraded below the cap (e.g. recorded 320, source 100, cap 128) re-encoded upward from the worse source. Now both encoded/source bitrates are required and the source-below-cap case is source-down-suppressed instead. Existing cap-down tests/e2e (320/128, 192/128 — source>=cap) still fire cap-down. Both encoded (sync-tag bitrate) AND source.bitrate are now required (else null); no DB-bitrate guessing.

VISIBILITY PLUMBING (report-but-don't-execute): added UnifiedSyncDiff.reportOnlyQualityChanges. In postProcessPresetChanges, a lossy change with reEncodes===false is pushed there and the callback returns null, so the track stays in `existing` — never enters toUpdate, never produces an operation, never bumps tracksToUpdate/tracksToUpgrade. music-presenter reads the channel alongside toUpdate: appends to qualityChanges[] (shared qualityChangeInfo helper), counts under updateBreakdown['quality-change-suppressed'], and prints a per-collection "Source-down suppressed" count (verbose: per-track device-vs-source bitrates). Also fixed updateBreakdown gating (was `toUpdate.length>0`; now `Object.keys(updateBreakdown).length>0`) so the suppressed count surfaces in JSON when only suppressed entries exist.

IDEMPOTENCY: suppressed tracks produce no operation, so each dry-run reports them and a real sync is a no-op; verified by e2e (real sync completed=0, device file unchanged .mp3/.m4a).

TESTS: upgrades.test.ts unit rows for source<encoded<=cap and the recorded-above-cap edge -> source-down-suppressed; encoded==effectiveTarget -> null; source>=cap&encoded>cap -> still cap-down; composed classifyQualityChange row. handler.test.ts: degraded lossy source -> reportOnlyQualityChanges (not toUpdate), planUpdate produces no op. E2E: iPod (upgrades.test.ts) within-cap suppression + above-cap edge; mass-storage (preset-change.test.ts) suppression. All assert qualityChanges[] source-down-suppressed, quality-change-suppressed=1, tracksToUpdate=0, device file unchanged.

LEFT TO A FUTURE POLICY: actually following a degraded source down (opt-in). No policy/config knob implemented here; the classifier already carries the source-down-suppressed change (effective target = source bitrate) such a policy would consume.

Files: packages/podkit-core/src/sync/engine/upgrades.ts, content-type.ts, sync/music/handler.ts; packages/podkit-cli/src/commands/music-presenter.ts, sync-output-types.ts; tests upgrades.test.ts (core+e2e), handler.test.ts, preset-change.test.ts; docs/user-guide/transcoding/audio.md, docs/user-guide/syncing/upgrades.md, documents/architecture/sync/upgrades.md; .changeset/lossy-source-down-suppression.md.

Reviewed (Sonnet): APPROVE-WITH-NITS, no blocking. Three-bound gating correct at all boundaries; suppressed path genuinely report-only (mutually exclusive null-vs-entry return — never in both toUpdate and reportOnlyQualityChanges; no tracksToUpdate bump; real sync does nothing); cap-down regression intact (source>=cap still fires); updateBreakdown keys-based gating fix correct; no double-count; no slice labels. Lead added the one missing-coverage nit: unit test for `encoded > cap` + source bitrate undefined -> null (documented behavior change, now pinned). Deliberately LEFT the dead-branch nits (breakdownKeyForUpdate !reEncodes guard, verbose ' (suppressed)' suffix, formatUpdateReason suppressed entry) — the next slice (bitrate.sync policy / match-all) resurrects the reEncodes:true source-down path, so removing+re-adding is churn. Re-verified classifier unit 39/0.
<!-- SECTION:NOTES:END -->
