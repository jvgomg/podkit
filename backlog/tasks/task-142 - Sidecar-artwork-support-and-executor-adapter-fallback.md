---
id: TASK-142
title: Sidecar artwork support and executor adapter fallback
status: To Do
assignee: []
created_date: '2026-03-17 14:58'
labels:
  - enhancement
  - artwork
  - subsonic
  - directory-adapter
dependencies:
  - TASK-141
references:
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/adapters/interface.ts
  - packages/podkit-core/src/artwork/extractor.ts
  - packages/podkit-core/src/adapters/directory.ts
  - test/fixtures/audio/multi-format/generate.sh
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Two artwork gaps remain after TASK-141 Phase 1 (Subsonic artwork presence detection):

### 1. Executor doesn't fall back to adapter artwork

When the executor downloads a Subsonic track and `extractArtwork()` returns null (no embedded artwork), it gives up. If the artwork exists on the server but isn't embedded in the audio file (e.g., sidecar artwork served by Navidrome via getCoverArt), it's never transferred to the iPod.

**Fix:** Add a `getArtwork(track): Promise<Buffer | null>` method to the adapter interface. When `extractArtwork()` returns null during sync, the executor falls back to fetching artwork from the adapter.

### 2. Directory sidecar files (cover.jpg) not detected

When a directory has `cover.jpg`/`folder.jpg` alongside audio files but no embedded artwork:
- Directory adapter reports `hasArtwork: false` (only checks embedded)
- Users expect sidecar artwork to be detected and transferred

**Fix:** Add sidecar file detection to the directory adapter. Check for cover.jpg, folder.jpg, cover.png, folder.png in the track's directory. Set `hasArtwork: true` when a sidecar exists.

## Notes

- The test fixture `test/fixtures/audio/multi-format/generate.sh` has cover.jpg creation commented out pending this work
- The executor's `transferArtwork()` in `packages/podkit-core/src/sync/executor.ts` is the integration point for the adapter fallback
- The adapter interface is at `packages/podkit-core/src/adapters/interface.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Executor falls back to adapter getArtwork() when extractArtwork() returns null
- [ ] #2 Directory adapter detects sidecar artwork files (cover.jpg, folder.jpg, cover.png, folder.png)
- [ ] #3 Directory adapter sets hasArtwork=true when sidecar exists even if no embedded artwork
- [ ] #4 Integration tests for executor adapter fallback
- [ ] #5 Integration tests for directory sidecar detection
- [ ] #6 test/fixtures/audio/multi-format/generate.sh cover.jpg creation uncommented
<!-- AC:END -->
