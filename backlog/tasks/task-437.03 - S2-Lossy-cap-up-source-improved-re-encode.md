---
id: TASK-437.03
title: 'S2: Lossy cap-up / source-improved re-encode'
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
  - packages/podkit-core/src/sync/music/handler.ts
parent_task_id: TASK-437
priority: medium
ordinal: 195000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK.** See PRD doc-051.

Raise the device cap (or improve the source) and have existing **lossy** tracks re-encode **up**, bounded by what the source can supply: `want.bitrate = min(source.bitrate, target.bitrate)`. Fires when `encoded.bitrate < min(source, target)` and the source can support more. Reuses `transferUpgradeToIpod`.

**Context:** user story 2 (raise cap re-encodes lossy up to the new target, as far as source allows).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Lossy source + raised cap: device track re-encodes up to min(source,cap)
- [ ] #2 Source-improved (source bitrate climbs) re-encodes up toward target; never exceeds source
- [ ] #3 Classifier unit tests cover cap-up + source-improved direction/reason for lossy
- [ ] #4 E2E in upgrades.test.ts: raise cap on a lossy collection -> device file re-encoded up (bounded by source)
- [ ] #5 Changeset added
- [ ] #6 User docs updated
- [ ] #7 Architecture doc upgrades.md updated for cap-up / source-improved
<!-- AC:END -->
