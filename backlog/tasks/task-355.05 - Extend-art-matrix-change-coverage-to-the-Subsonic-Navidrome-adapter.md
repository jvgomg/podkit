---
id: TASK-355.05
title: Extend art-matrix-change coverage to the Subsonic / Navidrome adapter
status: To Do
assignee: []
created_date: '2026-05-26 22:50'
labels:
  - enhancement
  - artwork
  - testing
  - subsonic
dependencies: []
references:
  - test-packages/e2e-tests/src/sources/subsonic.ts
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
parent_task_id: TASK-355
priority: low
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`art-matrix-change.test.ts` covers artwork-change detection for the directory adapter only — it mutates files on disk between syncs and observes whether podkit detects the cover swap. The Subsonic adapter is not yet covered.

The reason for the gap: changing a file served by Navidrome requires rewriting the file on disk *and* triggering a Navidrome library rescan, then waiting for re-index to complete. None of that plumbing exists in `test-packages/e2e-tests/src/sources/subsonic.ts` today.

## What's needed

1. Add a `mutateLibrary(fn): Promise<void>` method (or similar) to `SubsonicTestSource` that:
   - Rewrites files inside the mounted music directory.
   - Triggers a Navidrome scan (`POST /rest/startScan` or equivalent).
   - Polls Navidrome until the scan completes and the new artwork hashes are observable.

2. Add `art-matrix-change.docker.test.ts` mirroring the host file. Expected behaviour, before TASK-355.02 lands:

   - With `--check-artwork`: artwork-updated should fire for embed-capable formats (same as host).
   - Without `--check-artwork`: cover-swap is silently missed (same as host).

   After TASK-355.02 lands the predictions may diverge — coordinate with that task's outcome.

3. Reuse the same `multi-format-embedded` / `multi-format-embedded-alt` fixture pair the host matrix uses.

## Definition of done

- New file: `test-packages/e2e-tests/src/features/art-matrix-change.docker.test.ts`.
- `SubsonicTestSource` learns to mutate + rescan.
- 16 cells (8 formats × 2 flag values) green.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SubsonicTestSource supports mutating files behind Navidrome and waiting for rescan
- [ ] #2 art-matrix-change.docker.test.ts file created and green
- [ ] #3 Coverage matches art-matrix-change.test.ts (same axes, same fixtures)
<!-- AC:END -->
