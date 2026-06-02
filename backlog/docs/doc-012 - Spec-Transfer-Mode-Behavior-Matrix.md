---
id: doc-012
title: 'Spec: Transfer Mode Behavior Matrix'
type: other
created_date: '2026-03-23 13:55'
---
## Overview

This spec defines the exact behavior of each `transferMode` value for every file type path through the sync engine. It serves as the definitive reference for planner and executor implementation.

**Parent document:** PRD: Transfer Mode (DOC-011)

## Terminology

- **Direct copy**: File is copied byte-for-byte to the device. No FFmpeg involvement.
- **Optimized copy**: File is routed through FFmpeg with audio stream copy (`-c:a copy`) and artwork manipulation. Audio is not re-encoded.
- **Transcode**: File is decoded and re-encoded to a different codec/bitrate via FFmpeg.
- **Database artwork device**: Device reads artwork from an internal database, not from embedded file data (e.g., iPod via libgpod).
- **Embedded artwork device**: Device reads artwork from data embedded in the audio file (e.g., Rockbox, most DAPs).
- **Sidecar artwork device**: Device reads artwork from a file alongside the audio file, e.g., `folder.jpg` (e.g., some Rockbox themes, Echo Mini).

## Behavior Matrix: Database Artwork Devices (iPod)

This is the only matrix implemented in v1. iPods read artwork via `track.setArtworkFromData()` into their internal database. Embedded artwork in files is dead weight.

| Source → Target | `fast` | `optimized` | `portable` |
|----------------|--------|-------------|------------|
| FLAC → AAC | Transcode, strip artwork | Transcode, strip artwork | Transcode, preserve artwork |
| FLAC → ALAC | Transcode, strip artwork | Transcode, strip artwork | Transcode, preserve artwork |
| WAV → AAC | Transcode, strip artwork | Transcode, strip artwork | Transcode, preserve artwork |
| AIFF → AAC | Transcode, strip artwork | Transcode, strip artwork | Transcode, preserve artwork |
| ALAC → ALAC | Direct copy | Optimized copy, strip artwork | Direct copy |
| MP3 → MP3 | Direct copy | Optimized copy, strip artwork | Direct copy |
| M4A/AAC → M4A/AAC | Direct copy | Optimized copy, strip artwork | Direct copy |
| OGG → AAC | Transcode, strip artwork | Transcode, strip artwork | Transcode, preserve artwork |
| Opus → AAC | Transcode, strip artwork | Transcode, strip artwork | Transcode, preserve artwork |

**Key observations:**
- `fast` and `optimized` behave identically for transcodes (always strip — faster encode, smaller file)
- `fast` and `portable` behave identically for copies (both are direct copy, no FFmpeg)
- `optimized` is the only mode that introduces FFmpeg processing for copy-format files
- `portable` is the only mode that preserves artwork in transcoded output

## FFmpeg Arguments by Path

### Transcode paths (FLAC/WAV/AIFF → AAC)

**`fast` / `optimized` (strip artwork):**
```
-i <input> -c:a aac -q:a <quality> -ar 44100 -map_metadata 0 -vn -f ipod -y -progress pipe:1 <output>
```

**`portable` (preserve artwork):**
```
-i <input> -c:a aac -q:a <quality> -ar 44100 -map_metadata 0 -c:v copy -disposition:v attached_pic -f ipod -y -progress pipe:1 <output>
```

### Transcode paths (FLAC/WAV/AIFF → ALAC)

**`fast` / `optimized` (strip artwork):**
```
-i <input> -c:a alac -ar 44100 -map_metadata 0 -vn -f ipod -y -progress pipe:1 <output>
```

**`portable` (preserve artwork):**
```
-i <input> -c:a alac -ar 44100 -map_metadata 0 -c:v copy -disposition:v attached_pic -f ipod -y -progress pipe:1 <output>
```

### Optimized copy paths (ALAC → ALAC, strip artwork)

```
-i <input> -c:a copy -map_metadata 0 -vn -f ipod -y -progress pipe:1 <output>
```

### Optimized copy paths (MP3 → MP3, strip artwork)

```
-i <input> -c:a copy -map_metadata 0 -vn -y -progress pipe:1 <output>
```

Note: MP3 output does not use `-f ipod` container format. The output format is inferred or explicitly set to MP3.

### Optimized copy paths (M4A/AAC → M4A/AAC, strip artwork)

```
-i <input> -c:a copy -map_metadata 0 -vn -f ipod -y -progress pipe:1 <output>
```

### Direct copy paths

No FFmpeg involvement. Standard file copy operation.

## Behavior Matrix: Embedded Artwork Devices (Future)

For devices that read artwork from embedded file data. The key difference: stripping artwork degrades the experience, so `optimized` resizes rather than strips.

| Source → Target | `fast` | `optimized` | `portable` |
|----------------|--------|-------------|------------|
| FLAC → target codec | Transcode, resize artwork to device max | Transcode, resize artwork to device max | Transcode, preserve full-res artwork |
| Lossless copy | Direct copy | Optimized copy, resize artwork | Direct copy |
| Lossy copy | Direct copy | Optimized copy, resize artwork | Direct copy |

**Not implemented in v1.** The `DeviceCapabilities` interface is designed to support this, but the resize/embed logic ships with Echo Mini device support.

## Sidecar Artwork: Source-Side (TASK-142, landed)

Source adapters now consult sidecar artwork when the audio file body carries no embedded picture:

- **Directory adapter**: scans the audio file's parent directory for peer
  `{cover, folder, front, album}.{jpg, jpeg, png}` (case-insensitive). On a hit
  with no embed, `hasArtwork` flips true and the sidecar bytes are returned via
  the new `adapter.getArtwork(track)` seam. Embed wins when both are present —
  the sidecar is a fallback, not an override.
- **Subsonic adapter**: `getArtwork(track)` calls Navidrome's `getCoverArt`.
  Navidrome's scanner indexes sidecar files into the same endpoint that serves
  embedded covers, so podkit's executor sees adapter-side art for any source
  the server reports a cover for. The placeholder image is filtered via a
  one-time probe in `connect()`, so albums Navidrome has no real cover for
  return null and don't leak the placeholder onto the device.

The executor's `MusicPipeline.transferArtwork` consults `adapter.getArtwork`
after `AlbumArtworkCache.extractArtwork` returns null (per `MusicPipeline.buildAdapterFallback`).
Positive results promote to the album-level positive cache so siblings on the
same album share one fetch.

**Embed-vs-sidecar principle.** Identical on both adapters by virtue of routing
through the same album cache: `extractArtwork(audioFile)` runs first; sidecar /
API bytes flow only on a miss.

**Caveat (rare):** A Subsonic server configured to transcode-on-stream may
strip the embedded picture during download. In that case `extractArtwork` on
the downloaded file returns null even though the original had embed —
`getArtwork` then serves the server's API cover. Art still lands on the device;
the bytes may differ in compression/format from the original embed.

## Behavior Matrix: Sidecar Artwork Devices (Future, TASK-370)

For devices that read artwork from sidecar files (e.g., `folder.jpg`) in preference to embedded data on the device-side. **Independent of the source-side sidecar reading above** — TASK-370 is about WRITING sidecars onto the target.

| Source → Target | `fast` | `optimized` | `portable` |
|----------------|--------|-------------|------------|
| Any transcode | Transcode, strip embedded; create device-res sidecar | Transcode, strip embedded; create device-res sidecar | Transcode, preserve embedded; create device-res sidecar |
| Any copy | Direct copy; create device-res sidecar | Optimized copy, strip embedded; create device-res sidecar | Direct copy; create device-res sidecar |

**Not implemented in v1.** The matrix reference model carries the spec
(`artworkPrimary`, `expectedSidecarSize` in `test-packages/e2e-tests/src/matrix/reference-model.ts`)
so callers consume the predicate before production writes sidecars. Production
embeds bytes into the file via `track.setArtworkFromData` regardless of
`artworkSources[0]`; for `MassStorageTrack` this is a no-op on non-OGG
containers, fenced by `skipBug TASK-370` in the artwork matrix. TASK-371
(non-OGG taglib embed) and TASK-372 (`DeviceTrack.artworkSink` primitive) are
the related write-side follow-ups.

## Edge Cases

### Source file has no embedded artwork
All modes behave identically — no artwork to strip, resize, or preserve. Transcode and copy proceed without artwork flags. The `-vn` flag is still safe to include (it's a no-op when there's no video/image stream).

### Source file has multiple image streams
FFmpeg's `-vn` strips all video/image streams. `-c:v copy` copies the first video stream. This matches current behavior and is acceptable.

### Incompatible lossy sources (OGG, Opus)
These are always transcoded regardless of transfer mode. The lossy-to-lossy warning is orthogonal to transfer mode.

### Source artwork is smaller than device max resolution
For future embedded/sidecar devices: do not upscale. Use the source artwork as-is or copy it directly. Only downscale when source exceeds device max.
