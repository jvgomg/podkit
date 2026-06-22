---
id: TASK-431.09
title: Full happy-path + e2e smoke (default both-stage run)
status: To Do
assignee: []
created_date: '2026-06-22 11:03'
labels:
  - feature
  - ipod
  - archive
  - e2e
dependencies:
  - TASK-431.01
  - TASK-431.03
  - TASK-431.04
  - TASK-431.05
  - TASK-431.06
  - TASK-431.07
  - TASK-431.08
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 163000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final integration slice. Wire the default `podkit device archive` happy path to run both stages in sequence (dump → transform) producing the complete archive directory (`raw dump/` + archive tree + library.sqlite + Playlists + README + report). Add an end-to-end smoke test running the command against a dummy/fixture iPod, plus a `--from-dump` run against a fixture dump, asserting the top-level structure, README presence, and report contents. Confirm the thin-CLI / deep-package boundary holds (command logic is delegated, not embedded).

Spec: doc-047 (orchestrators runDump/runTransform; testing — e2e smoke; stories 31-32).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Default `podkit device archive` runs dump then transform, producing the full archive in one invocation
- [ ] #2 E2E smoke passes against a dummy/fixture iPod and a `--from-dump` fixture dump
- [ ] #3 Top-level archive structure, README, and report asserted by the e2e test
- [ ] #4 CLI command remains a thin shell delegating to @podkit/ipod-archive
<!-- AC:END -->
