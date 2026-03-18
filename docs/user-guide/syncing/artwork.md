---
title: Artwork
description: How podkit handles album artwork during sync, including change detection and upgrades.
sidebar:
  order: 5
---

Album artwork is synced to your iPod automatically. If your source files have embedded artwork, it transfers during sync with no extra configuration needed.

## How Artwork Sync Works

During a normal sync, podkit extracts embedded artwork from your audio files (FLAC, MP3, M4A, etc.) and writes it to the iPod database. Each track's artwork appears in the Now Playing screen and album browser on the iPod.

For **directory sources**, artwork is read from the image data embedded in each audio file's metadata tags (e.g., the `PICTURE` block in FLAC, `APIC` frame in MP3, `covr` atom in M4A).

For **Subsonic sources**, artwork is fetched from the server's `getCoverArt` API endpoint. This happens per unique album, so tracks sharing the same album artwork only require one request.

:::note
Artwork sync uses the embedded artwork in each file, not separate image files like `cover.jpg` or `folder.png` in the album directory. If your files don't have embedded artwork, tools like [MusicBrainz Picard](https://picard.musicbrainz.org/), [beets](https://beets.io/), or [kid3](https://kid3.kde.org/) can embed images into your audio files.
:::

## Disabling Artwork

If you want faster syncs or your device has limited storage, you can skip artwork entirely:

```bash
podkit sync --no-artwork
```

Or set it in your config file, globally or per device:

```toml
# Disable artwork for all devices
artwork = false

# Or disable for a specific device
[devices.nano]
volumeUuid = "EFGH-5678"
artwork = false
```

You can also use the `PODKIT_ARTWORK=false` environment variable.

When artwork is disabled, audio files are still synced normally -- only the artwork transfer is skipped.

## Artwork as Part of Upgrades

podkit's [self-healing sync](/user-guide/syncing/upgrades) detects when artwork is **added** to a previously bare track. If you embed artwork into files that were originally synced without it, podkit detects this on the next sync and re-transfers those tracks with their new artwork.

Similarly, if artwork is **removed** from source files, podkit detects the change and removes the artwork from the iPod database.

These two detections -- artwork added and artwork removed -- happen automatically during every sync without any extra flags.

## Artwork Change Detection

By default, podkit detects when artwork is added or removed, but not when existing artwork is **replaced** with a different image. Detecting replaced artwork requires comparing the actual image data of every track against a stored fingerprint, which means reading artwork from every file in your source collection (or fetching it from your Subsonic server) on every sync. For large libraries this adds real overhead -- potentially thousands of extra file reads or HTTP requests -- so it's opt-in rather than on by default.

If you do update artwork in your collection (e.g., replacing a low-resolution cover with a better scan), you can enable change detection to catch it.

### Enabling change detection

Use the `--check-artwork` flag:

```bash
podkit sync --check-artwork
```

Or enable it in your config file:

```toml
checkArtwork = true
```

Or via environment variable: `PODKIT_CHECK_ARTWORK=true`.

When enabled, podkit computes a fingerprint (a short hash) of each track's artwork and stores it in the sync tag. On subsequent syncs, it compares the current source artwork against the stored fingerprint. If they differ, the artwork on the iPod is updated -- without re-transferring the audio file.

### Progressive baseline building

Artwork fingerprints are written to sync tags whenever artwork is transferred, regardless of whether `--check-artwork` is active. This means baselines accumulate naturally over time as you add and sync tracks. When you later enable `--check-artwork`, many tracks will already have fingerprints to compare against.

If you enable `--check-artwork` on a device that already has a large synced library, some tracks may not have fingerprints yet. To establish a baseline for all existing tracks at once:

```bash
podkit sync --check-artwork --force-sync-tags
```

This writes artwork fingerprints for all matched tracks without re-transferring any audio files. Future `--check-artwork` runs can then detect changes against this baseline.

:::tip
You don't need to run `--force-sync-tags` right away. Fingerprints are written progressively during normal syncs, so the baseline fills in on its own over time. Use `--force-sync-tags` only if you want immediate full coverage.
:::

### What change detection finds

With `--check-artwork` enabled, podkit detects three types of artwork changes:

| Change | Description | Operation |
|--------|-------------|-----------|
| **Artwork added** | Artwork embedded into a previously bare track | File replacement (re-transfers audio) |
| **Artwork updated** | Different artwork in a track that already had artwork | Metadata only (no audio transfer) |
| **Artwork removed** | Artwork removed from a track that had it | Metadata only (no audio transfer) |

Artwork-updated and artwork-removed are metadata-only operations, meaning they are fast -- the iPod database is updated without touching the audio file. Artwork-added requires re-transferring the audio file to ensure the artwork is embedded.

:::note
Artwork-added and artwork-removed are detected during every sync, even without `--check-artwork`. The flag is only needed for detecting artwork-updated (when an existing image is replaced with a different one).
:::

## Directory vs Subsonic Sources

### Directory sources

For local files, artwork detection reads the embedded image data directly. This adds minimal overhead since the files are already being accessed during scanning. All three artwork operations (added, updated, removed) work reliably.

### Subsonic sources

For Subsonic sources, `--check-artwork` fetches cover art from the server via the `getCoverArt` API -- one HTTP request per unique album. Results are cached by cover art ID, so albums sharing the same artwork only require one request.

On large libraries with thousands of albums, this can add noticeable time to the scan phase. Consider using `--check-artwork` for periodic checks rather than enabling it permanently:

```bash
# Run occasionally to catch artwork changes
podkit sync --check-artwork

# Normal day-to-day syncs without the overhead
podkit sync
```

:::caution[Navidrome placeholder filtering]
Navidrome generates placeholder images for albums that don't have real artwork. podkit detects these placeholders automatically at connect time and filters them out, so tracks with only placeholder artwork are correctly identified as having no artwork. This happens transparently when `--check-artwork` is enabled -- no configuration needed.
:::

## Viewing Artwork Status

### Dry-run output

Use `--dry-run` to preview artwork-related changes before they happen:

```bash
podkit sync --check-artwork --dry-run
```

```
Sync plan:
  Add:       5 tracks
  Remove:    2 tracks
  Upgrade:   3 tracks
    Artwork added:      1
    Artwork updated:    1
    Artwork removed:    1
  Unchanged: 1,397 tracks
```

### Track listings

Use the `artwork` display field to see which tracks have artwork:

```bash
podkit device music --tracks --fields "title,artist,album,artwork"
```

### Sync tag consistency

`podkit device music` shows a consistency breakdown indicating how many tracks have complete sync tags (including artwork fingerprints). Tracks with missing fingerprints show as partially consistent -- they will gain fingerprints during the next sync that touches them, or you can populate them all at once with `--force-sync-tags`.

## Configuration Summary

| Setting | CLI flag | Config key | Env var | Default |
|---------|----------|------------|---------|---------|
| Include artwork | `--no-artwork` to disable | `artwork` | `PODKIT_ARTWORK` | `true` |
| Detect changes | `--check-artwork` | `checkArtwork` | `PODKIT_CHECK_ARTWORK` | `false` |

Both settings can be configured globally or per device in the config file. See [Config File Reference](/reference/config-file) for details.

## See Also

- [Track Upgrades](/user-guide/syncing/upgrades) -- How podkit detects and applies all types of upgrades
- [Music Syncing](/user-guide/syncing/music) -- Supported formats and metadata handling
- [Config File Reference](/reference/config-file) -- `artwork` and `checkArtwork` options
- [CLI Commands](/reference/cli-commands) -- `--no-artwork` and `--check-artwork` flags
