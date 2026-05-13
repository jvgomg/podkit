---
id: doc-036
title: Codec and Container Design Principles
type: specification
created_date: '2026-05-13 15:22'
tags:
  - codec
  - container
  - design-principles
  - device-presets
---
# Codec and Container Design Principles

## Status

Accepted. Phase 1 (codec/container disambiguation: `'ogg'` → `'vorbis'` rename + type-level groundwork) shipped May 2026. Phase 2/3 enforcement tracked in the [Container-Aware Sync PRD](#related-documents).

## Context

Until May 2026, podkit's `AudioCodec` type used the literal `'ogg'` to mean "OGG Vorbis." That literal conflated two concepts — the audio stream codec (Vorbis) and the file container (OGG) — and could not distinguish Vorbis-in-OGG from Opus-in-OGG.

Real-world consequence: Echo Mini (firsthand-confirmed in `devices/echo-mini.md`) supports Vorbis-in-OGG but hides `.opus` files from its library. With a single `'ogg'` slot, podkit could not tell apart "device supports Vorbis" from "device supports Opus" and could pass through `.opus` files to a device that would silently fail to play them.

The principles below set the model podkit uses to avoid this class of bug.

## Principles

### 1. Codec and container are distinct axes

- **Codec** names the audio stream format: `aac`, `alac`, `mp3`, `flac`, `vorbis`, `opus`, `wav` (PCM-in-WAV), `aiff` (PCM-in-AIFF).
- **Container** names the on-disk packaging: `mp4`, `mp3`, `flac`, `ogg`, `wav`, `aiff`.
- Independent in theory; tightly correlated in practice. OGG is the exception — Vorbis, Opus, and (rarely) FLAC and Speex can all live inside.

### 2. The codec axis is the unit of device compatibility

Device presets declare `supportedAudioCodecs: AudioCodec[]`. Each entry names the audio stream codec, not the container. A device declaring `'vorbis'` is implicitly declaring "I can decode a Vorbis stream when it arrives in its canonical container."

### 3. Containers are implied by canonical mapping unless overridden

`CODEC_CANONICAL_CONTAINER` in `packages/device-types/src/capabilities.ts` is the single source of truth.

| Codec | Canonical container | Canonical extension |
|-------|--------------------|--------------------|
| aac | mp4 | .m4a |
| alac | mp4 | .m4a |
| mp3 | mp3 | .mp3 |
| flac | flac | .flac |
| vorbis | ogg | .ogg |
| opus | ogg | .opus |
| wav | wav | .wav |
| aiff | aiff | .aif / .aiff |

podkit produces canonical containers when transcoding. podkit assumes a device accepts a codec only in its canonical container unless the device's `containerConstraints?: Partial<Record<AudioCodec, AudioContainer[]>>` field declares wider acceptance.

### 4. Non-canonical containers are rare but real; reserve type space

Edge cases that exist but are uncommon:

- FLAC-in-OGG (OGG-FLAC)
- Opus with `.ogg` extension instead of `.opus`
- AAC in bare ADTS (`.aac`) rather than MP4

`containerConstraints` is declared on `DeviceCapabilities` today but unenforced. Phase 2 wires it into the planner.

### 5. Source codec detection is the adapter boundary's job

Each adapter populates `track.codec` (audio stream codec) distinct from `track.fileType` (file extension).

- **Local files** (`DirectoryAdapter`): `music-metadata`'s OGG parser already emits `'Vorbis I'`, `'Opus'`, `'FLAC'`, etc. Free — header read is part of every scan.
- **Subsonic** (`SubsonicAdapter`): trust server `suffix` for container; use `contentType` for opus-in-`.ogg` discrimination. No per-file header probe.

`fileTypeToAudioCodec(fileType, codec?)` in `packages/podkit-core/src/sync/music/planner.ts` dispatches on extension, defaulting to canonical assumptions when `codec` is absent (`.m4a` → aac, `.ogg` → vorbis).

### 6. ffprobe is not on the scan path

Per-file ffprobe spawn: ~50–150 ms. Per-file `music-metadata` header read: ~1–5 ms. The header-read path is sufficient for codec inference on local files. ffprobe stays reserved for transcode-time operations.

### 7. Output codecs are a smaller, distinct set

`TranscodeTargetCodec` (in `packages/podkit-core/src/transcode/codecs.ts`) is intentionally narrower than `AudioCodec`. podkit will not produce:

- **Vorbis** — opus already covers the open lossy slot with better quality per bitrate; every device that accepts vorbis also accepts mp3 or opus.
- **PCM** (wav/aiff) — too large for portable use; tag-writing reliability in those containers is uneven.

### 8. Device profile (`devices/<name>.md`) is the prose source of truth

Preset code mirrors the device profile. When `supportedAudioCodecs` in a preset disagrees with the profile, the profile wins; the preset is updated to match.

### 9. Renames are config-migration territory

Any change to the `AudioCodec` literal set is breaking for user TOML. Migration 0002 (`'ogg'` → `'vorbis'` in `supportedAudioCodecs`) shipped with the rename.

## What this principle deliberately does not do

- **Does not add a parallel container axis to user config.** Container is implied by codec, overrides via `containerConstraints` only.
- **Does not require ffprobe at scan time.** Header inspection is sufficient.
- **Does not force every preset to populate `containerConstraints`.** When omitted, the canonical mapping applies.

## Related documents

- **PRD: Container-Aware Sync (Phases 2 & 3)** — sync-time enforcement, rebox path, planner integration, doctor pre-flight.
- **PRD: Portable Transfer Mode — Strict Manual UX** — adjacent UX work that depends on the same enforcement surface.
- `docs/reference/codec-support.md` — user-facing reference page.
- `devices/TEMPLATE.md` — device profile template with codec/container guidance.

## Implementation footprint (Phase 1, May 2026)

- `packages/device-types/src/capabilities.ts` — `AudioCodec` rename; new `AudioContainer`, `AUDIO_CONTAINERS`, `CODEC_CANONICAL_CONTAINER`; new `containerConstraints?` field.
- `packages/devices-mass-storage/src/presets/built-in.ts` — Echo Mini, Rockbox updated.
- `packages/devices-mass-storage/src/preset.ts` — merge logic carries `containerConstraints`.
- `packages/podkit-core/src/sync/music/planner.ts` — `fileTypeToAudioCodec` uses `track.codec` for `.ogg`.
- `packages/podkit-core/src/adapters/subsonic.ts` — `getCodec` adds `contentType` discrimination for opus-in-`.ogg`.
- `packages/devices-ipod/src/capabilities.ts` — `normaliseCodec` returns `'vorbis'` for vorbis labels.
- `packages/podkit-cli/src/config/migrations/0002-rename-ogg-codec.ts` — automatic migration.
- `packages/podkit-cli/src/config/version.ts` — `CURRENT_CONFIG_VERSION = 2`.
