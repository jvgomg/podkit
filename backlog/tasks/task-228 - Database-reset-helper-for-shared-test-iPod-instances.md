---
id: TASK-228
title: Database reset helper for shared test iPod instances
status: Done
assignee: []
created_date: '2026-03-23 20:33'
updated_date: '2026-05-02 11:40'
labels:
  - testing
  - performance
milestone: Test Suite Performance
dependencies: []
documentation:
  - backlog/documents/doc-021 - Test Suite Performance Plan.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a `resetDatabase()` function to `@podkit/gpod-testing` that clears all tracks, playlists, and artwork from an existing iPod database without re-creating the directory structure. This enables safe iPod sharing between tests within the same file.

## Context

After template directories make iPod creation fast, the next optimisation is reducing the number of creations. Currently each test creates its own iPod via `withTestIpod`. To share a single iPod across tests in a file, we need a way to reset the database to a clean state between tests.

## Approach

Implement using libgpod-node's `Database` API directly (no subprocess needed):
- Open the database
- Remove all tracks (which removes files from iPod_Control/Music/)
- Remove all playlists (except the master playlist)
- Remove all artwork
- Save and close

Alternatively, a `gpod-tool reset` command could be added, but the libgpod-node approach avoids subprocess overhead entirely.

Export the function from `@podkit/gpod-testing` as `resetTestIpod(ipodPath)` or similar.

## Key files

- `packages/gpod-testing/src/test-ipod.ts` — add the reset function here
- `packages/libgpod-node/src/index.ts` — Database API used for implementation

## Reference

See doc-021 (Test Suite Performance Plan), opportunity #4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 resetTestIpod(path) removes all tracks, playlists (except master), and artwork from the database
- [ ] #2 Removes copied track files from iPod_Control/Music/
- [ ] #3 Database is in a valid state after reset (gpod-tool verify passes)
- [ ] #4 Function is exported from @podkit/gpod-testing
- [ ] #5 Integration test verifying reset works correctly (add tracks, reset, verify empty)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Closed without implementation — superseded by TASK-227 + bulk addTracks

This task was Phase 1 of doc-021's plan to enable Phase 2 (TASK-229 / TASK-230 — shared iPod instances per test file). After completing TASK-227 (template fast-path) and adding `gpod-tool add-tracks` (bulk add helper), the cost model that made shared instances worthwhile no longer holds:

- Per-iPod creation: ~5ms via `fs.cp` from a template (was ~300ms)
- Per-multi-track setup: ~150ms total via bulk `addTracks` (was ~150ms × N)

A reset helper would save ~5ms per test by reusing an iPod instead of re-copying a template — across the whole suite that's ~3s of theoretical savings, and it would require auditing 580+ tests for state-leak risks between sharing.

The reset helper is also non-trivial to build correctly (must clear tracks, playlists, artwork, copied files, and leave the database in a state that exactly matches a fresh template — tricky for hash72 models with HashInfo). The implementation effort is disproportionate to the benefit.

Profiling after templates+bulk shows the remaining 31s wall-clock is dominated by real I/O work (libgpod `saveSync` / `openSync` cycles) inside test bodies, not by setup overhead. See TASK-227 final summary for the A/B benchmark.

If a future need for shared instances arises (e.g., test suite grows to 5000+ tests), reopen this. For now: not worth the refactor risk.
<!-- SECTION:FINAL_SUMMARY:END -->
