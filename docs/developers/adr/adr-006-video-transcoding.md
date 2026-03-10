---
title: "ADR-006: Video Transcoding"
description: Decision to use FFmpeg for video transcoding to iPod-compatible formats.
sidebar:
  order: 7
---

# ADR-006: Video Transcoding

## Status

**Accepted** (2026-03-08)

## Context

podkit syncs audio to iPods. Users want to sync movies and TV shows as well, requiring video transcoding to iPod-compatible formats, quality management, and metadata handling.

## Decision Drivers

- Video quality matched to device screen resolution
- Source quality awareness (don't upscale low-quality content)
- Consistent UX with audio transcoding (max/high/medium/low presets)
- Wide input format support
- Pass-through for already-compatible files

## Decision

**FFmpeg (CLI) for video transcoding**

### Rationale

1. **Consistency** - Same tool used for audio transcoding
2. **Capability** - FFmpeg handles all required input formats
3. **Quality** - libx264 produces excellent H.264 output
4. **Acceleration** - Hardware encoding on macOS (VideoToolbox)

## iPod Video Capabilities

| Device | Max Resolution | Video Codec | Profile |
|--------|---------------|-------------|---------|
| iPod Video (5th gen) | 320x240 | H.264 | Baseline |
| iPod Classic (6th/7th) | 640x480 | H.264 | Main |
| iPod Nano (3rd-5th gen) | 320x240 | H.264 | Baseline |

## Quality Presets

For iPod Classic (640x480):

| Preset | Video Bitrate | CRF | Audio Bitrate |
|--------|--------------|-----|---------------|
| max | 2500 kbps | 18 | 160 kbps |
| high | 2000 kbps | 21 | 128 kbps |
| medium | 1500 kbps | 24 | 128 kbps |
| low | 1000 kbps | 27 | 96 kbps |

### Source Quality Capping

```typescript
function calculateEffectiveSettings(source, preset, device) {
  return {
    // Never exceed source quality
    videoBitrate: Math.min(presetBitrate, source.bitrate),
    // Never upscale resolution
    width: Math.min(device.maxWidth, source.width),
    height: Math.min(device.maxHeight, source.height),
  };
}
```

## CLI Usage

```bash
# Unified sync command
podkit sync video                    # sync default video collection
podkit sync video -c movies          # sync specific collection
podkit sync video --video-quality medium
podkit sync                          # sync both music and video
```

## Consequences

### Positive

- Consistent with audio transcoding approach
- Source quality awareness prevents wasted encoding
- Extensible metadata system for future integrations

### Negative

- Video transcoding is CPU-intensive
- Additional complexity in sync engine

## Related Decisions

- [ADR-003](/developers/adr/adr-003-transcoding): Transcoding Backend
- [ADR-004](/developers/adr/adr-004-collection-sources): Collection Sources

## References

- [FFmpeg H.264 Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/H.264)
- [Apple iPod Video Specifications](https://support.apple.com/kb/SP5)
