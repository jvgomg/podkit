---
id: TASK-219
title: 'Review and refine PRD: Sync Preview Command'
status: To Do
assignee: []
created_date: '2026-03-23 18:26'
labels:
  - cli
  - ux
  - prd
dependencies: []
documentation:
  - doc-018
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review the draft PRD for the Sync Preview Command (doc-018) and resolve the open design questions. This PRD was created from user testing feedback where a tester had to reimplement transform logic externally to preview clean-artists behavior.

Key decisions to make:
1. **Command location**: top-level `podkit preview`, subcommand `podkit sync preview`, or flag on `collection`
2. **Device-connected vs. not**: what to show in each case, and whether to explicitly communicate what's missing
3. **Scope**: transforms only, or also quality decisions, artwork, planner summary
4. **Transform output**: include all tracks with a flag, or only affected tracks
5. **Device capabilities**: how to design for future integration without blocking on it

The PRD should be refined to a point where it can be broken into implementation tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 5 design questions in doc-018 have documented decisions with rationale
- [ ] #2 PRD status updated from Draft to Ready
- [ ] #3 PRD is detailed enough to break into implementation tasks
<!-- AC:END -->
