---
id: TASK-166.03
title: Interactive migration support
status: Done
assignee: []
created_date: '2026-03-19 14:42'
updated_date: '2026-03-19 15:29'
labels:
  - config
  - cli
milestone: Config Migration Wizard
dependencies:
  - TASK-166.02
references:
  - doc-006
parent_task_id: TASK-166
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the migration engine to support interactive migrations that prompt users for decisions. See PRD: doc-006.

**Behaviour:**
- Migration interface extended: migrations declare whether they are automatic or interactive.
- Interactive migrations receive a context object with utilities for:
  - Prompting the user (yes/no, choice from list, free text input)
  - Scanning directories (reusing existing adapters like VideoDirectoryAdapter)
  - Reading the filesystem
- The wizard walks through prompts step by step. Users can abort at any point — aborting leaves the config file unmodified.
- The summary/confirmation step from the engine (slice 2) still applies after all interactive decisions are made — user sees the final result before writing.
- Replace the trivial test migration from slice 2 with a more realistic interactive example that exercises the prompt utilities. This example will later be replaced by the real video split migration (doc-007).

**User stories covered:** 4, 14, 15
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration interface extended with automatic/interactive discriminator
- [x] #2 Migration context object provides prompt utilities: yes/no, choice, text input
- [x] #3 Migration context object provides filesystem utilities: directory scanning, file reading
- [x] #4 Aborting an interactive migration at any prompt leaves the config file unmodified
- [ ] #5 Interactive example migration exercises all prompt types and directory scanning
- [x] #6 Unit tests: context prompt utilities return expected values with mocked input
- [x] #7 Unit tests: abort during interactive migration produces no file changes
- [ ] #8 Integration test: interactive migration prompts user, collects answers, produces correct output
<!-- AC:END -->
