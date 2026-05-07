---
id: TASK-300
title: M-18 leftover dup cleanup
status: Done
assignee: []
created_date: '2026-05-06 23:52'
updated_date: '2026-05-07 21:20'
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

## m-18 Final Scrub (follow-up pass)

### Sweep 1: Delete @deprecated code

**1A — `core/ipod/generation.ts` DELETED**
- Added `formatGeneration(libgpodName)` to `packages/devices-ipod/src/tables/libgpod-mapping.ts`. Function uses reverse-index (libgpod name → IpodGenerationId → GENERATIONS[id].displayName) with a fallback table for libgpod-only names (unknown, mobile, iphone_*, ipad_*, classic_2). Exported from devices-ipod index.
- Removed `IPOD_GENERATIONS`, `IpodGenerationMetadata`, `getVideoProfile`, `supportsVideo`, `supportsAlac` from core's public surface. Kept `formatGeneration` re-export in core index for back-compat.
- Updated CLI test expectations to the longer 'iPod Classic (7th Generation)' form (was 'Classic (7th Generation)').
- Deleted `packages/podkit-core/src/ipod/generation.ts` (~151 LOC)

**1B — `core/device/sysinfo-extended.ts` DELETED**
- Migrated 4 consumers to import `readSysInfoExtended`/`ensureSysInfoExtended` directly from `@podkit/ipod-firmware`.
- Each call site now injects the `resolveModel` callback: `(sn) => resolveIpodModel({ from: 'serial', serialNumber: sn }) ?? undefined`.
- `sysinfo-extended.test.ts` updated to import from `@podkit/ipod-firmware` and pass the resolver.
- `device/index.ts` re-exports from `@podkit/ipod-firmware` directly.
- Deleted `packages/podkit-core/src/device/sysinfo-extended.ts` (~61 LOC)

**1C — `mass-storage-utils.ts` deprecated re-exports removed**
- Removed `export type { ContentPaths }` and `export { DEFAULT_CONTENT_PATHS }` (both with @deprecated markers).
- Migrated 6 consumers: `orphans-mass-storage.ts`, `orphans-mass-storage.test.ts`, `mass-storage-adapter.ts`, `mass-storage-adapter.test.ts`, `diagnostics/index.ts`, `diagnostics/types.ts`, `presets.test.ts` — all now import from `@podkit/devices-mass-storage` directly.
- `device/index.ts` re-exports `DEFAULT_CONTENT_PATHS` and `ContentPaths` from `@podkit/devices-mass-storage`.

**1D — devices-ipod deprecated aliases removed**
- Deleted `lookupIpodModel`, `lookupIpodModelByNumber`, `lookupIpodModelBySerial`, `getGenerationInfo` from `lookups.ts`.
- Kept `resolveIpodModel` alias (heavily used in CLI, readiness stages, and diagnostics — 8+ production call sites).
- Updated `lookups.test.ts` to test canonical functions (`lookupByUsbId`, `lookupByModelNumber`, `lookupBySerial`, `lookupGenerationInfo`).
- Updated `core/device/readiness/stages/sysinfo.ts` to use `lookupByModelNumber`, `lookupGenerationInfo`.
- Updated `device/index.ts` to re-export canonical names instead of aliases.

### Sweep 2: Move libgpod-coupled classification out of core

**2A — `core/device/libgpod-bridge.ts` MOVED to `@podkit/devices-ipod`**
- Created `packages/devices-ipod/src/libgpod-bridge.ts` with `modelFromLibgpodInfo` + `LibgpodDeviceInfo`.
- Exported from devices-ipod index.
- `device/index.ts` now re-exports from `@podkit/devices-ipod` instead of local file.
- `resolve-capabilities.parity.test.ts` updated to import from `@podkit/devices-ipod`.
- Deleted `packages/podkit-core/src/device/libgpod-bridge.ts` (~97 LOC).

**2B — Unsupported-generation logic split**
- Added `getUnsupportedReasonByLibgpodName(libgpodName): UnsupportedGenerationKind | null` and `UnsupportedGenerationKind` to `devices-ipod/src/libgpod-bridge.ts`.
- `UNSUPPORTED_GENERATIONS`, `IOS_GENERATIONS`, `BUTTONLESS_SHUFFLE_GENERATIONS` sets DELETED from `core/ipod/device-validation.ts`.
- `isUnsupportedGeneration` and `getUnsupportedReason` now delegate to `getUnsupportedReasonByLibgpodName`.

**2C — `core/ipod/test-helpers.ts` DELETED**
- Inlined `capsForGeneration(id: IpodGenerationId)` test helper into both integration test files.
- Uses `IpodGenerationId` keys (`'classic_7g'`) instead of libgpod names (`'classic_3'`).
- Deleted `packages/podkit-core/src/ipod/test-helpers.ts` (~49 LOC)

### Sweep 3: @deprecated audit

Remaining @deprecated markers (all pre-m18, out of scope):
- `transcode/ffmpeg.ts` — `EncoderConfig` alias
- `device/mass-storage-adapter.ts` — `musicDir` field
- `sync/engine/types.ts` — ALAC capabilities check
- `devices-ipod/src/identity.ts` — `resolveIpodModel = identify` (kept; 8+ production call sites)

One residual libgpod-node import in non-database file: `core/ipod/device-validation.ts` imports `IpodGeneration` type (type-only; needed for `IpodDeviceInfo.generation` typing).

### Final test counts
- podkit-core unit: 2397 pass, 1 skip, 0 fail (75 files)
- devices-ipod: 178 pass (4 files)
- devices-mass-storage: 74 pass (5 files)
- ipod-firmware: 205 pass (12 files)
- podkit-cli: 1065 pass (34 files)
- typecheck: clean
- lint: 0 errors
- build: clean

### Net LOC delta
- Deleted: generation.ts (~151), sysinfo-extended.ts (~61), libgpod-bridge.ts (~97), test-helpers.ts (~49) = ~358 LOC deleted
- Added: libgpod-bridge.ts in devices-ipod (~145), formatGeneration + reverse-index in libgpod-mapping.ts (~70) = ~215 LOC added
- Net: ~−143 LOC across packages

Final cleanup pass (3 sweeps) completed:
- Sweep 1: Deleted `packages/devices-ipod/src/tables/artwork-formats.ts` (0 runtime consumers). Removed its export from `index.ts`. Removed test assertion referencing the export from `lookups.test.ts`.
- Sweep 2A: `modelFromLibgpodInfo` now returns `IpodModel | null`. The `video_5g` synthetic fallback is gone. `open-device.ts` throws with a user-facing message on null; `device.ts` leaves capabilities null and falls through.
- Sweep 2B: `bridgeIpodIdentityToModel` returns `IpodModel | null`. `resolveCapabilities` throws `Error('Could not resolve iPod model from identity: ...')` instead of silently using video_5g. Tests updated: two `video_5g` fallback assertions replaced with `toThrow` assertions.
- Sweep 3: 22 TASK-XXX / phase-history comments removed across 16 files in `@podkit/devices-ipod`, `@podkit/devices-mass-storage`, `@podkit/ipod-firmware`, `@podkit/core`, and `@podkit/cli`.
- Final grep: zero hits for TASK-29x / in P[1-4] / moved at m-18 / m-8 will in source files.
- All quality gates pass: typecheck, unit tests (podkit-core 2397, devices-ipod 178, devices-mass-storage 74, ipod-firmware 205, podkit-cli 1065), lint (0 errors), build (16/16 tasks).
<!-- SECTION:FINAL_SUMMARY:END -->
