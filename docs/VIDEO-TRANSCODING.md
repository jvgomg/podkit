# Video Transcoding Guide

## Overview

podkit supports syncing movies and TV shows to iPod devices. This document covers video transcoding configuration, quality settings, format compatibility, and device-specific considerations.

## Quick Reference

### Quality Presets

| Preset | Description | Recommended For |
|--------|-------------|-----------------|
| `max` | Highest quality, largest files | Best viewing experience, ample storage |
| `high` | Excellent quality (default) | General use |
| `medium` | Good quality, smaller files | Limited storage |
| `low` | Space-efficient | Maximum capacity |

**Key principle:** Quality setting affects bitrate, not resolution. Resolution is always matched to device capabilities. Source quality is respected—low-quality sources won't be "upscaled."

### Content Types

| Type | Metadata | Example |
|------|----------|---------|
| **Movie** | Title, year, description | `The Matrix (1999).mkv` |
| **TV Show** | Series, season, episode | `Breaking Bad/S01E01.mkv` |

### Supported Input Formats

| Format | Extensions | Notes |
|--------|------------|-------|
| Matroska | `.mkv` | Common for rips |
| MP4 | `.mp4`, `.m4v` | May passthrough if compatible |
| AVI | `.avi` | Legacy support |
| MOV | `.mov` | QuickTime |
| WebM | `.webm` | VP8/VP9 transcoded to H.264 |
| WMV | `.wmv` | Windows Media |

## Device Profiles

### iPod Classic (6th/7th Generation)

| Setting | Value |
|---------|-------|
| Max Resolution | 640x480 |
| Video Codec | H.264 Main Profile |
| Max Video Bitrate | ~2.5 Mbps |
| Audio | AAC-LC, up to 160 kbps |

### iPod Video (5th Generation) / iPod Nano (3rd-5th)

| Setting | Value |
|---------|-------|
| Max Resolution | 320x240 |
| Video Codec | H.264 Baseline Profile |
| Max Video Bitrate | ~768 kbps |
| Audio | AAC-LC, up to 128 kbps |

## Configuration

### CLI Usage

```bash
# Sync videos with default quality (high)
podkit sync --source ~/Movies --device /Volumes/iPod --type video

# Specify quality preset
podkit sync --source ~/Movies --quality medium --type video

# Dry run to check compatibility
podkit sync --source ~/Movies --dry-run --type video

# TV shows from a series folder
podkit sync --source "~/TV Shows/Breaking Bad" --type tvshow
```

### Config File

```toml
# ~/.config/podkit/config.toml

[video]
quality = "high"           # max | high | medium | low
source = "~/Movies"

[video.metadata]
adapter = "embedded"       # embedded | nfo | plex (future)
```

## Quality Settings

### How Quality Presets Work

Unlike some tools that reduce resolution for lower quality, podkit always targets the device's native resolution and varies the bitrate:

| Preset | iPod Classic (640x480) | iPod Video (320x240) |
|--------|------------------------|----------------------|
| max | 640x480 @ 2500 kbps | 320x240 @ 768 kbps |
| high | 640x480 @ 2000 kbps | 320x240 @ 600 kbps |
| medium | 640x480 @ 1500 kbps | 320x240 @ 400 kbps |
| low | 640x480 @ 1000 kbps | 320x240 @ 300 kbps |

### Source Quality Awareness

podkit analyzes source files and caps output quality accordingly:

| Source Quality | User Setting | Effective Output |
|----------------|--------------|------------------|
| 1080p @ 8 Mbps | high | 640x480 @ 2000 kbps |
| 480p @ 1.5 Mbps | high | 480p @ 1500 kbps (capped) |
| 360p @ 800 kbps | high | 360p @ 800 kbps (source limited) |

**Principle:** Never produce output larger or "higher quality" than the source.

### File Size Estimates

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
- Resolution ≤ device maximum
- Bitrate ≤ device maximum
- AAC audio
- MP4/M4V container

```bash
# Dry run shows which files will passthrough
podkit sync --source ~/Videos --dry-run --type video

# Output:
# ✓ Movie.m4v - compatible (passthrough)
# → Movie.mkv - will transcode (MKV → M4V)
# ⚠ LowRes.avi - will transcode (low quality source)
```

## Validation and Dry Run

### Early Compatibility Check

During `--dry-run`, podkit validates all files and reports:

| Status | Meaning |
|--------|---------|
| ✓ Compatible | Already iPod-ready, will copy |
| → Transcodable | Will be transcoded successfully |
| ⚠ Warning | Transcodable with caveats (low quality, etc.) |
| ✗ Unsupported | Cannot be processed |

### Warning Types

| Warning | Meaning |
|---------|---------|
| Low quality source | Source quality below target preset |
| Unusual aspect ratio | Will be letterboxed/pillarboxed |
| Long duration | File will be large |
| Missing metadata | Title/info not detected |

## Metadata Handling

### Embedded Metadata (Default)

podkit extracts metadata from video files using ffprobe:

- Title
- Year/date
- Description/comment
- Duration
- Embedded poster/thumbnail

### Content Type Detection

podkit determines movie vs. TV show by:

1. **Embedded tags** - If file contains episode/season tags
2. **Folder structure** - `TV Shows/Series Name/Season 01/`
3. **Filename patterns** - `S01E01`, `1x01`, etc.

### Folder Organization Examples

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

## FFmpeg Integration

### Encoder Selection

podkit uses FFmpeg for video transcoding:

| Encoder | Platform | Quality | Speed |
|---------|----------|---------|-------|
| libx264 | All | Excellent | Medium |
| h264_videotoolbox | macOS | Very Good | Fast |

Hardware acceleration (VideoToolbox) is used automatically on macOS when available.

### Verifying FFmpeg

```bash
# Check FFmpeg installation
ffmpeg -version

# Verify H.264 encoder
ffmpeg -encoders 2>/dev/null | grep h264

# Check for VideoToolbox (macOS)
ffmpeg -encoders 2>/dev/null | grep videotoolbox
```

### Installing FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Debian/Ubuntu:**
```bash
sudo apt install ffmpeg
```

**Windows:**
```powershell
winget install FFmpeg
```

## Technical Details

### Output Format

| Property | Value |
|----------|-------|
| Container | M4V (MPEG-4 with Apple extensions) |
| Video Codec | H.264 (AVC) |
| Video Profile | Main (Classic) / Baseline (older iPods) |
| Audio Codec | AAC-LC |
| Audio Channels | Stereo (2.0) |

### Encoding Parameters

iPod Classic (high quality):
```bash
ffmpeg -i input.mkv \
  -c:v libx264 -profile:v main -level 3.1 \
  -crf 21 -maxrate 2000k -bufsize 4000k \
  -vf "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:-1:-1:black" \
  -r 30 \
  -c:a aac -b:a 128k -ac 2 \
  -movflags +faststart \
  -f ipod output.m4v
```

### Aspect Ratio Handling

Videos are scaled to fit device resolution while maintaining aspect ratio:

| Source | Device | Result |
|--------|--------|--------|
| 16:9 | 4:3 | Letterboxed (black bars top/bottom) |
| 4:3 | 4:3 | Full frame |
| 2.35:1 | 4:3 | Letterboxed (larger bars) |

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "FFmpeg not found" | FFmpeg not installed | Install FFmpeg |
| "Unsupported format" | Rare container/codec | Check file with ffprobe |
| Slow transcoding | Software encoding | Enable hardware acceleration |
| Poor quality output | Low quality source | Use lower preset or source better file |
| Large file sizes | High bitrate preset | Use medium or low preset |

### Debugging

```bash
# Analyze a video file
ffprobe -v error -show_format -show_streams input.mkv

# Test transcode with verbose output
ffmpeg -v verbose -i input.mkv -t 60 -c:v libx264 test.m4v

# Check podkit analysis
podkit info --file input.mkv
```

## Future Enhancements

- **Plex integration** - Fetch rich metadata from Plex library
- **NFO support** - Parse Kodi/Jellyfin sidecar files
- **TMDB lookup** - Auto-fetch movie/show information
- **Subtitle support** - Burn-in or sidecar subtitles
- **Chapter markers** - Preserve chapter information

## Related Documentation

- [Audio Transcoding Guide](./TRANSCODING.md)
- [ADR-006: Video Transcoding](./adr/ADR-006-video-transcoding.md)
- [Collection Sources](./COLLECTION-SOURCES.md)

## References

- [FFmpeg H.264 Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/H.264)
- [Apple iPod Tech Specs](https://support.apple.com/kb/SP5)
- [libx264 Documentation](https://www.ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb)
