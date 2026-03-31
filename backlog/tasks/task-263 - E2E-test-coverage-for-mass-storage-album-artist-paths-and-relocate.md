---
id: TASK-263
title: E2E test coverage for mass-storage album artist paths and relocate
status: To Do
assignee: []
created_date: '2026-03-31 17:45'
labels:
  - testing
  - mass-storage
dependencies: []
references:
  - packages/e2e-tests/src/features/mass-storage-sync.e2e.test.ts
  - packages/podkit-core/src/device/mass-storage-utils.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The album-artist path template and self-healing relocate features (added alongside the albumArtist directory fix) lack E2E test coverage. The unit tests cover the mechanics, but E2E tests should verify the full sync flow on a mass-storage device.

### What to test

1. **Compilation album grouping** — sync a collection with compilation tracks (different `artist`, same `albumArtist` = "Various Artists") to a mass-storage device. Assert all tracks end up in the same `Various Artists/{album}/` directory rather than being scattered across per-artist directories.

2. **Self-healing relocate on metadata change** — sync a track, then change the source's `albumArtist` and re-sync. Assert the file moves to the new directory via relocate (not delete+re-add), the old directory is cleaned up, and the track's audio data is unchanged.

3. **Path template change** — sync tracks with the default template, then open the adapter with a custom `pathTemplate` and re-sync. Assert files are relocated to paths matching the new template.

4. **Featured artist tracks** — sync a track where `artist` = "Artist feat. Guest" and `albumArtist` = "Artist". Assert the directory uses "Artist", not "Artist feat. Guest".

### Context

These scenarios were identified during code review of the album-artist path template implementation. The existing mass-storage E2E tests (`mass-storage-sync.e2e.test.ts`) cover basic sync flow but don't exercise albumArtist-based paths or the relocate mechanism.
<!-- SECTION:DESCRIPTION:END -->
