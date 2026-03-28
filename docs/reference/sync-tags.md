---
title: Sync Tags
description: Reference for sync tags — metadata embedded in iPod tracks that record transcode settings and artwork fingerprints.
sidebar:
  order: 6
---

Sync tags are small metadata markers that podkit writes into the iPod track's comment field. They record exactly what transcode settings produced each file, enabling precise [preset change detection](/reference/quality-presets) and [artwork change detection](/user-guide/syncing/artwork).

## Format

Sync tags use a versioned key-value format:

```
[podkit:v1 quality=high encoding=vbr codec=aac]
```

The tag is embedded in the track's comment field alongside any existing comment text. podkit reads and updates only the `[podkit:...]` block, leaving the rest of the comment untouched.

### Fields

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `quality` | Yes | `lossless`, `high`, `medium`, `low`, `max`, `copy` | The quality preset (or `copy` for direct-copy tracks) |
| `encoding` | No | `vbr`, `cbr` | Encoding mode. Omitted for lossless audio and video |
| `codec` | No | `aac`, `opus`, `mp3`, `flac`, `alac` | The resolved audio codec. Used for [codec change detection](/user-guide/transcoding/codec-preferences#codec-change-re-sync). Legacy tags without this field assume AAC (lossy) or ALAC (lossless). |
| `bitrate` | No | `64`–`320` | Only present when a custom bitrate override was used |
| `art` | No | 8-character hex string | Artwork fingerprint (xxHash truncated to 32 bits) |
| `transfer` | No | `fast`, `optimized`, `portable` | Transfer mode used when processing the file. Informational — not used for change detection. |

### Examples

```
[podkit:v1 quality=high encoding=vbr codec=aac]        # VBR AAC transcode at high preset
[podkit:v1 quality=medium encoding=cbr codec=aac]      # CBR AAC transcode at medium preset
[podkit:v1 quality=high encoding=vbr codec=opus]       # VBR Opus transcode at high preset
[podkit:v1 quality=high encoding=cbr bitrate=256 codec=aac]  # CBR with custom bitrate override
[podkit:v1 quality=lossless codec=alac art=a1b2c3d4]   # ALAC transcode with artwork fingerprint
[podkit:v1 quality=lossless codec=flac]                # FLAC transcode (lossless)
[podkit:v1 quality=copy art=deadbeef]                  # Direct-copy track with artwork fingerprint
[podkit:v1 quality=max]                                # Video transcode
[podkit:v1 quality=high encoding=vbr codec=aac transfer=fast]  # VBR transcode with fast transfer mode
[podkit:v1 quality=copy transfer=optimized]            # Optimized copy (artwork stripped via passthrough)
```

## When Sync Tags Are Written

Sync tags are written automatically during normal syncs:

- **Transcoded tracks** get a tag recording the quality preset and encoding mode
- **Artwork transfers** add the `art` field to the existing tag (or create a minimal `quality=copy` tag for non-transcoded tracks)

This means sync tag coverage grows naturally over time as you sync new tracks or upgrade existing ones.

### Writing tags to all tracks at once

Use `--force-sync-tags` to write or update sync tags for all matched tracks without re-transferring audio:

```bash
podkit sync --force-sync-tags
```

This is a metadata-only operation. It's useful for:

- Establishing sync tags on a library that was synced before sync tags existed
- Populating artwork fingerprints for [artwork change detection](/user-guide/syncing/artwork#artwork-change-detection) (combine with `--check-artwork`)

```bash
# Write sync tags and artwork fingerprints in one pass
podkit sync --force-sync-tags --check-artwork
```

## How Sync Tags Are Used

### Preset change detection

When you change your [quality preset](/reference/quality-presets) (e.g., `medium` to `high`), podkit compares the new target settings against each track's sync tag. If they don't match, the track is re-transcoded.

Without sync tags, podkit falls back to comparing the track's bitrate against the target bitrate using a percentage tolerance (30% for VBR, 10% for CBR). This works but is less precise — VBR encoding naturally produces variable bitrates that can trigger false re-transcodes. Sync tags eliminate this ambiguity with an exact comparison.

The `transfer` field is informational only — it records which transfer mode was used when the track was processed, but changes to `transferMode` do not trigger re-transcoding. Use `--force-transfer-mode` to re-process tracks when changing transfer mode.

### Artwork change detection

When `--check-artwork` is enabled, podkit computes a fingerprint of each track's current source artwork and compares it against the `art` field in the sync tag. A mismatch means the artwork has changed since the last sync. See [Artwork](/user-guide/syncing/artwork) for details.

## Consistency

`podkit device music` reports sync tag consistency — how many tracks have complete sync tags:

| Symbol | State | Meaning |
|--------|-------|---------|
| `✓` | Consistent | Has sync tag with artwork fingerprint (or track has no artwork) |
| `◐` | Partial | Has sync tag but missing artwork fingerprint |
| `✗` | Missing | No sync tag at all |

Tracks without sync tags still sync normally — they just use the bitrate tolerance fallback for preset change detection and can't participate in artwork change detection.

## Forward Compatibility

Sync tags are designed to be resilient to future changes:

- The `v1` version prefix means future tag formats won't conflict with existing ones
- Unknown fields are silently ignored during parsing
- Unknown tag versions are left untouched

## See Also

- [Quality Presets](/reference/quality-presets) — Preset tiers and how preset changes are detected
- [Artwork](/user-guide/syncing/artwork) — Artwork sync and change detection
- [Track Upgrades](/user-guide/syncing/upgrades) — How podkit detects and applies upgrades
- [CLI Commands](/reference/cli-commands) — `--force-sync-tags` and `--force-transcode` flags
