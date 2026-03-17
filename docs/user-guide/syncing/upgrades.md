---
title: Track Upgrades
description: How podkit detects and upgrades improved source files during sync.
sidebar:
  order: 5
---

When you improve your music collection — replacing MP3s with lossless files, adding artwork, or fixing metadata — podkit detects these changes and upgrades the tracks on your iPod automatically. Play counts, star ratings, and playlist membership are preserved.

## How It Works

During sync, podkit compares metadata between your source files and the tracks already on your iPod. When it finds a matched track where the source has meaningfully improved, it upgrades the iPod copy in place rather than removing and re-adding it.

This detection uses metadata fields (format, bitrate, artwork presence, Sound Check values, genre, year, etc.) rather than file hashing or modification times, so it works with both local directories and remote Subsonic sources.

## Upgrade Categories

podkit recognizes several types of improvements:

| Category | Example | What happens |
|----------|---------|--------------|
| **Format upgrade** | MP3 replaced with FLAC | New file transcoded and copied to iPod |
| **Quality upgrade** | 128 kbps re-ripped at 320 kbps | New file transcoded and copied to iPod |
| **Preset upgrade** | Quality preset changed from low to high | Re-transcoded at new (higher) bitrate |
| **Preset downgrade** | Quality preset changed from high to low | Re-transcoded at new (lower) bitrate |
| **Artwork added** | Artwork embedded into previously bare files | New file copied with artwork |
| **Artwork updated** | Album artwork changed in source (requires `--check-artwork`) | Metadata updated (no file transfer) |
| **Artwork removed** | Artwork removed from source files | Artwork removed from iPod |
| **Sound Check update** | ReplayGain tags added to collection | Metadata updated (no file transfer) |
| **Metadata correction** | Genre, year, or track numbers fixed | Metadata updated (no file transfer) |

File-replacement upgrades (format, quality, preset, artwork added) require transferring a new audio file to the iPod. Metadata-only updates (artwork updated, artwork removed, Sound Check, metadata corrections) are instant since they only touch the iPod database.

## Preserved User Data

Upgrades preserve everything about the track's history on the iPod:

- Play counts
- Star ratings
- Skip counts
- Playlist membership
- Date added

This is possible because podkit updates the existing database entry rather than deleting and recreating it.

## Preset Changes

When you change your quality preset (e.g., from `low` to `high`), podkit detects that existing transcoded tracks on the iPod don't match the new target bitrate and re-transcodes them on the next sync. Both directions are supported:

- **Preset upgrade**: iPod bitrate is significantly lower than the new preset target (e.g., switching from `low` at 128 kbps to `high` at 256 kbps)
- **Preset downgrade**: iPod bitrate is significantly higher than the new preset target (e.g., switching from `high` at 256 kbps to `medium` at 192 kbps)

This only affects lossless source tracks (FLAC, WAV, AIFF) that are transcoded during sync. Lossy source tracks (MP3, AAC) are copied as-is regardless of the quality preset.

### Tolerance

Preset change detection uses a **percentage-based tolerance** that adapts to the encoding mode:

| Encoding | Default tolerance | Rationale |
|----------|------------------|-----------|
| VBR | 30% of target bitrate | Wide enough to absorb VBR variance |
| CBR | 10% of target bitrate | CBR bitrates are stable, so tighter detection is safe |
| ALAC (`max` on capable device) | Format check | Is the iPod track ALAC? Yes = in sync. No = needs upgrade |

For example, at the `high` preset (256 kbps target) with VBR encoding, tracks between 179 and 333 kbps are considered in sync.

If you find that syncs are incorrectly re-transcoding tracks, you can adjust the tolerance with the `bitrateTolerance` config option:

```toml
bitrateTolerance = 0.25  # 25% tolerance instead of the default
```

See the [Config File Reference](/reference/config-file) for details.

**VBR overlap note:** Adjacent VBR presets (e.g., `medium` and `high`) can produce overlapping bitrate ranges depending on content complexity. Jumps of two or more preset levels (e.g., `low` to `high`) are always detected. Single-step transitions between adjacent VBR presets may miss some tracks in the overlap zone — use `encoding = "cbr"` for guaranteed detection of all preset changes.

### Switching encoding mode

The iPod database stores a track's bitrate but not whether it was encoded with VBR or CBR. When you switch encoding mode at the same quality preset, podkit uses the tolerance for your new mode to decide what to re-transcode:

- **VBR to CBR**: The tighter CBR tolerance (10%) catches tracks whose VBR bitrate landed far from the target. Tracks that happen to be close to the target are left alone — they're already at the right quality. Typically 40–60% of tracks are re-transcoded.
- **CBR to VBR**: The wider VBR tolerance (30%) means existing CBR tracks (at the exact target bitrate) are well within range and left alone. This is the right behaviour — a CBR file at the target bitrate is already excellent quality. New tracks added in future syncs will use VBR.
- **Different preset + different encoding** (e.g., `low` VBR to `high` CBR): The bitrate difference is large enough that all tracks are detected and re-transcoded regardless of encoding mode.

If you want every track re-encoded after an encoding mode change, use `--force-transcode`:

```bash
podkit sync --force-transcode
```

This re-transcodes all lossless-source tracks while preserving play counts, ratings, and playlist membership. Compatible lossy sources (MP3, AAC) are not affected — they are always copied as-is. Use `--dry-run` to preview what would be re-transcoded.

Like other file-replacement upgrades, preset changes are suppressed by `--skip-upgrades`.

## Artwork Change Detection

By default, podkit detects when artwork is **added** to a previously bare track — but not when existing artwork is **replaced** with a different image. To detect changed artwork, use the `--check-artwork` flag:

```bash
podkit sync --check-artwork
```

When enabled, podkit stores a fingerprint of each track's artwork during sync. On subsequent syncs, it compares the current source artwork against the stored fingerprint and upgrades the artwork if it has changed. This is a metadata-only operation — the audio file is not re-transferred.

You can also enable this via the `PODKIT_CHECK_ARTWORK` environment variable or the `checkArtwork` config option.

### Establishing a Baseline

If you enable `--check-artwork` on a device that has already been synced, existing tracks won't have artwork fingerprints yet. To establish a baseline without re-syncing all your audio files, combine it with `--force-sync-tags`:

```bash
podkit sync --check-artwork --force-sync-tags
```

This writes artwork fingerprints for all existing tracks so that future changes can be detected.

### Performance

For directory sources, artwork detection adds minimal overhead — artwork bytes are already read during scanning, and hashing adds only microseconds per track.

For directory sources, `--check-artwork` reads artwork bytes from files for hashing — adding minimal overhead since the files are already being read.

For Subsonic sources, `--check-artwork` adds one HTTP request per unique album cover during scanning. Results are cached by cover art ID, so albums sharing the same artwork only require one request. On large libraries (thousands of albums), this can add noticeable time to the scan phase. Consider using the CLI flag for periodic checks rather than enabling permanently.

### Subsonic Artwork Detection

With `--check-artwork` enabled, podkit fetches cover art for each unique album from the Subsonic server during scanning. All three artwork operations work with both directory and Subsonic sources:

- **Artwork added**: Detected when artwork appears in a previously bare track
- **Artwork updated**: Detected when artwork fingerprints differ between syncs
- **Artwork removed**: Detected when artwork is stripped from source files

**Navidrome compatibility:** Navidrome generates placeholder images for albums without real artwork. podkit detects this placeholder at connect time and filters it out, so tracks with only placeholder artwork are correctly identified as having no artwork. This works automatically when `--check-artwork` is enabled.

### Sync Tags

Sync tags are metadata stored in the iPod track's comment field that record exactly what transcode settings produced each file. They look like this:

```
[podkit:v1 quality=high encoding=vbr]
```

When a sync tag is present, podkit uses exact comparison instead of bitrate tolerance to detect preset changes. This eliminates all false positives from VBR bitrate variance and reliably detects any change in quality, encoding mode, or custom bitrate.

#### Sync Tag Consistency

A sync tag is "consistent" when it accurately reflects the track's actual state on the iPod — the correct quality preset, encoding mode, and artwork hash. Inconsistencies can arise from missing tags (tracks synced before sync tags existed), missing artwork hashes, or stale values after manual changes.

Consistency is maintained progressively: every sync writes tags to newly transcoded tracks and updates tags on upgraded tracks. You can check the current consistency breakdown with `podkit device music`, which shows how many tracks are fully consistent, missing artwork hashes, or missing sync tags entirely. To bring all tracks into consistency at once, use `--force-sync-tags`.

**Gradual rollout:** Sync tags are written automatically to all newly transcoded tracks. Existing tracks on your iPod (synced before sync tags were introduced) will continue using bitrate-based detection until they are re-transcoded.

To immediately tag all existing transcoded tracks with your current preset info (without re-transcoding them), use `--force-sync-tags`:

```bash
podkit sync --force-sync-tags
```

This writes sync tags to all matched lossless-source tracks on the iPod. Future syncs will then use exact comparison for those tracks. Use `--dry-run` to preview what would be tagged:

```bash
podkit sync --force-sync-tags --dry-run
```

Copied lossy tracks (MP3, AAC) that are not transcoded may also receive a minimal sync tag with `quality=copy` when artwork hashes are written. This records the artwork baseline without implying any transcoding took place.

Sync tags coexist with any existing text in the comment field — they don't overwrite user comments.

## Dry-Run Output

Use `--dry-run` to preview upgrades before they happen:

```bash
podkit sync --dry-run
```

```
Sync plan:
  Add:       5 tracks
  Remove:    2 tracks
  Upgrade:  12 tracks
    Format upgrade:     8  (MP3 → FLAC)
    Preset upgrade:     2  (quality preset changed)
    Artwork added:      1
    Artwork updated:    1
    Sound Check update: 1
  Unchanged: 1,397 tracks
```

## Skipping Upgrades

Upgrades are on by default. To skip file-replacement upgrades (for example, on a device with limited storage), use the `--skip-upgrades` flag:

```bash
podkit sync --skip-upgrades
```

Or set it in your config file, either globally or per device:

```toml
# Skip upgrades on all devices
skipUpgrades = true

# Or skip upgrades on a specific device
[devices.nano]
volumeUuid = "EFGH-5678"
skipUpgrades = true    # Nano has limited space
```

When upgrades are skipped, dry-run still reports available upgrades so you can see what you are missing.

## See Also

- [Music Syncing](/user-guide/syncing/music) — How music syncing works
- [Sound Check](/user-guide/syncing/sound-check) — Volume normalization
- [Config File Reference](/reference/config-file) — `skipUpgrades` option
- [CLI Commands](/reference/cli-commands) — `--skip-upgrades` flag
