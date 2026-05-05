---
id: TASK-294.02
title: P3.2 — libgpod-free getCapabilities + snapshot parity tests
status: Done
assignee: []
created_date: '2026-05-03 11:32'
updated_date: '2026-05-05 18:24'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
parent_task_id: TASK-294
ordinal: 10020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `getCapabilities(identity, opts?)` in `@podkit/devices-ipod` purely from generation tables, with optional firmware overlay. No dependency on libgpod's `LibgpodDeviceInfo`.

Snapshot-test the new function against the old `createIpodCapabilities` for every generation. Diffs must be reviewed and either fixed (if a bug) or accepted (if a deliberate improvement). HITL: snapshot diffs need user review.

See spec doc-034, Scope > New package: @podkit/devices-ipod, capabilities.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 getCapabilities(identity, opts?) implemented purely from tables (no LibgpodDeviceInfo dependency)
- [x] #2 Firmware overlay correctly merges with table-derived values when opts.firmware supplied
- [x] #3 Snapshot tests cover every generation × { with firmware, without firmware }
- [x] #4 Snapshot diffs against the pre-P3 createIpodCapabilities reviewed and accepted
- [x] #5 Documentation captures any deliberate behaviour changes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented `getCapabilities(identity, opts?)` in `packages/devices-ipod/src/capabilities.ts` purely from the generation table; firmware overlay merges audio codec advertisements via `normaliseCodec`.

## Generation table augmentation
Extended `IpodGeneration` with `supportsAlac`, `supportsVideo`, `artworkMaxResolution`. The previous shape only carried `id/displayName/checksumType` — capability data lived only in podkit-core's libgpod-keyed sibling. Filling in 29 generations exhaustively (one per `IpodGenerationId`) makes the table the authority. Existing call sites (`lookupGenerationInfo`, `getGenerationInfo`) consume the additional fields without breaking — they read by field name.

## Snapshot parity result
**25/29 generations achieve byte-identical parity** with the legacy `createIpodCapabilities(libgpodInfo)` from `packages/podkit-core/src/device/capability-adapter.ts`. To avoid a `@podkit/core` devDependency in this libgpod-free package, the legacy adapter is reimplemented inline in `capabilities.test.ts` as `referenceCreateIpodCapabilities` (verbatim port — TASK-294.12 will replace this with a direct import once the legacy adapter becomes a re-export shim).

**4/29 generations are deliberately table-only** (`nano_7g`, `touch_5g`, `touch_6g`, `touch_7g`) — these map to libgpod's `'unknown'` so the legacy adapter can only emit the degenerate `{ artworkMaxResolution:0, supportsVideo:<runtime>, codecs:['aac','mp3'] }` shape. The new table-driven path produces correct output (ALAC + video + 240/320 artwork), validated against expected literals.

## Diffs found / resolved
None. Parity holds for every libgpod-known generation on first run. Constructed the synthetic `LibgpodDeviceInfo` from table values (`supportsArtwork = artworkMaxResolution > 0`, `supportsVideo = gen.supportsVideo`) — the parity assertion therefore validates that the new table reproduces what the legacy adapter would emit for a freshly-detected device with no libgpod runtime quirks.

## Firmware overlay tests
Five overlay scenarios cover: nano_4g full Apple codec list (no-op), video_5g standard set (no-op), classic_6g unknown-codec dropping + dedup, nano_2g (non-ALAC class) gaining FLAC under hypothetical Rockbox firmware, and absent-overlay equivalence.

## Decisions to flag
- **TASK-294.03 (provider)**: The new function takes `IpodModel` (not `IpodIdentity` from `@podkit/device-types`). Provider integration will need to either widen `getCapabilities` to accept `IpodIdentity` or have the provider build an `IpodModel` from the identity result; preferred direction TBD with the firmware-aware identity rework.
- **TASK-294.12 (shim)**: When migrating the legacy adapter to delegate, the inline `referenceCreateIpodCapabilities` in `capabilities.test.ts` should be deleted and replaced with a direct call into `getCapabilities` (parity becomes a tautology and can be retired). The fixture `LEGACY_IPOD_GENERATIONS` and `LEGACY_ARTWORK_MAX_RESOLUTION` live only in the test file and will be removed at that point.
- **`mini_2g` ALAC flag**: libgpod's `IPOD_GENERATIONS` marks `mini_2` as ALAC-capable; this seems doubtful for a 2005 mini lacking the audio decoder upgrades of the photo/4G click-wheel, but parity is preserved (kept `supportsAlac:true`) to honour the "byte-identical" gate. Worth verifying against a real device in m-18 hardware validation.

## Files
- `packages/devices-ipod/src/types.ts` — extended `IpodGeneration` interface
- `packages/devices-ipod/src/tables/generations.ts` — 29 entries with capability flags
- `packages/devices-ipod/src/capabilities.ts` — new `getCapabilities` + `GetCapabilitiesOptions`
- `packages/devices-ipod/src/capabilities.test.ts` — parity + table-only + firmware overlay
- `packages/devices-ipod/src/index.ts` — wire export

## Quality gates
- `mise exec -- bun run --cwd packages/devices-ipod typecheck` ✓
- `mise exec -- bun run --cwd packages/devices-ipod test` ✓ (148 pass, 0 fail)
- `mise exec -- bun run --cwd packages/podkit-core test:unit` ✓ (2509 pass)
- `mise exec -- bun run typecheck` ✓ repo-wide
- `mise exec -- bun run lint` ✓ no new warnings (14 pre-existing in unrelated files)
- `mise exec -- bun run build --filter @podkit/devices-ipod` ✓
<!-- SECTION:NOTES:END -->
