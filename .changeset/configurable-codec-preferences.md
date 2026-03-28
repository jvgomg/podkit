---
"podkit": minor
"@podkit/core": minor
---

Add configurable codec preference system for multi-device audio format support

Users can now configure an ordered list of preferred audio codecs globally and per-device. The system walks the list top-to-bottom, selecting the first codec that is both supported by the target device and has an available FFmpeg encoder. This replaces the hardcoded AAC-only transcoding pipeline.

- **Default lossy stack:** opus → aac → mp3 (Rockbox devices get Opus automatically, iPods fall through to AAC)
- **Default lossless stack:** source → flac → alac (lossless files are kept in their original format when possible)
- **Quality presets are codec-aware:** "high" delivers perceptually equivalent quality regardless of codec (e.g., Opus 160 kbps ≈ AAC 256 kbps)
- **Codec change detection:** changing your codec preference re-transcodes affected tracks on the next sync
- **`podkit device info`** shows your codec preference list with supported/unsupported codecs marked
- **`podkit sync --dry-run`** shows which codec will be used and any codec changes
- **`podkit doctor`** warns when FFmpeg is missing an encoder for a preferred codec

Configure via `config.toml`:

```toml
[codec]
lossy = ["opus", "aac", "mp3"]
lossless = ["source", "flac", "alac"]

[devices.myipod.codec]
lossy = "aac"
```

No configuration is required — existing setups work unchanged with sensible defaults.
