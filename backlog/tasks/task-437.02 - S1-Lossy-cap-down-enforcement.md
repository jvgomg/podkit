---
id: TASK-437.02
title: 'S1: Lossy cap-down enforcement'
status: To Do
assignee: []
created_date: '2026-06-25 22:37'
updated_date: '2026-06-27 16:11'
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
priority: high
ordinal: 194000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK. The headline gap.** See PRD doc-051.

Make a lowered device bitrate cap actually shrink **lossy** tracks already on the device. Today lossy sources are copied as-is and excluded from cap enforcement (`if (!isSourceLossless) return null` in `postProcessPresetChanges`). Remove that exclusion for the down direction: when `encoded.bitrate > target.bitrate` for a lossy source, re-encode down to the new cap, reusing the existing `transferUpgradeToIpod` executor. A second sync with no change must be a no-op (idempotent).

**Context:** user stories 1 (lower cap shrinks lossy tracks), 21 (idempotent re-sync).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Lossy source + lowered cap: existing device track re-encodes down to min(source,cap) via transferUpgradeToIpod (no new executor code)
- [ ] #2 Re-sync after the re-encode is a no-op (idempotent; sync-tag updated to new encoded value)
- [ ] #3 Classifier unit tests cover lossy cap-down direction/reason
- [ ] #4 E2E in upgrades.test.ts: lower cap on a lossy collection -> device file bitrate/size drops
- [ ] #5 Changeset added
- [ ] #6 User docs updated (quality/bitrate behaviour now applies to lossy)
- [ ] #7 Architecture doc upgrades.md updated for lossy cap-down
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CAVEAT from S0 (must handle here): there is a latent SYMMETRIC merge leak in the reverse direction — a transcode->copy transition leaks `encoding` into the copy tag (buildCopySyncTag omits the `encoding` key, so the adapter merge `{...existing,...update}` keeps a stale `encoding` from a prior audio tag). It is harmless in S0 because classifyDeviceBound's LOSSY branch is dormant. S1 ACTIVATES lossy cap classification, so this WILL cause the same non-idempotent re-sync bug for lossy copies unless fixed. Fix mirror of S0's: make buildCopySyncTag authoritatively emit the `encoding` key (undefined for a pure copy) so the merge clears stale values — keeping write/expected symmetric. Add a mass-storage idempotency e2e for the lossy-copy path. Ref S0 fix in sync-tags.ts buildAudioSyncTag.
<!-- SECTION:NOTES:END -->
