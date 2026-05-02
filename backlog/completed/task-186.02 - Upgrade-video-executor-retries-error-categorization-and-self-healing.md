---
id: TASK-186.02
title: 'Upgrade video executor: retries, error categorization, and self-healing'
status: Done
assignee: []
created_date: '2026-03-21 23:19'
updated_date: '2026-03-22 11:23'
labels:
  - enhancement
  - video
dependencies:
  - TASK-186.01
references:
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/sync/video-executor.ts
  - packages/podkit-core/src/sync/differ.ts
  - packages/podkit-core/src/sync/video-differ.ts
  - packages/podkit-core/src/sync/types.ts
  - packages/podkit-core/src/sync/video-planner.ts
documentation:
  - doc-010
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Goal:** Bring the video executor to feature parity with the music executor in three areas: error categorization, retry logic, and self-healing upgrades. This closes the gap between the two implementations before unification, making the eventual merge much simpler.

**Depends on:** TASK-186.01 (unified ExecuteResult with CategorizedError[], unified ExecutorProgress)

---

### Part A: Error Categorization

**Current state:** The video executor (video-executor.ts) uses simple `try/catch` with `errors: Array<{ operation, error }>`. The music executor has a sophisticated `categorizeError()` function that classifies errors into categories: `'transcode' | 'copy' | 'database' | 'artwork' | 'unknown'`.

**What to do:**
1. The music executor's `categorizeError()` function in `executor.ts` (~line 130) classifies errors by inspecting error messages. Extract this into a shared utility in a new file `packages/podkit-core/src/sync/error-handling.ts` (or similar).
2. Add video-specific error patterns to the categorizer (e.g., video transcode failures may have different FFmpeg error messages than audio).
3. Update `DefaultVideoSyncExecutor.execute()` to wrap each operation's catch block with `categorizeError()` and produce `CategorizedError[]` in the result.
4. After TASK-186.01, the video executor already uses the unified `ExecuteResult` type with `CategorizedError[]` — this task fills in the actual categorization logic.

**Key reference:** Read `executor.ts` lines ~120-180 for the existing `categorizeError()`, `CategorizedError`, and `ErrorCategory` types.

---

### Part B: Retry Logic

**Current state:** The music executor has `RetryConfig` with per-category retry counts and exponential backoff delay. The video executor has no retry support at all — a single failure skips the operation.

**What to do:**
1. Extract the retry logic from the music executor into the shared `error-handling.ts` module. The core pattern is:
   - On failure, categorize the error
   - Check if retries remain for that category
   - If yes, wait (with backoff) and re-attempt
   - If no, record the categorized error and continue (if `continueOnError`)
2. The retry utility should be generic — it takes an async operation function and a `RetryConfig`, returns the result or a `CategorizedError`.
3. Apply this retry utility in the video executor's operation loop. Use the same default retry config as music (or a video-specific one if video failures have different retry characteristics — e.g., video transcodes are expensive so maybe fewer retries for transcode category).
4. Wire the `retryAttempt` field in the unified `ExecutorProgress` so the CLI can display retry status for video operations.

**Key reference:** Read `executor.ts` for `RetryConfig` type (~line 90), retry logic in the pipeline's prepare stage.

---

### Part C: Self-Healing Upgrades

**Current state:** The music differ detects several upgrade scenarios via `detectUpgrade()` in `differ.ts` (~line 400):
- `format-upgrade`: source was re-encoded to a better format
- `quality-upgrade`: source quality improved (e.g., 128kbps → 320kbps)
- `preset-upgrade` / `preset-downgrade`: user changed their quality preset
- `artwork-changed`: album artwork differs from what's on the iPod
- `metadata-correction`: source metadata was updated (tags fixed)

The video differ has **none of this**. It only handles preset changes via `toReplace` (remove + re-add), and has `toUpdate` for metadata-only changes. There is no concept of detecting that a video source file was re-encoded or improved.

**What to do:**
1. Add upgrade detection to the video differ (`video-differ.ts`). For videos, the relevant upgrade scenarios are:
   - **`preset-change`**: Already handled via `toReplace`, but should be migrated to use the same `toUpdate` + `UpgradeReason` pattern as music (eliminating the `toReplace` field). This means video preset changes become upgrade operations rather than remove+re-add pairs.
   - **`quality-upgrade`**: Detect when the source video has higher quality than what's on the iPod (e.g., source was replaced with a higher bitrate version). Compare source file size or probe bitrate against the iPod copy's bitrate stored in sync tags.
   - **`metadata-correction`**: Already partially handled via `toUpdate` with `VideoUpdateReason`. Ensure it covers all metadata fields (title, series title, season, episode, year).
2. Add a `video-upgrade` operation type to the `SyncOperation` union in `types.ts`, mirroring the music `upgrade` type:
   ```typescript
   { type: 'video-upgrade'; source: CollectionVideo; target: IPodVideo; reason: UpgradeReason; settings?: VideoTranscodeSettings }
   ```
3. Update the video planner to create `video-upgrade` operations from `toUpdate` items that have upgrade reasons (similar to `planUpdateOperations()` in the music planner).
4. Update the video executor to handle `video-upgrade` operations: remove the old iPod track, transcode/copy the new source, add to iPod.
5. Eliminate `toReplace` from `VideoSyncDiff` — preset changes flow through the upgrade mechanism instead.

**Key references:**
- `differ.ts` ~line 400: `detectUpgrade()` function
- `differ.ts` ~line 320: `categorizeExistingTrack()` which routes to upgrade detection
- `video-differ.ts` ~line 200: `categorizeExistingVideo()` — this is where upgrade detection should be added
- `types.ts` ~line 177: `SyncOperation` union where `video-upgrade` should be added
- `video-planner.ts` ~line 300: `planReplaceOperations()` — this should be replaced by upgrade planning

**Testing:**
- Run `bun run test --filter podkit-core` for unit tests
- Existing video differ tests should be updated to cover upgrade scenarios
- Add test cases: video source replaced with higher quality, video preset changed, video metadata corrected
- Test retry behavior: mock a transient failure and verify the operation is retried
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Video executor categorizes errors using the same ErrorCategory system as music
- [x] #2 Video executor retries failed operations with configurable per-category retry counts and backoff
- [x] #3 The toReplace field is eliminated from VideoSyncDiff — preset changes use the upgrade path
- [x] #4 A video-upgrade operation type exists in the SyncOperation union and is handled by the video executor
- [x] #5 Error categorization and retry logic are extracted into a shared module usable by both executors
- [x] #6 New test cases cover: video upgrade detection, retry on transient failure, error categorization for video operations
- [x] #7 Video differ detects preset-change (via sync tags) and metadata-correction scenarios, routing preset changes through an upgrade mechanism (not remove+re-add)
- [x] #8 Video transcode failures are NOT retried — only copy/database failures are retried. Error output clearly indicates partial sync and that re-running will resume.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Design Decisions (2026-03-21)

**Video quality-upgrade detection:** We are NOT implementing bitrate-based quality-upgrade detection for video. Unlike music, detecting video quality changes requires probing source files (expensive FFprobe call per matched video). Instead, we rely solely on sync tags for preset-change detection. Document this limitation in code comments.

**Video retry policy:** Video transcodes are NOT retried. Only copy and database operation failures are retried. Rationale: video transcodes are expensive (minutes per file), and users should see failures clearly so they know to run sync again. The error reporting should make it obvious that partial data was synced and a re-run will pick up where it left off.

**Self-healing scope for video:** Limited to preset-change (via sync tags) and metadata-correction. No format-upgrade or quality-upgrade detection.
<!-- SECTION:NOTES:END -->
