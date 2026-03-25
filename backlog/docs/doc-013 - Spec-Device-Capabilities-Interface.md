---
id: doc-013
title: 'Spec: Device Capabilities Interface'
type: other
created_date: '2026-03-23 13:55'
updated_date: '2026-03-24 16:12'
---
## Overview

This spec defines the `DeviceCapabilities` interface that allows the sync engine to make device-aware decisions about file transfer, artwork handling, and codec selection. For v1, only iPod implements this interface. The design accommodates future devices (Rockbox, Echo Mini) without requiring changes to the interface.

**Parent document:** PRD: Transfer Mode (DOC-011)

## Design Principles

1. **Capability-driven, not device-driven.** The sync engine queries capabilities, not device types. It never asks "is this an iPod?" — it asks "does this device read embedded artwork?"
2. **Declare what the device needs.** Capabilities describe what the device requires for optimal playback, not what it can theoretically handle.
3. **Auto-detect when possible, accept user input when not.** iPod capabilities are derived from USB probing and generation metadata. Rockbox capabilities may need user configuration because the same firmware runs on many hardware platforms.
4. **Start narrow, expand later.** Only include capabilities that the sync engine actually queries today. Don't add speculative fields.

## Interface

```typescript
interface DeviceCapabilities {
  /** Where the device reads artwork from, ordered by priority (first = preferred). */
  artworkSources: ArtworkSource[];

  /** Maximum artwork display resolution in pixels (width = height, square). */
  artworkMaxResolution: number;

  /** Audio codecs the device can play natively without transcoding. */
  supportedAudioCodecs: AudioCodec[];

  /** Whether the device supports video playback. */
  supportsVideo: boolean;
}

type ArtworkSource = 'database' | 'embedded' | 'sidecar';

type AudioCodec = 'aac' | 'alac' | 'mp3' | 'flac' | 'ogg' | 'opus' | 'wav' | 'aiff';
```

## How the Sync Engine Uses Capabilities

### Transfer mode decisions

The sync engine combines `transferMode` (user intent) with `artworkSources` (device need) to decide how to handle artwork:

```
If primary artwork source is 'database':
  → Embedded artwork is dead weight
  → fast/optimized: strip embedded artwork
  → portable: preserve embedded artwork

If primary artwork source is 'embedded':
  → Embedded artwork is functional
  → All modes: resize to artworkMaxResolution (never strip)
  → portable: also preserve full-res (inform user of device limitation)

If primary artwork source is 'sidecar':
  → Create optimized sidecar at artworkMaxResolution
  → fast/portable: direct copy file (embedded preserved naturally)
  → optimized: strip embedded artwork (sidecar is what matters)
```

### Codec / transcode decisions

The sync engine uses `supportedAudioCodecs` to determine the transcode target:

```
If source codec in supportedAudioCodecs:
  → Copy or passthrough (no audio re-encoding needed)

If 'alac' in supportedAudioCodecs and quality = 'lossless':
  → Transcode lossless sources to ALAC

If 'alac' not in supportedAudioCodecs and quality = 'lossless':
  → Transcode to AAC at high bitrate (current behavior for non-ALAC iPods)
```

This replaces the current `deviceSupportsAlac: boolean` with a more general mechanism.

### Video decisions

`supportsVideo` is used by the video sync pipeline (unchanged from current behavior).

## iPod Implementation (v1)

iPod capabilities are derived from the existing generation metadata in `generation.ts`. No new data sources needed.

```
iPod with color screen (Classic, Video, Nano 3-5G):
  artworkSources: ['database']
  artworkMaxResolution: 320  (Classic/Video) or 176 (Nano 3G) etc.
  supportedAudioCodecs: ['aac', 'mp3', 'alac', 'wav', 'aiff']  (if ALAC-capable)
  supportsVideo: true/false (per generation)

iPod without color screen (Nano 1-2G, Mini):
  artworkSources: ['database']  (artwork still written to DB, just smaller/monochrome)
  artworkMaxResolution: 42  (Mini) or 0 for no-screen models
  supportedAudioCodecs: ['aac', 'mp3']
  supportsVideo: false

iPod Shuffle:
  artworkSources: []  (no screen)
  artworkMaxResolution: 0
  supportedAudioCodecs: ['aac', 'mp3']
  supportsVideo: false
```

### Mapping from generation.ts

The existing `supportsAlac()`, `supportsVideo()`, and `getVideoProfile()` functions provide most of the data. A new function builds the full capabilities object:

```
getDeviceCapabilities(generation, deviceInfo) → DeviceCapabilities
```

This function consolidates scattered capability queries into a single structured object.

## Future Device: Rockbox

Rockbox runs custom firmware on various hardware (iPod Classic, Sansa, etc.). Capabilities vary by hardware, not firmware.

```
Typical Rockbox device:
  artworkSources: ['embedded']  (or ['sidecar', 'embedded'] depending on theme)
  artworkMaxResolution: varies by hardware screen size
  supportedAudioCodecs: ['aac', 'mp3', 'flac', 'ogg', 'opus', 'alac', 'wav', 'aiff']
  supportsVideo: false (most Rockbox targets)
```

**Detection challenge:** Rockbox devices appear as USB mass storage. podkit cannot probe the firmware version or hardware model via USB. Users may need to specify their device profile or hardware model in config.

**Config approach (future):**
```toml
[[devices]]
name = "my-rockbox"
type = "rockbox"
model = "ipod-classic"  # Determines screen size, capabilities
# OR explicit overrides:
# artworkMaxResolution = 320
```

The `DeviceCapabilities` interface doesn't need to change — only the source of the data differs (auto-detected vs user-configured).

## Echo Mini (confirmed via firsthand testing, 2026-03-24)

```
Echo Mini:
  artworkSources: ['embedded']            # Embedded JPEG only — no sidecar support (confirmed)
  artworkMaxResolution: 600               # Optimal for instant load; 1000 max before slowdown
  supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'wav']
  supportsVideo: false
```

**Corrections from original spec (based on TASK-232/233 testing):**
- **No sidecar artwork** — tested cover.jpg, folder.jpg, albumart.jpg; all ignored. Original spec assumed `['sidecar', 'embedded']`.
- **ALAC confirmed working** — resolves conflicting community reports. Plays in both library and folder browser.
- **artworkMaxResolution: 600** — not 320 as estimated. 600x600 at quality 85-90 (~50-100KB) loads instantly. No hard pixel limit, but byte size determines load speed.
- **WAV included** — plays but not indexed by library scanner (folder browser only).
- **Baseline JPEG only** — progressive JPEG silently ignored. Not reflected in DeviceCapabilities but critical for the artwork pipeline.

**Implementation notes (not part of capabilities interface):**
- Library displays filenames, not TITLE tags — adapter must generate meaningful filenames
- Compound TRACKNUMBER ("3/10") not parsed — use clean integers
- Disc number sorting inverted — workaround: append "(disc N)" to album name
- FLAC must use Vorbis Comments (ID3 in FLAC ignored)
- Opus files completely hidden from device (library and folder browser)
- USB detection: VID 0x071b, PID 0x3203, manufacturer string "ECHO MINI"
- Dual USB LUNs: internal (FAT32, 7.5GB) + SD card (exFAT)

## Extension Points

The interface can be extended with additional capabilities as needed:

- `supportedSampleRates`: For devices that can't handle high sample rates
- `maxFileSize`: For FAT32 or device-imposed limits
- `playlistFormat`: 'm3u' | 'pls' | 'database' etc.
- `metadataSource`: 'tags' | 'database' — how the device reads track metadata

These are **not included in v1**. Listed here to show the interface can grow without breaking changes.

## Transition from Current Code

The current code passes `deviceSupportsAlac: boolean` through `MusicContentConfig` and `PlanOptions`. This will be replaced by passing `DeviceCapabilities` (or a relevant subset) to the planner and executor. The `deviceSupportsAlac` flag becomes derivable from `capabilities.supportedAudioCodecs.includes('alac')`.
