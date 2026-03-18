---
title: Music Syncing
description: Supported audio formats, metadata handling, and how music syncing works in podkit.
sidebar:
  order: 2
---

podkit syncs music tracks from your [collections](/user-guide/collections) to your iPod. It handles format conversion automatically — lossless files are transcoded, compatible lossy files are copied directly.

## Supported Audio Formats

| Format | Extensions | What Happens |
|--------|------------|--------------|
| FLAC | `.flac` | Transcoded to AAC (or ALAC) |
| WAV | `.wav` | Transcoded to AAC (or ALAC) |
| AIFF | `.aiff`, `.aif` | Transcoded to AAC (or ALAC) |
| ALAC | `.m4a` | Copied directly (Apple Lossless) |
| MP3 | `.mp3` | Copied directly |
| AAC | `.m4a` | Copied directly |
| OGG Vorbis | `.ogg` | Transcoded to AAC (lossy-to-lossy warning) |
| Opus | `.opus` | Transcoded to AAC (lossy-to-lossy warning) |

See [Audio Transcoding](/user-guide/transcoding/audio) for quality presets and encoder details.

## Metadata

podkit preserves all standard metadata through syncing and transcoding:

- **Core fields:** Title, artist, album, album artist
- **Track info:** Track number, disc number, year, genre, composer
- **Technical info:** Duration, bitrate, sample rate
- **Album artwork:** Embedded artwork is synced to the iPod (see [Artwork](/user-guide/syncing/artwork))

### Track Matching

podkit matches tracks by **artist + album + title**. This means:
- Renaming files doesn't cause duplicates
- Changing metadata (e.g., fixing a typo in the artist name) triggers an update
- Re-encoding a file at a different quality is detected as unchanged if metadata matches

## Supported Content Types

| Content Type | Supported | Notes |
|--------------|-----------|-------|
| **Music** | Yes | Full support — the primary use case |
| **Podcasts** | Not yet | Planned for a future release |
| **Audiobooks** | Not yet | Planned for a future release |
| **Music Videos** | Not yet | Planned for a future release |

:::note[Want podcast, audiobook, or music video support?]
These content types are on the [roadmap](/project/roadmap/). Vote and comment on the discussions to help us prioritise: [Podcasts](https://github.com/jvgomg/podkit/discussions/2), [Audiobooks](https://github.com/jvgomg/podkit/discussions/3), [Music Videos](https://github.com/jvgomg/podkit/discussions/4).
:::

## Syncing Commands

```bash
# Sync all music collections
podkit sync -t music

# Sync a specific collection
podkit sync -t music -c main

# Preview changes
podkit sync -t music --dry-run

# Remove tracks no longer in source
podkit sync -t music --delete

# Override quality for this sync
podkit sync -t music --quality medium
```

## Listing Music

See what's on your iPod or in your collections:

```bash
# Music on your iPod (shows stats by default)
podkit device music

# List all tracks
podkit device music --tracks

# List albums (compilation albums are marked)
podkit device music --albums

# Custom fields
podkit device music --tracks --fields "title,artist,album,compilation"

# Music in a collection
podkit collection music

# Output as JSON
podkit device music --format json
```

See [Display Fields](/reference/cli-commands#display-fields) for all available fields.

## See Also

- [Syncing Overview](/user-guide/syncing) — How syncing works
- [Audio Transcoding](/user-guide/transcoding/audio) — Quality presets and encoder options
- [Directory Source](/user-guide/collections/directory) — Local filesystem collections
- [Subsonic Source](/user-guide/collections/subsonic) — Streaming from Navidrome and others
