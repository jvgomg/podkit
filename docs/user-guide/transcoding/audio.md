---
title: Audio Transcoding
description: Configure audio transcoding quality, codecs, and presets for syncing music to iPod.
sidebar:
  order: 2
---

This guide covers audio quality presets, encoder options, and file size estimates. For an overview of how podkit decides what to transcode, see [Transcoding Methodology](/user-guide/transcoding).

## Quality Presets

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

**Default:** `high` (VBR ~256 kbps)

## Configuration

### CLI Usage

```bash
# Default: VBR ~256 kbps
podkit sync

# Lossless (ALAC) with lossy quality fallback
podkit sync --audio-quality alac --lossy-quality max

# Guaranteed 320 kbps CBR
podkit sync --audio-quality max-cbr

# Space-efficient
podkit sync --quality low

# Set unified quality, but override audio specifically
podkit sync --quality medium --audio-quality high
```

### Config File

```toml
# Top-level settings in config.toml
quality = "high"          # Unified quality for audio and video
audioQuality = "high"     # Audio-specific override: alac | max | max-cbr | high | high-cbr | medium | medium-cbr | low | low-cbr
lossyQuality = "max"     # Quality for lossy sources when audioQuality = "alac"
```

## Example Scenarios

**Scenario 1: Audiophile with mixed collection**

```toml
audioQuality = "alac"
lossyQuality = "max"
```

| Source | Result |
|--------|--------|
| FLAC | ALAC (lossless preserved) |
| MP3 320 | Copy as-is |
| OGG 192 | AAC ~320 VBR (lossy quality) + warning |

**Scenario 2: Space-conscious user**

```toml
quality = "medium"
```

| Source | Result |
|--------|--------|
| FLAC | AAC ~192 kbps VBR |
| MP3 128 | Copy as-is |
| Opus 128 | AAC ~192 kbps VBR + warning |

**Scenario 3: Predictable file sizes**

```toml
quality = "high-cbr"
```

| Source | Result |
|--------|--------|
| FLAC | AAC 256 kbps CBR |
| MP3 320 | Copy as-is |
| OGG 192 | AAC 256 kbps CBR + warning |

## VBR vs CBR

| Mode | Pros | Cons |
|------|------|------|
| **VBR** | Better quality-per-MB, adapts to content | Less predictable file sizes |
| **CBR** | Predictable file sizes | May waste bits on simple passages |

**Note:** VBR AAC works correctly for seeking on iPods (unlike VBR MP3). podkit defaults to VBR for better quality efficiency.

## File Size Guidelines

| Preset | Mode | Approx Bitrate | File Size (4 min song) |
|--------|------|----------------|------------------------|
| **alac** | Lossless | ~900 kbps | ~26 MB |
| **max** | VBR | ~320 kbps | ~9.4 MB |
| **high** | VBR | ~256 kbps | ~7.5 MB |
| **medium** | VBR | ~192 kbps | ~5.6 MB |
| **low** | VBR | ~128 kbps | ~3.8 MB |

VBR file sizes vary based on content complexity. CBR sizes are exact.

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

- [Transcoding Methodology](/user-guide/transcoding) - How podkit decides what to transcode
- [Video Transcoding](/user-guide/transcoding/video) - Video transcoding settings and device profiles
- [Quality Presets Reference](/reference/quality-presets) - Detailed preset specifications
- [Configuration](/user-guide/configuration) - Config file options
