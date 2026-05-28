---
id: TASK-359
title: E2E test review — clear fixes (test hardening + defined issues)
status: To Do
assignee: []
created_date: '2026-05-28 21:27'
labels:
  - testing
  - e2e
  - test-quality
dependencies: []
references:
  - agents/testing.md
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
priority: medium
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-356.04 we reviewed every non-matrix e2e test for captured bugs and assertion quality. This umbrella collects the **clearly-defined** follow-ups — issues where *what to do* is unambiguous and a developer can pick them up directly (mostly test-quality hardening, plus one well-scoped investigation). The findings with design uncertainty live under the sibling "open questions" umbrella (Draft).

Theme: many e2e tests assert loosely (`>= N` / `> 0` where the fixture count is exact), guard assertions behind `if (json?.plan)` / `if (existsSync)` (so missing data passes silently), swallow probe errors in try/catch (so a broken ffprobe reads as "no artwork"), or are hollow (assert nothing about their stated subject). These let real regressions pass green — the opposite of the visible-bug-skip philosophy in agents/testing.md §"Test skip anti-patterns".

Subtasks are status "To Do" = ready for a developer.

(Not tasked — working-as-intended: eject failing on the dummy iPod target is a test-environment limitation, tolerated deliberately.)
<!-- SECTION:DESCRIPTION:END -->
