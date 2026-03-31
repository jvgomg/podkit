---
"@podkit/core": minor
"podkit": minor
---

Refactor audio normalization from iPod-centric Sound Check to a generic `AudioNormalization` type, and add ReplayGain album gain/peak support

**Normalization refactoring:**

- Introduce `AudioNormalization` type that preserves source format fidelity (ReplayGain dB, iTunNORM soundcheck integers) without unnecessary round-trip conversions
- Replace scattered `soundcheck`, `soundcheckSource`, `replayGainTrackGain`, `replayGainTrackPeak` fields on `CollectionTrack` with a single `normalization` field
- Replace `soundcheck`, `replayGainTrackGain`, `replayGainTrackPeak` fields on `DeviceTrackInput` with `normalization`
- Conversions now happen at device boundaries: iPod adapter reads soundcheck integers, mass-storage adapter reads dB values directly
- Upgrade detection compares in dB space with 0.1 dB epsilon tolerance, eliminating false positives from integer rounding
- Metadata update diffs show human-readable dB values (e.g., `normalization: -7.5 dB → -6.2 dB`) instead of opaque integers

**Album gain/peak support (TASK-253):**

- Extract `albumGain` and `albumPeak` from local file metadata and Subsonic API
- Write `REPLAYGAIN_ALBUM_GAIN` and `REPLAYGAIN_ALBUM_PEAK` via FFmpeg metadata flags during transcode
- Write album gain/peak via node-taglib-sharp tag writer for M4A files
- Thread album data through the full sync pipeline for mass-storage devices (Rockbox, etc.)

**Breaking changes:**

- `CollectionTrack` shape: four normalization fields replaced by single `normalization?: AudioNormalization`
- `SoundCheckSource` type removed, replaced by `NormalizationSource`
- Upgrade reason `'soundcheck-update'` renamed to `'normalization-update'` in JSON output
- `soundCheckTracks` stat renamed to `normalizedTracks`
