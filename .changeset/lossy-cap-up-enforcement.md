---
"podkit": minor
"@podkit/core": minor
---

Enforce the device bitrate cap on lossy tracks (up direction)

Raising a device's quality (a larger preset, or a higher custom bitrate) now re-encodes the **lossy** tracks already on the device back up toward the new target — not just lossless ones. Previously raising the cap left existing lossy copies stuck at their smaller bitrate; now an under-cap lossy track is re-encoded up from the original source file, so the device reflects your current quality preference.

The upward re-encode is bounded by what the source can actually supply: the effective target is the lower of the new cap and the source's own bitrate (`min(source, cap)`), so it never inflates a file beyond the quality the source provides. The re-encode reads the source, not the smaller copy on the device, so it genuinely recovers quality. After the re-encode the new bitrate is written back to the sync tag, so syncing again at the same cap is a no-op (idempotent) — including when the effective target was the source bitrate. Works on both iPod and mass-storage devices.

A source that was re-ripped to a *lower* bitrate is not followed down: when the source has degraded below the device copy, the better existing copy is kept rather than re-encoded down. `--skip-upgrades` still suppresses all file replacement, in both directions.
