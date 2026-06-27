---
id: TASK-437.07
title: 'S6: Untagged opt-out + --force-sync-tags-transcode + drop DB-bitrate fallback'
status: To Do
assignee: []
created_date: '2026-06-25 22:38'
labels:
  - sync
  - transcoding
  - quality
  - cli
dependencies:
  - TASK-437.01
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
  - packages/podkit-cli/src/commands/sync.ts
  - adr/adr-010-preset-change-detection.md
parent_task_id: TASK-437
priority: medium
ordinal: 199000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK.** See PRD doc-051.

Make the sync-tag the **sole** quality truth: remove the DB-bitrate + tolerance fallback entirely. A track with no sync-tag (one podkit didn't write) is **opted out** of bitrate/encoding re-checks — the classifier returns null for it (no guessing from the unreliable iPod-DB bitrate; libgpod has no VBR signal). Add `--force-sync-tags-transcode` (sibling of `--force-sync-tags`, which writes tags without re-encoding) — the only path that re-encodes untagged (or all matched) tracks to establish true bitrate + encoding, explicit because it is destructive. Record the "sync-tag is sole quality truth; no DB-bitrate fallback" decision in an ADR (extend or supersede ADR-010).

**Context:** user stories 13 (untagged left alone — no re-encode storm on upgrade), 14 (explicit adoption flag).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DB-bitrate + tolerance fallback path removed; classifier returns null for untagged tracks (opted out of bitrate/encoding checks)
- [ ] #2 Upgrading to this feature does NOT trigger a re-encode storm on a library of untagged tracks
- [ ] #3 --force-sync-tags-transcode re-encodes untagged (or all matched) tracks to establish true bitrate+encoding sync-tags; explicit + destructive
- [ ] #4 --force-sync-tags (non-destructive, tag-only) behaviour preserved and clearly distinct
- [ ] #5 Sync-tag round-trip tests: untagged opted out until adopted; adoption writes authoritative encoded data
- [ ] #6 E2E: untagged track unchanged on normal sync; --force-sync-tags-transcode adopts it
- [ ] #7 ADR added/updated recording sync-tag-as-sole-truth (no DB-bitrate fallback)
- [ ] #8 Changeset added
- [ ] #9 User docs updated (--force-sync-tags-transcode + untagged opt-out behaviour)
- [ ] #10 Architecture doc upgrades.md updated (sync-tag sole truth, fallback removed)
<!-- AC:END -->
