---
title: Codec Preferences
description: How podkit selects the best audio codec for your device, and how to customize the preference order.
sidebar:
  order: 4
---

podkit automatically selects the best audio codec your device supports. You don't need to configure anything -- the defaults deliver optimal quality for every device. This page explains how the system works and how to customize it if you want to.

## How It Works

podkit maintains an ordered list of codecs called the **preference stack**. When preparing to transcode a track, it walks the list from top to bottom and picks the first codec that meets two conditions:

1. The target device supports decoding it
2. Your FFmpeg installation has the encoder available

This means the same config works across different devices. An iPod gets AAC (it doesn't support Opus), while a Rockbox player gets Opus (better quality per bit) -- all from the same preference stack.

## Default Stacks

There are two separate stacks: one for lossy transcoding and one for lossless.

### Lossy

`opus` then `aac` then `mp3`

| Priority | Codec | Why |
|----------|-------|-----|
| 1st | Opus | Best quality per bit at all bitrates |
| 2nd | AAC | Excellent quality, widest device compatibility |
| 3rd | MP3 | Universal fallback |

### Lossless

`source` then `flac` then `alac`

| Priority | Codec | Why |
|----------|-------|-----|
| 1st | `source` | Keep the original lossless format if the device supports it (zero processing) |
| 2nd | FLAC | Best lossless compression, open standard |
| 3rd | ALAC | Apple ecosystem lossless |

The lossless stack is used when your quality preset is `max` and the source file is lossless. If no lossless codec in the stack is supported by the device, podkit falls through to the lossy stack at the `high` bitrate tier.

## The `source` Keyword

The `source` entry in the lossless stack means "keep the original format if the device supports it." If you have a FLAC file and the device can play FLAC, the file is copied directly with no audio processing.

`source` only applies to lossless formats that are valid transcoding targets (FLAC, ALAC). For uncompressed formats like WAV and AIFF, `source` is skipped and the stack falls through to the next entry. This prevents accidentally filling your device with massive uncompressed files.

For example, with the default lossless stack on a FLAC-capable device:

| Source format | Result |
|---------------|--------|
| FLAC | Copied directly (source match) |
| ALAC | Copied directly (source match) |
| WAV | Transcoded to FLAC (source skipped, falls through) |
| AIFF | Transcoded to FLAC (source skipped, falls through) |

## Configuration

Codec preferences are configured in the `[codec]` section of your config file. The defaults work well for most setups, so you only need this if you want to change the order or restrict to specific codecs.

### Global

```toml
[codec]
lossy = ["opus", "aac", "mp3"]
lossless = ["source", "flac", "alac"]
```

### Per-Device Override

Per-device codec settings override the global config for that device. You only need to specify the stacks you want to change -- unspecified stacks inherit from the global config.

```toml
# Global: prefer Opus, fall back to AAC
[codec]
lossy = ["opus", "aac", "mp3"]

# iPod: only AAC and MP3 matter (it doesn't support Opus)
# but you could also explicitly set it:
[devices.classic.codec]
lossy = "aac"

# Rockbox player: Opus all the way
[devices.rockbox.codec]
lossy = ["opus", "aac"]
lossless = "flac"
```

A single string value is treated as a one-element list. `lossy = "aac"` is equivalent to `lossy = ["aac"]`.

## Quality Presets Are Orthogonal

Quality presets (`high`, `medium`, `low`) control the bitrate tier. Codec preferences control the format. These are independent -- "high quality" means perceptually equivalent quality regardless of which codec is selected.

Each codec has its own bitrate mapping so that the same preset delivers comparable listening quality:

| Preset | AAC | Opus | MP3 |
|--------|-----|------|-----|
| high | 256 kbps | 160 kbps | 256 kbps |
| medium | 192 kbps | 128 kbps | 192 kbps |
| low | 128 kbps | 96 kbps | 128 kbps |

Opus achieves equivalent quality at lower bitrates due to its more advanced psychoacoustic model, so the numbers differ but the listening experience is comparable across codecs at each tier.

`customBitrate` bypasses this mapping and is applied literally to whichever codec is resolved. The `encoding` setting (VBR/CBR) also applies to the resolved codec.

## Codec Change Re-Sync

When you change your codec preference and the resolved codec changes (for example, switching a Rockbox device from `"aac"` to `["opus", "aac"]`), podkit detects that existing tracks on the device were encoded with a different codec. On the next sync, those tracks are re-transcoded with the new codec. Play counts, ratings, and playlist membership are preserved.

The dry run shows codec changes clearly:

```
Codec change: 12 tracks need re-transcoding (aac -> opus)
```

## Seeing What's Happening

### Device Info

`podkit device info` shows your codec preference list with support indicators for the connected device:

```
Codec preference (lossy):    ✗ opus  · ✓ aac  · ✓ mp3
Codec preference (lossless): ✓ source · ✗ flac · ✓ alac
```

This tells you at a glance which codec will actually be used. In this example (an iPod), Opus is not supported, so AAC is the resolved lossy codec.

### Dry Run

`podkit sync --dry-run` includes the resolved codec in its summary:

```
Codec: aac (first supported from preference: opus -> aac -> mp3)
```

### Doctor

`podkit doctor` checks whether your FFmpeg build has the encoders needed for your configured codec preferences. If a preferred encoder is missing (for example, libopus is not compiled into FFmpeg), doctor reports a warning with advice on how to install it.

## Error Handling

If no codec in your preference list is both supported by the target device and has an available encoder, `podkit sync` exits with an error message listing:

- Which codecs were in your preference list
- That none are supported by the device
- Which codecs the device does support

This is rare with the default stack, since MP3 is universally supported as a fallback.

## See Also

- [Audio Transcoding](/user-guide/transcoding/audio) -- Quality presets, VBR vs CBR, file size estimates
- [Quality Presets](/reference/quality-presets) -- Detailed preset specifications
- [Config File Reference](/reference/config-file) -- Complete `[codec]` section reference
- [Track Upgrades](/user-guide/syncing/upgrades) -- How codec changes trigger re-transcoding
- [iPod Health Checks](/user-guide/devices/doctor) -- Doctor encoder availability checks
