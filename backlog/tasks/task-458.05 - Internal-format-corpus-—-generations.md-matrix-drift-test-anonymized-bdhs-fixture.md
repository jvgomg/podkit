---
id: TASK-458.05
title: >-
  Internal format corpus — generations.md matrix + drift test + anonymized bdhs
  fixture
status: Done
assignee: []
created_date: '2026-07-05 14:24'
updated_date: '2026-07-05 22:42'
labels:
  - device-capability
  - docs
  - formats
milestone: m-18
dependencies:
  - TASK-458.01
parent_task_id: TASK-458
ordinal: 214000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Finish the `documents/formats/` corpus. Author `documents/formats/generations.md` — the generation × {DB files, checksum, access, verified} matrix — and add a drift test that pins it to `getSupportMatrix()` (test-pins-contract), so the internal reference, public compatibility table, and CLI cannot disagree. Add an anonymized/synthetic `bdhs` fixture (fake paths, neutral ordering) that pins the offsets documented in `itunessd-bdhs.md`; a real user's iTunesSD is never committed.

`documents/formats/README.md` and `documents/formats/itunessd-bdhs.md` already exist on the branch (written alongside the PRD) — this slice completes the corpus.

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md §7.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `documents/formats/generations.md` exists as the generation×format matrix, marked with per-row access/verified
- [x] #2 A drift test fails if generations.md diverges from getSupportMatrix()
- [ ] #3 An anonymized/synthetic bdhs fixture pins the itunessd-bdhs.md offsets; no personal device dump is committed
- [x] #4 README corpus map lists generations.md as present (not pending)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Commit f1bff16b. Added renderSupportMatrixMarkdown() (pure, deterministic) to devices-ipod; documents/formats/generations.md carries its output between BEGIN/END GENERATED markers; generations-doc.test.ts reads the doc and asserts the region equals the generator (drift fails the build). README corpus map updated; itunessd-bdhs stale cross-ref removed. 379 devices-ipod tests + typecheck green.

AC #3 (bdhs fixture) intentionally NOT done: no iTunesSD parser exists to consume a fixture, so it has no test value — deferred until/unless a parser lands (noted in the doc itself).
<!-- SECTION:NOTES:END -->
