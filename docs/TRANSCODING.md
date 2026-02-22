# Transcoding Guide

## Overview

podkit uses FFmpeg for audio transcoding. This document covers AAC encoding configuration, quality settings, and platform-specific considerations.

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
| **aac** (native) | Very Good | LGPL | Always available |
| **libfdk_aac** | Excellent | Non-free | Requires compilation flag |
| **aac_at** | Excellent | Proprietary | macOS only |

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

For transparent audio quality:
1. **libfdk_aac** - Fraunhofer reference implementation
2. **aac_at** - Apple's encoder (macOS)
3. **aac** (native) - FFmpeg's built-in encoder

However, the native AAC encoder is **excellent** for most use cases and doesn't require special builds.

## Quality Presets

### Preset Definitions

```typescript
interface TranscodePreset {
  name: string;
  encoder: 'aac' | 'libfdk_aac' | 'aac_at';
  bitrate?: number;      // CBR mode (kbps)
  vbr?: number;          // VBR mode (1-5, encoder specific)
  sampleRate: number;
  channels: number;
}

const PRESETS = {
  high: {
    name: 'high',
    encoder: 'aac',
    bitrate: 256,
    sampleRate: 44100,
    channels: 2,
  },
  medium: {
    name: 'medium',
    encoder: 'aac',
    bitrate: 192,
    sampleRate: 44100,
    channels: 2,
  },
  low: {
    name: 'low',
    encoder: 'aac',
    bitrate: 128,
    sampleRate: 44100,
    channels: 2,
  },
};
```

### Bitrate Guidelines

| Preset | Bitrate | Quality | File Size (4 min song) |
|--------|---------|---------|------------------------|
| **High** | 256 kbps | Transparent | ~7.5 MB |
| **Medium** | 192 kbps | Excellent | ~5.6 MB |
| **Low** | 128 kbps | Good | ~3.8 MB |

**Note:** For critical listening or archival, consider keeping lossless files and only transcoding to the device.

## FFmpeg Commands

### Basic Transcoding

```bash
# High quality (256 kbps CBR)
ffmpeg -i input.flac -c:a aac -b:a 256k -ar 44100 output.m4a

# With metadata preservation
ffmpeg -i input.flac -c:a aac -b:a 256k -ar 44100 -map_metadata 0 output.m4a

# VBR mode (quality-based)
ffmpeg -i input.flac -c:a aac -q:a 2 -ar 44100 output.m4a
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

### With libfdk_aac (if available)

```bash
# CBR mode
ffmpeg -i input.flac -c:a libfdk_aac -b:a 256k output.m4a

# VBR mode (1-5, 5 is highest quality)
ffmpeg -i input.flac -c:a libfdk_aac -vbr 5 output.m4a
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
  // Prefer in order: libfdk_aac > aac_at > aac
  const priority = ['libfdk_aac', 'aac_at', 'aac'];

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
  preset: TranscodePreset,
  options: TranscodeOptions
): string[] {
  const args = [
    '-i', input,
    '-c:a', preset.encoder,
    '-b:a', `${preset.bitrate}k`,
    '-ar', String(preset.sampleRate),
    '-ac', String(preset.channels),
  ];

  if (options.preserveMetadata) {
    args.push('-map_metadata', '0');
  }

  if (options.preserveArtwork) {
    args.push('-c:v', 'copy');
    args.push('-disposition:v', 'attached_pic');
  }

  // Output format
  args.push('-f', 'ipod');  // M4A container optimized for iPod

  // Overwrite output
  args.push('-y');

  args.push(output);

  return args;
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
