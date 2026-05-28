---
id: DRAFT-009
title: >-
  Review: Subsonic hasArtwork relies on probing + filtering Navidrome's
  placeholder
status: Draft
assignee: []
created_date: '2026-05-28 21:28'
labels:
  - needs-discussion
  - subsonic
  - artwork
dependencies: []
references:
  - test-packages/e2e-tests/src/features/artwork-change.docker.test.ts
  - test-packages/e2e-tests/src/sources/subsonic.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`features/artwork-change.docker.test.ts:456-459, 541-545` document that podkit must fetch the cover and filter out Navidrome's placeholder image to compute `hasArtwork`, because the Subsonic API always returns a `coverArt` ID even when there is no real art. This is a known adapter workaround.

Open question: is the placeholder-filtering approach robust enough to keep (it's inherently heuristic — placeholder bytes can change between Navidrome versions), or is there a cleaner signal? Likely working-as-intended, but worth a short review to confirm we're comfortable with the heuristic and to decide whether it needs hardening (e.g. against placeholder drift). Low priority.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decision recorded: keep the placeholder-filter heuristic as-is, or harden it
- [ ] #2 If harden — implementation task filed
<!-- AC:END -->
