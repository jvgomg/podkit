#!/bin/bash
# Generate test audio files in various formats for testing mixed-quality collections
# All files are 5-second tones with metadata

set -e
cd "$(dirname "$0")"

# Create a simple cover image (100x100 gradient)
echo "Creating cover art..."
ffmpeg -y -f lavfi -i "color=c=#4a90d9:s=100x100:d=1,format=rgb24" -frames:v 1 cover.jpg 2>/dev/null

# Common metadata
ARTIST="Multi-Format Test"
DATE="2026"
GENRE="Electronic"

# ==============================================================================
# Lossless formats
# ==============================================================================

echo "Creating lossless formats..."

# WAV - uncompressed PCM (lossless)
echo "  - WAV (PCM)"
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=5:sample_rate=44100" \
  -c:a pcm_s16le -ar 44100 -ac 2 \
  -metadata title="WAV Test Track" \
  -metadata artist="$ARTIST" \
  -metadata album="Lossless Collection" \
  -metadata track="1" \
  -metadata date="$DATE" \
  -metadata genre="$GENRE" \
  01-wav-track.wav 2>/dev/null

# AIFF - Apple's PCM format (lossless)
echo "  - AIFF (PCM)"
ffmpeg -y -f lavfi -i "sine=frequency=523.25:duration=5:sample_rate=44100" \
  -c:a pcm_s16be -ar 44100 -ac 2 \
  -metadata title="AIFF Test Track" \
  -metadata artist="$ARTIST" \
  -metadata album="Lossless Collection" \
  -metadata track="2" \
  -metadata date="$DATE" \
  -metadata genre="$GENRE" \
  02-aiff-track.aiff 2>/dev/null

# FLAC - free lossless audio codec
echo "  - FLAC"
ffmpeg -y -f lavfi -i "sine=frequency=659.25:duration=5:sample_rate=44100" \
  -c:a flac -ar 44100 -ac 2 \
  -metadata title="FLAC Test Track" \
  -metadata artist="$ARTIST" \
  -metadata album="Lossless Collection" \
  -metadata track="3" \
  -metadata date="$DATE" \
  -metadata genre="$GENRE" \
  03-flac-track.flac 2>/dev/null

# ALAC in M4A container (lossless)
echo "  - ALAC (M4A)"
ffmpeg -y -f lavfi -i "sine=frequency=783.99:duration=5:sample_rate=44100" \
  -c:a alac -ar 44100 \
  -metadata title="ALAC Test Track" \
  -metadata artist="$ARTIST" \
  -metadata album="Lossless Collection" \
  -metadata track="4" \
  -metadata date="$DATE" \
  -metadata genre="$GENRE" \
  04-alac-track.m4a 2>/dev/null

# ==============================================================================
# Compatible lossy formats (iPod-native, should be copied as-is)
# ==============================================================================

echo "Creating compatible lossy formats..."

# MP3 - 256 kbps VBR
echo "  - MP3 (256 kbps)"
ffmpeg -y -f lavfi -i "sine=frequency=329.63:duration=5:sample_rate=44100" \
  -c:a libmp3lame -q:a 0 -ar 44100 -ac 2 \
  -metadata title="MP3 Test Track" \
  -metadata artist="$ARTIST" \
  -metadata album="Compatible Lossy" \
  -metadata track="1" \
  -metadata date="$DATE" \
  -metadata genre="$GENRE" \
  05-mp3-track.mp3 2>/dev/null

# AAC in M4A container - 256 kbps
echo "  - AAC (M4A, 256 kbps)"
ffmpeg -y -f lavfi -i "sine=frequency=392:duration=5:sample_rate=44100" \
  -c:a aac -b:a 256k -ar 44100 \
  -metadata title="AAC Test Track" \
  -metadata artist="$ARTIST" \
  -metadata album="Compatible Lossy" \
  -metadata track="2" \
  -metadata date="$DATE" \
  -metadata genre="$GENRE" \
  06-aac-track.m4a 2>/dev/null

# ==============================================================================
# Incompatible lossy formats (require transcoding, trigger warnings)
# ==============================================================================

echo "Creating incompatible lossy formats..."

# OGG Vorbis (native vorbis encoder)
echo "  - OGG Vorbis"
ffmpeg -y -f lavfi -i "sine=frequency=493.88:duration=5:sample_rate=44100" \
  -c:a vorbis -strict -2 -q:a 7 -ar 44100 -ac 2 \
  -metadata title="OGG Test Track" \
  -metadata artist="$ARTIST" \
  -metadata album="Incompatible Lossy" \
  -metadata track="1" \
  -metadata date="$DATE" \
  -metadata genre="$GENRE" \
  07-ogg-track.ogg 2>/dev/null

# Opus - 128 kbps
echo "  - Opus (128 kbps)"
ffmpeg -y -f lavfi -i "sine=frequency=587.33:duration=5:sample_rate=48000" \
  -c:a libopus -b:a 128k -ar 48000 -ac 2 \
  -metadata title="Opus Test Track" \
  -metadata artist="$ARTIST" \
  -metadata album="Incompatible Lossy" \
  -metadata track="2" \
  -metadata date="$DATE" \
  -metadata genre="$GENRE" \
  08-opus-track.opus 2>/dev/null

echo ""
echo "Generated files:"
ls -la *.wav *.aiff *.flac *.m4a *.mp3 *.ogg *.opus 2>/dev/null || true

echo ""
echo "File details:"
for f in *.wav *.aiff *.flac *.m4a *.mp3 *.ogg *.opus; do
  if [ -f "$f" ]; then
    codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$f" 2>/dev/null)
    size=$(ls -lh "$f" | awk '{print $5}')
    echo "  $f: $codec ($size)"
  fi
done 2>/dev/null

echo ""
echo "Done!"
