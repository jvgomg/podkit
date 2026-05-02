---
id: TASK-197
title: New operation types and planner decision logic
status: Done
assignee: []
created_date: '2026-03-23 14:07'
updated_date: '2026-03-23 16:25'
labels:
  - feature
  - core
  - sync
milestone: 'Transfer Mode: iPod Support'
dependencies:
  - TASK-195
  - TASK-196
references:
  - packages/podkit-core/src/sync/music-planner.ts
  - packages/podkit-core/src/sync/types.ts
  - packages/podkit-core/src/sync/music-differ.ts
documentation:
  - backlog/docs/doc-014 - Spec--Operation-Types-&-Sync-Tags.md
  - backlog/docs/doc-012 - Spec--Transfer-Mode-Behavior-Matrix.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the planner's overloaded `copy`/`transcode`/`upgrade` operation types with explicit, granular types that distinguish between direct-copy, optimized-copy, and transcode paths. Update planner decision logic to route based on source category + transferMode + device capabilities.

**PRD:** DOC-011 (Transfer Mode)
**Spec:** DOC-014 (Operation Types & Sync Tags)

**New operation types:**
- Add: `add-direct-copy`, `add-optimized-copy`, `add-transcode`
- Update: `upgrade-direct-copy`, `upgrade-optimized-copy`, `upgrade-transcode`
- `upgrade-artwork`, `update-metadata`, `remove` unchanged

**Planner decision flow:**
1. Categorize source (lossless / compatible-lossy / incompatible-lossy) — existing logic
2. Determine if transcode is needed (category + device codec support + quality preset) — existing logic adapted to use DeviceCapabilities
3. If transcode needed → `add-transcode` / `upgrade-transcode`
4. If copy path: check transferMode
   - `'optimized'` → `add-optimized-copy` / `upgrade-optimized-copy`
   - `'fast'` or `'portable'` → `add-direct-copy` / `upgrade-direct-copy`

**One-operation-per-track rule:**
When the differ produces multiple reasons for the same track (e.g., source-changed + artwork-updated), the planner collapses them into one operation. Priority: file replacement > artwork-only > metadata-only.

**planAddOperations changes:**
- `createCopyOperation()` → `createDirectCopyOperation()` or `createOptimizedCopyOperation()` based on transferMode
- `createTranscodeOperation()` unchanged but produces `add-transcode` type

**planUpdateOperations changes:**
- Same routing logic for upgrade variants
- `upgrade` type with optional preset → explicit `upgrade-direct-copy` / `upgrade-optimized-copy` / `upgrade-transcode`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New operation type definitions: add-direct-copy, add-optimized-copy, add-transcode, upgrade-direct-copy, upgrade-optimized-copy, upgrade-transcode
- [x] #2 Planner routes copy-format files to add-optimized-copy when transferMode is 'optimized'
- [x] #3 Planner routes copy-format files to add-direct-copy when transferMode is 'fast' or 'portable'
- [x] #4 ALAC→ALAC copy routing respects transferMode (direct-copy in fast/portable, optimized-copy in optimized)
- [x] #5 One-operation-per-track: file replacement subsumes artwork changes for same track
- [x] #6 planUpdateOperations produces explicit upgrade-* types instead of overloaded upgrade with optional preset
- [x] #7 --dry-run output shows the new operation type names
- [x] #8 Planner tests cover all transferMode × source-category combinations
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SyncOperation union replaced: `transcode`→`add-transcode`, `copy`→`add-direct-copy`/`add-optimized-copy`, `upgrade`→`upgrade-transcode`/`upgrade-direct-copy`/`upgrade-optimized-copy`/`upgrade-artwork`. PlanOptions gained `transferMode` field (defaults to 'fast'). `getMusicPlanSummary` returns granular counts plus backward-compat aggregate counts. ~20 files updated (types, planner, executor, handlers, generic planner/executor, error handling, demo mock, CLI presenter, all tests). 2037 core + 58 CLI + 24 E2E tests pass. Optimized-copy execution uses same path as direct-copy for now — TASK-199 adds FFmpeg passthrough.
<!-- SECTION:NOTES:END -->
