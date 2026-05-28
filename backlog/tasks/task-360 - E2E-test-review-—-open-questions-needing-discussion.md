---
id: TASK-360
title: E2E test review — open questions needing discussion
status: To Do
assignee: []
created_date: '2026-05-28 21:27'
labels:
  - testing
  - e2e
  - needs-discussion
dependencies: []
references:
  - agents/testing.md
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
priority: medium
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-356.04 we reviewed every non-matrix e2e test for captured bugs and assertion quality. This umbrella collects the findings that surfaced **podkit behaviours with design uncertainty** — places where a test froze a limitation or surprising behaviour, but the *right* fix needs a product/design decision before a developer can act. These are for collaboration, not immediate implementation.

Subtasks are status "Draft" = not ready to implement; each needs a decision on intended behaviour first. Once resolved, promote to "To Do" (and likely move the fix into the relevant package, plus tighten the e2e test that froze the old behaviour).
<!-- SECTION:DESCRIPTION:END -->
