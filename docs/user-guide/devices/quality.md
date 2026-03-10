---
title: Quality Settings
description: Configure audio and video transcoding quality per device.
sidebar:
  order: 2
---

Different iPods have different storage capacities and use cases. podkit lets you set audio and video quality independently for each device, so you can use lossless audio on a high-capacity Classic while using compressed audio on a space-constrained Nano.

## Unified Quality

The simplest approach is to set `quality` on a device, which applies to both audio and video:

```toml
[devices.nano]
quality = "medium"            # Both audio and video use medium
```

## Audio Quality

For audio-specific control, use `audioQuality` on a device. This overrides `quality` for audio:

```toml
[devices.classic]
quality = "high"              # Video uses high
audioQuality = "alac"         # Audio uses lossless (overrides quality)

[devices.nano]
audioQuality = "medium"
```

This overrides the global `audioQuality` and `quality` settings in your [config file](/user-guide/configuration). Available presets:

| Preset | Bitrate | Best for |
|--------|---------|----------|
| `alac` | Lossless | High-capacity devices |
| `max` | ~320 kbps VBR | Best AAC quality |
| `high` | ~256 kbps VBR | Good quality, reasonable size (**default**) |
| `medium` | ~192 kbps VBR | Saving space |
| `low` | ~128 kbps VBR | Maximum compression |

CBR variants (`max-cbr`, `high-cbr`, `medium-cbr`, `low-cbr`) are also available for predictable file sizes. See [Audio Transcoding](/user-guide/transcoding/audio) for full details.

## Video Quality

Set the video quality preset per device with `videoQuality`:

```toml
[devices.classic]
videoQuality = "high"

[devices.nano]
videoQuality = "low"
```

| Preset | Description |
|--------|-------------|
| `max` | Highest quality, largest files |
| `high` | Excellent quality (**default**) |
| `medium` | Good quality, smaller files |
| `low` | Space-efficient |

Video resolution is automatically matched to each device's capabilities (e.g., 640x480 for Classic, 320x240 for Nano). See [Video Transcoding](/user-guide/transcoding/video) for device profiles and format details.

## Example: Multi-Device Setup

```toml
# Global default
quality = "high"

[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "CLASSIC"
audioQuality = "alac"         # Lossless audio
videoQuality = "high"

[devices.nano]
volumeUuid = "EFGH-5678"
volumeName = "NANO"
quality = "medium"            # Both audio and video use medium
videoQuality = "low"          # Override: low video quality
artwork = false
```

The Classic gets lossless audio and high-quality video, while the Nano uses medium audio, low-quality video, and skips artwork to save space.

## CLI Overrides

You can override quality on the command line for a single sync. Reference devices by their config name or mount path:

```bash
podkit sync --quality medium
podkit sync --audio-quality alac --lossy-quality max
podkit sync --video-quality low
podkit sync --device nano --quality medium --video-quality low
podkit sync --device /Volumes/NANO --audio-quality high
```

## See Also

- [Transcoding Methodology](/user-guide/transcoding) — How podkit decides what to transcode
- [Audio Transcoding](/user-guide/transcoding/audio) — Presets, VBR vs CBR, encoders
- [Video Transcoding](/user-guide/transcoding/video) — Device profiles and format details
- [Managing Devices](/user-guide/devices) — Device configuration overview
