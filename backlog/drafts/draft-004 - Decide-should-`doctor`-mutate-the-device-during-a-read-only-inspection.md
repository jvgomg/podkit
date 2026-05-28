---
id: DRAFT-004
title: 'Decide: should `doctor` mutate the device during a read-only inspection?'
status: Draft
assignee: []
created_date: '2026-05-28 21:28'
labels:
  - needs-discussion
  - doctor
  - libgpod
dependencies: []
references:
  - test-packages/e2e-tests/src/commands/doctor.test.ts
  - packages/libgpod-node/src/index.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`commands/doctor.test.ts:211-244` documents that libgpod initialises/rewrites an empty ArtworkDB during `IpodDatabase.open()` — so running the `doctor` health check (which only inspects) actually writes to the device. The test accepts this (`['skip','pass']`, "may rewrite the empty file ... producing a valid-but-empty ArtworkDB").

Open question: a diagnostic/health command is expected to be read-only. Is this acceptable (unavoidable libgpod-on-open behaviour, harmless), or should `doctor` open the DB in a read-only / no-write-back mode? Needs a decision on the intended read-only contract before any fix.

If we decide it should be read-only: investigate whether libgpod can open without the ArtworkDB rewrite, and tighten the e2e test from `['skip','pass']` to assert no device mutation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decision recorded: is doctor required to be non-mutating?
- [ ] #2 If yes — follow-up implementation task filed with the read-only approach and a tightened test
<!-- AC:END -->
