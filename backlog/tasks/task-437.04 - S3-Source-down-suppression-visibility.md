---
id: TASK-437.04
title: 'S3: Source-down suppression + visibility'
status: To Do
assignee: []
created_date: '2026-06-25 22:37'
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
- [ ] #1 Source-down (source<encoded, cap unchanged) under default policy: track is NOT re-encoded
- [ ] #2 qualityChanges[] JSON includes a source-down-suppressed entry (track, encoded, source, cap)
- [ ] #3 Default text output shows a per-collection suppressed count; verbose lists each affected track
- [ ] #4 Classifier unit tests cover source-down-suppressed (separate-bounds: distinguished from cap-down)
- [ ] #5 E2E in upgrades.test.ts: re-rip source lower -> device track unchanged, suppressed entry emitted
- [ ] #6 Changeset added
- [ ] #7 User docs updated (explain source-down suppression + how to opt in via match-all, forward-ref S4)
- [ ] #8 Architecture doc upgrades.md updated for source-down handling
<!-- AC:END -->
