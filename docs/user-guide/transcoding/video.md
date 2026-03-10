---
title: Video Transcoding
description: Configure video transcoding quality, formats, and device profiles for syncing movies and TV shows to iPod.
sidebar:
  order: 3
---

This guide covers video transcoding quality settings, device profiles, and output format. For an overview of how podkit decides what to transcode, see [Transcoding Methodology](/user-guide/transcoding). For supported formats, content types, and how to set up video syncing, see [Video Syncing](/user-guide/syncing/video).

## Quality Settings

Video quality can be set globally or per device. Use `videoQuality` for a video-specific override, or set `quality` to apply to both audio and video:

```toml
# Global video quality override
videoQuality = "high"         # max | high | medium | low

# Or use unified quality (applies to both audio and video)
quality = "high"

# Per-device video quality
[devices.classic]
videoQuality = "high"
```

| Preset | Description | Recommended For |
|--------|-------------|-----------------|
| `max` | Highest quality, largest files | Best viewing experience, ample storage |
| `high` | Excellent quality (default) | General use |
| `medium` | Good quality, smaller files | Limited storage |
| `low` | Space-efficient | Maximum capacity |

## Output Format

All videos are transcoded to iPod-compatible format:

| Property | Value |
|----------|-------|
| Container | M4V (MPEG-4 with Apple extensions) |
| Video Codec | H.264 (AVC) |
| Audio Codec | AAC-LC stereo |

## Device Profiles

### iPod Classic (6th/7th Generation)

| Setting | Value |
|---------|-------|
| Max Resolution | 640x480 |
| Video Profile | H.264 Main Profile |
| Max Video Bitrate | ~2.5 Mbps |
| Audio | AAC-LC, up to 160 kbps |

### iPod Video / Nano (3rd-5th Gen)

| Setting | Value |
|---------|-------|
| Max Resolution | 320x240 |
| Video Profile | H.264 Baseline Profile |
| Max Video Bitrate | ~768 kbps |
| Audio | AAC-LC, up to 128 kbps |

## Quality and Resolution

Quality settings affect bitrate, not resolution. Resolution is always matched to device capabilities:

| Preset | iPod Classic (640x480) | iPod Video (320x240) |
|--------|------------------------|----------------------|
| max | 640x480 @ 2500 kbps | 320x240 @ 768 kbps |
| high | 640x480 @ 2000 kbps | 320x240 @ 600 kbps |
| medium | 640x480 @ 1500 kbps | 320x240 @ 400 kbps |
| low | 640x480 @ 1000 kbps | 320x240 @ 300 kbps |

## File Size Estimates

For a 2-hour movie on iPod Classic:

| Preset | Approx Size |
|--------|-------------|
| max | ~2.2 GB |
| high | ~1.8 GB |
| medium | ~1.3 GB |
| low | ~900 MB |

## Hardware Acceleration

On macOS, podkit uses VideoToolbox for hardware-accelerated encoding when available. This significantly speeds up transcoding.

```bash
# Check for VideoToolbox
ffmpeg -encoders 2>/dev/null | grep videotoolbox
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Unsupported format" | Rare container/codec | Check file with ffprobe |
| Slow transcoding | Software encoding | macOS uses hardware acceleration |
| Poor quality output | Low quality source | Use source-appropriate preset |
| Large file sizes | High bitrate preset | Use medium or low preset |

### Debugging

```bash
# Analyze a video file
ffprobe -v error -show_format -show_streams input.mkv

# Test transcode with verbose output
ffmpeg -v verbose -i input.mkv -t 60 -c:v libx264 test.m4v

# Run with debug logging
podkit sync video --dry-run -vvv
```

## See Also

- [Video Syncing](/user-guide/syncing/video) - Supported formats, content types, and folder organization
- [Transcoding Methodology](/user-guide/transcoding) - How podkit decides what to transcode
- [Audio Transcoding](/user-guide/transcoding/audio) - Audio transcoding quality and codec settings
- [Quality Settings](/user-guide/devices/quality) - Per-device video quality configuration
