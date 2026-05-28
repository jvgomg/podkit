---
id: DRAFT-008
title: >-
  Decide: define a stable contract for how `doctor` categorises a corrupt source
  file
status: Draft
assignee: []
created_date: '2026-05-28 21:28'
labels:
  - needs-discussion
  - doctor
  - artwork
dependencies: []
references:
  - test-packages/e2e-tests/src/features/doctor-artwork-repair.test.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`features/doctor-artwork-repair.test.ts:487-517` documents that a corrupt source file's categorisation is non-deterministic: it "may either fail to scan (becoming noSource) or scan but fail during artwork extraction (becoming an error or noArtwork via album cache)". The test only asserts everything is *accounted for* (`matched + noSource + noArtwork + errors === 3`), not which bucket each lands in.

Open question: should podkit guarantee a stable categorisation for a corrupt/unreadable file (e.g. always `error`), so users get a predictable diagnostic? Or is best-effort bucketing acceptable? Needs a decision on the intended contract; if we define one, the test can then assert the exact bucket.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decision recorded: is there a required categorisation contract for corrupt files?
- [ ] #2 If yes — implementation task filed and the doctor-artwork-repair test tightened to assert the exact buckets
<!-- AC:END -->
