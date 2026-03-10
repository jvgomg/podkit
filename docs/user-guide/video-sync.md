---
title: Video Sync
description: Sync movies and TV shows to video-capable iPods with automatic transcoding.
sidebar:
  order: 4
---

# Video Sync

podkit supports syncing movies and TV shows to video-capable iPods. This guide covers video configuration, quality settings, and supported formats.

## Supported Devices

Video sync works with iPods that support video playback:

- iPod Video (5th and 5.5th generation)
- iPod Classic (6th and 7th generation)
- iPod Nano (3rd through 5th generation)

## Quick Start

### 1. Configure Video Collection

Add a video source to your config:

```toml
[video.movies]
path = "/path/to/movies"

[defaults]
video = "movies"
```

### 2. Sync Video

```bash
# Sync video collection
podkit sync video

# Preview first
podkit sync video --dry-run
```

## Configuration

### Video Collections

Define multiple video sources:

```toml
[video.movies]
path = "/Volumes/Media/movies"

[video.shows]
path = "/Volumes/Media/tv-shows"
```

### Quality Settings

```toml
[video]
quality = "high"           # max | high | medium | low
```

| Preset | Description | Recommended For |
|--------|-------------|-----------------|
| `max` | Highest quality, largest files | Best viewing experience, ample storage |
| `high` | Excellent quality (default) | General use |
| `medium` | Good quality, smaller files | Limited storage |
| `low` | Space-efficient | Maximum capacity |

## CLI Usage

```bash
# Sync all video with default quality
podkit sync video

# Sync specific collection
podkit sync video -c shows

# Specify quality preset
podkit sync video --video-quality medium

# Dry run to preview
podkit sync video --dry-run

# Remove videos not in source
podkit sync video --delete

# Sync to specific device
podkit sync video --device myipod
```

## Supported Input Formats

| Format | Extensions | Notes |
|--------|------------|-------|
| Matroska | `.mkv` | Common for rips |
| MP4 | `.mp4`, `.m4v` | May passthrough if compatible |
| AVI | `.avi` | Legacy support |
| MOV | `.mov` | QuickTime |
| WebM | `.webm` | VP8/VP9 transcoded to H.264 |
| WMV | `.wmv` | Windows Media |

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

### Source Quality Awareness

podkit analyzes source files and caps output quality accordingly. Low-quality sources won't be "upscaled":

| Source Quality | User Setting | Effective Output |
|----------------|--------------|------------------|
| 1080p @ 8 Mbps | high | 640x480 @ 2000 kbps |
| 480p @ 1.5 Mbps | high | 480p @ 1500 kbps (capped) |
| 360p @ 800 kbps | high | 360p @ 800 kbps (source limited) |

## File Size Estimates

For a 2-hour movie on iPod Classic:

| Preset | Approx Size |
|--------|-------------|
| max | ~2.2 GB |
| high | ~1.8 GB |
| medium | ~1.3 GB |
| low | ~900 MB |

## Passthrough (No Transcoding)

If a video is already iPod-compatible, podkit copies it directly:

**Compatible criteria:**
- H.264 video (Baseline or Main profile)
- Resolution <= device maximum
- Bitrate <= device maximum
- AAC audio
- MP4/M4V container

The dry run shows which files will passthrough:

```
+ [transcode    ] Movie.mkv
+ [passthrough  ] Compatible.m4v
- [remove       ] OldVideo.m4v
```

## Content Type Detection

podkit determines movie vs. TV show by:

1. **Embedded tags** - If file contains episode/season tags
2. **Folder structure** - `TV Shows/Series Name/Season 01/`
3. **Filename patterns** - `S01E01`, `1x01`, etc.

### Folder Organization

**Movies:**

```
Movies/
├── The Matrix (1999).mkv
├── Inception (2010)/
│   └── Inception.mkv
└── Sci-Fi/
    └── Blade Runner (1982).mkv
```

**TV Shows:**

```
TV Shows/
└── Breaking Bad/
    ├── Season 1/
    │   ├── S01E01 - Pilot.mkv
    │   └── S01E02 - Cat's in the Bag.mkv
    └── Season 2/
        └── S02E01 - Seven Thirty-Seven.mkv
```

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

- [Supported Devices](/devices/supported-devices) - Video-capable iPod models
- [Configuration](/user-guide/configuration) - Full configuration reference
- [CLI Commands](/reference/cli-commands) - Command-line options
