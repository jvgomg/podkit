---
"podkit": minor
"@podkit/core": minor
---

Enforce the device bitrate cap on lossy tracks (down direction)

Lowering a device's quality (a smaller preset, or a lower custom bitrate) now re-encodes the **lossy** tracks already on the device down to the new cap. Previously lossy sources (MP3, AAC) were copied as-is and never capped, so the setting silently did nothing for most libraries — only lossless sources were re-transcoded on a preset change.

The cap comparison is driven by the bitrate podkit recorded in the track's sync tag, not the unreliable device-database bitrate, so it never guesses: a lossy track podkit never wrote (synced by another tool, or before this feature) has no recorded bitrate and is left alone. After a cap-down re-encode the new bitrate is written back to the sync tag, so syncing again at the same cap is a no-op (idempotent). Works on both iPod and mass-storage devices.

This release enforces the cap in the down direction only (shrinking over-cap tracks). `--skip-upgrades` still suppresses all file replacement, including cap-down.

Note: a newly added lossy track whose bitrate is above the cap is still copied as-is on the first sync, then re-encoded down on the next sync — cap enforcement currently applies to tracks already on the device, so a fresh library converges to the cap over two syncs.
