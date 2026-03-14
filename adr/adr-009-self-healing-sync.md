---
title: "ADR-009: Self-Healing Sync"
description: Design for detecting and upgrading changed source files during sync.
sidebar:
  order: 10
---

# ADR-009: Self-Healing Sync for Changed Source Files

## Status

**Accepted** (2026-03-14)

## Context

Currently, sync matches tracks by normalized `(artist, title, album)`. If a match exists, the track is considered "already synced" and skipped — even if the source file has meaningfully improved. Common scenarios where this causes problems:

- **Format upgrade:** User replaces MP3s with FLACs — iPod keeps the old MP3
- **Quality upgrade:** 128 kbps re-ripped at 320 kbps — iPod keeps the low bitrate version
- **Artwork added:** User embeds artwork into previously bare files — iPod shows no artwork
- **Sound Check added:** User runs `loudgain` on their collection — iPod doesn't get normalization values
- **Metadata corrected:** Genre, year, or track numbers fixed — iPod keeps stale values

The only workaround today is to manually remove and re-add affected tracks, which loses play counts, star ratings, and playlist membership.

## Decision

### Metadata-based change detection with in-place track upgrades

Detect meaningful changes by comparing metadata fields already available on both source (`CollectionTrack`) and iPod (`IPodTrack`) sides. Upgrade tracks in place by preserving the database entry and swapping only what changed — the audio file, the metadata, or both.

### Change Detection Strategy

**Metadata comparison** — no file hashing, no modification times.

Both `CollectionTrack` and `IPodTrack` already expose the fields needed for comparison: `fileType`, `bitrate`, `lossless`, `hasArtwork`, `soundcheck`, `genre`, `year`, `trackNumber`, `discNumber`, `albumArtist`, and `compilation`. By comparing these fields on matched tracks, we can detect and categorize changes without any new infrastructure, persistent sync state, or filesystem operations.

This approach was chosen over file hashing (accurate but slow, doesn't work with remote sources like Subsonic) and modification time (unreliable across platforms, also doesn't work with remote sources).

### Upgrade Categories

Changes are grouped into categories that determine both the operation type and default behavior:

| Category | Detection | Operation | Default |
|----------|-----------|-----------|---------|
| **Format upgrade** | Source `fileType` differs and source is higher quality (lossy → lossless, or lossless replacing lossy) | File replacement | Opt-in |
| **Quality upgrade** | Same format family, source `bitrate` significantly higher (≥ 1.5× or ≥ 64 kbps increase) | File replacement | Opt-in |
| **Artwork added** | Source `hasArtwork` is true, iPod `hasArtwork` is false | File replacement | Opt-in |
| **Sound Check update** | Source has `soundcheck`, iPod value is absent or differs | Metadata update | On by default |
| **Metadata correction** | Non-matching fields differ (genre, year, trackNumber, etc.) | Metadata update | On by default |

> **Format-upgrade detection and `transcodingActive`:** When the source is lossless (e.g., FLAC) and `transcodingActive` is true, the expected iPod format is AAC. Format-upgrade detection is suppressed only when the iPod track is already AAC — the correct transcode output. If the iPod track is MP3 (or any other non-AAC format), this indicates the source was previously an MP3 that has since been replaced with a FLAC, so the iPod copy should be re-transcoded. Suppression only applies to the expected output format, not to all lossy formats.

> **Source bitrate on copied tracks:** `toTrackInput()` includes the source `bitrate` in the track input passed to the planner. This is required for quality-upgrade detection on compatible-lossy tracks that are copied rather than transcoded — without the source bitrate, the quality comparison cannot determine whether the source is a meaningful improvement.

> **Artwork detection:** `CollectionTrack` exposes `hasArtwork`, making artwork-added detection fully implementable via metadata comparison. No file inspection is required.

**Rationale for defaults:** Metadata-only updates are non-destructive (no file transfer, no transcoding time) and preserve everything about the track. File replacements are heavier operations that the user should consciously opt into.

### Quality Comparison Logic

Not all file differences are upgrades. The comparison must be directional:

```
Lossless > Lossy (always an upgrade)
Higher bitrate lossy > Lower bitrate lossy (if same format family)
Lossy → Lossy different format: NOT an upgrade (no quality gain)
Lower bitrate lossless > Higher bitrate lossy: upgrade (lossless wins)
```

A `isQualityUpgrade(source: CollectionTrack, ipod: IPodTrack): boolean` function encapsulates this logic. It returns `true` only when the source is definitively better, not merely different.

### In-Place Track Upgrade (Preserving User Data)

The critical design choice: **upgrades preserve the iPod database entry** so that play counts, star ratings, skip counts, time added, and playlist membership are all retained.

#### For file replacements (format/quality/artwork upgrades):

1. Record the old file path via `getTrackFilePath()`
2. Transcode or copy the new source file to a temp location
3. Delete the old file from disk and clear `ipod_path` on the native track struct (setting it to `null`)
4. Copy the new file to the iPod via `copyTrackToDevice()` — libgpod generates a fresh path with the correct extension for the new format
5. Update technical metadata via `updateTrack()` — `bitrate`, `size`, `duration`, `sampleRate`, `fileType`
6. Update artwork if the new file has it

Clearing `ipod_path` before calling `copyTrackToDevice()` is essential. The iPod firmware selects the audio decoder based on the file extension, so an AAC file stored under a `.mp3` path will not play. By clearing the path, libgpod assigns a new filename with the correct extension for the new format.

The track's database ID is unchanged, so all user data (play counts, ratings, playlist entries) is automatically preserved.

#### For metadata-only updates (Sound Check, genre, year, etc.):

1. Call `updateTrack()` with the changed fields
2. No file operations needed

This uses the same `update-metadata` operation that already exists for transform changes.

### Integration with the Diff Engine

The existing `SyncDiff` structure already has a `toUpdate: UpdateTrack[]` array with a `reason` field and `changes: MetadataChange[]`. Self-healing sync extends this naturally:

```typescript
// Existing reasons
type UpdateReason = 'transform-apply' | 'transform-remove';

// Extended with upgrade reasons
type UpdateReason =
  | 'transform-apply'
  | 'transform-remove'
  | 'format-upgrade'
  | 'quality-upgrade'
  | 'artwork-added'
  | 'soundcheck-update'
  | 'metadata-correction';
```

After matching a track and before classifying it as `existing`, the diff engine checks for upgrades:

1. Is the source quality higher? → `format-upgrade` or `quality-upgrade`
2. Does the source have artwork the iPod lacks? → `artwork-added`
3. Does the source have a soundcheck value the iPod lacks? → `soundcheck-update`
4. Do non-matching metadata fields differ? → `metadata-correction`

Tracks with upgrade reasons go into `toUpdate` instead of `existing`.

### Planner Changes

The planner maps upgrade reasons to operations:

| Reason | Operation |
|--------|-----------|
| `format-upgrade` | `transcode` or `copy` (depending on source format) + `update-metadata` |
| `quality-upgrade` | `transcode` or `copy` + `update-metadata` |
| `artwork-added` | `transcode` or `copy` + `update-metadata` |
| `soundcheck-update` | `update-metadata` only |
| `metadata-correction` | `update-metadata` only |

File replacement operations reuse the existing transcode/copy infrastructure but target an existing track instead of creating a new one. A new operation type — `upgrade` — wraps this:

```typescript
type SyncOperation =
  | { type: 'upgrade'; source: CollectionTrack; target: IPodTrack;
      reason: UpgradeReason; preset?: TranscodePresetRef }
  | { type: 'update-metadata'; track: IPodTrack;
      metadata: Partial<TrackMetadata>; reason: UpdateReason }
  // ... existing operation types
```

### CLI Design

Upgrades are part of normal sync — no special flag needed. Since upgrades preserve play counts, star ratings, and playlist membership, they are non-destructive and should happen by default.

```bash
podkit sync --dry-run

Sync plan:
  Add:       5 tracks
  Remove:    2 tracks
  Upgrade:  12 tracks
    Format upgrade:     8  (MP3 → FLAC)
    Artwork added:      3
    Sound Check update: 1
  Unchanged: 1,397 tracks

# Skip upgrades when short on time
podkit sync --skip-upgrades
```

The `--skip-upgrades` flag is an escape hatch, not the normal workflow.

### Config and Resolution Order

`skipUpgrades` follows the same defaults-fallback pattern as `quality`, `artwork`, and other device settings:

1. CLI `--skip-upgrades`
2. Device `skipUpgrades`
3. Global `skipUpgrades`
4. Default: `false`

```toml
# Global default — applies to all devices unless overridden
skipUpgrades = false

[devices.classic]
volumeUuid = "ABCD-1234"
# inherits global skipUpgrades = false — upgrades happen normally

[devices.nano]
volumeUuid = "EFGH-5678"
skipUpgrades = true    # Nano has limited space, skip file upgrades
```

This lets users disable upgrades globally or per-device. A small iPod Nano might skip upgrades to avoid filling up with larger lossless files, while a 160 GB Classic gets the full benefit.

### Dry-Run Output

Dry-run always detects and reports available upgrades, even when `--skip-upgrades` is active. This lets users see what they're missing:

```
Upgrades skipped (remove --skip-upgrades to apply):
  ♫ Pink Floyd - Comfortably Numb
    Format: MP3 (192 kbps) → FLAC (lossless)
  ♫ Radiohead - Everything in Its Right Place
    Artwork: not present → available
```

## Alternatives Considered

### File hashing for change detection

Compute a hash (SHA-256 or similar) of each source file and compare against a stored hash from the last sync. This is the most accurate approach — it catches any change, including re-encoded files with identical metadata.

**Rejected because:**
- Requires hashing every source file on each sync (slow for large libraries)
- Requires persistent sync state to store hashes (new infrastructure)
- Doesn't work with remote sources (Subsonic) without downloading files first
- Doesn't tell you *what* changed — just that something did — so you can't categorize or selectively upgrade

### Modification time comparison

Compare the source file's mtime against a stored value from the last sync. Fast and simple.

**Rejected because:**
- Unreliable across platforms (re-tagging tools may or may not update mtime)
- Doesn't work with remote sources (Subsonic API doesn't expose mtime)
- Requires persistent sync state
- Same categorization problem as file hashing

### Remove and re-add (instead of in-place upgrade)

Remove the old track from the iPod and add a fresh one with the new file.

**Rejected because:**
- Loses play counts, star ratings, skip counts, and time added
- Loses playlist membership (track must be manually re-added to playlists)
- Users rightfully expect upgrade to be non-destructive

## Consequences

### Positive

- Users get better quality audio on their iPods automatically as they improve their collections
- Play counts, ratings, and playlists are preserved during upgrades
- No new infrastructure (no sync database, no file hashing)
- Metadata-only updates (soundcheck, genre fixes) happen transparently
- Works with both local and remote (Subsonic) sources
- Simple mental model: sync keeps the iPod up to date, period
- `skipUpgrades` follows the established config fallback pattern (CLI → device → global → default)

### Negative

- Metadata comparison can't detect every change (e.g., a re-mastered file with identical bitrate/format)
- Quality comparison heuristics may misjudge edge cases (e.g., a 320 kbps MP3 vs a 256 kbps AAC — which is "better"?)
- Adds complexity to the diff engine (more reasons, more code paths)

### Neutral

- Upgrades are on by default; `--skip-upgrades` is the escape hatch for time/space-constrained syncs
- Future work: collection caching (TASK-071) could store additional state to enable hash-based detection later if metadata comparison proves insufficient
- **Quality preset changes** are handled by TASK-137 via `detectPresetChange()` in `upgrades.ts`. When a user changes their quality preset, the diff engine compares iPod bitrates against the new preset target and flags mismatches as `preset-upgrade` or `preset-downgrade`. This runs as a post-processing step in the differ, separate from `detectUpgrades()` which focuses on source improvements.
