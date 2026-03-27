---
id: doc-024
title: 'PRD: Configurable Codec Preference System'
type: other
created_date: '2026-03-26 11:38'
updated_date: '2026-03-27 10:34'
---
## Problem Statement

Podkit now supports multiple device types (iPod, Rockbox, Echo Mini) with different codec support, but the transcoding pipeline hardcodes AAC as the universal lossy target and has special-case ALAC logic for the `max` preset. This means devices that support superior codecs like Opus still get AAC files — larger files at lower quality than necessary. Users have no way to express codec preferences, and adding new device types requires modifying planner logic rather than just declaring capabilities.

## Solution

Introduce a **codec preference stack** — an ordered list of codecs that podkit walks top-to-bottom, selecting the first codec the target device supports AND whose encoder is available in FFmpeg. Users can configure this globally and per-device, with sensible defaults that deliver the best quality without requiring any configuration.

The system separates **lossy** and **lossless** preference stacks. Quality presets (max/high/medium/low) remain orthogonal — they control bitrate tier, while the codec stack controls format. Preset-to-bitrate mappings are codec-aware internally so that "high quality" means perceptually equivalent quality regardless of codec.

### Default stacks

**Lossy:** `opus → aac → mp3`
- Opus: Best quality per bit at all bitrates
- AAC: Excellent quality, widest device support
- MP3: Universal fallback

**Lossless (used when quality preset is `max` and source is lossless):** `source → flac → alac`
- `source`: Keep the original lossless format if the device supports it (zero audio processing). This applies to lossless formats that are valid transcoding targets (FLAC, ALAC). For lossless formats that are not transcoding targets (WAV, AIFF), `source` is skipped and the stack falls through to the next entry. This means WAV sources on a WAV-capable device with `["source", "flac"]` will be transcoded to FLAC rather than copied as massive uncompressed files. Users who truly want to copy WAV files can add `wav` explicitly to their lossless stack.
- FLAC: Best lossless compression, open standard
- ALAC: Apple ecosystem lossless

### Config shape (TOML)

```toml
# Global codec preference
[codec]
lossy = ["opus", "aac", "mp3"]
lossless = ["source", "flac", "alac"]

# Per-device override — inherits from global, overrides what's specified
# Supports single value or array
[devices.terapod.codec]
lossy = "aac"

[devices.echo.codec]
lossy = ["opus", "aac"]
lossless = "flac"
```

Adding `[codec]` is additive — existing configs without it use the defaults. No config version bump is required.

### Codec metadata table

A single shared constant maps each codec to its container metadata. This is the source of truth consumed by the resolver, executor, FFmpeg argument builders, and mass-storage adapter:

| Codec | Container | Extension | FFmpeg `-f` | Filetype label | Sample rate | Type |
|-------|-----------|-----------|-------------|----------------|-------------|------|
| AAC | M4A | `.m4a` | `ipod` | `AAC audio file` | 44100 | lossy |
| ALAC | M4A | `.m4a` | `ipod` | `ALAC audio file` | 44100 | lossless |
| Opus | OGG | `.opus` | `ogg` | `Opus audio file` | 48000 | lossy |
| MP3 | MP3 | `.mp3` | `mp3` | `MPEG audio file` | 44100 | lossy |
| FLAC | FLAC | `.flac` | `flac` | `FLAC audio file` | 44100 | lossless |

Note: Opus idiomatically uses 48kHz because the libopus encoder internally operates at 48kHz. Using 44100 would cause an unnecessary internal resample. This is the first time the system needs per-codec sample rates — the metadata table is the source of truth, and the FFmpeg argument builders must use it instead of hardcoding `-ar 44100`. Size estimation logic that assumes 44.1kHz must also account for 48kHz Opus output.

Note: WAV and AIFF are valid lossless *source* formats but are not transcoding *targets*. They are not in the codec metadata table because podkit does not encode to WAV/AIFF. The `source` keyword in the lossless stack skips these formats and falls through.

### Codec-aware quality mapping

Quality presets map to codec-appropriate bitrates so that each tier delivers perceptually equivalent quality regardless of codec:

| Preset | AAC | Opus | MP3 |
|--------|-----|------|-----|
| high | 256 kbps | 160 kbps | 256 kbps |
| medium | 192 kbps | 128 kbps | 192 kbps |
| low | 128 kbps | 96 kbps | 128 kbps |

Lossless codecs (FLAC, ALAC) have no quality presets — they are always maximum quality. Size estimation uses different average bitrates: ALAC ~900 kbps, FLAC ~700 kbps for CD-quality audio.

`customBitrate` bypasses this mapping and is applied literally to whichever codec is resolved.

`encoding` (vbr/cbr) applies uniformly to the resolved codec. The FFmpeg arguments for VBR/CBR are codec-specific:
- **AAC:** `aac_at` uses `-q:a`, `libfdk_aac` uses `-vbr`, native `aac` uses `-q:a` (each with different scales)
- **Opus:** VBR uses `-vbr on -b:a {bitrate}`, CBR uses `-vbr off -b:a {bitrate}`
- **MP3:** VBR uses `libmp3lame -q:a` (0-9 scale, 0=best), CBR uses `-b:a {bitrate}`
- **FLAC:** Lossless, no quality/bitrate parameters. Uses `-c:a flac -f flac`.

Note: The `encoding` field's docstrings and CLI help text currently say "Encoding mode for AAC transcoding" — these must be updated to reflect that it is now codec-generic.

### Codec preference resolution

The resolver takes three inputs:
1. **Codec preference config** (global merged with device override)
2. **Device capabilities** (`supportedAudioCodecs`)
3. **Available encoders** (from `TranscoderCapabilities`)

It walks the preference list and selects the first codec that is both supported by the device AND has an available encoder. If the preferred codec's encoder is missing but a lower-preference codec works, the resolver silently falls through. If NO codec in the list is both supported and encodable, it returns a structured error.

This means a user with `lossy = ["opus", "aac", "mp3"]` on a Rockbox device without libopus installed will get AAC, not an error. The doctor check surfaces the missing encoder as a warning.

### SourceCategory rework

The `SourceCategory` type (`'lossless' | 'compatible-lossy' | 'incompatible-lossy'`) and `categorizeSource()` are currently iPod-centric. `categorizeSource()` classifies sources by file type alone with no device context: Opus is always `incompatible-lossy`, MP3/AAC are always `compatible-lossy`. This creates problems with codec preferences:

- An Opus source going to a Rockbox device (which natively supports Opus) would be classified as `incompatible-lossy`, triggering a false lossy-to-lossy warning
- Size estimation uses different logic for `incompatible-lossy` vs `compatible-lossy`
- The `INCOMPATIBLE_LOSSY_FORMATS` and `DEFAULT_COMPATIBLE_FORMATS` hardcoded sets in the planner become incorrect

**Solution:** `categorizeSource()` must become device-aware. It takes device capabilities (specifically `supportedAudioCodecs`) as an additional input. The categories are redefined:
- `lossless`: Source is a lossless format (unchanged)
- `compatible-lossy`: Source is a lossy format that the target device can play natively (was: iPod-compatible lossy)
- `incompatible-lossy`: Source is a lossy format that the target device cannot play natively (was: not iPod-compatible)

This changes `categorizeSource()`'s signature and its call sites. The hardcoded `INCOMPATIBLE_LOSSY_FORMATS` and `DEFAULT_COMPATIBLE_FORMATS` sets become the fallback only when device capabilities are unavailable (i.e., the iPod-centric default behavior is preserved for backward compatibility).

### UpgradeReason for codec changes

The `UpgradeReason` type (a subset of `UpdateReason`) must include a `'codec-changed'` variant for when a user changes their codec preference and existing tracks need re-transcoding. This is distinct from `'preset-upgrade'`/`'preset-downgrade'` (which are about bitrate changes) and `'format-upgrade'` (which is about self-healing). Codec changes require file replacement, making this an `UpgradeReason` (not just an `UpdateReason`), since `SyncOperation` for upgrades requires an `UpgradeReason`. The new reason is used in dry-run display and sync plan output to clearly communicate why tracks are being re-transcoded.

### Sync tag codec field

Sync tags (stored in iPod track comments as `[podkit:v1 quality=high encoding=vbr]`) must be extended to include the resolved codec, e.g. `[podkit:v1 quality=high encoding=vbr codec=aac]`. This is required because:

- iPod devices store tracks with opaque internal paths (`iPod_Control/Music/F00/XXXX.m4a`) — file extension comparison is not reliable for codec change detection
- The sync tag is the authoritative record of how a track was transcoded

**Legacy tag handling:** Tags without a `codec` field are assumed based on the tag's quality field:
- `quality=lossless` without `codec` → assume ALAC (since ALAC was the only lossless transcode target before this feature)
- Any other quality without `codec` → assume AAC for transcoded tracks (since AAC was the only lossy transcode target before this feature)
- Direct-copy tracks → the source file's codec is assumed

For mass-storage devices, file extension comparison is a valid fallback, but sync tags should be the primary detection mechanism across all device types for consistency.

### TranscodePresetRef codec field

The `TranscodePresetRef` type (used across planner, classifier, operation factory, and executor) must carry a `targetCodec` field so that every stage of the pipeline knows which codec was resolved. Currently the executor infers AAC vs ALAC from the preset name — this implicit coupling must be replaced with an explicit codec field.

### TranscoderCapabilities generalization

The `TranscoderCapabilities` type currently only tracks AAC encoders (`aacEncoders`, `preferredEncoder`). This must be generalized to track encoder availability per codec (Opus: libopus; MP3: libmp3lame; FLAC: flac encoder; AAC: aac_at/libfdk_aac/aac). The `FFmpegTranscoder.detect()` method must scan for all supported encoders, not just AAC.

### Transcoder interface update

The `Transcoder` interface's `transcode()` method currently accepts `QualityPreset`, while the concrete `FFmpegTranscoder.transcode()` accepts `QualityPreset | 'lossless' | AacTranscodeConfig`. The interface and implementation are out of sync. With multi-codec support, `AacTranscodeConfig` must be generalized to a codec-generic type (e.g., `EncoderConfig`) that carries the target codec, quality parameters, and encoding mode. Note: the name `TranscodeConfig` is already taken by the user-facing quality/encoding config interface — the new type must use a different name to avoid collision.

### FFmpeg argument builder generalization

The current `buildTranscodeArgs` and `buildVbrArgs` functions are entirely AAC-encoder-specific. These must be generalized to dispatch to codec-specific argument builders:

- **AAC:** Existing logic (encoder priority: aac_at → libfdk_aac → aac)
- **Opus:** `-c:a libopus -vbr on/off -b:a {bitrate} -ar 48000 -f ogg`
- **MP3:** `-c:a libmp3lame -q:a {quality}` (VBR) or `-b:a {bitrate}` (CBR), `-f mp3`
- **FLAC:** `-c:a flac -f flac` (lossless, no quality parameter)
- **ALAC:** Existing logic (`-c:a alac -f ipod`)

Additionally:
- `buildOptimizedCopyArgs` hardcodes the `ipod` container format for non-MP3 files — must dispatch to correct `-f` flag per codec: `ogg` for Opus, `flac` for FLAC, `ipod` for AAC/ALAC, `mp3` for MP3
- `OptimizedCopyFormat` type is `'alac' | 'mp3' | 'm4a'` — must be widened to include `'opus'`, `'flac'`
- Sample rate must come from the codec metadata table, not hardcoded `-ar 44100`

### Executor generalization

The executor has 6+ locations with hardcoded AAC assumptions:
- `prepareTranscode()` — output path `.m4a` (two call sites, including temp file path in pipeline.ts)
- `prepareTranscode()` — `filetype: 'AAC audio file'` (two call sites)
- `getFileTypeLabel()` — switch on `.mp3`, `.m4a`, `.aac` only; everything else returns `"Audio file"`
- `getOptimizedCopyFormat()` — returns `OptimizedCopyFormat` typed as `'alac' | 'mp3' | 'm4a'`

All must derive values from the codec metadata table via the `targetCodec` on `TranscodePresetRef`.

For transcode operations, the filetype label must come from the resolved **target codec** (via the metadata table), not from the source file extension. `getFileTypeLabel()` is currently extension-based and is only correct for copy operations.

### Mass-storage adapter: codec change rename

When a codec change triggers re-sync (e.g., AAC→Opus), the existing file on disk has a `.m4a` path. The adapter's `replaceTrackFile()` copies the new file to the existing path without renaming. This means an Opus payload would land in a `.m4a` path. Most players index by extension, so this is silent corruption.

This is a non-trivial change to `replaceTrackFile()` — it changes the method's contract from "replace file in-place" to "replace file with possible relocation." The implementation must:
1. Allocate a new path with the correct extension
2. Copy the file there
3. Delete the old file at the old path
4. Update `allocatedPaths` (remove old, add new)
5. Update `managedFiles`
6. Update the track's `filePath` field
7. Update `pendingCommentWrites` if it has an entry keyed on the old path

This affects manifest/playlist references and is the primary risk in the executor generalization task. It requires careful testing of the bookkeeping — a missed update causes subtle bugs where manifests reference deleted files or playlists point to stale paths.

### `source` keyword codec matching

The `source` keyword in the lossless stack means "keep original format if device supports it." The matching must use the same codec name mapping the planner already uses (via `fileTypeToAudioCodec()`), not raw FFmpeg codec names. FFmpeg reports WAV as `pcm_s16le`, not `wav` — the existing mapping function normalizes this.

**Important:** `source` only applies to lossless formats that are valid transcoding targets (i.e., present in the codec metadata table: FLAC, ALAC). For WAV and AIFF sources, `source` is skipped and the stack falls through to the next entry. This ensures users don't accidentally fill their device with uncompressed audio.

### Lossless behavior

When `quality = "max"` and the source file is lossless, the system walks the lossless preference stack. `source` means "if the device supports the source file's lossless codec AND that codec is a valid transcoding target, use it as-is." Even when copying lossless files, artwork constraints still apply — artwork is resized/reformatted to the device's maximum resolution and preferred format (embedded or sidecar) across all transfer modes.

If no lossless codec in the stack is supported by the device, the system falls through to the lossy stack at the `high` bitrate tier.

### Re-sync on codec change

When a user changes their codec preference and the resolved codec changes, the sync engine detects this primarily via the `codec` field in sync tags. For mass-storage devices without sync tags, file extension comparison is used as a fallback. Tracks with a mismatched codec are re-transcoded with `UpgradeReason: 'codec-changed'`.

### Error handling

If no codec in the user's preference list is both supported by the target device and has an available encoder:
- **`podkit device info`**: Displays the incompatibility in the output alongside the rest of the device information
- **`podkit sync` and `podkit sync --dry-run`**: Errors and exits with a message stating which codecs were in the preference list, that none are supported by the device, and listing the codecs the device does support

### Display

**`podkit device info`** shows the full preference list with device support indicated:

```
Codec preference (lossy):    ✓ opus  · ✓ aac  · ✓ mp3
Codec preference (lossless): ✓ source · ✓ flac · ✓ alac
```

vs an iPod:

```
Codec preference (lossy):    ✗ opus  · ✓ aac  · ✓ mp3
Codec preference (lossless): ✓ source · ✗ flac · ✓ alac
```

**`podkit sync --dry-run`** summary includes:

```
Codec: aac (first supported from preference: opus → aac → mp3)
```

And when codec changes are detected:

```
Codec change: 12 tracks need re-transcoding (opus → aac)
```

### Doctor integration

`podkit doctor` checks FFmpeg encoder availability for all codecs in the user's preference list using the generalized `TranscoderCapabilities`. If a preferred codec's encoder is missing (e.g., libopus not compiled into FFmpeg), it shows a warning. The repair command offers advice on installing the missing encoder.

## User Stories

1. As a user with a Rockbox device, I want podkit to automatically use Opus instead of AAC, so that I get better audio quality at smaller file sizes without changing any settings.
2. As a user with an iPod, I want the default codec preference to resolve to AAC automatically, so that the new system doesn't change my existing sync behavior.
3. As a user with multiple devices, I want to set codec preferences per device, so that my Rockbox player gets Opus while my iPod gets AAC.
4. As a user, I want to set a global codec preference that applies to all my devices, so that I don't have to configure each device individually.
5. As a user, I want per-device codec config to override my global config, so that I can have a sensible default with specific exceptions.
6. As a user, I want to specify a single codec instead of an array, so that config is concise when I only want one format.
7. As a user with `quality = "max"` and a FLAC-capable device, I want podkit to copy my FLAC files directly instead of transcoding, so that I keep lossless quality with zero processing time.
8. As a user with `quality = "max"` and a FLAC-capable device, I want artwork to still be resized to the device's maximum resolution even when FLAC files are copied, so that artwork constraints are always respected.
9. As a user with `quality = "max"` and an iPod, I want podkit to use ALAC (via the lossless stack), so that I get lossless audio on Apple devices without special-case logic.
10. As a user with `quality = "max"` and a device that supports no lossless codec, I want podkit to fall through to the lossy stack at high quality, so that I still get the best possible audio.
11. As a user who changes codec preferences after an initial sync, I want podkit to detect that existing tracks are in the wrong codec and re-transcode them, so that my device stays consistent with my config.
12. As a user, I want `podkit device info` to show my codec preference list with supported/unsupported codecs clearly marked, so that I can see which codec will actually be used.
13. As a user, I want `podkit sync --dry-run` to show which codec will be used for transcoding and any codec changes, so that I can preview the impact before syncing.
14. As a user who configures a codec that my device doesn't support, I want a clear error message listing compatible codecs, so that I can fix my config.
15. As a user, I want the example config to document the default codec stacks with explanations, so that I understand what each codec offers.
16. As a user, I want `podkit doctor` to warn me if my FFmpeg build is missing an encoder for a codec in my preference list, so that I can fix it before syncing fails.
17. As a user, I want `podkit doctor` repair to advise me on how to install missing encoders, so that I don't have to research it myself.
18. As a user, I want `encoding` (vbr/cbr) to apply to whichever codec the stack resolves to, so that I have consistent control regardless of format.
19. As a user, I want `customBitrate` to apply literally to the resolved codec, so that I have precise control when I need it.
20. As a user, I want quality presets to deliver perceptually equivalent quality across codecs, so that "high" means "high" whether I'm using AAC or Opus.
21. As a user with a `source` entry in my lossless stack and ALAC source files on an ALAC-capable device, I want those files copied without transcoding, so that lossless-to-lossless transcoding is avoided when unnecessary.
22. As a user migrating from an older config, I want the config migration to set the default codec stacks without breaking my existing setup, so that upgrading is seamless.

## Implementation Decisions

### Modules to build or modify

**1. Codec metadata table (new, in podkit-core)**
- Single shared constant mapping each codec to container metadata: extension, FFmpeg format flag, filetype label, sample rate, type (lossy/lossless)
- Source of truth consumed by resolver, executor, FFmpeg argument builders, mass-storage adapter, and size estimation
- Defined early, imported everywhere — prevents inconsistent derivation across modules
- WAV/AIFF are not in this table — they are valid sources but not transcoding targets

**2. Codec preference resolver (new, in podkit-core)**
- Pure function: takes codec preference config (global + device override), device capabilities, AND available encoders
- Returns resolved codec (with container metadata from the codec metadata table) for lossy and lossless — or a structured error if no match
- Walks the preference list and selects the first codec that is both device-supported and encoder-available
- Handles: merging global/device config, single-value-to-array normalization
- The `source` keyword is resolved at plan time per-track (since it depends on the source file's codec), not at config resolution time. The resolver returns `source` in the resolved lossless list; the planner interprets it using `fileTypeToAudioCodec()` for consistent codec name mapping. `source` only matches codecs that are valid transcoding targets (in the metadata table) — WAV/AIFF sources skip `source` and fall through.

**3. Codec-aware quality mapping (modify existing transcode types)**
- Maps quality presets to codec-appropriate bitrate targets for lossy codecs
- Each lossy codec has its own preset-to-bitrate table
- Lossless codecs (FLAC, ALAC) have no quality presets — size estimation uses ~700 kbps for FLAC, ~900 kbps for ALAC
- Specifies VBR quality parameters per codec, not just target bitrates (e.g., MP3 libmp3lame `-q:a` scale)
- `customBitrate` bypasses the mapping entirely
- `encoding` (vbr/cbr) is applied uniformly at the config level; FFmpeg argument construction is codec-specific

**4a. Generalize TranscoderCapabilities and Transcoder interface**
- Extend `TranscoderCapabilities` to track encoder availability per codec (not just AAC)
- Extend `FFmpegTranscoder.detect()` to scan for Opus (libopus), MP3 (libmp3lame), and FLAC (flac) encoders
- Rename `AacTranscodeConfig` to a codec-generic type (e.g., `EncoderConfig`) — note: `TranscodeConfig` is already taken by the user-facing config interface
- Update `Transcoder` interface to accept the generic config type

**4b. FFmpeg argument builders for Opus, MP3, and FLAC**
- Generalize `buildTranscodeArgs` and `buildVbrArgs` to dispatch to codec-specific argument builders
- Add Opus encoder support: `-c:a libopus -vbr on/off -b:a {bitrate} -ar 48000 -f ogg`
- Add MP3 encoder support: `-c:a libmp3lame -q:a {quality}` (VBR) or `-b:a {bitrate}` (CBR), `-f mp3`
- Add FLAC encoder support: `-c:a flac -f flac` (lossless, no quality parameter)
- Generalize `buildOptimizedCopyArgs` to dispatch container format per codec: `ogg` for Opus, `flac` for FLAC, `ipod` for AAC/ALAC, `mp3` for MP3
- Widen `OptimizedCopyFormat` type to include `'opus'`, `'flac'`
- Sample rate from codec metadata table, not hardcoded `-ar 44100`
- Container format flag (`-f`) from codec metadata table

**5. Sync tag codec field and UpgradeReason**
- Add `codec` field to `SyncTagData` (e.g., `[podkit:v1 quality=high encoding=vbr codec=aac]`)
- Update sync tag parser and serializer
- Legacy tags without `codec` field: `quality=lossless` → assume ALAC; other qualities → assume AAC for transcoded tracks; source codec for direct copies
- Add `'codec-changed'` to `UpgradeReason` type (not just `UpdateReason` — codec changes require file replacement)
- Use sync tag codec field as primary mechanism for codec change detection across all device types
- File extension comparison as fallback for mass-storage devices without sync tags

**6. TranscodePresetRef and executor generalization**
- Add `targetCodec` field to `TranscodePresetRef` so every pipeline stage knows the resolved codec
- Replace hardcoded `.m4a` extensions in executor — specifically:
  - Two `prepareTranscode()` call sites that set output path to `.m4a`
  - The temp file path construction in pipeline.ts (also hardcodes `.m4a`)
- Replace hardcoded `'AAC audio file'` filetype strings (two call sites) with codec-derived labels from metadata table
- Update `getFileTypeLabel()`: for transcode operations, derive label from target codec (not source extension); for copy operations, derive from source extension. Add cases for `.opus`, `.flac`.
- Update `getOptimizedCopyFormat()` and widen its return type
- Ensure mass-storage adapter produces correct output filenames for non-M4A codecs
- Handle codec-change renames in mass-storage `replaceTrackFile()` — this is the primary risk in this task:
  1. Allocate new path with correct extension
  2. Copy file to new path
  3. Delete old file at old path
  4. Update `allocatedPaths` (remove old, add new)
  5. Update `managedFiles`
  6. Update track's `filePath` field
  7. Update `pendingCommentWrites` if keyed on old path
  - This changes the method's contract from "replace in-place" to "replace with possible relocation"
  - Requires testing manifest/playlist reference integrity after rename
- Update existing test expectations that assert on `.m4a` or `'AAC audio file'`

**7. SourceCategory rework and planner update (modify planner and classifier)**
- Make `categorizeSource()` device-aware: add `supportedAudioCodecs` parameter so that Opus sources on Rockbox are `compatible-lossy`, not `incompatible-lossy`. Hardcoded `INCOMPATIBLE_LOSSY_FORMATS`/`DEFAULT_COMPATIBLE_FORMATS` become fallback when device capabilities are unavailable.
- Replace hardcoded AAC/ALAC decision logic with codec preference resolution
- Wire codec preferences through `MusicSyncConfig` → `resolveMusicConfig()` → `ResolvedMusicConfig` → `ClassifierContext`
- Detect codec changes via sync tag codec field (primary) and file extension (fallback), using `UpgradeReason: 'codec-changed'`
- Handle lossless `max` preset via the lossless stack walking instead of special-case ALAC logic
- `source` keyword resolved per-track using `fileTypeToAudioCodec()` for consistent codec name mapping — skip `source` for WAV/AIFF (not in metadata table)
- Lossless fallback to lossy stack at `high` tier when no lossless codec is device-supported
- Update size estimation to account for per-codec sample rates (48kHz for Opus) and per-codec lossless bitrates (~700 kbps FLAC vs ~900 kbps ALAC)

**8. Config schema update (modify config types, loader, writer)**
- Add `[codec]` section at global level and `[devices.*.codec]` at device level
- Both `lossy` and `lossless` accept a string or array of strings
- Validation: values must be known codec identifiers
- No config version bump needed — additive change with defaults is backward-compatible
- Default codec stacks documented in example config with explanations
- Update `encoding` field docstrings and CLI help text from "AAC transcoding" to codec-generic

**9. Display updates (modify device info and sync dry-run output)**
- `device info`: Show preference list with ✓/✗ per codec based on device support
- `sync --dry-run`: Show resolved codec in summary, codec change counts with `'codec-changed'` reason
- `sync`: Show codec change info in the sync plan before execution

**10. Doctor check (modify diagnostics framework)**
- Use generalized `TranscoderCapabilities` to check encoder availability for all codecs in the user's configured preference list
- Warning-level diagnostic if a preferred encoder is missing
- Repair advice with platform-specific installation guidance

**11. E2E test coverage**
- Add E2E test(s) covering codec preference resolution in an actual sync flow
- At minimum: Opus output on a mass-storage mock device, verifying correct file extension and playable output
- Codec change re-sync: verify old file removed, new file with correct extension
- Validates integration seams between resolver, executor, and adapter

### Architecture notes

- The codec preference system is designed to be extensible to video codecs in the future, though only audio codecs are implemented in this PRD
- The resolver is a pure function with no side effects, making it straightforward to test and reuse across planner, device info, and doctor contexts
- The existing `supportedAudioCodecs` device capability field remains the source of truth for what a device can decode — the preference system sits on top of it

## Testing Decisions

Tests should verify external behavior through inputs and outputs, not implementation details. Test the public interfaces of modules, not internal helper functions.

### Unit tests

**Codec preference resolver:**
- Resolves first supported codec from preference list
- Falls through correctly when top preference isn't supported by device
- Falls through correctly when top preference's encoder is unavailable
- Returns error when no codec in list is both supported and encodable
- Merges device-level config over global config
- Device config inherits from global when not overridden
- Normalizes single string to array
- Handles `source` keyword in lossless list (passes it through, does not resolve it)
- Uses default stacks when no config is provided
- Validates codec names and rejects unknown values
- Returns correct container format metadata for each resolved codec

**Codec-aware quality mapping:**
- Maps each preset to correct bitrate per codec (AAC, Opus, MP3)
- Returns no bitrate for lossless codecs (FLAC, ALAC)
- `customBitrate` overrides preset mapping for all codecs
- `encoding` mode is applied uniformly

**Codec change detection:**
- Detects codec mismatch via sync tag codec field
- Handles legacy sync tags without codec field (assumes AAC for lossy, ALAC for lossless)
- Detects codec mismatch via file extension fallback
- Marks tracks for re-transcoding with `UpgradeReason: 'codec-changed'`
- Does not re-transcode when codec matches

**FFmpeg argument builders:**
- Produces correct VBR/CBR arguments per codec (AAC, Opus, MP3)
- Produces correct lossless arguments for FLAC (`-c:a flac -f flac`)
- Uses correct container format flag per codec
- Uses correct sample rate per codec (48kHz for Opus, 44100 for others)
- Produces correct output file extension per codec
- `buildOptimizedCopyArgs` dispatches correct format: `ogg` for Opus, `flac` for FLAC, `ipod` for AAC/ALAC

**SourceCategory rework:**
- Opus source classified as `compatible-lossy` on Rockbox (supports Opus)
- Opus source classified as `incompatible-lossy` on iPod (does not support Opus)
- MP3/AAC remain `compatible-lossy` on all devices
- Fallback to hardcoded sets when device capabilities unavailable

**`source` keyword:**
- FLAC source + FLAC-capable device → `source` matches, direct copy
- ALAC source + ALAC-capable device → `source` matches, direct copy
- WAV source + WAV-capable device → `source` skipped (not a transcoding target), falls through to next entry
- AIFF source → same as WAV

### Integration tests

**Planner integration:**
- Plans with default codec stack and iPod capabilities resolves to AAC
- Plans with default codec stack and Rockbox capabilities resolves to Opus
- Plans with Opus preference but no libopus falls through to AAC
- Plans with `max` preset and FLAC-capable device copies FLAC source files
- Plans with `max` preset and ALAC-only lossless support transcodes to ALAC
- Plans with `max` preset and no lossless support falls through to lossy at high quality
- Plans with `max` preset and WAV source on FLAC-capable device transcodes WAV to FLAC (source skipped)
- Codec change from opus to aac generates re-transcode actions with `'codec-changed'` reason
- Lossless copy still respects artwork constraints
- Opus source on Rockbox device is classified as compatible (no lossy-to-lossy warning)

**Config loading:**
- Loads and validates `[codec]` section
- Loads per-device codec overrides
- Existing configs without `[codec]` section use defaults

### E2E tests

- Sync to mass-storage mock device with Opus codec preference: verify `.opus` file on device
- Codec change re-sync: verify old file removed, new file with correct extension

### Prior art

Existing planner tests in the sync module test similar decision-tree logic (source categories, preset behavior, device capabilities). The codec preference tests follow the same pattern: set up inputs (config + device capabilities + source files), run through the planner, and assert the planned actions.

## Out of Scope

- **Video codec preferences**: The architecture supports future extension to video, but only audio codecs are implemented in this PRD
- **Per-codec bitrate configuration in user config**: Users cannot set different bitrates per codec in config. The codec-aware quality mapping is internal only. `customBitrate` applies uniformly.
- **Automatic codec installation**: Doctor repair offers advice but does not install codecs automatically
- **Lossy-to-lossy codec conversion optimization**: If a source is OGG Vorbis and the resolved codec is Opus, the system transcodes (lossy→lossy). It does not attempt to detect that both use similar psychoacoustic models. The existing lossy→lossy bitrate capping logic still applies.
- **Vorbis in the default stack**: Vorbis is a supported codec but is not in the default preference list. Users can add it manually. It doesn't win on any axis — Opus beats it on quality, AAC on compatibility.
- **SourceCategory naming cleanup**: The categories are made device-aware but the names (`compatible-lossy`, `incompatible-lossy`) are retained. A rename is deferred as a separate cleanup task.
- **WAV/AIFF as transcoding targets**: These uncompressed formats are valid sources but podkit does not encode to them. The `source` keyword skips them in favor of compressed lossless formats.

## Further Notes

- The `source` keyword is unique to the lossless stack. It means "if the device supports the source file's lossless codec AND that codec is a valid transcoding target, use it as-is." This is resolved per-track at plan time using `fileTypeToAudioCodec()` for consistent codec name mapping, not at config resolution time, since different source files may have different lossless codecs.
- The default codec stacks should be prominently documented in the example config file, in `podkit sync --dry-run` output, and in `podkit device info` output, so users understand what podkit is doing without reading docs.
