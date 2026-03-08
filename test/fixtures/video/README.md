# Video Test Fixtures

Synthetic video files for testing podkit's video sync pipeline, transcoding decisions, and metadata parsing.

## File Reference

| Category | File | Resolution | Video Codec | Audio Codec | Size | Test Purpose |
|----------|------|------------|-------------|-------------|------|--------------|
| **Compatible** | `compatible-h264.mp4` | 640x480 | H.264 Main L3.1 | AAC 128k | ~61K | Passthrough (no transcode) |
| **Compatible** | `low-quality.mp4` | 320x240 | H.264 Baseline L1.3 | AAC 96k | ~53K | Low quality handling |
| **Needs Transcode** | `high-res-h264.mkv` | 1920x1080 | H.264 High L4.1 | AAC 192k | ~565K | Resolution downscale + remux |
| **Incompatible** | `incompatible-vp9.webm` | 640x480 | VP9 | Opus | ~96K | Unsupported codec handling |
| **Metadata** | `movie-with-metadata.mp4` | 640x480 | H.264 Main L3.1 | AAC 128k | ~39K | Movie metadata parsing |
| **Metadata** | `tvshow-episode.mp4` | 640x480 | H.264 Main L3.1 | AAC 128k | ~36K | TV show metadata parsing |

## Expected Test Behavior

### Passthrough (Copy as-is)

| File | Reason |
|------|--------|
| `compatible-h264.mp4` | Already meets iPod Classic specs: 640x480, H.264 Main profile, AAC audio |
| `low-quality.mp4` | Compatible format, even at low quality |
| `movie-with-metadata.mp4` | Compatible format with movie metadata |
| `tvshow-episode.mp4` | Compatible format with TV show metadata |

### Requires Transcoding

| File | Reason | Expected Output |
|------|--------|-----------------|
| `high-res-h264.mkv` | Resolution too high (1080p), MKV container | Downscale to 640x480, remux to MP4 |

### Unsupported (Should Warn/Skip)

| File | Reason |
|------|--------|
| `incompatible-vp9.webm` | VP9 codec not supported by iPod, transcoding required |

## Embedded Metadata

### movie-with-metadata.mp4

| Tag | Value |
|-----|-------|
| title | Test Movie Title |
| artist | Test Director |
| album_artist | Test Studio |
| date | 2024 |
| description | A test movie with embedded metadata for validation purposes. |
| synopsis | Extended synopsis: This is a synthetic test video... |
| genre | Test |

### tvshow-episode.mp4

| Tag | Value |
|-----|-------|
| title | Pilot Episode |
| show | Test Show |
| season_number | 1 |
| episode_id | S01E01 |
| episode_sort | 1 |
| network | Test Network |
| description | The first episode of our test TV series. |
| date | 2024 |
| genre | Drama |

## iPod Classic Video Specifications

For reference, iPod Classic (6th/7th gen) video requirements:

| Parameter | Supported Values |
|-----------|------------------|
| Container | MP4, M4V, MOV |
| Video Codec | H.264 (Baseline, Main profile) |
| Max Resolution | 640x480 (4:3) or 720x480 (widescreen) |
| Max Bitrate | 2.5 Mbps video, 160 kbps audio |
| Audio Codec | AAC-LC, up to 48 kHz |

## Visual Test Patterns

Each video uses a different FFmpeg test pattern for easy identification:

| File | Pattern |
|------|---------|
| `compatible-h264.mp4` | `testsrc` (standard test pattern) |
| `low-quality.mp4` | `testsrc` (standard test pattern) |
| `high-res-h264.mkv` | `testsrc2` (animated test pattern) |
| `incompatible-vp9.webm` | `testsrc` (standard test pattern) |
| `movie-with-metadata.mp4` | `smptebars` (SMPTE color bars) |
| `tvshow-episode.mp4` | `pal75bars` (PAL color bars) |

## Audio Content

Each video includes a pure sine wave tone at different frequencies:

| File | Frequency | Note |
|------|-----------|------|
| `compatible-h264.mp4` | 440 Hz | A4 |
| `low-quality.mp4` | 523.25 Hz | C5 |
| `high-res-h264.mkv` | 659.25 Hz | E5 |
| `incompatible-vp9.webm` | 783.99 Hz | G5 |
| `movie-with-metadata.mp4` | 392 Hz | G4 |
| `tvshow-episode.mp4` | 329.63 Hz | E4 |

## Regenerating Files

```bash
./generate.sh
```

Requirements:
- FFmpeg with `libx264`, `libvpx-vp9`, `aac`, `libopus` encoders
- Approximately 1 MB disk space

## Inspecting Files

```bash
# View video stream details
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,profile,level,width,height \
  -of default=noprint_wrappers=1 compatible-h264.mp4

# View all metadata tags
ffprobe -v error -show_entries format_tags \
  -of default=noprint_wrappers=1 movie-with-metadata.mp4

# View both video and audio codec info
ffprobe -v error -show_entries stream=codec_name,codec_type \
  -of default=noprint_wrappers=1 compatible-h264.mp4
```

## License

CC0 1.0 Universal (Public Domain Dedication)

These files are original synthetic video generated specifically for this project using FFmpeg.
