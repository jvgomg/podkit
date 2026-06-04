---
id: TASK-383
title: 'Refactor pipeline.ts: extract artwork module + music/video symmetry pass'
status: To Do
assignee: []
created_date: '2026-06-04 08:05'
labels:
  - enhancement
  - refactor
  - music-pipeline
  - video-pipeline
  - code-quality
dependencies:
  - TASK-372
references:
  - packages/podkit-core/src/sync/music/pipeline.ts
  - packages/podkit-core/src/sync/video/
  - packages/podkit-core/src/sync/engine/error-handling.ts
priority: medium
ordinal: 109000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`packages/podkit-core/src/sync/music/pipeline.ts` is 2,500+ lines after TASK-370 / TASK-372 / TASK-142 landed. The video pipeline (`sync/video/`) is split across smaller modules:

```
sync/music/        sync/video/
  pipeline.ts        executor.ts (168)
  handler.ts         handler.ts (864)
                     planner.ts (154)
                     types.ts (169)
```

The music side has 6,795 LOC across music+video sync; the music pipeline alone is the heaviest single file in the project's runtime path. The video side proves out a more granular shape that the music side could adopt.

## Scope

1. **Extract `sync/music/artwork.ts`** (~400 LOC) from `pipeline.ts`:
   - `transferArtwork`, `buildAdapterFallback`, `getResizedArtwork`
   - `albumCandidates` map + `buildAlbumCandidates`
   - `resizedArtworkCache` + the artwork sink dispatch
   - The album-cache helper lives here, called from the pipeline's transfer steps

2. **Look for symmetry with video.** Read `sync/video/handler.ts` + `executor.ts`. Identify shapes that the music side could borrow:
   - Does video have its own `transferArtwork` equivalent (probably no — video doesn't carry album-style art)?
   - Operation dispatch shape: video's `handleVideoOperation` vs music's `executePipeline`. Are there per-op handler functions in video that music could mirror?
   - Error categorisation: do video errors flow through the same `error-handling.ts` categorizer? If so, are the categories aligned?
   - Progress event shape: are `ExecutorProgress` events identical across music + video? If divergent, why?

3. **Identify dedup opportunities** between music + video:
   - Free-space probe (TASK-378) should be shared.
   - Save-failure handling (TASK-380) should sweep both.
   - Both pipelines spawn FFmpeg processes — is the transcoder wrapper unified?

4. **Likely splits** (preliminary, will be refined during implementation):
   - `sync/music/artwork.ts` — artwork concerns
   - `sync/music/transfer.ts` — `transferToIpod`, `transferUpgradeToIpod` (still big enough to live alone after artwork extracts)
   - `sync/music/pipeline.ts` shrinks to the executor entry + the 3-stage prefetch/prepare/consumer loop + the small `executeRemove`/`executeUpdateMetadata`/`executeUpdateSyncTag`/`executeRelocate` inline handlers

## Concerns to address

- TASK-38 (ExecutionContext refactor) touches the same surface. Either land first then refactor (likely cleaner) or land together (riskier but one PR for the executor surface).
- `transferToIpod` and `transferUpgradeToIpod` share artwork-handling logic that's currently duplicated (`extractedHash !== undefined ? source.artworkHash ?? extractedHash : undefined` pattern across 3+ call sites). A small `resolveSyncTagArtHash(extractedHash, source)` helper would DRY these.

## Acceptance criteria

- `pipeline.ts` drops below 1,500 LOC.
- `sync/music/artwork.ts` exists with a focused public API.
- Music + video sync errors classify through a shared categorizer (or the divergence is documented as intentional).
- No behaviour changes — all existing tests green; matrix counts unchanged.

## Reference

- Items 1, 2 from the post-team-lead retro (doc-041 follow-ups discussion 2026-06-04).
- `sync/video/` for the symmetric shape to aim at.
<!-- SECTION:DESCRIPTION:END -->
