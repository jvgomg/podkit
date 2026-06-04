---
id: TASK-385
title: DeviceTrack interface pruning post-artworkSink
status: To Do
assignee: []
created_date: '2026-06-04 08:06'
labels:
  - enhancement
  - refactor
  - device-adapter
  - interface
  - code-quality
dependencies:
  - TASK-372
references:
  - packages/podkit-core/src/device/adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/ipod/track.ts
priority: low
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-372 added `DeviceTrack.artworkSink` for dispatch but did not remove the legacy artwork methods. The interface now has:

- `setArtwork(imagePath: string): DeviceTrack` — set from file path
- `setArtworkFromData(imageData: Buffer): DeviceTrack` — set from bytes
- `removeArtwork(): DeviceTrack` — clear
- `artworkSink: 'database' | 'embedded' | 'sidecar' | 'noop'` — new dispatch hint

After TASK-372 the live pipeline only calls `setArtworkFromData` (for the `'database'` sink → iPod), and `removeArtwork` (for `transferUpgradeToIpod`'s `artwork-removed` upgrade branch). `setArtwork(path)` has zero remaining callers in production code.

## Scope

1. **Grep audit.** Find every caller of `setArtwork(path)`, `setArtworkFromData(bytes)`, `removeArtwork()` in production + test code. Confirm the dead surface.
2. **Delete `setArtwork(imagePath)` from the interface** if confirmed dead. Probably means deleting the IpodTrack + MassStorageTrack implementations + tests.
3. **Decide on `setArtworkFromData`**:
   - Option A: Keep as-is. It's the actual write path for the `'database'` sink (works for iPod via libgpod). Mass-storage's no-op is documented as unreachable but kept for interface conformance.
   - Option B: Rename to something more specific (e.g. `writeArtworkToDatabase`) to signal its narrow purpose. Touches every test fixture; high churn.
   - Option C: Move to a sink-specific interface (`DatabaseArtworkSink`) that `IpodTrack` implements but `MassStorageTrack` doesn't. Cleaner contract; requires interface segregation.
4. **Decide on `removeArtwork`**:
   - Live caller: `transferUpgradeToIpod` `artwork-removed` branch. Works for iPod (clears the iTunesDB entry). Mass-storage version is also a no-op AFAIK — verify.
   - Possible cleanup: instead of `track.removeArtwork()`, dispatch via the sink (`'database' → device.clearTrackArtwork(track)`; `'embedded' → updateTrack({ embeddedPictureData: null })`).

## Acceptance criteria

- `DeviceTrack` interface contract is tightened by at least one method.
- No dead-on-arrival surface remains.
- All callers verified.
- Existing tests green.

## Notes

- Worth pairing with TASK-39 (pipeline refactor) — both touch the artwork dispatch surface.
- Be conservative with breaking changes: `DeviceTrack` is a public interface (`@podkit/core` consumers see it). A minor version bump may be required if anything is removed.

## Reference

- Item 4 from post-team-lead retro (2026-06-04).
- TASK-372 (commit 50a6247f) introduced `artworkSink`.
<!-- SECTION:DESCRIPTION:END -->
