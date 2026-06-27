---
"podkit": minor
"@podkit/core": minor
---

Keep the better device copy when a source is re-ripped lower, and report it

When a track's source file is re-ripped (or re-encoded) to a **lower** bitrate than the copy already on the device, podkit no longer follows the source down by default. Re-encoding the device copy down to the worse source would destroy quality for no benefit, so the better existing copy is kept and the situation is surfaced instead of silently acted on.

This also fixes a latent edge in lossy cap-down: a device copy whose recorded bitrate sits *above* the cap was re-encoded down to the cap even when the source had since degraded *below* the cap (e.g. recorded 320, source re-ripped to 100, cap 128) — a lossy-to-lossy upsample of degraded audio. The cap comparison now uses the three-bound model (the effective target is `min(source, cap)`), so when the source can no longer supply the cap the change is suppressed rather than re-encoded.

Suppressed changes are visible without creating any work:

- `sync --json` lists each one in the per-collection `qualityChanges[]` array with `reason: "source-down-suppressed"` and `reEncodes: false`, and counts it under `updateBreakdown["quality-change-suppressed"]`.
- The default text summary shows a per-collection "Source-down suppressed" count; `-v` lists each affected track with its device/source bitrates.
- The track is never moved into `tracksToUpdate`/`tracksToUpgrade` and no file work runs — a suppressed track is a stable no-op across repeated syncs.

Suppression is the default. Following the source down instead is left to a future opt-in policy. Works on both iPod and mass-storage devices.
