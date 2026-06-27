---
id: TASK-437.06
title: 'S5: Precondition re-encodes — CBR/VBR flip + lossy/lossless boundary'
status: To Do
assignee: []
created_date: '2026-06-25 22:38'
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
ordinal: 198000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK.** See PRD doc-051.

Treat encoding-mode flips (CBR↔VBR) and the lossy↔lossless boundary as **precondition classes** — they re-encode for correctness regardless of bitrate policy, so they fire even when `bitrate.sync = off`, and bypass the policy gate. CBR/VBR is read from the sync-tag `encoding` (libgpod exposes no VBR signal); the lossy/lossless axis is observable from codec (DB filetype + source probe). Direction still tags the result (lossy→lossless = up; lossless→lossy = down) for display. `skipUpgrades` (additive-only) still vetoes even these.

**Context:** user stories 4 (encoding-mode flip re-encodes), 5 (lossy/lossless boundary re-encodes both directions).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Switching device encoding mode (CBR<->VBR) re-encodes existing tracks to the new mode; fires even at bitrate.sync=off
- [ ] #2 Lossy->lossless target change re-encodes up; lossless->lossy transcodes down to cap; both fire even at bitrate.sync=off
- [ ] #3 Precondition classes bypass the policy gate but are vetoed by skipUpgrades (additive-only)
- [ ] #4 Classifier unit tests cover encoding-mismatch + lossless-boundary (both directions) and the off-bypass + skipUpgrades-veto
- [ ] #5 E2E in upgrades.test.ts: encoding flip and lossless-boundary each re-encode under off; skipUpgrades blocks them
- [ ] #6 Changeset added
- [ ] #7 User docs updated (encoding mode + lossy/lossless are correctness, not bitrate policy)
- [ ] #8 Architecture doc upgrades.md updated for precondition classes
<!-- AC:END -->
