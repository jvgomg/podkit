---
title: Quality Presets
description: Detailed specifications for audio and video transcoding quality presets.
sidebar:
  order: 3
---

# Quality Presets

Detailed specifications for podkit's audio and video transcoding presets.

## Audio Presets

### Preset Summary

| Preset | Type | Target | Description |
|--------|------|--------|-------------|
| `alac` | Lossless | N/A | Apple Lossless (only from lossless sources) |
| `max` | VBR | ~320 kbps | Highest VBR quality level |
| `max-cbr` | CBR | 320 kbps | Guaranteed 320 kbps |
| `high` | VBR | ~256 kbps | Transparent quality (default) |
| `high-cbr` | CBR | 256 kbps | Predictable file sizes |
| `medium` | VBR | ~192 kbps | Excellent quality |
| `medium-cbr` | CBR | 192 kbps | |
| `low` | VBR | ~128 kbps | Good quality, space-efficient |
| `low-cbr` | CBR | 128 kbps | |

### File Size Estimates

For a 4-minute song:

| Preset | Mode | Approx Bitrate | File Size |
|--------|------|----------------|-----------|
| **alac** | Lossless | ~900 kbps | ~26 MB |
| **max** | VBR | ~320 kbps | ~9.4 MB |
| **high** | VBR | ~256 kbps | ~7.5 MB |
| **medium** | VBR | ~192 kbps | ~5.6 MB |
| **low** | VBR | ~128 kbps | ~3.8 MB |

VBR file sizes vary based on content complexity. CBR sizes are exact.

### VBR vs CBR

| Mode | Description |
|------|-------------|
| **VBR** | Variable bitrate - adapts to content complexity. Better quality-per-MB. |
| **CBR** | Constant bitrate - predictable file sizes. May waste bits on simple passages. |

VBR is recommended for most uses. VBR AAC works correctly for seeking on iPods.

### ALAC Preset

The `alac` preset produces Apple Lossless (ALAC) files:

- **Lossless** - No quality loss from original
- **Larger files** - Approximately 50-60% of original lossless size
- **Source requirement** - Only applies to lossless sources (FLAC, WAV, AIFF, ALAC)
- **Fallback** - Lossy sources use the `fallback` preset (default: `max`)

### Encoder Mapping

FFmpeg encoder settings by preset:

| Preset | Native AAC (`-q:a`) | libfdk_aac (`-vbr`) | aac_at (`-q:a`) |
|--------|---------------------|---------------------|-----------------|
| max/high | 5 | 5 | 14 |
| medium | 4 | 4 | 11 |
| low | 2 | 3 | 6 |

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

## Choosing a Preset

### For Audio

| Use Case | Recommended Preset |
|----------|-------------------|
| Audiophile, large storage | `alac` with `fallback = "max"` |
| Best quality, reasonable size | `high` (default) |
| Limited storage | `medium` |
| Minimum storage | `low` |
| Predictable file sizes | Any `-cbr` variant |

### For Video

| Use Case | Recommended Preset |
|----------|-------------------|
| Best viewing experience | `max` |
| General use | `high` (default) |
| Limited storage | `medium` |
| Maximum capacity | `low` |

## See Also

- [Transcoding Guide](/user-guide/transcoding) - Full transcoding documentation
- [Video Sync](/user-guide/video-sync) - Video configuration
- [Configuration](/user-guide/configuration) - Setting presets in config
