---
id: TASK-300
title: M-18 leftover dup cleanup
status: Done
assignee: []
created_date: '2026-05-06 23:52'
labels:
  - device-capability-architecture
  - m-18-cleanup
milestone: m-18
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Post-migration deduplication audit cleanup. Removed duplicate code in podkit-core that should have moved to the new packages (devices-ipod, devices-mass-storage) during the m-18 P0–P4 migration.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## What was deduped

**Step 1 — ARTWORK_RESOLUTION (ipod/capabilities.ts)**
Deleted the 16-entry `ARTWORK_RESOLUTION` constant. Rewrote `getArtworkMaxResolution` to use `GENERATION_ID_TO_LIBGPOD` reverse-index + `GENERATIONS[id].artworkMaxResolution` from `@podkit/devices-ipod`. Added `'unknown'` sentinel guard (libgpod 'unknown' → null resolution). Files touched: `ipod/capabilities.ts`.

**Step 2 — ContentPaths / DEFAULT_CONTENT_PATHS (device/mass-storage-utils.ts)**
Moved `DEFAULT_CONTENT_PATHS` constant from core to canonical home in `devices-mass-storage/src/presets/types.ts`. Exported from `devices-mass-storage` index. Updated `devices-mass-storage/src/presets/built-in.ts` to import from types (removed inline duplicate). Core's `mass-storage-utils.ts` now re-exports both with `@deprecated` JSDoc for backward-compat (removal at m-8). `presets.test.ts` unchanged — assertion is now self-referential (both sides from same source), which is valid.

**Step 3 — getDeviceCapabilities (ipod/capabilities.ts)**
Deleted `getDeviceCapabilities` function entirely. Added `ipod/test-helpers.ts` with `capsForLibgpodGeneration(libgpodName)` helper for the 22 integration test call sites (all used `'classic_3'`). Migrated both `ipod-adapter.integration.test.ts` (16 sites) and `sync/music/pipeline.integration.test.ts` (6 sites). Deleted `ipod/capabilities.ts` (now empty after ARTWORK_RESOLUTION and getDeviceCapabilities removed). Removed public re-export from `index.ts:164`. Removed stub from `demo/src/mock-core.ts`. Moved `isValidTransferMode` tests from deleted `capabilities.test.ts` to `transcode/types.test.ts`.

**Step 4 — IPOD_GENERATIONS table (ipod/generation.ts)**
Stripped `generation.ts` from 289 LOC to ~150 LOC. Removed all capability fields (supportsAlac, videoProfile) from `IPOD_GENERATIONS` — rebuilt as a display-name-only table. Moved `getVideoProfile` out of the import chain: video/types.ts now has its own `LIBGPOD_GENERATION_TO_VIDEO_PROFILE` inline map (3 profile names, video-capable gens only). `supportsVideo` and `supportsAlac` marked `@deprecated`, return stub false (these were never used by the CLI or any production path). Deleted `generation.test.ts` (tested capability fields now in devices-ipod). `formatGeneration` preserved with original display names to avoid CLI behavior change.

**Step 5 — ipod-models.test.ts**
Deleted 648-LOC test file. All tested functions (`lookupIpodModel`, `lookupIpodModelByNumber`, `lookupIpodModelBySerial`, `getGenerationInfo`, `getChecksumType`, `lookupGenerationByProductId`, `toLibgpodGeneration`, `resolveIpodModel`) have equivalent or superior coverage in `devices-ipod/src/lookups.test.ts` and `identity.test.ts`.

## Files deleted
- `packages/podkit-core/src/ipod/capabilities.ts` (109 LOC)
- `packages/podkit-core/src/ipod/capabilities.test.ts` (202 LOC)
- `packages/podkit-core/src/ipod/generation.test.ts` (87 LOC)
- `packages/podkit-core/src/device/ipod-models.test.ts` (648 LOC)

## Files added
- `packages/podkit-core/src/ipod/test-helpers.ts` (52 LOC) — `capsForLibgpodGeneration` test utility

## Net line delta: ~−1200 LOC

## Final test count
- podkit-core unit: 2398 tests (was 2554 before all steps; delta accounts for deleted capability + generation + ipod-models tests, and 3 new isValidTransferMode tests moved to transcode/types.test.ts)
- devices-ipod: 178 tests — all pass
- devices-mass-storage: 74 tests — all pass
- ipod-firmware: 205 tests — all pass
- typecheck: clean
- lint: 0 errors (14 pre-existing warnings)
- build: clean
<!-- SECTION:FINAL_SUMMARY:END -->
