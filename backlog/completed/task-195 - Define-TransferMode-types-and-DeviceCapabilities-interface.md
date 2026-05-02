---
id: TASK-195
title: Define TransferMode types and DeviceCapabilities interface
status: Done
assignee: []
created_date: '2026-03-23 14:07'
updated_date: '2026-03-23 15:13'
labels:
  - feature
  - core
  - architecture
milestone: 'Transfer Mode: iPod Support'
dependencies: []
references:
  - packages/podkit-core/src/transcode/types.ts
  - packages/podkit-core/src/ipod/generation.ts
  - packages/podkit-core/src/ipod/device-validation.ts
  - packages/podkit-core/src/sync/types.ts
  - packages/podkit-core/src/index.ts
documentation:
  - backlog/docs/doc-011 - PRD--Transfer-Mode.md
  - backlog/docs/doc-013 - Spec--Device-Capabilities-Interface.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the foundational types for the transfer mode system and the device capabilities abstraction. This is the type-level foundation that all other transfer mode tasks build on.

**PRD:** DOC-011 (Transfer Mode)
**Spec:** DOC-013 (Device Capabilities Interface)

**TransferMode type:**
- `TransferMode = 'fast' | 'optimized' | 'portable'`
- `TRANSFER_MODES` array and `isValidTransferMode()` validator (same pattern as existing `FileMode`)
- Export from `@podkit/core` index

**DeviceCapabilities interface:**
```typescript
interface DeviceCapabilities {
  artworkSources: ArtworkSource[];        // ['database'] for iPod
  artworkMaxResolution: number;           // e.g. 320 for Classic
  supportedAudioCodecs: AudioCodec[];     // e.g. ['aac', 'mp3', 'alac']
  supportsVideo: boolean;
}
type ArtworkSource = 'database' | 'embedded' | 'sidecar';
type AudioCodec = 'aac' | 'alac' | 'mp3' | 'flac' | 'ogg' | 'opus' | 'wav' | 'aiff';
```

**iPod implementation:**
- New `getDeviceCapabilities(generation, deviceInfo)` function that consolidates existing `supportsAlac()`, `supportsVideo()` and generation metadata into a single `DeviceCapabilities` object
- Map each iPod generation to correct capabilities (see DOC-013 for per-generation details)

**Replace deviceSupportsAlac:**
- Replace `deviceSupportsAlac: boolean` in `MusicContentConfig`, `PlanOptions`, and anywhere it's threaded through
- Derive ALAC support from `capabilities.supportedAudioCodecs.includes('alac')`
- The planner and executor receive `DeviceCapabilities` instead of the boolean flag

**Remove old FileMode:**
- Remove `FileMode` type, `FILE_MODES`, `isValidFileMode()` — replaced by `TransferMode` equivalents
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TransferMode type exported from @podkit/core with TRANSFER_MODES array and isValidTransferMode() validator
- [x] #2 DeviceCapabilities interface exported from @podkit/core with ArtworkSource and AudioCodec types
- [x] #3 getDeviceCapabilities() returns correct capabilities for all iPod generations (color screen, non-color, Shuffle)
- [x] #4 deviceSupportsAlac boolean replaced with DeviceCapabilities throughout planner, executor, and config types
- [x] #5 Old FileMode type, FILE_MODES array, and isValidFileMode() removed
- [x] #6 Unit tests for getDeviceCapabilities() covering ALAC-capable, non-ALAC, video-capable, and screenless iPod generations
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TransferMode type added alongside FileMode (then FileMode removed after all consumers migrated). DeviceCapabilities interface in new `ipod/capabilities.ts` file. `DeviceArtworkSource` name used instead of `ArtworkSource` to avoid conflict with existing `ArtworkSource` in artwork/types.ts. PlanOptions extended with `capabilities` field; `deviceSupportsAlac` deprecated. Planner uses fallback chain: `capabilities?.supportedAudioCodecs.includes('alac') ?? deviceSupportsAlac ?? false`.
<!-- SECTION:NOTES:END -->
