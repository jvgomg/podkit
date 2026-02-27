# Transcoding Guide

## Overview

podkit uses FFmpeg for audio transcoding. This document covers AAC encoding configuration, quality settings, ALAC (lossless) support, and platform-specific considerations.

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

**Key insight:** M4A files can be either AAC (lossy) or ALAC (lossless). podkit uses codec detection, not just file extension.

### VBR vs CBR

| Mode | Pros | Cons |
|------|------|------|
| **VBR** | Better quality-per-MB, adapts to content complexity | Less predictable file sizes |
| **CBR** | Predictable file sizes, simpler | May waste bits on simple passages |

**Note:** VBR AAC works correctly for seeking on iPods (unlike VBR MP3). podkit defaults to VBR for better quality efficiency.

## Configuration

### CLI Usage

```bash
# Default: VBR ~256 kbps
podkit sync --source ~/Music

# Lossless (ALAC) with fallback for lossy sources
podkit sync --quality alac --fallback max

# Guaranteed 320 kbps CBR
podkit sync --quality max-cbr

# Space-efficient
podkit sync --quality low
```

### Config File

```toml
# ~/.config/podkit/config.toml

[transcode]
quality = "high"      # alac | max | max-cbr | high | high-cbr | medium | medium-cbr | low | low-cbr
fallback = "max"      # Fallback for lossy sources when quality=alac (default: max)
```

### Environment Variables

```bash
export PODKIT_QUALITY=high
export PODKIT_FALLBACK=max
```

## Decision Logic

### How podkit Chooses Operations

| Source | Target: ALAC | Target: AAC preset |
|--------|--------------|-------------------|
| Lossless | Convert to ALAC | Transcode to AAC |
| Compatible Lossy | **Copy as-is** | Copy as-is |
| Incompatible Lossy | **Fallback** + warn | Transcode + warn |

**Why copy compatible lossy?** Re-encoding MP3→AAC only loses quality. Even "upconverting" 128kbps→256kbps wastes space without improving audio.

**Lossy-to-lossy warning:** During `--dry-run`, podkit flags incompatible lossy files (OGG, Opus) that will undergo lossy-to-lossy conversion. This informs users of unavoidable quality loss.

### Example Scenarios

#### Scenario 1: Audiophile with mixed collection
```toml
quality = "alac"
fallback = "max"
```
| Source | Result |
|--------|--------|
| FLAC → | ALAC (lossless preserved) |
| MP3 320 → | Copy as-is |
| OGG 192 → | AAC ~320 VBR (fallback) + warning |

#### Scenario 2: Space-conscious user
```toml
quality = "medium"
```
| Source | Result |
|--------|--------|
| FLAC → | AAC ~192 kbps VBR |
| MP3 128 → | Copy as-is |
| Opus 128 → | AAC ~192 kbps VBR + warning |

#### Scenario 3: Predictable file sizes
```toml
quality = "high-cbr"
```
| Source | Result |
|--------|--------|
| FLAC → | AAC 256 kbps CBR |
| MP3 320 → | Copy as-is |
| OGG 192 → | AAC 256 kbps CBR + warning |

#### Scenario 4: Maximum quality guarantee
```toml
quality = "max-cbr"
```
| Source | Result |
|--------|--------|
| FLAC → | AAC 320 kbps CBR |
| WAV → | AAC 320 kbps CBR |
| MP3 → | Copy as-is |

## Supported Input Formats

| Format | Extension(s) | Category | Notes |
|--------|--------------|----------|-------|
| FLAC | `.flac` | Lossless | Free Lossless Audio Codec |
| WAV | `.wav` | Lossless | Uncompressed PCM |
| AIFF | `.aiff`, `.aif` | Lossless | Apple's PCM format |
| ALAC | `.m4a` | Lossless | Detected by codec, not extension |
| MP3 | `.mp3` | Compatible Lossy | MPEG Audio Layer 3 |
| AAC | `.m4a`, `.aac` | Compatible Lossy | Advanced Audio Coding |
| OGG | `.ogg` | Incompatible Lossy | Ogg Vorbis |
| Opus | `.opus` | Incompatible Lossy | Opus codec in Ogg container |

## Why FFmpeg?

| Backend | Pros | Cons |
|---------|------|------|
| **FFmpeg** | Ubiquitous, excellent codec support, well-documented | Complex CLI, version variations |
| **GStreamer** | Plugin architecture, Linux native | Less portable, configuration complexity |
| **faac** | Simple, dedicated AAC encoder | Outdated, lower quality than alternatives |
| **libav** | Fork of FFmpeg | Less active, confusing naming |

FFmpeg is the recommended choice for:
- **Portability** - Available on all major platforms
- **Quality** - Native AAC encoder is high quality
- **Features** - Metadata handling, format detection, filtering
- **Documentation** - Extensive community resources

## AAC Encoders in FFmpeg

FFmpeg can use several AAC encoders:

| Encoder | Quality | License | Availability |
|---------|---------|---------|--------------|
| **aac_at** | Excellent | Proprietary | macOS only (AudioToolbox) |
| **libfdk_aac** | Excellent | Non-free | Requires custom build |
| **aac** (native) | Very Good | LGPL | Always available |

### Platform Availability

| Platform | Encoders Available | Best Available |
|----------|-------------------|----------------|
| macOS (Homebrew) | `aac`, `aac_at` | `aac_at` |
| Linux (apt/dnf) | `aac` only | `aac` |
| Linux (custom build) | `aac`, `libfdk_aac` | `libfdk_aac` |

### Encoder Selection Strategy

podkit automatically selects the best available encoder:

```typescript
function selectEncoder(available: string[]): string {
  // Prefer in order of quality
  if (available.includes('aac_at')) return 'aac_at';       // macOS
  if (available.includes('libfdk_aac')) return 'libfdk_aac'; // Custom build
  if (available.includes('aac')) return 'aac';             // Always available
  throw new Error('No AAC encoder available');
}
```

### Building FFmpeg with libfdk_aac (Linux)

For the best quality on Linux, you can build FFmpeg with the Fraunhofer FDK AAC encoder. See [`tools/ffmpeg-linux/`](../tools/ffmpeg-linux/) for build scripts:

```bash
cd tools/ffmpeg-linux
sudo ./install-deps.sh
./build-ffmpeg.sh

# Use the custom build
export PODKIT_FFMPEG_PATH="$(pwd)/ffmpeg-build/bin/ffmpeg"
```

**Note:** The native FFmpeg AAC encoder is very good and sufficient for most uses. Custom builds are optional.

### Encoder Detection

```bash
# Check available encoders
ffmpeg -encoders 2>/dev/null | grep aac

# Output example:
#  A..... aac              AAC (Advanced Audio Coding)
#  A..... libfdk_aac       Fraunhofer FDK AAC
#  A..... aac_at           aac (AudioToolbox)
```

### Quality Ranking

Per [FFmpeg Wiki](https://trac.ffmpeg.org/wiki/Encode/AAC), for transparent audio quality:

1. **aac_at** - Apple's encoder (macOS only) - equal to or better than libfdk_aac
2. **libfdk_aac** - Fraunhofer reference implementation (requires custom build)
3. **aac** (native) - FFmpeg's built-in encoder

The native AAC encoder is **very good** for most use cases and doesn't require special builds. macOS users get the best encoder (`aac_at`) automatically via Homebrew.

## Preset Definitions

### Internal Implementation

```typescript
type QualityPreset =
  | 'alac'
  | 'max' | 'max-cbr'
  | 'high' | 'high-cbr'
  | 'medium' | 'medium-cbr'
  | 'low' | 'low-cbr';

const AAC_PRESETS = {
  // VBR presets (variable bitrate, better quality-per-byte)
  'max':        { mode: 'vbr', quality: 5, targetKbps: 320 },
  'high':       { mode: 'vbr', quality: 5, targetKbps: 256 },
  'medium':     { mode: 'vbr', quality: 4, targetKbps: 192 },
  'low':        { mode: 'vbr', quality: 2, targetKbps: 128 },

  // CBR presets (constant bitrate, predictable sizes)
  'max-cbr':    { mode: 'cbr', targetKbps: 320 },
  'high-cbr':   { mode: 'cbr', targetKbps: 256 },
  'medium-cbr': { mode: 'cbr', targetKbps: 192 },
  'low-cbr':    { mode: 'cbr', targetKbps: 128 },
};

const ALAC_PRESET = { codec: 'alac', container: 'm4a', estimatedKbps: 900 };
```

### VBR Quality Mapping

VBR quality levels map differently per encoder:

| Preset | Native AAC (`-q:a`) | libfdk_aac (`-vbr`) | aac_at (`-q:a`) | Approx Bitrate |
|--------|---------------------|---------------------|-----------------|----------------|
| max/high | 5 | 5 | 14 | ~256-320 kbps |
| medium | 4 | 4 | 11 | ~192 kbps |
| low | 2 | 3 | 6 | ~128 kbps |

**Note:** FFmpeg's native AAC VBR tops out around ~256 kbps, so `max` VBR may produce similar bitrates to `high`. Use `max-cbr` for guaranteed 320 kbps.

### File Size Guidelines

| Preset | Mode | Approx Bitrate | File Size (4 min song) |
|--------|------|----------------|------------------------|
| **alac** | Lossless | ~900 kbps | ~26 MB |
| **max** | VBR | ~320 kbps | ~9.4 MB |
| **high** | VBR | ~256 kbps | ~7.5 MB |
| **medium** | VBR | ~192 kbps | ~5.6 MB |
| **low** | VBR | ~128 kbps | ~3.8 MB |
| **max-cbr** | CBR | 320 kbps | 9.4 MB |
| **high-cbr** | CBR | 256 kbps | 7.5 MB |
| **medium-cbr** | CBR | 192 kbps | 5.6 MB |
| **low-cbr** | CBR | 128 kbps | 3.8 MB |

**Note:** VBR file sizes vary based on content complexity. CBR sizes are exact.

**Note:** For critical listening or archival, keep lossless source files and only transcode to the device.

## FFmpeg Commands

### ALAC Encoding (Lossless)

```bash
# Convert FLAC to ALAC
ffmpeg -i input.flac -c:a alac -ar 44100 -map_metadata 0 -f ipod output.m4a

# Preserve artwork
ffmpeg -i input.flac -c:a alac -c:v copy -disposition:v attached_pic -map_metadata 0 -f ipod output.m4a
```

### VBR Encoding (Recommended)

```bash
# High quality VBR (native AAC)
ffmpeg -i input.flac -c:a aac -q:a 5 -ar 44100 -map_metadata 0 output.m4a

# Medium quality VBR
ffmpeg -i input.flac -c:a aac -q:a 4 -ar 44100 -map_metadata 0 output.m4a

# Low quality VBR
ffmpeg -i input.flac -c:a aac -q:a 2 -ar 44100 -map_metadata 0 output.m4a
```

### CBR Encoding

```bash
# 320 kbps CBR
ffmpeg -i input.flac -c:a aac -b:a 320k -ar 44100 -map_metadata 0 output.m4a

# 256 kbps CBR
ffmpeg -i input.flac -c:a aac -b:a 256k -ar 44100 -map_metadata 0 output.m4a

# 192 kbps CBR
ffmpeg -i input.flac -c:a aac -b:a 192k -ar 44100 -map_metadata 0 output.m4a

# 128 kbps CBR
ffmpeg -i input.flac -c:a aac -b:a 128k -ar 44100 -map_metadata 0 output.m4a
```

### VBR Quality Scale

For FFmpeg's native AAC encoder (`-q:a`):

| Value | Approximate Bitrate | Quality |
|-------|---------------------|---------|
| 0.1 | ~20 kbps | Very low |
| 1 | ~64 kbps | Low |
| 2 | ~128 kbps | Good |
| 3 | ~160 kbps | Very good |
| 4 | ~192 kbps | Excellent |
| 5 | ~256 kbps | Transparent |

### With libfdk_aac (Custom Build)

```bash
# VBR mode (recommended)
ffmpeg -i input.flac -c:a libfdk_aac -vbr 5 -cutoff 18000 output.m4a

# CBR mode
ffmpeg -i input.flac -c:a libfdk_aac -b:a 256k output.m4a
```

**Note:** libfdk_aac defaults to a 14kHz low-pass filter. Use `-cutoff 18000` to preserve higher frequencies.

### With aac_at (macOS)

```bash
# VBR mode
ffmpeg -i input.flac -c:a aac_at -q:a 14 -ar 44100 output.m4a

# CBR mode
ffmpeg -i input.flac -c:a aac_at -b:a 256k -ar 44100 output.m4a
```

### Metadata Handling

```bash
# Preserve all metadata from source
ffmpeg -i input.flac -c:a aac -b:a 256k \
  -map_metadata 0 \
  -id3v2_version 3 \
  output.m4a

# Set specific metadata
ffmpeg -i input.flac -c:a aac -b:a 256k \
  -metadata title="Song Title" \
  -metadata artist="Artist Name" \
  -metadata album="Album Name" \
  output.m4a
```

### Artwork Handling

```bash
# Preserve embedded artwork
ffmpeg -i input.flac -c:a aac -b:a 256k \
  -c:v copy \
  -disposition:v attached_pic \
  output.m4a

# Extract artwork to file
ffmpeg -i input.flac -an -c:v copy cover.jpg

# Embed artwork from file
ffmpeg -i input.flac -i cover.jpg -c:a aac -b:a 256k \
  -c:v copy -map 0:a -map 1:v \
  -disposition:v attached_pic \
  output.m4a
```

## Platform-Specific Configuration

### Debian/Ubuntu

```bash
# Install FFmpeg
sudo apt update
sudo apt install ffmpeg

# Verify installation
ffmpeg -version

# Check for AAC encoder
ffmpeg -encoders 2>/dev/null | grep aac
```

**Note:** Debian's FFmpeg includes the native AAC encoder but **not** libfdk_aac due to licensing.

#### Building FFmpeg with libfdk_aac (Optional)

```bash
# Install dependencies
sudo apt install build-essential yasm libfdk-aac-dev

# Download FFmpeg source
wget https://ffmpeg.org/releases/ffmpeg-6.1.tar.xz
tar xf ffmpeg-6.1.tar.xz
cd ffmpeg-6.1

# Configure with libfdk_aac (non-redistributable)
./configure --enable-libfdk-aac --enable-nonfree

# Build
make -j$(nproc)
sudo make install
```

### macOS

```bash
# Install via Homebrew
brew install ffmpeg

# Verify aac_at encoder (AudioToolbox)
ffmpeg -encoders 2>/dev/null | grep aac_at
```

macOS FFmpeg from Homebrew includes:
- Native AAC encoder (`aac`)
- AudioToolbox encoder (`aac_at`) - Apple's encoder

#### Using AudioToolbox (macOS)

```bash
# Use Apple's AAC encoder (highest quality on macOS)
ffmpeg -i input.flac -c:a aac_at -b:a 256k output.m4a

# AAC-LC profile (default, most compatible)
ffmpeg -i input.flac -c:a aac_at -aac_at_mode cvbr -b:a 256k output.m4a
```

### Windows

```powershell
# Install via winget
winget install FFmpeg

# Or via Chocolatey
choco install ffmpeg

# Or download from: https://www.gyan.dev/ffmpeg/builds/
```

### Alpine Linux (Docker)

```dockerfile
FROM alpine:3.19

RUN apk add --no-cache ffmpeg

# Verify
RUN ffmpeg -encoders 2>/dev/null | grep aac
```

## Implementation in podkit

### TranscodeConfig Interface

```typescript
interface TranscodeConfig {
  /** Primary quality target (applies to lossless sources) */
  quality: QualityPreset;

  /**
   * Fallback for lossy sources when quality='alac' or for incompatible formats.
   * Default: 'max' if quality='alac', otherwise inherits from quality
   */
  fallback?: Exclude<QualityPreset, 'alac'>;
}
```

### Source Categorization

```typescript
type SourceCategory = 'lossless' | 'compatible-lossy' | 'incompatible-lossy';

function categorizeSource(track: CollectionTrack): SourceCategory {
  // Unambiguously lossless by extension
  if (['flac', 'wav', 'aiff'].includes(track.fileType)) {
    return 'lossless';
  }
  // Incompatible lossy (requires transcoding)
  if (['ogg', 'opus'].includes(track.fileType)) {
    return 'incompatible-lossy';
  }
  // MP3 is always compatible lossy
  if (track.fileType === 'mp3') {
    return 'compatible-lossy';
  }
  // M4A/AAC requires codec detection (could be AAC or ALAC)
  if (track.fileType === 'm4a' || track.fileType === 'aac') {
    return track.codec === 'alac' ? 'lossless' : 'compatible-lossy';
  }
  // Unknown formats: treat as incompatible (safe default, triggers warning)
  return 'incompatible-lossy';
}
```

### Encoder Selection Logic

```typescript
function selectEncoder(available: string[]): string {
  // Prefer in order: aac_at >= libfdk_aac > aac
  const priority = ['aac_at', 'libfdk_aac', 'aac'];

  for (const encoder of priority) {
    if (available.includes(encoder)) {
      return encoder;
    }
  }

  throw new Error('No AAC encoder available');
}
```

### Command Building

```typescript
function buildCommand(
  input: string,
  output: string,
  encoder: string,
  preset: QualityPreset
): string[] {
  // Handle ALAC
  if (preset === 'alac') {
    return [
      '-i', input,
      '-c:a', 'alac',
      '-ar', '44100',
      '-map_metadata', '0',
      '-c:v', 'copy', '-disposition:v', 'attached_pic',
      '-f', 'ipod', '-y', output
    ];
  }

  const aacPreset = AAC_PRESETS[preset];
  const args = ['-i', input, '-c:a', encoder];

  // Apply quality settings based on mode
  if (aacPreset.mode === 'vbr') {
    args.push(...getVbrArgs(encoder, aacPreset.quality));
  } else {
    args.push('-b:a', `${aacPreset.targetKbps}k`);
  }

  // Common settings
  args.push('-ar', '44100');
  args.push('-map_metadata', '0');
  args.push('-c:v', 'copy', '-disposition:v', 'attached_pic');
  args.push('-f', 'ipod', '-y', output);

  return args;
}

function getVbrArgs(encoder: string, quality: number): string[] {
  switch (encoder) {
    case 'libfdk_aac':
      return ['-vbr', String(quality), '-cutoff', '18000'];
    case 'aac_at':
      const aacAtQuality = Math.round(quality * 2.8);
      return ['-q:a', String(aacAtQuality)];
    case 'aac':
    default:
      return ['-q:a', String(quality)];
  }
}
```

## Quality Verification

### Objective Metrics

```bash
# Compare bitrates
ffprobe -v error -show_entries format=bit_rate -of default=noprint_wrappers=1 output.m4a

# Check encoding settings
ffprobe -v error -show_streams -select_streams a output.m4a
```

### Listening Tests

For critical evaluation:
1. Use high-quality headphones or speakers
2. Compare against original lossless source
3. Test with various genres (classical, electronic, acoustic)
4. Use ABX testing for blind comparison

### Recommended Test Tracks

- Complex orchestral pieces (classical)
- High-frequency content (cymbals, hi-hats)
- Quiet passages with subtle details
- Spoken word with sibilance

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Encoder not found" | Missing codec | Install FFmpeg properly |
| Metadata not preserved | Missing `-map_metadata` | Add flag to command |
| Artwork lost | Incorrect mapping | Use `-c:v copy` |
| Low quality output | Wrong bitrate | Check preset configuration |
| "Invalid data" errors | Corrupt source file | Validate input first |

### Debugging Commands

```bash
# Verbose FFmpeg output
ffmpeg -v verbose -i input.flac -c:a aac -b:a 256k output.m4a

# Show all streams in file
ffprobe -v error -show_streams input.flac

# Check for codec issues
ffmpeg -v error -i input.flac -f null -
```

## References

- [FFmpeg AAC Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/AAC)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [Fraunhofer FDK AAC](https://wiki.hydrogenaud.io/index.php?title=Fraunhofer_FDK_AAC)
- [Apple AudioToolbox](https://developer.apple.com/documentation/audiotoolbox)
- [Hydrogenaudio AAC Comparison](https://wiki.hydrogenaud.io/index.php?title=AAC_encoders)
