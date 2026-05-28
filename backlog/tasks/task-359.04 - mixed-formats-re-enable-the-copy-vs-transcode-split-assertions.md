---
id: TASK-359.04
title: 'mixed-formats: re-enable the copy-vs-transcode split assertions'
status: To Do
assignee: []
created_date: '2026-05-28 21:28'
labels:
  - testing
  - e2e
  - test-quality
dependencies: []
references:
  - test-packages/e2e-tests/src/workflows/mixed-formats.test.ts
parent_task_id: TASK-359
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`workflows/mixed-formats.test.ts:68-73` has two commented-out assertions — `plan.tracksToCopy === 2` and `plan.tracksToTranscode === 6` — leaving only the total (`tracksToAdd === 8`) asserted. The copy/transcode split is knowable for that fixture, so it was presumably disabled because the classifier's split was wrong or unstable.

Re-enable the two assertions and run. If they pass, keep them (free coverage of the copy/transcode classification). If they fail, the classifier is mis-splitting copy vs transcode for this fixture — capture that as a production bug (new task) with the observed-vs-expected numbers. Bounded either way.

Also check `workflows/mixed-formats.test.ts:268-272` — `stdout.includes('ogg') || stdout.includes('opus')` lets one of two expected formats go missing; assert both.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The tracksToCopy/tracksToTranscode assertions are re-enabled with the correct exact values, OR a production-bug task is filed with the observed mis-split
- [ ] #2 The ogg/opus OR-assertion is split so both are required
- [ ] #3 Full e2e suite still green (or the prod bug is filed and the assertion left documented)
<!-- AC:END -->
