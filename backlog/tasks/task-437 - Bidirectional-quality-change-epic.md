---
id: TASK-437
title: Bidirectional quality-change (epic)
status: To Do
assignee: []
created_date: '2026-06-25 22:37'
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
