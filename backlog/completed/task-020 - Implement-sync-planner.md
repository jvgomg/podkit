---
id: TASK-020
title: Implement sync planner
status: Done
assignee: []
created_date: '2026-02-22 19:23'
updated_date: '2026-02-23 00:30'
labels: []
milestone: 'M2: Core Sync (v0.2.0)'
dependencies:
  - TASK-018
references:
  - docs/ARCHITECTURE.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the planner that converts a diff into a sync plan.

**Input:** SyncDiff (from diff engine)
**Output:** SyncPlan with ordered operations

**Operations to plan:**
- transcode: source needs format conversion
- copy: source already iPod-compatible
- remove: track should be removed from iPod (if enabled)

**Planning logic:**
- Check if source format needs transcoding
- Estimate output sizes
- Check available space on iPod
- Order operations sensibly

**Testing requirements:**
- Unit tests for operation planning
- Test transcode vs copy decisions
- Test space calculation
- Test with various input scenarios
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Planner generates correct operations from diff
- [x] #2 Correctly identifies transcode vs copy
- [x] #3 Estimates output sizes
- [x] #4 Checks available iPod space
- [x] #5 Unit tests for planning logic
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Implemented sync planner at `packages/podkit-core/src/sync/planner.ts` with the following features:

### Core Functions
- `createPlan(diff, options)`: Main function that converts SyncDiff to SyncPlan
- `isIPodCompatible(fileType)`: Checks if format can be copied directly (MP3, M4A, AAC, ALAC)
- `requiresTranscoding(fileType)`: Checks if format needs conversion (FLAC, OGG, OPUS, WAV)
- `estimateTranscodedSize(durationMs, bitrateKbps)`: Calculates output size based on bitrate
- `estimateCopySize(track)`: Estimates size for direct copy based on format
- `calculateOperationSize(operation)`: Gets size for any operation type
- `willFitInSpace(plan, availableSpace)`: Validates plan fits on device
- `getPlanSummary(plan)`: Returns counts by operation type

### Planning Logic
1. For each track in `toAdd`:
   - If iPod-compatible (MP3, M4A, AAC, ALAC) -> 'copy' operation
   - If needs transcoding (FLAC, OGG, OPUS, WAV) -> 'transcode' operation
2. For each track in `toRemove` (if removeOrphans enabled):
   - 'remove' operation
3. Operations ordered: removes first, then copies, then transcodes
4. Calculates estimated total size and time

### Size Estimation
- Transcode: `(duration_ms / 1000) * (bitrate_kbps * 1000 / 8) + container_overhead`
- Copy: Uses typical bitrate for format (256kbps for MP3/M4A, 900kbps for ALAC)
- Default duration (when missing): 4 minutes

### Test Coverage
- 180+ test cases covering:
  - Format detection (copy vs transcode)
  - Size estimation accuracy
  - Operation ordering
  - Space validation
  - Edge cases (no duration, empty diff, etc.)

## Code Review (2026-02-23)

**Reviewer:** Claude

### Format Detection - Correct

- **iPod-compatible formats (copy):** MP3, M4A, AAC, ALAC - all correctly identified
- **Transcode-required formats:** FLAC, OGG, OPUS, WAV - all correctly identified
- Clear separation with `isIPodCompatible()` and `requiresTranscoding()` helper functions

### Size Estimation - Reasonable

- **Transcode:** `(duration_ms / 1000) * (bitrate_kbps * 1000 / 8) + 2KB overhead` - mathematically correct
- **Copy:** Uses typical bitrates per format (256kbps for MP3/M4A/AAC, 900kbps for ALAC)
- **Fallback:** 4-minute default duration when track duration is missing
- Reasonable conservative estimates for planning purposes

### Space Validation - Works

- `willFitInSpace(plan, availableSpace)` correctly compares `plan.estimatedSize <= availableSpace`
- Remove operations correctly return 0 size (they free space)
- Time estimation included for UX feedback

### Operation Ordering - Good Strategy

- Order: removes -> copies -> transcodes
- Rationale documented: removes free space first, copies are fast/no CPU, transcodes last (CPU intensive)

### Test Coverage - Comprehensive

- 180+ test cases covering all scenarios
- Format detection (16 tests)
- Size estimation with edge cases
- Operation ordering verification
- Space validation
- Large collection performance (1000 tracks in <100ms)
- Source track reference preservation

### Verification Results

- `bun run typecheck`: PASS (all 7 tasks cached)
- `bun run lint`: PASS (0 warnings, 0 errors)
- `bun run test:unit`: PASS (319 tests, 0 failures)

### Verdict: APPROVED

Implementation is clean, well-documented, and thoroughly tested.
<!-- SECTION:NOTES:END -->
