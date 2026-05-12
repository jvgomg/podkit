---
"podkit": minor
"@podkit/core": minor
"@podkit/devices-mass-storage": minor
---

Polish on the convergent-metadata work (TASK-327 follow-up):

- **Tag-write concurrency cap.** `save()` now caps in-flight tag writes at 16 via a small `runWithConcurrency` helper instead of firing every pending write at once. Avoids `EMFILE` on large libraries.
- **Aggregated tag-write errors.** Failure messages now begin with `tag write failed` so the executor's error categorizer classifies them as file-I/O (`copy`) rather than risking a path-keyword mis-classification.
- **WAV/AIFF on mass-storage.** Podkit transcodes WAV and AIFF source files to a managed codec before placing them on a mass-storage device, even when the device firmware can play them. RIFF/IFF tag-writing is unreliable. Presets continue to list these codecs for documentation. iPod is unaffected (libgpod / iTunesDB handle metadata for WAV/AIFF).
- **OGG Vorbis tag round-trip tests.** Now run on builds with libvorbis (skipped automatically when absent).
- **Shared TagFields helpers.** `buildTagFieldsFromInput` and `diffTagFields` replace three duplicate field-by-field walks across adapters.
- **`TransferMode` type unified.** Removed `'fast' | 'optimized' | 'portable'` duplication between `DeviceTrackInput`, `DeviceTrackMetadata`, and the canonical `TransferMode` in `transcode/types.ts`. Drops several inline type casts.
- **Docs.** `transferMode` now has a dedicated section in `docs/reference/config-file.md` explaining the iPod vs mass-storage contract and migration churn. `pathTemplate` (from the prior release) and `PODKIT_PATH_TEMPLATE` are now documented in the config reference and environment-variables reference.
