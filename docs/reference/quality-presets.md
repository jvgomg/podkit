---
title: Quality Presets
description: Detailed specifications for audio and video transcoding quality presets.
sidebar:
  order: 3
---

Detailed specifications for podkit's audio and video transcoding presets.

## Unified vs Specific Quality

podkit uses a layered quality system:

- **`quality`** sets a baseline for both audio and video: `max`, `high`, `medium`, `low`.
- **`audioQuality`** overrides `quality` for audio specifically.
- **`videoQuality`** overrides `quality` for video specifically.

This lets you use a single `quality` setting for simplicity, or fine-tune audio and video independently. See [Config File Reference](/reference/config-file#quality-resolution-order) for the full resolution chain.

## Audio Presets

### Preset Summary

| Preset | Target | Description |
|--------|--------|-------------|
| `max` | Lossless or ~256 kbps | ALAC if device supports it and source is lossless; otherwise same as `high` |
| `high` | ~256 kbps | Transparent quality (**default**) |
| `medium` | ~192 kbps | Excellent quality |
| `low` | ~128 kbps | Good quality, space-efficient |

All presets use VBR encoding by default. Set `encoding = "cbr"` globally or per device for constant bitrate encoding. See [Audio Transcoding](/user-guide/transcoding/audio) for full details.

### The `max` Preset

The `max` preset is device-aware. On devices that support Apple Lossless (iPod Classic, Video 5G/5.5G, Nano 3G-5G), it produces ALAC from lossless sources. On other devices, it falls back to the same high-quality AAC as the `high` preset.

- Compatible lossy sources (MP3, AAC) are always copied as-is, regardless of preset
- Incompatible lossy sources (OGG, Opus) are transcoded with the bitrate capped at the source bitrate

### File Size Estimates

For a 4-minute song:

| Preset | Approx Bitrate | File Size |
|--------|----------------|-----------|
| **max** (ALAC) | ~900 kbps | ~26 MB |
| **max** (AAC fallback) | ~256 kbps | ~7.5 MB |
| **high** | ~256 kbps | ~7.5 MB |
| **medium** | ~192 kbps | ~5.6 MB |
| **low** | ~128 kbps | ~3.8 MB |

VBR file sizes vary based on content complexity. CBR sizes are exact.

### VBR vs CBR

| Mode | Description |
|------|-------------|
| **VBR** (default) | Variable bitrate — adapts to content complexity. Better quality-per-MB. |
| **CBR** | Constant bitrate — predictable file sizes. More reliable preset change detection. |

VBR is recommended for most uses. VBR AAC works correctly for seeking on iPods. Use `encoding = "cbr"` if you want predictable file sizes or guaranteed detection of preset changes between adjacent tiers.

### Encoder Mapping

FFmpeg encoder settings by preset:

| Preset | Native AAC (`-q:a`) | libfdk_aac (`-vbr`) | aac_at (`-q:a`) |
|--------|---------------------|---------------------|-----------------|
| high (and max AAC fallback) | 5 | 5 | 2 |
| medium | 4 | 4 | 4 |
| low | 2 | 3 | 6 |

When `max` resolves to ALAC (on capable devices with lossless sources), the ALAC encoder is used instead. When `max` falls back to AAC, it uses the same encoder settings as `high`.

Note: The `aac_at` encoder (macOS AudioToolbox) uses an inverted quality scale where 0 is highest quality and 14 is lowest. The native `aac` and `libfdk_aac` encoders use a scale where higher values mean higher quality. podkit maps target bitrates to the correct `aac_at` quality value automatically.

## Video Presets

### Preset Summary

| Preset | Description | Recommended For |
|--------|-------------|-----------------|
| `max` | Highest quality, largest files | Best viewing, ample storage |
| `high` | Excellent quality (default) | General use |
| `medium` | Good quality, smaller files | Limited storage |
| `low` | Space-efficient | Maximum capacity |

### Bitrate by Device and Preset

| Preset | iPod Classic (640x480) | iPod Video (320x240) |
|--------|------------------------|----------------------|
| max | 640x480 @ 2500 kbps | 320x240 @ 768 kbps |
| high | 640x480 @ 2000 kbps | 320x240 @ 600 kbps |
| medium | 640x480 @ 1500 kbps | 320x240 @ 400 kbps |
| low | 640x480 @ 1000 kbps | 320x240 @ 300 kbps |

### File Size Estimates

For a 2-hour movie on iPod Classic:

| Preset | Approx Size |
|--------|-------------|
| max | ~2.2 GB |
| high | ~1.8 GB |
| medium | ~1.3 GB |
| low | ~900 MB |

### Source Quality Awareness

Video quality is capped to source quality:

| Source Quality | User Setting | Effective Output |
|----------------|--------------|------------------|
| 1080p @ 8 Mbps | high | 640x480 @ 2000 kbps |
| 480p @ 1.5 Mbps | high | 480p @ 1500 kbps (capped) |
| 360p @ 800 kbps | high | 360p @ 800 kbps (source limited) |

## Changing Presets

When you change your quality preset, podkit detects that existing transcoded tracks on the iPod don't match the new target bitrate and re-transcodes them on the next sync. Play counts, star ratings, and playlist membership are preserved.

This applies to lossless source tracks only. Lossy sources (MP3, AAC) are copied as-is regardless of the preset.

See [Track Upgrades](/user-guide/syncing/upgrades#preset-changes) for details.

## Choosing a Preset

### For Audio

| Use Case | Recommended Preset |
|----------|-------------------|
| Audiophile, large storage | `max` (ALAC on supported devices) |
| Best quality, reasonable size | `high` (default) |
| Limited storage | `medium` |
| Minimum storage | `low` |
| Predictable file sizes | Any preset with `encoding = "cbr"` |

### For Video

| Use Case | Recommended Preset |
|----------|-------------------|
| Best viewing experience | `max` |
| General use | `high` (default) |
| Limited storage | `medium` |
| Maximum capacity | `low` |

## See Also

- [Audio Transcoding](/user-guide/transcoding/audio) - Full audio transcoding documentation
- [Video Transcoding](/user-guide/transcoding/video) - Video transcoding and configuration
- [Configuration](/user-guide/configuration) - Setting presets in config
