---
title: Audio Transcoding
description: Configure audio transcoding quality, codecs, and presets for syncing music to iPod.
sidebar:
  order: 2
---

This guide covers audio quality presets, encoder options, and file size estimates. For an overview of how podkit decides what to transcode, see [Transcoding Methodology](/user-guide/transcoding). For how podkit selects which codec to use, see [Codec Preferences](/user-guide/transcoding/codec-preferences).

## Quality Presets

| Preset | Target | Description |
|--------|--------|-------------|
| `max` | Lossless or ~256 kbps | ALAC if device supports it and source is lossless; otherwise same as `high` |
| `high` | ~256 kbps | Transparent quality (**default**) |
| `medium` | ~192 kbps | Excellent quality |
| `low` | ~128 kbps | Good quality, space-efficient |

**Default:** `high` (VBR ~256 kbps)

The `max` preset is device-aware. On devices that support Apple Lossless (iPod Classic, Video 5G/5.5G, Nano 3G-5G), it produces ALAC from lossless sources. On other devices, it falls back to the same high-quality AAC as the `high` preset.

## Configuration

### CLI Usage

```bash
# Default: VBR ~256 kbps
podkit sync

# Best quality — ALAC on supported devices, high AAC on others
podkit sync --audio-quality max

# CBR encoding for predictable file sizes
podkit sync --encoding cbr

# Space-efficient
podkit sync --quality low

# Set unified quality, but override audio specifically
podkit sync --quality medium --audio-quality high
```

### Config File

```toml
# Top-level settings in config.toml
quality = "high"          # Unified quality for audio and video
audioQuality = "high"     # Audio-specific override: max | high | medium | low
encoding = "vbr"          # Encoding mode: vbr (default) or cbr
```

## Example Scenarios

**Scenario 1: Audiophile with iPod Classic**

```toml
audioQuality = "max"
```

| Source | Result |
|--------|--------|
| FLAC | ALAC (Classic supports lossless) |
| MP3 320 | Copy as-is |
| OGG 192 | AAC ~192 kbps VBR (capped at source bitrate) + warning |

**Scenario 2: Space-conscious user**

```toml
quality = "medium"
```

| Source | Result |
|--------|--------|
| FLAC | AAC ~192 kbps VBR |
| MP3 128 | Copy as-is |
| Opus 128 | AAC ~128 kbps VBR (capped at source bitrate) + warning |

**Scenario 3: Predictable file sizes**

```toml
quality = "high"
encoding = "cbr"
```

| Source | Result |
|--------|--------|
| FLAC | AAC 256 kbps CBR |
| MP3 320 | Copy as-is |
| OGG 192 | AAC 192 kbps CBR (capped at source bitrate) + warning |

## VBR vs CBR

VBR is the default encoding mode. You can switch to CBR globally or per device with the `encoding` option:

```toml
encoding = "cbr"  # global

[devices.nano]
encoding = "cbr"  # per device
```

| Mode | Pros | Cons |
|------|------|------|
| **VBR** (default) | Better quality-per-MB, adapts to content | Less predictable file sizes; adjacent preset changes may not always be detected |
| **CBR** | Predictable file sizes, reliable preset change detection | May waste bits on simple passages |

**Note:** VBR AAC works correctly for seeking on iPods (unlike VBR MP3). podkit defaults to VBR for better quality efficiency.

### Incompatible Lossy Bitrate Capping

When transcoding incompatible lossy sources (OGG, Opus), the effective bitrate is capped at the source file's bitrate to avoid creating a larger file with no quality benefit. For example, a 128 kbps OGG file transcoded with the `high` preset (256 kbps target) will be transcoded at 128 kbps, not 256 kbps.

## File Size Guidelines

| Preset | Approx Bitrate | File Size (4 min song) |
|--------|----------------|------------------------|
| **max** (ALAC) | ~900 kbps | ~26 MB |
| **max** (AAC fallback) | ~256 kbps | ~7.5 MB |
| **high** | ~256 kbps | ~7.5 MB |
| **medium** | ~192 kbps | ~5.6 MB |
| **low** | ~128 kbps | ~3.8 MB |

VBR file sizes vary based on content complexity. CBR sizes are exact. The `max` preset produces ALAC (lossless) on devices that support it, otherwise AAC at the same quality as `high`.

## AAC Encoders

FFmpeg can use several AAC encoders. podkit automatically selects the best available:

| Encoder | Quality | Platform | Availability |
|---------|---------|----------|--------------|
| **aac_at** | Excellent | macOS only | AudioToolbox |
| **libfdk_aac** | Excellent | Custom build | Fraunhofer reference |
| **aac** (native) | Very Good | All platforms | Always available |

### Platform Availability

| Platform | Encoders Available | Best Available |
|----------|-------------------|----------------|
| macOS (Homebrew) | `aac`, `aac_at` | `aac_at` |
| Linux (apt/dnf) | `aac` only | `aac` |
| Linux (custom build) | `aac`, `libfdk_aac` | `libfdk_aac` |

The native FFmpeg AAC encoder is very good and sufficient for most uses. macOS users get Apple's encoder (`aac_at`) automatically.

### Check Your Encoders

```bash
ffmpeg -encoders 2>/dev/null | grep aac
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Encoder not found" | Missing codec | Install FFmpeg properly |
| Metadata not preserved | FFmpeg issue | Check FFmpeg version |
| Low quality output | Wrong preset | Check quality configuration |
| "Invalid data" errors | Corrupt source file | Validate input files |

### Debugging

```bash
# Check FFmpeg encoders
ffmpeg -encoders 2>/dev/null | grep aac

# Check a specific file
ffprobe -v error -show_streams input.flac

# Run sync with debug output
podkit sync -vvv --dry-run
```

## See Also

- [Codec Preferences](/user-guide/transcoding/codec-preferences) - How podkit selects the audio codec
- [Transcoding Methodology](/user-guide/transcoding) - How podkit decides what to transcode
- [Video Transcoding](/user-guide/transcoding/video) - Video transcoding settings and device profiles
- [Quality Presets Reference](/reference/quality-presets) - Detailed preset specifications
- [Configuration](/user-guide/configuration) - Config file options
