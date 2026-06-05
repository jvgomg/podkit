---
"@podkit/core": minor
---

Move artwork operations from `DeviceTrack` onto `DeviceAdapter` (Option Z)

Public API: the `DeviceTrack` and `IpodTrack` interfaces no longer expose
`setArtwork(path)`, `setArtworkFromData(bytes)`, or `removeArtwork()`. The
`DeviceAdapter` interface gains:

- `setTrackArtwork(track, imageData): Promise<void>` — write artwork bytes;
  adapter dispatches internally on `track.artworkSink` (iPod ArtworkDB,
  mass-storage embedded tag, sidecar `cover.jpg`, or no-op).
- `removeTrackArtwork(track): Promise<void>` (was `T`, optional) — clear
  artwork. Now required on every adapter; iPod clears the ArtworkDB entry,
  mass-storage is a deliberate no-op.

The pipeline's `transferArtwork` is now a single `adapter.setTrackArtwork`
call instead of a three-way branch on `artworkSink`. `artworkSink` remains
on `DeviceTrack` as a readable introspection property used for progress
reporting and to suppress dishonest `syncTag.artworkHash` claims on noop
adapters (churn-loop guard, doc-041 §3.6). Behaviour is unchanged: iPod
bytes go to libgpod's ArtworkDB, mass-storage bytes route through the tag
writer or sidecar cover.jpg path. Internal consumers (Pipeline, repair,
diagnostics) are updated; downstream callers using `DeviceAdapter` need
only switch to the adapter methods.
