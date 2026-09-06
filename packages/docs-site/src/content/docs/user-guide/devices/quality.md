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
audioQuality = "max"          # Best quality — ALAC on Classic (overrides quality)

[devices.nano]
audioQuality = "medium"
```

This overrides the global `audioQuality` and `quality` settings in your [config file](/user-guide/configuration). Available presets:

| Preset | Bitrate | Best for |
|--------|---------|----------|
| `max` | Lossless or ~256 kbps | ALAC on supported devices, otherwise same as `high` |
| `high` | ~256 kbps VBR | Good quality, reasonable size (**default**) |
| `medium` | ~192 kbps VBR | Saving space |
| `low` | ~128 kbps VBR | Maximum compression |

For predictable file sizes, set `encoding = "cbr"` on the device. See [Audio Transcoding](/user-guide/transcoding/audio) for full details.

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
audioQuality = "max"          # ALAC on Classic (it supports lossless)
videoQuality = "high"

[devices.nano]
volumeUuid = "EFGH-5678"
volumeName = "NANO"
quality = "medium"            # Both audio and video use medium
videoQuality = "low"          # Override: low video quality
artwork = false
```

The Classic gets the best audio quality (ALAC, since it supports lossless playback) and high-quality video, while the Nano uses medium audio, low-quality video, and skips artwork to save space.

## Setting Quality via CLI

You can set quality on a device when adding it or at any time afterward:

```bash
# Set quality when adding a device
podkit device add -d classic --audio-quality max --video-quality high

# Change quality on an existing device
podkit device set -d classic --quality max
podkit device set -d nano --audio-quality medium --video-quality low

# Clear a setting (reverts to global default)
podkit device set -d classic --clear-audio-quality
```

## Sync-Time Overrides

You can also override quality for a single sync without changing device settings:

```bash
podkit sync --quality medium
podkit sync --audio-quality max
podkit sync --video-quality low
podkit sync --device nano --quality medium --video-quality low
podkit sync --device /Volumes/NANO --audio-quality high
```

## See Also

- [Transcoding Methodology](/user-guide/transcoding) — How podkit decides what to transcode
- [Audio Transcoding](/user-guide/transcoding/audio) — Presets, VBR vs CBR, encoders
- [Video Transcoding](/user-guide/transcoding/video) — Device profiles and format details
- [Managing Devices](/user-guide/devices) — Device configuration overview
