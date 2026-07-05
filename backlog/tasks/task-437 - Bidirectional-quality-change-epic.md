---
id: TASK-437
title: Bidirectional quality-change (epic)
status: Done
assignee: []
created_date: '2026-06-25 22:37'
updated_date: '2026-06-29 17:03'
labels:
  - sync
  - transcoding
  - quality
  - epic
dependencies: []
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
  - >-
    backlog/docs/doc-054 -
    Bidirectional-quality-change-for-video-bring-video-sync-to-the-sync-tag-authoritative-model-and-make-music-video-symmetric.md
priority: medium
ordinal: 192000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Epic tracking the bidirectional quality-change work. See PRD **doc-051** for the full design, scenario catalogue, and rationale.

**One-line goal:** make "the device matches my target quality" true in both directions for **every** source type (lossy included), driven by the sync-tag (what podkit actually encoded), not by re-probing or the unreliable iPod-DB bitrate.

**Premise correction (vs archived TASK-419):** bidirectional, sync-tag-exact preset-change detection already exists for *lossless* sources (ADR-010: `detectPresetChange` + `determineSyncTagDirection`). The real gap is (a) lossy sources are copied as-is and never cap-enforced, (b) three fragmented detection paths need unifying into one pure classifier, (c) per-direction `bitrate.sync` policy, (d) dropping the DB-bitrate tolerance fallback (untagged = opted out; explicit adoption flag).

**Subtask map (vertical slices):**
- S0 Foundation — unify classifier + quality-change event surface + sync-tag always-write (HITL, blocks all)
- S1 Lossy cap-down enforcement
- S2 Lossy cap-up / source-improved
- S3 Source-down suppression + visibility
- S4 `bitrate.sync` policy + config + CLI override (converges S1/S2/S3)
- S5 Precondition re-encodes (CBR/VBR flip + lossy/lossless boundary)
- S6 Untagged opt-out + `--force-sync-tags-transcode` + drop DB-fallback + ADR

**Cross-cutting (every user-facing slice):** add a changeset, update user docs, update architecture docs (`documents/architecture/sync/upgrades.md`).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All eight slices are implemented and committed on branch `feat/quality-change-bidirectional` (local; not pushed/merged). Status is In Progress, not Done — the user flips subtasks/epic to Done on merge.

Slice status:
- S0 unified classifier + event surface (437.01) — Done
- S1 lossy cap-down (437.02) — Done
- S2 lossy cap-up / source-improved (437.03) — Done
- S3 source-down suppression (437.04) — Done
- S4 bitrate.sync policy + config + CLI override (437.05) — implemented, In Progress (all ACs incl. AC#5 checked)
- S5 precondition re-encodes (CBR/VBR flip + lossy/lossless boundary) (437.06) — implemented, In Progress
- S6 untagged opt-out + --force-sync-tags-transcode + drop DB-bitrate fallback + ADR-022 (437.07) — implemented, In Progress (all 10 ACs incl. AC#6 full-execution e2e)
- 437.08 enforce lossy cap at add time — implemented, In Progress

Outcome: the device matches the target audio quality in both directions for every source type, driven by the sync-tag as the sole quality truth (no DB-bitrate fallback for audio; untagged opt-out; explicit --force-sync-tags-transcode adoption). Unified classifier + pure policy gate (off/match-cap/match-all/up-only/down-only) + per-device [bitrate].sync + --bitrate-sync override. ADR-022 records sync-tag-as-sole-truth. Cross-cutting deliverables (changesets, user docs, documents/architecture/sync/upgrades.md) landed per slice.

Scope note: this epic is AUDIO only. Bringing the same bidirectional/sync-tag-authoritative model to VIDEO — and making the music/video sync routines symmetrical — is captured in a separate PRD (Backlog doc; see References once linked). Video still uses the older DB-bitrate + tolerance preset-change path (the retained detectBitratePresetMismatch consumers in sync/video/handler.ts).

Video follow-up PRD now written: doc-054 "Bidirectional quality-change for video" — brings video sync to the same sync-tag-authoritative, bidirectional, policy-gated model and makes the music/video routines symmetric (shared content-neutral engine primitives + policy gate; a video-adapted vector bound-classifier; video sync-tag as a full effective-settings vector; untagged opt-out + adoption; then delete the DB-bitrate fallback whose last consumer is video). It carries 8 open questions for the user. Not yet broken into tasks.

DONE: all eight slices implemented, reviewed (per-slice Sonnet pass), and committed on feat/quality-change-bidirectional; all gates green. Marking the epic and its subtasks Done now that the work is complete (correcting an earlier note that gated Done on merge — that was an incorrect assumption). VIDEO is NOT part of this epic: it is a separate future effort with its own PRD (doc-054) and will get its own task(s) when picked up; the audio epic stands complete independently.

FOLLOW-UP / partial supersession: after the epic was marked Done, the add-time cap (437.08) was found to break the codec matrix and the bidirectional cap design was found to have gaps vs settled policy (ADR-010 "compatible lossy → copy"; transfer mode was treated as orthogonal but shouldn't be; lossy was re-encoded up, which it shouldn't). A redesign — transfer-mode-primary, down-only reduction, two tolerances (drift=0, source-proximity=stepped default), codec-stack-aware target — is captured in TASK-437.09 (ADR + docs + re-plan). The branch feat/quality-change-bidirectional is intentionally left RED pending that work. The shipped slices stand as history, but S1/S2/S4/437.08 will be reshaped/removed by the 437.09 plan.
<!-- SECTION:NOTES:END -->
