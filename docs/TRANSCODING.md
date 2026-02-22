# Transcoding Guide

## Overview

podkit uses FFmpeg for audio transcoding. This document covers AAC encoding configuration, quality settings, and platform-specific considerations.

## Quick Reference

### Recommended Presets

| Preset | Mode | Target | Description |
|--------|------|--------|-------------|
| `high` | VBR | ~256 kbps | Transparent quality, recommended for most users |
| `medium` | VBR | ~192 kbps | Excellent quality, good balance |
| `low` | VBR | ~128 kbps | Good quality, space-efficient |
| `cbr-256` | CBR | 256 kbps | Constant bitrate, predictable file sizes |
| `cbr-192` | CBR | 192 kbps | Constant bitrate |
| `cbr-128` | CBR | 128 kbps | Constant bitrate |

**Default:** `high` (VBR ~256 kbps)

### VBR vs CBR

| Mode | Pros | Cons |
|------|------|------|
| **VBR** | Better quality-per-MB, adapts to content complexity | Less predictable file sizes |
| **CBR** | Predictable file sizes, simpler | May waste bits on simple passages |

**Note:** VBR AAC works correctly for seeking on iPods (unlike VBR MP3). podkit defaults to VBR for better quality efficiency.

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

## Quality Presets

### Preset Definitions

```typescript
type BitrateMode = 'vbr' | 'cbr';

interface TranscodePreset {
  name: string;
  mode: BitrateMode;
  // For VBR: quality level (0-5 scale, higher = better)
  // For CBR: target bitrate in kbps
  value: number;
  description: string;
}

const PRESETS: Record<string, TranscodePreset> = {
  // VBR presets (recommended - better quality per MB)
  'high':   { name: 'high',   mode: 'vbr', value: 5, description: '~256 kbps, transparent' },
  'medium': { name: 'medium', mode: 'vbr', value: 4, description: '~192 kbps, excellent' },
  'low':    { name: 'low',    mode: 'vbr', value: 2, description: '~128 kbps, good' },

  // CBR presets (predictable file sizes)
  'cbr-256': { name: 'cbr-256', mode: 'cbr', value: 256, description: '256 kbps constant' },
  'cbr-192': { name: 'cbr-192', mode: 'cbr', value: 192, description: '192 kbps constant' },
  'cbr-128': { name: 'cbr-128', mode: 'cbr', value: 128, description: '128 kbps constant' },
};
```

### VBR Quality Mapping

VBR quality levels map differently per encoder:

| Preset | Native AAC (`-q:a`) | libfdk_aac (`-vbr`) | Approx Bitrate |
|--------|---------------------|---------------------|----------------|
| high | 5 | 5 | ~256 kbps |
| medium | 4 | 4 | ~192 kbps |
| low | 2 | 3 | ~128 kbps |

### File Size Guidelines

| Preset | Mode | Approx Bitrate | File Size (4 min song) |
|--------|------|----------------|------------------------|
| **high** | VBR | ~256 kbps | ~7.5 MB |
| **medium** | VBR | ~192 kbps | ~5.6 MB |
| **low** | VBR | ~128 kbps | ~3.8 MB |
| **cbr-256** | CBR | 256 kbps | 7.5 MB |
| **cbr-192** | CBR | 192 kbps | 5.6 MB |
| **cbr-128** | CBR | 128 kbps | 3.8 MB |

**Note:** VBR file sizes vary based on content complexity. CBR sizes are exact.

**Note:** For critical listening or archival, keep lossless source files and only transcode to the device.

## FFmpeg Commands

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

### Transcoder Interface

```typescript
interface TranscoderConfig {
  ffmpegPath?: string;  // Auto-detect if not specified
  tempDir: string;
}

interface TranscodeOptions {
  preset: 'high' | 'medium' | 'low' | TranscodePreset;
  preserveMetadata: boolean;
  preserveArtwork: boolean;
}

interface TranscodeResult {
  outputPath: string;
  duration: number;
  bitrate: number;
  encoder: string;
}

class Transcoder {
  constructor(config: TranscoderConfig);

  // Detect FFmpeg and available encoders
  async detect(): Promise<{
    available: boolean;
    version: string;
    encoders: string[];
    preferredEncoder: string;
  }>;

  // Transcode a file
  async transcode(
    inputPath: string,
    outputPath: string,
    options: TranscodeOptions
  ): Promise<TranscodeResult>;

  // Get audio metadata
  async probe(filePath: string): Promise<AudioMetadata>;
}
```

### Encoder Selection Logic

```typescript
function selectEncoder(available: string[]): string {
  // Prefer in order: aac_at ≥ libfdk_aac > aac
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
  preset: TranscodePreset,
  options: TranscodeOptions
): string[] {
  const args = ['-i', input, '-c:a', encoder];

  // Apply quality settings based on mode
  if (preset.mode === 'vbr') {
    args.push(...getVbrArgs(encoder, preset.value));
  } else {
    args.push('-b:a', `${preset.value}k`);
  }

  // Common settings
  args.push('-ar', '44100', '-ac', '2');

  if (options.preserveMetadata) {
    args.push('-map_metadata', '0');
  }

  if (options.preserveArtwork) {
    args.push('-c:v', 'copy', '-disposition:v', 'attached_pic');
  }

  // Output format (M4A container optimized for iPod)
  args.push('-f', 'ipod', '-y', output);

  return args;
}

function getVbrArgs(encoder: string, quality: number): string[] {
  switch (encoder) {
    case 'libfdk_aac':
      // libfdk_aac uses -vbr 1-5 scale
      // Also set cutoff to preserve high frequencies
      return ['-vbr', String(quality), '-cutoff', '18000'];
    case 'aac_at':
      // aac_at uses -q:a 0-14 scale (14 = highest)
      // Map our 1-5 to aac_at's scale
      const aacAtQuality = Math.round(quality * 2.8);
      return ['-q:a', String(aacAtQuality)];
    case 'aac':
    default:
      // Native AAC uses -q:a 0.1-5 scale
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

## Future Considerations

### Opus Codec

If iPod compatibility weren't required, Opus would be ideal:
- Better quality at lower bitrates
- Open, royalty-free
- Native FFmpeg support

However, iPods don't support Opus, so AAC remains the best choice.

### ALAC (Apple Lossless)

For users who prioritize quality over space:
```bash
ffmpeg -i input.flac -c:a alac output.m4a
```

iPods support ALAC natively, so no transcoding losses. Consider offering this as a "lossless" preset.

## References

- [FFmpeg AAC Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/AAC)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [Fraunhofer FDK AAC](https://wiki.hydrogenaud.io/index.php?title=Fraunhofer_FDK_AAC)
- [Apple AudioToolbox](https://developer.apple.com/documentation/audiotoolbox)
- [Hydrogenaudio AAC Comparison](https://wiki.hydrogenaud.io/index.php?title=AAC_encoders)
