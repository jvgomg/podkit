---
id: DRAFT-006
title: 'Decide: are the inert format-upgrade / quality-upgrade paths bugs or intended?'
status: Draft
assignee: []
created_date: '2026-05-28 21:28'
labels:
  - needs-discussion
  - sync
  - transcoding
dependencies: []
references:
  - test-packages/e2e-tests/src/features/upgrades.test.ts
  - packages/podkit-core/src/sync/music/classifier.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`features/upgrades.test.ts:11-18` documents two upgrade paths that don't fire end-to-end, and the suite deliberately tests only metadata-correction instead:
- `format-upgrade` is suppressed when `transcodingActive` is true.
- `quality-upgrade` requires `bitrate` to be populated on the iPod track, which doesn't happen for copied (compatible-lossy) files in the current executor.

Open question: are these intended (e.g. format-upgrade is redundant because the transcode already produces the target format; quality-upgrade-on-copy is meaningless) or real gaps where a user who lowers quality / changes format won't get their existing tracks upgraded? Needs a decision on intended upgrade semantics per path before deciding to fix or to document-as-WAI.

Note overlap: TASK-358.03 (mass-storage preset-upgrade loop) is a related but distinct convergence defect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decision recorded per path: intended vs gap
- [ ] #2 For any path deemed a gap — implementation task filed and the upgrades e2e test extended to assert it fires
<!-- AC:END -->
