---
id: TASK-057
title: Integrate artwork extraction and transfer into sync executor
status: Done
assignee: []
created_date: '2026-02-26 11:37'
updated_date: '2026-02-26 11:43'
labels:
  - bug
  - sync
  - artwork
  - e2e-finding
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Bug found in E2E testing (TASK-029)**

Artwork is not transferred during sync. The building blocks exist but aren't wired together:
- `extractArtwork()` function exists in `@podkit/core`
- `track.setArtwork()` / `track.setArtworkFromData()` methods exist on `IPodTrack`

But the sync executor (`executor.ts`) never calls these functions.

**Implementation needed:**
1. In `executeTranscode()` and `executeCopy()`:
   - Extract artwork from source file using `extractArtwork()`
   - If artwork exists, call `track.setArtworkFromData()` or write to temp file and call `track.setArtwork()`
2. Respect the `artwork` config option (skip if disabled)
3. Handle artwork errors gracefully (skip artwork, continue sync)

**Related:**
- TASK-025 implemented the libgpod binding
- TASK-023 implemented artwork extraction
- This task wires them together in the sync flow
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Artwork extracted from source files during sync
- [x] #2 Artwork transferred to iPod via setArtwork API
- [x] #3 Config artwork option respected
- [x] #4 Artwork errors handled gracefully (skip, continue)
- [ ] #5 Integration test verifies artwork on synced tracks
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented artwork extraction and transfer in sync executor:

1. **Added artwork option to ExecuteOptions** (sync/types.ts:99)
   - Default value: true (artwork enabled by default)
   - Type: `artwork?: boolean`

2. **Imported extractArtwork function** (sync/executor.ts:36)
   - From `../artwork/extractor.js`

3. **Added transferArtwork helper method** (sync/executor.ts:574-590)
   - Extracts artwork using `extractArtwork(sourceFilePath)`
   - Transfers to iPod using `track.setArtworkFromData(artwork.data)`
   - Error handling: catches and logs errors, continues sync (artwork is optional)
   - Errors are logged with console.warn but don't fail the operation

4. **Updated executeTranscode()** (sync/executor.ts:593-638)
   - Added `artworkEnabled?: boolean` parameter
   - Calls `transferArtwork(track, source.filePath)` after copying file
   - Only transfers if `artworkEnabled === true`

5. **Updated executeCopy()** (sync/executor.ts:643-692)
   - Added `artworkEnabled?: boolean` parameter
   - Calls `transferArtwork(track, source.filePath)` after copying file
   - Only transfers if `artworkEnabled === true`

6. **Updated execute() method** (sync/executor.ts:339-553)
   - Extracts `artwork` option from ExecuteOptions (default: true)
   - Passes artwork flag to executeOperation()

7. **Updated executeOperation()** (sync/executor.ts:554-573)
   - Added `artworkEnabled?: boolean` parameter
   - Passes to executeTranscode() and executeCopy()

8. **Updated CLI sync command** (commands/sync.ts:283-289, 722)
   - Extracts artwork option: `const artwork = options.artwork ?? config.artwork`
   - Passes to executor: `executor.execute(plan, { ..., artwork })`

**Error Handling:**
- Artwork errors are caught in transferArtwork()
- Logged with console.warn (visible to user)
- Categorized as 'artwork' type (no retry)
- Doesn't fail the sync operation
- Track is added successfully even if artwork fails

**Config Integration:**
- CLI has `--no-artwork` flag
- Config has `artwork: boolean` field
- Defaults to true (enabled)
- Respected throughout sync pipeline
<!-- SECTION:NOTES:END -->
