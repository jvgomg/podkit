---
title: Transcoding
description: Configure audio transcoding quality, codecs, and presets for syncing to iPod.
sidebar:
  order: 3
---

# Transcoding

podkit uses FFmpeg to transcode audio files to iPod-compatible formats. This guide covers quality settings, encoder options, and how podkit decides what to transcode.

## Quick Reference

### Quality Presets

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

### Source File Categories

| Category | Formats | Behavior |
|----------|---------|----------|
| **Lossless** | FLAC, WAV, AIFF, ALAC | Transcode to target preset |
| **Compatible Lossy** | MP3, M4A (AAC) | Copy as-is (no re-encoding) |
| **Incompatible Lossy** | OGG, Opus | Transcode + lossy-to-lossy warning |

## Configuration

### CLI Usage

```bash
# Default: VBR ~256 kbps
podkit sync

# Lossless (ALAC) with fallback for lossy sources
podkit sync --quality alac --fallback max

# Guaranteed 320 kbps CBR
podkit sync --quality max-cbr

# Space-efficient
podkit sync --quality low
```

### Config File

```toml
[transcode]
quality = "high"      # alac | max | max-cbr | high | high-cbr | medium | medium-cbr | low | low-cbr
fallback = "max"      # Fallback for lossy sources when quality=alac
```

## How Transcoding Works

### Decision Logic

| Source | Target: ALAC | Target: AAC preset |
|--------|--------------|-------------------|
| Lossless | Convert to ALAC | Transcode to AAC |
| Compatible Lossy | **Copy as-is** | Copy as-is |
| Incompatible Lossy | **Fallback** + warn | Transcode + warn |

**Why copy compatible lossy?** Re-encoding MP3 to AAC only loses quality. Even "upconverting" 128kbps to 256kbps wastes space without improving audio.

**Lossy-to-lossy warning:** During `--dry-run`, podkit flags incompatible lossy files (OGG, Opus) that require lossy-to-lossy conversion.

### Example Scenarios

**Scenario 1: Audiophile with mixed collection**

```toml
quality = "alac"
fallback = "max"
```

| Source | Result |
|--------|--------|
| FLAC | ALAC (lossless preserved) |
| MP3 320 | Copy as-is |
| OGG 192 | AAC ~320 VBR (fallback) + warning |

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

## Metadata and Artwork

podkit preserves metadata through transcoding:

- All standard tags (title, artist, album, etc.)
- Album artwork (embedded in output file)
- Track numbers, disc numbers, year, genre

Artwork is preserved by default. To skip artwork transfer:

```bash
podkit sync --no-artwork
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

- [Quality Presets Reference](/reference/quality-presets) - Detailed preset specifications
- [Configuration](/user-guide/configuration) - Config file options
- [Music Sources](/user-guide/music-sources) - Source configuration
