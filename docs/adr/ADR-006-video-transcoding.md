# ADR-006: Video Transcoding

## Status

**Accepted** (2026-03-08)

## Implementation Notes

The video sync feature was implemented as proposed with the following details:

- **CLI command:** Implemented as `podkit video-sync` (separate command, not a `--type` flag on `sync`)
- **Quality presets:** Implemented exactly as specified (max/high/medium/low)
- **Device profiles:** iPod Classic, iPod Video 5G, and iPod Nano 3G-5G supported
- **Source quality capping:** Implemented to prevent upscaling low-quality content
- **Hardware acceleration:** VideoToolbox on macOS supported
- **Metadata adapter:** EmbeddedMetadataAdapter implemented using ffprobe
- **Passthrough detection:** Compatible files (H.264/AAC in M4V) are copied without transcoding

**Current limitations (as of initial implementation):**
- Full sync execution requires iPod database video support (libgpod video track support)
- Currently only dry-run mode is fully functional
- Plex, NFO, and TMDB adapters planned for future releases

## Context

podkit currently syncs audio to iPods. Users want to sync movies and TV shows as well. This requires video transcoding to iPod-compatible formats, quality management tied to device capabilities, and metadata handling for video content.

## Decision Drivers

- Video quality matched to device screen resolution
- Source quality awareness (don't upscale low-quality content)
- Consistent UX with audio transcoding (max/high/medium/low presets)
- Wide input format support with early validation
- Pass-through for already-compatible files
- Extensible metadata architecture

## iPod Video Capabilities

| Device | Max Resolution | Video Codec | Audio Codec | Container |
|--------|---------------|-------------|-------------|-----------|
| iPod Video (5th gen) | 320x240 | H.264 Baseline | AAC-LC | M4V |
| iPod Classic (6th/7th) | 640x480 | H.264 Main Profile | AAC-LC | M4V |
| iPod Nano (3rd-5th gen) | 320x240 | H.264 Baseline | AAC-LC | M4V |

**Common constraints:**
- Max video bitrate: ~2.5 Mbps (Classic), ~768 kbps (5th gen)
- Max audio bitrate: 160 kbps stereo AAC
- Frame rate: 30 fps max
- Profile/Level: Baseline 3.0 or Main 3.1

## Options Considered

### Option A: FFmpeg (CLI)

Execute FFmpeg for video transcoding, consistent with audio approach.

**Pros:**
- Consistent with audio transcoding (ADR-003)
- Excellent H.264 encoder (libx264)
- Full format support (MKV, MP4, AVI, MOV, etc.)
- Metadata extraction via ffprobe
- Hardware acceleration available (VideoToolbox on macOS)

**Cons:**
- Same external dependency as audio
- Video transcoding is CPU-intensive

### Option B: HandBrakeCLI

Use HandBrake's CLI tool.

**Pros:**
- Designed for video transcoding
- Good presets for Apple devices
- Excellent quality defaults

**Cons:**
- Additional external dependency
- Less programmatic control
- Preset-focused rather than parameter-focused

### Option C: GStreamer

Use GStreamer pipelines.

**Pros:**
- Plugin architecture
- Native Linux integration

**Cons:**
- Complex configuration
- Less portable
- Would introduce inconsistency with audio approach

## Decision

**Option A: FFmpeg (CLI)**

### Rationale

1. **Consistency** - Same tool used for audio transcoding
2. **Capability** - FFmpeg handles all required input formats
3. **Quality** - libx264 produces excellent H.264 output
4. **Integration** - ffprobe provides format detection and validation
5. **Acceleration** - Hardware encoding available on macOS (VideoToolbox)

## Quality Presets

Following the audio transcoding pattern, video uses max/high/medium/low presets that map to device-appropriate settings.

### Quality Philosophy

```
effective_bitrate = min(preset_bitrate, source_bitrate)
effective_resolution = min(device_resolution, source_resolution)
```

This prevents:
- "Upscaling" quality (wasting bitrate on low-quality sources)
- Creating files larger than necessary
- Encoding at higher resolution than source

### Preset Definitions

For iPod Classic (640x480):

| Preset | Video Bitrate | CRF | Audio Bitrate | Use Case |
|--------|--------------|-----|---------------|----------|
| max | 2500 kbps | 18 | 160 kbps | Best quality, largest files |
| high | 2000 kbps | 21 | 128 kbps | Excellent quality (default) |
| medium | 1500 kbps | 24 | 128 kbps | Good quality, smaller files |
| low | 1000 kbps | 27 | 96 kbps | Space-efficient |

For iPod Video/Nano (320x240):

| Preset | Video Bitrate | CRF | Audio Bitrate |
|--------|--------------|-----|---------------|
| max | 768 kbps | 20 | 128 kbps |
| high | 600 kbps | 23 | 128 kbps |
| medium | 400 kbps | 26 | 96 kbps |
| low | 300 kbps | 28 | 96 kbps |

### CRF vs Bitrate

- **CRF (Constant Rate Factor):** Quality-based encoding, variable file size
- **Target Bitrate:** Size-based encoding, variable quality

Recommendation: Use CRF with bitrate as a maximum cap. This produces consistent visual quality while respecting device limits.

## Source Quality Detection

Before transcoding, analyze source:

```typescript
interface SourceAnalysis {
  // Video
  videoCodec: string;
  width: number;
  height: number;
  bitrate: number;
  frameRate: number;

  // Audio
  audioCodec: string;
  audioBitrate: number;
  channels: number;

  // Compatibility
  isCompatible: boolean;  // Already iPod-ready?
  compatibilityIssues: string[];

  // Quality assessment
  effectiveQuality: 'high' | 'medium' | 'low';
}
```

### Quality Capping Logic

```typescript
function calculateEffectiveSettings(
  source: SourceAnalysis,
  preset: QualityPreset,
  device: DeviceProfile
): TranscodeSettings {
  const presetSettings = getPresetSettings(preset, device);

  return {
    // Never exceed source quality
    videoBitrate: Math.min(presetSettings.videoBitrate, source.bitrate),

    // Never upscale resolution
    width: Math.min(device.maxWidth, source.width),
    height: Math.min(device.maxHeight, source.height),

    // Maintain aspect ratio
    // ...scaling logic
  };
}
```

## Format Support

### Input Formats

| Format | Extensions | Status | Notes |
|--------|------------|--------|-------|
| Matroska | .mkv | Supported | Common for rips |
| MP4/M4V | .mp4, .m4v | Supported | May be passthrough |
| AVI | .avi | Supported | Legacy format |
| MOV | .mov | Supported | QuickTime |
| WebM | .webm | Supported | VP8/VP9 → H.264 |
| WMV | .wmv | Supported | Windows Media |
| FLV | .flv | Supported | Flash Video |

### Output Format

- **Container:** M4V (MP4 with Apple extensions)
- **Video:** H.264 (libx264 or VideoToolbox)
- **Audio:** AAC-LC stereo

### Validation During Dry-Run

```typescript
interface ValidationResult {
  status: 'compatible' | 'transcodable' | 'unsupported';
  message: string;
  warnings: string[];  // e.g., "Low quality source"
}
```

## Metadata Architecture

### Adapter Pattern

Following ADR-004's collection source pattern:

```typescript
interface VideoMetadataAdapter {
  readonly name: string;
  readonly description: string;

  /**
   * Extract metadata for a video file
   */
  getMetadata(filePath: string): Promise<VideoMetadata>;

  /**
   * Check if this adapter can handle the file
   */
  canHandle(filePath: string): Promise<boolean>;
}

interface VideoMetadata {
  // Common
  title: string;
  description?: string;
  year?: number;
  genre?: string;

  // Movie-specific
  type: 'movie' | 'tvshow';

  // TV Show-specific
  seriesName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;

  // Artwork
  posterPath?: string;
  hasEmbeddedPoster?: boolean;

  // Technical (from file analysis)
  duration: number;
  resolution: { width: number; height: number };
}
```

### Initial Implementation: Embedded Metadata

v1 uses ffprobe to extract embedded metadata:

```typescript
class EmbeddedMetadataAdapter implements VideoMetadataAdapter {
  readonly name = 'embedded';
  readonly description = 'Extract metadata from video file tags';

  async getMetadata(filePath: string): Promise<VideoMetadata> {
    // Use ffprobe to extract:
    // - Title from metadata tags
    // - Duration, resolution from streams
    // - Embedded poster if present
  }
}
```

### Future Adapters

- **PlexAdapter** - Query Plex API for rich metadata
- **NFOAdapter** - Parse Kodi/Plex .nfo sidecar files
- **TMDBAdapter** - Lookup via The Movie Database API

## Implementation

### FFmpeg Command Structure

```bash
# Basic video transcode for iPod Classic
ffmpeg -i input.mkv \
  -c:v libx264 -profile:v main -level 3.1 \
  -crf 21 -maxrate 2000k -bufsize 4000k \
  -vf "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:-1:-1:black" \
  -r 30 \
  -c:a aac -b:a 128k -ac 2 \
  -movflags +faststart \
  -f ipod output.m4v
```

### Hardware Acceleration (macOS)

```bash
# VideoToolbox encoding (faster, good quality)
ffmpeg -i input.mkv \
  -c:v h264_videotoolbox -profile:v main \
  -b:v 2000k \
  -vf "scale=640:480:..." \
  -c:a aac -b:a 128k \
  -f ipod output.m4v
```

### Interface Design

```typescript
interface VideoTranscoder {
  /**
   * Analyze source file for compatibility and quality
   */
  analyze(input: string): Promise<SourceAnalysis>;

  /**
   * Transcode with progress reporting
   */
  transcode(
    input: string,
    output: string,
    options: VideoTranscodeOptions
  ): AsyncIterable<TranscodeProgress>;

  /**
   * Check if file can be copied without transcoding
   */
  canPassthrough(analysis: SourceAnalysis, device: DeviceProfile): boolean;
}

interface VideoTranscodeOptions {
  device: DeviceProfile;
  quality: QualityPreset;
  metadata?: VideoMetadata;
}
```

## Content Type Detection

### Movie vs TV Show

Detection strategy (in order):
1. Embedded metadata tags (if present)
2. Folder structure patterns
3. Filename patterns

```typescript
// Folder patterns
const TV_FOLDER_PATTERNS = [
  /\/TV Shows?\//i,
  /\/Series\//i,
  /\/Season \d+/i,
];

// Filename patterns
const TV_FILE_PATTERNS = [
  /S\d{1,2}E\d{1,2}/i,      // S01E01
  /\d{1,2}x\d{1,2}/i,        // 1x01
  /Season \d+.*Episode \d+/i,
];
```

## Consequences

### Positive

- Consistent with audio transcoding approach
- Source quality awareness prevents wasted encoding
- Extensible metadata system for future integrations
- Early validation catches issues before sync

### Negative

- Video transcoding is CPU-intensive
- Additional complexity in sync engine
- Users must have FFmpeg with libx264

### Mitigation

- Use hardware acceleration where available
- Consider parallel transcoding for multi-core systems
- Clear progress reporting during transcoding
- Pre-transcode cache to avoid re-encoding

## Related Decisions

- ADR-003: Transcoding Backend - Video uses same FFmpeg approach
- ADR-004: Collection Sources - Metadata adapters follow same pattern

## References

- [FFmpeg H.264 Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/H.264)
- [Apple iPod Video Specifications](https://support.apple.com/kb/SP5)
- [libx264 Options](https://www.ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb)
- [VideoToolbox Encoding](https://developer.apple.com/documentation/videotoolbox)
