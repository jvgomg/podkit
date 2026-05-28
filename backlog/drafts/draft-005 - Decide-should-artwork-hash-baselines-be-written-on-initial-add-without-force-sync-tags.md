---
id: DRAFT-005
title: >-
  Decide: should artwork-hash baselines be written on initial add (without
  --force-sync-tags)?
status: Draft
assignee: []
created_date: '2026-05-28 21:28'
labels:
  - needs-discussion
  - artwork
  - sync
dependencies: []
references:
  - test-packages/e2e-tests/src/features/artwork-change.docker.test.ts
  - packages/podkit-core/src/metadata/sync-tags.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`features/artwork-change.docker.test.ts:294-318` works around a limitation: a first sync (even with `--check-artwork`) may add tracks *without* writing the artwork-hash baseline, so a separate `--force-sync-tags` pass is needed before artwork-change detection works. The test does the extra pass to establish baselines.

Open question: should the initial add write the artwork-hash baseline so change-detection works on the very next sync, or is deferring it (until `--check-artwork`/`--force-sync-tags`) an intentional cost/perf tradeoff? This affects whether first-run users get artwork-change detection for free. Needs a product/design decision before changing write-baseline timing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decision recorded: when should the artwork-hash baseline be written?
- [ ] #2 If 'on initial add' — implementation task filed and the docker test's force-sync-tags workaround removed
<!-- AC:END -->
