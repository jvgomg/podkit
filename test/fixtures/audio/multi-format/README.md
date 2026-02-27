# Multi-Format Test Audio Fixtures

Synthetic audio files in various formats for testing mixed-quality collection handling, source categorization, and lossy-to-lossy warnings.

## File Reference

| Category | File | Format | Codec | Duration | Notes |
|----------|------|--------|-------|----------|-------|
| **Lossless** | `01-wav-track.wav` | WAV | PCM S16LE | 5s | Uncompressed PCM |
| **Lossless** | `02-aiff-track.aiff` | AIFF | PCM S16BE | 5s | Apple's PCM format |
| **Lossless** | `03-flac-track.flac` | FLAC | FLAC | 5s | Free Lossless Audio Codec |
| **Lossless** | `04-alac-track.m4a` | M4A | ALAC | 5s | Apple Lossless in M4A container |
| **Compatible Lossy** | `05-mp3-track.mp3` | MP3 | MP3 | 5s | MPEG Audio Layer 3, VBR |
| **Compatible Lossy** | `06-aac-track.m4a` | M4A | AAC | 5s | AAC at 256 kbps |
| **Incompatible Lossy** | `07-ogg-track.ogg` | OGG | Vorbis | 5s | Requires transcoding |
| **Incompatible Lossy** | `08-opus-track.opus` | Opus | Opus | 5s | Requires transcoding |

## Source Categories

These files test podkit's source categorization logic:

1. **Lossless**: Can be converted to any target format (ALAC or AAC)
   - WAV, AIFF, FLAC, ALAC

2. **Compatible Lossy**: Already iPod-playable, copied as-is
   - MP3, AAC/M4A

3. **Incompatible Lossy**: Must be transcoded, triggers lossy-to-lossy warning
   - OGG Vorbis, Opus

## Test Scenarios

| Scenario | Files | Expected Behavior |
|----------|-------|-------------------|
| Lossless to AAC | WAV, AIFF, FLAC | Transcode to AAC preset |
| Lossless to ALAC | WAV, AIFF, FLAC | Transcode to ALAC |
| ALAC copy | 04-alac-track.m4a | Copy as-is when `quality=alac` |
| Compatible copy | MP3, AAC | Copy as-is (no transcoding) |
| Lossy-to-lossy | OGG, Opus | Transcode to AAC + warning |

## Metadata

All files include:

| Tag | Value |
|-----|-------|
| ARTIST | Multi-Format Test |
| ALBUM | Lossless Collection / Compatible Lossy / Incompatible Lossy |
| TITLE | (format-specific) |
| DATE | 2026 |
| GENRE | Electronic |

## Audio Content

Each file contains a pure sine wave at a different frequency:

| File | Frequency | Note |
|------|-----------|------|
| 01-wav-track.wav | 440 Hz | A4 |
| 02-aiff-track.aiff | 523.25 Hz | C5 |
| 03-flac-track.flac | 659.25 Hz | E5 |
| 04-alac-track.m4a | 783.99 Hz | G5 |
| 05-mp3-track.mp3 | 329.63 Hz | E4 |
| 06-aac-track.m4a | 392 Hz | G4 |
| 07-ogg-track.ogg | 493.88 Hz | B4 |
| 08-opus-track.opus | 587.33 Hz | D5 |

## Regenerating Files

```bash
./generate.sh
```

Requires FFmpeg with the following encoders:
- `pcm_s16le`, `pcm_s16be` (always available)
- `flac` (always available)
- `alac` (available on macOS via AudioToolbox)
- `libmp3lame` (MP3 encoder)
- `aac` (native AAC encoder)
- `vorbis` (native Vorbis encoder, experimental)
- `libopus` (Opus encoder)

## License

CC0 1.0 Universal (Public Domain Dedication)
