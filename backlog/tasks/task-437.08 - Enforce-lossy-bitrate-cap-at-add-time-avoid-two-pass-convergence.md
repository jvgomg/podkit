---
id: TASK-437.08
title: Enforce lossy bitrate cap at add time (avoid two-pass convergence)
status: To Do
assignee: []
created_date: '2026-06-27 17:25'
labels:
  - sync
  - transcoding
  - quality
dependencies: []
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
parent_task_id: TASK-437
priority: low
ordinal: 201000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up surfaced during the lossy cap-down review.

Cap-down enforcement currently applies to tracks **already on the device**. A newly added lossy track whose bitrate is above the cap is copied as-is on the first sync, then re-encoded down on the **next** sync — so a fresh library converges to the cap over two syncs rather than one. This is self-healing and documented (changeset + docs/user-guide/transcoding/audio.md), not silent, but it's a UX wart.

Enforce the cap on the **add** path too: when a lossy source's bitrate exceeds the device cap, transcode-down on first add (mirroring the cap-down upgrade path's `bitrateOverride`) so a brand-new library lands at the cap in one sync.

**Care:** must NOT cap a lossy source that is at/below the cap (keep copying as-is), and must not interfere with the source-improved path (a source above an existing device copy). Verify idempotency and that a fresh add at/under cap still copies. Add e2e for fresh-add-above-cap → single-sync convergence.

Out of scope for the headline cap-down slice; low priority since it self-heals on the second sync.
<!-- SECTION:DESCRIPTION:END -->
