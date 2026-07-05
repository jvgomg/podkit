---
id: TASK-453.04
title: Below-raised-cap report-only surfacing + output reason vocabulary cleanup
status: Done
assignee: []
created_date: '2026-06-30 16:51'
updated_date: '2026-07-05 14:10'
labels:
  - sync
  - quality
  - cli
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - >-
    backlog/docs/doc-055 -
    PRD-Lossy-Reduction-Redesign-—-Down-Only-Transfer-Mode-Defaulted-Axis.md
parent_task_id: TASK-453
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 4. Prereq: slices 2 + 3. The visibility promise (library-safety §6) + JSON/text output cleanup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A reduced track sitting below a raised cap (recorded bitrate < cap, from the sync tag) is routed to the report-only channel with a ‘N tracks below your quality target; --force-transcode to lift’ message; never auto-upgraded
- [x] #2 JSON reason vocabulary and the music presenter drop cap-up / source-improved; report-only counts retained (source-down-suppressed + below-cap)
- [x] #3 formatters + demo mock-core updated; presenter/formatter tests cover the new vocabulary and the below-cap report
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 4 implemented (report-only visibility + vocab cleanup).

source-down-suppressed (D1): re-homed the producer into classifySourceBound (upgrades.ts) — the source bound has both source and device. Condition: a LOSSY source whose ffprobe bitrate < device recorded (sync-tag) bitrate × (1 − tolerance). Emits reEncodes:false. tolerance defaults to DEFAULT_SOURCE_DOWN_TOLERANCE (0.25); handler threads config.reductionTolerance. Only sync-tagged tracks qualify (recorded bitrate required; lossless device copies carry no bitrate so are excluded). Handler postProcessPresetChanges lossy branch runs the source bound first → pushes to reportOnlyQualityChanges and returns null (track stays in `existing`, NO operation). Proven by handler test "source re-ripped below the device copy -> reported, kept in existing, NO operation" (toUpdate length 0).

below-cap (AC#1): classifyLossyDeviceBound now, when the seam returns `copy`, checks isBelowRaisedCap — discriminator is the sync tag's quality marker: a previously-REDUCED track carries a lossy preset quality (low/medium/high) and its recorded TIER is strictly below the target tier; a copied device-native track (quality=copy) or same-tier VBR-wobble track does NOT qualify (keeps it low-noise; recorded==cap is in sync). Emits below-cap reEncodes:false. CLI surfaces an aggregate low-noise line: "N tracks below your quality target; `--force-transcode` to lift them". --force-transcode wired: handler lifts a below-cap track (when source.bitrate > recorded) by re-deriving it up to the cap via the proven quality-change path (reEncodes:true), and suppresses the report in that case (no double-count).

QualityChangeReason union: added `below-cap`. Reachable: lossless-boundary, cap-down, cap-up, encoding-mismatch, source-down-suppressed, below-cap. Reserved: format-mismatch.

Vocab cleanup (AC#2/#3): no lossy cap-up / source-improved display strings remained (cleaned in earlier slices) — cap-up retained for lossless/ALAC. Added quality-change-below-cap breakdown key + formatter label; presenter splits reportOnlyQualityChanges by reason in text and JSON. mock-core classifySourceBound stub gained the tolerance param. Removed genuinely-unused sync.ts imports (genericSyncCollection, GenericSyncResult, WarningInfo, ScanWarningInfo, TransformInfo, UpdateBreakdown, QualityChangeInfo, VideoSummary) — all still re-exported for external consumers; kept ErrorInfo, SyncOutput, MusicContentConfig, VideoContentConfig (used in-body).

E1 guard: added a small, safe guard in classifyDeviceBound — a lossless device copy (ALAC) with a now-LOSSY source and a lossy target now crosses the lossless→lossy boundary DOWN (previously fell through to the lossy bound, read the absent recorded bitrate, returned null, and left an over-ceiling copy). Mirrors the lossless-source branch; correctness precondition, axis-independent. Covered by two tests.

Tests: bun run test:unit --filter @podkit/core (3376 pass) and --filter podkit (1923 pass) green. bunx turbo run typecheck lint build (42 tasks) clean; CLI typecheck force-run clean.

Team-lead review pass: B1 FIX (correctness) — a `--force-transcode` lift of a below-cap track was emitted as `below-cap`+reEncodes, which `resolveUpgradeAction` didn't recognise → it copied the source verbatim instead of re-encoding to the new cap. Now emits the lift as `cap-up` (the explicit opt-in re-encode), so it routes through the existing upgrade path; `below-cap` stays purely report-only. +2 tests (forced cap-up → upgrade-transcode; can't-lift → report-only no-op). B2: vocabulary pin corrected (below-cap added, length 6→7). S2: demo mock `classifyDeviceBound` updated to the object-input signature. N1: DRY'd the duplicated lossless-boundary-down literal into a helper. N2: removed pre-existing TASK-142/TASK-398 comment refs in touched files. S1/E2: source-down report is skipped when the track has a concurrent metadata/artwork change (audio still kept) — made visible via a KNOWN LIMITATION comment + filed TASK-454. Gates: core 9/9, full typecheck+lint+build 42/42, CLI+demo unit green.
<!-- SECTION:NOTES:END -->
