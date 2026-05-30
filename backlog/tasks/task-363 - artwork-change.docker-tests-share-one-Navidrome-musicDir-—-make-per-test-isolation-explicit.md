---
id: TASK-363
title: >-
  artwork-change.docker tests share one Navidrome musicDir — make per-test
  isolation explicit
status: To Do
assignee: []
created_date: '2026-05-30 15:00'
labels:
  - testing
  - e2e
  - docker
  - test-isolation
dependencies: []
priority: low
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Surfaced by

TASK-359.01 first docker-e2e run failed `expect(syncJson?.result?.completed).toBe(1)` with received: 4.

## Symptom

`test-packages/e2e-tests/src/features/artwork-change.docker.test.ts` declares one `musicDir` and one Navidrome container in `beforeAll`. Three tests run sequentially in that suite:

1. **artwork-updated** — syncs the goldberg fixture, replaces artwork in source, asserts artwork-updated detected.
2. **artwork-removed** — restores goldberg artwork (between-test setup), strips it again, asserts artwork-removed detected.
3. **artwork-added** — copies a dual-tone track into the same musicDir, asserts artwork-added detected for the new track.

The iPod target is fresh per test (`withTarget`), but the Subsonic library is shared. When the artwork-added test does its initial sync to verify the dual-tone is present, the iPod also receives the 3 goldberg tracks still in the library — so `completed` is 4, not 1.

This made the test's "initial sync count" assertion permanently fuzzy and forced TASK-359.01 to revert that assertion to a loose `>= 1` with a comment.

## Why it matters

- Order-dependent test counts hide real regressions (a goldberg track silently disappearing wouldn't fail any assertion).
- The shared library means "artwork-added detection" tests are entangled with whatever state earlier tests left behind.
- The artwork-added test's `breakdown['artwork-added'] === 1` works *only because* the engine doesn't see artwork changes on goldberg between syncs. If the artwork-updated test left goldberg in a half-modified state, the next test's breakdown would silently include it.

## Options

1. **Per-test Navidrome.** Each `it` block creates its own `SubsonicTestSource`. Higher container startup cost but full isolation.
2. **Per-test subfolder under one musicDir.** Each test gets `<musicDir>/<testname>/...` and only its own subfolder is populated. One container, but tests see only their own files. Requires Subsonic config or library scoping to point at the subfolder.
3. **Explicit cleanup between tests.** `afterEach` removes everything except a known base set, then restarts Navidrome. Closest to current shape; brittle.

Option 2 is the cleanest if Subsonic supports scoping; otherwise option 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each test in `artwork-change.docker.test.ts` sees only its own fixture set in the Subsonic library.
- [ ] #2 Test order does not affect any assertion in the suite.
- [ ] #3 The artwork-added test's initial-sync `completed` count can be asserted exactly (`=== 1`) without a justifying-range comment.
<!-- AC:END -->
