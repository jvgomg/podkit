#!/bin/bash
# Generate test video files for testing podkit's video sync pipeline
# All videos are 1-2 seconds with synthetic test patterns and audio tones

set -e
cd "$(dirname "$0")"

# Common metadata
DATE="2026"

echo "Generating video test fixtures..."
echo ""

# ==============================================================================
# iPod Classic Compatible Videos (passthrough candidates)
# ==============================================================================

echo "Creating iPod-compatible videos..."

# Compatible H.264 - 640x480, Main profile, AAC audio
# This matches iPod Classic specs exactly
echo "  - compatible-h264.mp4 (640x480, H.264 Main, AAC)"
ffmpeg -y -f lavfi -i "testsrc=duration=2:size=640x480:rate=30" \
  -f lavfi -i "sine=frequency=440:duration=2" \
  -c:v libx264 -profile:v main -level:v 3.1 -b:v 500k -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ar 44100 \
  -movflags +faststart \
  -metadata title="Compatible Test Video" \
  -metadata artist="Podkit Test Generator" \
  -metadata date="$DATE" \
  compatible-h264.mp4 2>/dev/null

# Low quality - 320x240, low bitrate (tests minimum quality handling)
echo "  - low-quality.mp4 (320x240, 300kbps)"
ffmpeg -y -f lavfi -i "testsrc=duration=2:size=320x240:rate=24" \
  -f lavfi -i "sine=frequency=523.25:duration=2" \
  -c:v libx264 -profile:v baseline -level:v 1.3 -b:v 300k -pix_fmt yuv420p \
  -c:a aac -b:a 96k -ar 44100 \
  -movflags +faststart \
  -metadata title="Low Quality Test" \
  -metadata artist="Podkit Test Generator" \
  -metadata date="$DATE" \
  low-quality.mp4 2>/dev/null

# ==============================================================================
# Videos Requiring Transcoding
# ==============================================================================

echo "Creating videos that require transcoding..."

# High-res H.264 in MKV container - needs resolution downscale and remux
echo "  - high-res-h264.mkv (1920x1080, H.264, MKV container)"
ffmpeg -y -f lavfi -i "testsrc2=duration=2:size=1920x1080:rate=30" \
  -f lavfi -i "sine=frequency=659.25:duration=2" \
  -c:v libx264 -profile:v high -level:v 4.1 -b:v 2000k -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 \
  -metadata title="High Resolution Test" \
  -metadata artist="Podkit Test Generator" \
  -metadata date="$DATE" \
  high-res-h264.mkv 2>/dev/null

# ==============================================================================
# Incompatible Codecs
# ==============================================================================

echo "Creating incompatible codec videos..."

# VP9 in WebM container - completely unsupported codec
echo "  - incompatible-vp9.webm (VP9 codec, WebM container)"
ffmpeg -y -f lavfi -i "testsrc=duration=2:size=640x480:rate=30" \
  -f lavfi -i "sine=frequency=783.99:duration=2" \
  -c:v libvpx-vp9 -b:v 500k -pix_fmt yuv420p \
  -c:a libopus -b:a 128k -ar 48000 \
  -metadata title="VP9 Incompatible Test" \
  -metadata artist="Podkit Test Generator" \
  -metadata date="$DATE" \
  incompatible-vp9.webm 2>/dev/null

# ==============================================================================
# Videos with Rich Metadata
# ==============================================================================

echo "Creating videos with metadata..."

# Movie with full metadata
echo "  - movie-with-metadata.mp4 (Movie metadata: title, year, description)"
ffmpeg -y -f lavfi -i "smptebars=duration=2:size=640x480:rate=30" \
  -f lavfi -i "sine=frequency=392:duration=2" \
  -c:v libx264 -profile:v main -level:v 3.1 -b:v 500k -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ar 44100 \
  -movflags +faststart \
  -metadata title="Test Movie Title" \
  -metadata artist="Test Director" \
  -metadata album_artist="Test Studio" \
  -metadata date="2024" \
  -metadata description="A test movie with embedded metadata for validation purposes." \
  -metadata synopsis="Extended synopsis: This is a synthetic test video created for testing podkit's video metadata parsing capabilities." \
  -metadata genre="Test" \
  movie-with-metadata.mp4 2>/dev/null

# TV show episode with series metadata
echo "  - tvshow-episode.mp4 (TV show metadata: series, season, episode)"
ffmpeg -y -f lavfi -i "pal75bars=duration=2:size=640x480:rate=30" \
  -f lavfi -i "sine=frequency=329.63:duration=2" \
  -c:v libx264 -profile:v main -level:v 3.1 -b:v 500k -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ar 44100 \
  -movflags +faststart \
  -metadata title="Pilot Episode" \
  -metadata show="Test Show" \
  -metadata season_number="1" \
  -metadata episode_id="S01E01" \
  -metadata episode_sort="1" \
  -metadata network="Test Network" \
  -metadata description="The first episode of our test TV series." \
  -metadata date="2024" \
  -metadata genre="Drama" \
  tvshow-episode.mp4 2>/dev/null

echo ""
echo "Generated files:"
ls -la *.mp4 *.mkv *.webm 2>/dev/null || true

echo ""
echo "File details:"
for f in *.mp4 *.mkv *.webm; do
  if [ -f "$f" ]; then
    # Get video codec and dimensions
    video_info=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 "$f" 2>/dev/null | head -1)
    # Get audio codec
    audio_codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$f" 2>/dev/null)
    size=$(ls -lh "$f" | awk '{print $5}')
    echo "  $f: $video_info / $audio_codec ($size)"
  fi
done 2>/dev/null

echo ""
echo "Total size:"
du -sh . | awk '{print "  " $1}'

echo ""
echo "Done!"
