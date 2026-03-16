---
title: "ADR-010: Quality Preset Redesign"
description: Redesign of quality presets to be device-aware, fix VBR bitrate variance issues, and simplify the preset model.
sidebar:
  order: 11
---

# ADR-010: Quality Preset Redesign

## Status

**Accepted** (2026-03-15)

Supersedes the preset portion of [ADR-003](/developers/adr/adr-003-transcoding) and the preset change detection portion of [ADR-009](/developers/adr/adr-009-self-healing-sync).

## Context

The current quality preset system has 9 presets (`lossless`, `max`, `max-cbr`, `high`, `high-cbr`, `medium`, `medium-cbr`, `low`, `low-cbr`) and several problems:

### VBR variance causes infinite re-sync loops

After syncing FLAC tracks with a VBR preset, a subsequent sync detects many tracks as needing re-transcoding. This is because VBR encoding produces content-dependent bitrates that can fall outside the ±50 kbps tolerance used for preset change detection. On a real iPod with 2,261 tracks synced at the `max` VBR preset (target 320 kbps), 195 tracks (8.6%) were falsely flagged — 161 as "preset downgrade" and 34 as "preset upgrade." Re-transcoding these tracks produces similarly variable bitrates, creating an infinite cycle.

The observed bitrate distribution for `max` VBR ranged from 175–399 kbps (mean 345, median 350), far exceeding the ±50 kbps tolerance window of 270–370 kbps.

### `max` and `high` VBR are effectively identical

Both `max` and `high` VBR use the same FFmpeg quality parameter (`q:a 5` for native AAC, `q=0` and `q=2` for aac_at). The `max` VBR preset claims a 320 kbps target but FFmpeg's VBR mode doesn't honour a target bitrate — it encodes to a quality level. The `max` preset produces the widest bitrate variance (±51 kbps observed spread) while offering no perceptible quality improvement over `high`.

### No device awareness for audio

The `lossless` preset sends ALAC to all devices, but not all iPods support ALAC playback. Only Classic, Video 5G/5.5G, and Nano 3G–5G support ALAC. The system has no way to gate lossless output on device capability. Video already has device profiles with per-generation capabilities; audio does not.

### Too many presets, confusing mental model

9 presets with VBR/CBR split at every tier creates choice paralysis. The `lossyQuality` fallback config (needed when `quality=lossless` and source is lossy) adds further complexity. Users shouldn't need to understand VBR vs CBR encoding to pick a quality level.

## Decision Drivers

- **Idempotent sync**: Running sync twice with no source changes should produce no work on the second run
- **Device awareness**: Presets should make the best choice for the connected device
- **Source awareness**: Transcoding decisions should consider what the source file actually is
- **Simplicity**: Fewer presets with sensible defaults, power-user overrides for those who want control
- **Consistency**: Audio and video presets should follow the same model

## Options Considered

### Option A: Widen tolerance only

Keep the 9-preset model, increase the fixed tolerance from 50 to 80 kbps. Simple fix but doesn't address the underlying design problems (too many presets, no device awareness, `max` ≈ `high`).

### Option B: Store preset name in sidecar cache

Record which preset was used per-track in a local cache file. Compare preset names instead of bitrates. Most robust for change detection but requires new infrastructure (cache files, invalidation logic, what happens if cache is lost).

### Option C: Redesign presets with device awareness and percentage tolerance (chosen)

Simplify to 4 tiers, make `max` device-aware (ALAC when supported, otherwise same as `high`), use percentage-based tolerance that adapts to VBR/CBR, offer power-user overrides. Addresses all problems holistically.

## Decision

### 4 quality tiers

| Preset | Default encoding | Default target | Behaviour |
|--------|-----------------|----------------|-----------|
| `max` | — | Lossless or 256 | ALAC if device supports it and source is lossless; otherwise identical to `high` |
| `high` | VBR | ~256 kbps | Transparent quality. Default preset |
| `medium` | VBR | ~192 kbps | Excellent quality |
| `low` | VBR | ~128 kbps | Space-efficient |

The old presets (`lossless`, `max-cbr`, `high-cbr`, `medium-cbr`, `low-cbr`, and the old `max` VBR) are removed. This is a breaking change — users with old preset names in their config will get a validation error with a clear message explaining the new options.

### ALAC device capability detection

Add `supportsAlac: boolean` to `IpodGenerationMetadata` in `generation.ts`:

| Supports ALAC | Generations |
|---------------|-------------|
| Yes | `video_1`, `video_2`, `classic_1`, `classic_2`, `classic_3`, `nano_3`, `nano_4`, `nano_5` |
| No | All others (Nano 1G–2G, 6G–7G, Shuffle, Mini, Touch, older iPods) |

### `max` preset decision tree

```
max + device supports ALAC + source is lossless:
  Source is ALAC → COPY
  Source is other lossless (FLAC, WAV, AIFF) → TRANSCODE to ALAC

max + device does NOT support ALAC:
  → Identical to high (VBR 256 or CBR 256)

max + source is compatible lossy (MP3, AAC):
  → COPY as-is (same as all other presets)

max + source is incompatible lossy (OGG, Opus):
  → TRANSCODE to AAC, capped at source bitrate (same as all other presets)
```

### Encoding mode config

VBR is the default. Users can opt into CBR globally or per-device:

```toml
encoding = "cbr"  # global override

[devices.nano]
encoding = "cbr"  # per-device override
```

### Custom bitrate override

Power users can override the preset's target bitrate:

```toml
customBitrate = 320  # kbps, range 64-320
```

Validation: must be an integer in the range 64–320. Ignored when `max` resolves to ALAC (lossless has no target bitrate).

### Incompatible lossy bitrate capping

When transcoding incompatible lossy sources (OGG, Opus), the effective bitrate is capped at the source file's bitrate to avoid creating larger files with no quality benefit:

```
effectiveBitrate = min(sourceBitrate, presetBitrate)
```

If the source bitrate is unknown, the preset bitrate is used as a safe default.

### Percentage-based preset change detection

Replace the fixed ±50 kbps tolerance with a percentage of the target bitrate, adapting to the encoding mode:

| Encoding | Default tolerance | Rationale |
|----------|------------------|-----------|
| VBR | 30% | Wide enough for VBR variance, reliably detects 2+ tier jumps |
| CBR | 10% | CBR bitrates are stable, can detect adjacent tier changes |
| ALAC (`max` on capable device) | Format check | Is the iPod track ALAC? Yes → in sync. No → upgrade |

Example ranges at 30% VBR tolerance:

| Preset | Target | In-sync range |
|--------|--------|---------------|
| high | 256 | 179–333 kbps |
| medium | 192 | 134–250 kbps |
| low | 128 | 90–166 kbps |

Users can override via `bitrateTolerance`:

```toml
bitrateTolerance = 0.25  # 25%, applies to all presets
```

### `lossyQuality` config removed

The `lossyQuality` fallback (previously needed when `quality=lossless` and source is lossy) is no longer needed. The new `max` preset handles this naturally: compatible lossy sources are copied as-is, incompatible lossy sources are transcoded with bitrate capping. There is no scenario where a separate lossy quality setting is required.

### Audio decision tree (complete)

```
COMPATIBLE LOSSY (MP3, AAC/M4A):
  → COPY as-is (always, regardless of preset)

INCOMPATIBLE LOSSY (OGG, Opus):
  → effectiveBitrate = min(sourceBitrate, presetBitrate)
  → TRANSCODE to AAC at effectiveBitrate
  → Warn: lossy-to-lossy conversion

LOSSLESS (FLAC, WAV, AIFF, ALAC):
  max + device supports ALAC:
    → Source is ALAC? COPY : TRANSCODE to ALAC
  max + device does NOT support ALAC:
    → TRANSCODE to AAC at target (encoding mode applies)
  high / medium / low:
    → TRANSCODE to AAC at target (encoding mode applies)
```

### Sync tags

Sync tags are metadata stored in the iPod track's `comment` field that record what transcode settings produced each file. They enable exact preset change detection without bitrate comparison.

Format: `[podkit:v1 quality=high encoding=vbr]`

- Written automatically after every transcode (add or upgrade)
- Versioned (`v1`) for forward compatibility — unknown versions are ignored
- Key-value pairs are order-independent and extensible
- Coexist with other comment text (the tag block is found and replaced in-place)
- When present, sync tag comparison takes priority over bitrate tolerance
- When absent (tracks synced before sync tags existed), falls back to bitrate tolerance

Detection flow for matched tracks:
1. Parse sync tag from iPod track's comment field
2. If sync tag found → exact comparison against current config → match = in sync, mismatch = re-transcode
3. If no sync tag → fall back to percentage-based bitrate tolerance

`--force-sync-tags` writes sync tags to all existing transcoded tracks as metadata-only updates (no file replacement). `--force-transcode` re-transcodes all lossless-source tracks and writes sync tags to the results.

### Video parallel

Video retains its existing `max | high | medium | low` presets and device profiles. Sync tags and percentage-based bitrate tolerance apply to video preset change detection in the same way as audio.

## Consequences

### Positive

- **Idempotent sync**: Sync tags eliminate false re-transcoding entirely for tagged tracks. Bitrate tolerance (30% VBR, 10% CBR) handles untagged tracks. Tested against a 2,261-track library where the previous system flagged 195 false positives.
- **Device-aware quality**: `max` automatically picks the best format the device supports, eliminating the risk of sending ALAC to devices that can't play it.
- **Simpler model**: 4 presets instead of 9. Users pick a quality tier; the system handles encoding details.
- **Source-aware transcoding**: Incompatible lossy files are transcoded at their source bitrate ceiling, not wastefully inflated.
- **Fine-grained control**: `encoding`, `customBitrate`, and `bitrateTolerance` for users who want to tune behaviour.
- **Explicit re-sync**: `--force-transcode` re-encodes all lossless-source tracks while preserving play counts, ratings, and playlists. `--force-sync-tags` tags existing tracks without re-encoding.

### Negative

- **Breaking change**: Users must update their config to use the new preset names. Error messages show valid options.
- **Adjacent VBR preset changes partially missed**: Switching between adjacent VBR presets (e.g., `medium` → `high`) may not trigger re-transcoding for all untagged tracks due to overlapping VBR ranges. Tagged tracks are always detected. Use `encoding = "cbr"` for guaranteed detection on untagged tracks.
- **Comment field usage**: Sync tags occupy part of the iPod track's comment field. The tag coexists with other text but tools that clear the comment field will remove the tag, causing a re-transcode on next sync.

## Related Decisions

- [ADR-003](/developers/adr/adr-003-transcoding) — Original transcoding design (presets portion superseded)
- [ADR-006](/developers/adr/adr-006-video-transcoding) — Video transcoding (video presets unchanged, tolerance approach applies)
- [ADR-009](/developers/adr/adr-009-self-healing-sync) — Self-healing sync (preset change detection portion superseded)
