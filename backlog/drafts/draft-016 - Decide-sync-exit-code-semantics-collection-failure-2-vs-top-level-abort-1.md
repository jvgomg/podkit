---
id: DRAFT-016
title: 'Decide sync exit-code semantics: collection failure (2) vs top-level abort (1)'
status: Draft
assignee: []
created_date: '2026-06-23 20:23'
labels:
  - sync
  - cli
  - decision
dependencies: []
references:
  - test-packages/e2e-tests/src/workflows/playlist-scoped-sync.docker.test.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Decision task surfaced by task-434.05 e2e work.**

`podkit sync` exit codes are currently asymmetric:
- A collection-level failure (e.g. missing playlist → PlaylistNotFoundError caught per-collection) sets `anyError` and exits **2** (partial failure).
- A top-level CliError (e.g. the empty-playlist guard's EMPTY_PLAYLIST_ABORT) exits **1**.

A consumer automating on exit codes cannot cleanly distinguish "one collection failed" (2) from "the run refused to proceed / aborted" (1) under standard UNIX semantics. The empty-playlist abort is arguably a top-level refusal (1 is defensible), and missing-playlist is arguably also an abort-before-transfer that some might expect to behave like the guard.

This is a **decision**, not an obvious fix: confirm whether the 1 vs 2 split is intentional and document it, OR unify the semantics. Either way, pin the expected exit codes in a code comment and in the e2e tests (the 434.05 test currently asserts only "non-zero" for the missing-playlist case to avoid over-coupling to the asymmetry).

Draft until the team decides the intended contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Documented decision on whether exit 1 (abort) vs 2 (partial failure) is intentional
- [ ] #2 Exit-code contract recorded in a code comment near the exit-code assignment in runSync
- [ ] #3 e2e tests pin the agreed exit codes explicitly
<!-- AC:END -->
