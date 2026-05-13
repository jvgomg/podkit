---
title: Codec & Container Support
description: How podkit names audio codecs and containers, what device codec slots mean, and the assumptions podkit makes when matching source files to device support.
sidebar:
  order: 4
---

This page explains how podkit names audio codecs and containers, what each value means when it appears in your config, and the assumptions podkit makes about which combinations a device will accept.

## Codec vs container

Two distinct concepts that are easy to conflate, especially for OGG-family files:

- **Codec** — the audio stream format: AAC, ALAC, MP3, FLAC, Vorbis, Opus, PCM (WAV/AIFF). Determines how the audio is encoded.
- **Container** — the on-disk packaging that holds one or more streams plus metadata: MP4 (.m4a), MP3 (.mp3 native), FLAC (.flac native), OGG (.ogg or .opus), WAV, AIFF.

A device claiming to "support OGG" is ambiguous unless you know which codec inside the OGG container — Vorbis and Opus share the same container framing but are completely different codecs with different licensing histories, different bitrate-quality curves, and different device-support patterns. To avoid that ambiguity, podkit's codec model names the **audio stream codec**, not the container.

## Audio codecs podkit recognises

| Codec | Canonical container | Typical extension | Notes |
|-------|--------------------|--------------------|-------|
| `aac` | MP4 | `.m4a` | Most common modern lossy codec. Also accepted by some devices in bare ADTS (`.aac`). |
| `alac` | MP4 | `.m4a` | Apple Lossless. Same container as AAC; distinguished by stream codec. |
| `mp3` | MP3 (native) | `.mp3` | Universally supported. |
| `flac` | FLAC (native) | `.flac` | Open lossless. Rarely also seen as OGG-FLAC (`.ogg`). |
| `vorbis` | OGG | `.ogg` | Older open lossy codec. Wide legacy-device support. |
| `opus` | OGG | `.opus` | Modern open lossy codec (IETF RFC 6716). Better quality per bitrate than Vorbis. Support on many post-2015 DAPs but **not all** — some devices that play Vorbis-in-OGG refuse Opus. |
| `wav` | WAV | `.wav` | Uncompressed PCM. podkit will not transcode *to* WAV (see below), but accepts it as a source. |
| `aiff` | AIFF | `.aif`, `.aiff` | Uncompressed PCM (Apple). Same source-only treatment as WAV. |

`'ogg'` was previously a codec value that meant "OGG Vorbis." It was renamed to `'vorbis'` to make the codec/container distinction explicit. Configs using `'ogg'` are migrated automatically by `podkit migrate`.

## Container detection

The container is implied by the codec in nearly every case:

- AAC → MP4 (`.m4a`)
- ALAC → MP4 (`.m4a`)
- MP3 → MP3 native
- FLAC → FLAC native
- Vorbis → OGG (`.ogg`)
- Opus → OGG (`.opus`)
- PCM → WAV or AIFF

When podkit transcodes, it produces the canonical container. When a source file is in a non-canonical container — for example, FLAC-in-OGG, or Opus-in-`.ogg`-extension instead of `.opus` — podkit detects this from the file header (local sources) or the server's `contentType` field (Subsonic). Container-level enforcement at sync time is part of the planned [container-aware sync work](#planned-improvements).

## Device codec slots

A device preset's `supportedAudioCodecs` lists the codecs the device firmware can decode. Each entry names the audio stream codec, not the container.

```toml
[devices.echo-mini]
supportedAudioCodecs = ["aac", "alac", "mp3", "flac", "vorbis", "wav"]
# Note: NO "opus" — Echo Mini firmware hides .opus files from its library.
```

```toml
[devices.rockbox]
supportedAudioCodecs = ["aac", "alac", "mp3", "flac", "vorbis", "opus", "wav", "aiff"]
# Rockbox supports both Vorbis-in-OGG and Opus-in-OGG.
```

When podkit syncs a source file to a device:

1. The source file's stream codec is detected (local file via header read; Subsonic via API metadata).
2. The codec is matched against the device's `supportedAudioCodecs`.
3. If matched, the file is passed through unchanged (subject to transfer mode — see [Transfer Modes](/user-guide/syncing/transfer-modes)).
4. If not matched, the file is transcoded to a codec the device does support, picked from the [codec preference stack](/user-guide/transcoding/codec-preferences).

## Output codecs (transcoding targets)

A separate, smaller set: the codecs podkit can produce as output when transcoding. podkit will not produce WAV, AIFF, or Vorbis as output:

- WAV/AIFF — too large for portable use; reliable tag-writing in those containers is uneven.
- Vorbis — opus already covers the open lossy slot with better quality per bitrate. Adding a Vorbis encoder target is not on the roadmap.

Output codecs are configured via the `[codec]` section. See [Codec Preferences](/user-guide/transcoding/codec-preferences).

## Source format expectations

podkit accepts these file extensions as sources:

| Extension | Default codec assumption | When that assumption is wrong |
|-----------|--------------------------|------------------------------|
| `.mp3` | MP3 | Never |
| `.flac` | FLAC (native container) | Never |
| `.m4a` | AAC, unless the file's stream codec is ALAC | (handled automatically) |
| `.aac` | AAC (ADTS) | Never |
| `.ogg` | Vorbis, unless the file's stream codec is Opus or FLAC | (handled automatically when stream codec is probed) |
| `.opus` | Opus | Never |
| `.wav` | PCM | Never |
| `.aif` / `.aiff` | PCM | Never |

The `.m4a` and `.ogg` extensions can hold multiple codecs. podkit inspects the audio stream via the file header (for local directory sources) or the server's content type metadata (for Subsonic). Worst case if codec inference fails: podkit falls back to the dominant codec for the container (`aac` for `.m4a`, `vorbis` for `.ogg`).

## Planned improvements

podkit's current model treats codec compatibility as the sole gate. It does not yet enforce container compatibility separately — for example, a device that supports `flac` as a codec is assumed to accept FLAC only in its native `.flac` container, not in OGG-FLAC. In practice this assumption holds for the devices podkit currently supports; the wider container-axis enforcement (and a `containerConstraints` field for devices with unusual container support) is planned for a future release. See the [container-aware sync](../../backlog/docs/) PRD for details.

## How podkit detects source codecs

**Local directory sources** (`DirectoryAdapter`)

Local files are parsed once at scan time using [`music-metadata`](https://github.com/borewit/music-metadata), which reads only the file header. For `.ogg` files specifically, music-metadata identifies the stream codec (`Vorbis I`, `Opus`, `FLAC`, etc.) from the OGG page headers. No external tool spawns, no ffprobe per file.

**Subsonic sources** (`SubsonicAdapter`)

The Subsonic API supplies a `suffix` (file extension) and `contentType` (MIME) per track. The adapter trusts `suffix` for the container axis and, for the rare opus-in-`.ogg` case, checks `contentType` for the `opus` substring. There is no file-header probe — the file is on the server and a per-track HEAD or range request would add measurable network overhead.

If a Subsonic server reports `.ogg` for a file that actually contains Opus and does **not** include `opus` in its content type, podkit will treat the file as Vorbis and may misclassify compatibility on devices with asymmetric Vorbis/Opus support. This is rare; if you hit it, please report the server and file.

## Related references

- [Quality Presets](/reference/quality-presets) — how podkit picks bitrates per codec.
- [Codec Preferences](/user-guide/transcoding/codec-preferences) — configuring the transcode output stack.
- [Device-specific docs](/devices/) — per-device codec and container quirks.
