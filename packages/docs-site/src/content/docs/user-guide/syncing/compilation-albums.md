---
title: Compilation Albums
description: How podkit handles compilation albums during sync, including metadata detection and iPod browsing behavior.
sidebar:
  order: 4
---

podkit syncs the compilation flag from your source metadata to the iPod database. This ensures compilation albums (soundtracks, "Various Artists" collections, "Best Of" compilations) appear correctly in the iPod's Compilations browser rather than cluttering individual artist lists.

## How It Works

### Source Detection

podkit reads the compilation flag from standard audio metadata tags:

| Format | Tag | Example |
|--------|-----|---------|
| FLAC / OGG / Opus | `COMPILATION` Vorbis comment | `COMPILATION=1` |
| MP3 | `TCMP` ID3v2 frame | iTunes compilation flag |
| M4A / AAC | `cpil` iTunes atom | iTunes compilation flag |

For **Subsonic sources** (Navidrome, etc.), podkit reads the `isCompilation` field from the album-level metadata in the Subsonic API. All tracks in a compilation album inherit the flag.

### iPod Behavior

When a track has the compilation flag set:

- It appears under **Compilations** in the iPod's music browser
- The track's artist still shows the individual performer (e.g., "Artist Alpha")
- The album groups with other compilation albums instead of under each artist

Without the compilation flag, a "Various Artists" album with tracks from different artists would create separate entries under each artist's name, making it hard to browse.

### Sync Pipeline

The compilation flag flows through the full sync pipeline:

1. **Source scan** — podkit reads the compilation tag from your audio files or Subsonic server
2. **Diff** — compilation changes are detected as metadata conflicts (just like genre or year changes)
3. **Sync** — the flag is written to the iPod database via libgpod
4. **Verification** — `podkit device music --format json` includes the `compilation` field

## Setting Compilation Tags

If your files don't have the compilation tag set, you can add it with common tagging tools:

### metaflac (FLAC files)

```bash
# Set compilation flag
metaflac --set-tag="COMPILATION=1" *.flac

# Remove compilation flag
metaflac --remove-tag=COMPILATION *.flac
```

### MusicBrainz Picard

1. Select the album
2. In the metadata panel, set **Compilation** to "Yes"
3. Save

### beets

beets reads the `comp` field from MusicBrainz and writes it to the `COMPILATION` tag automatically during import. You can also set it manually:

```bash
beet modify comp=1 album:"Greatest Hits"
```

### kid3

1. Open the album
2. Select all tracks
3. In the tag editor, find the compilation field and set it to `1`

## Viewing Compilation Status

### Default stats view

The default `podkit device music` output includes a compilation summary when compilations are present:

```
Music on iPod
  Tracks:  847
  Albums:  62
  Artists: 38
  Compilations: 4 albums (47 tracks)
```

### Albums view

Use `--albums` to see which albums are compilations. A `COMP` column with `✓` appears when compilations exist:

```bash
podkit device music --albums
```

### Track listing

Use `--fields` to include the compilation column in track listings:

```bash
podkit device music --tracks --fields "title,artist,album,compilation"
```

Compilation tracks show `✓`, non-compilation tracks show `✗`.

### JSON output

For scripting, use JSON output to filter compilations:

```bash
podkit device music --tracks --format json | jq '.[] | select(.compilation == true) | .title'
```

These same options work with `podkit collection music` to check your source library.

## Re-syncing After Tag Changes

If you add or remove the compilation tag from source files after an initial sync, podkit detects the change on the next sync and updates the iPod database accordingly — no need to remove and re-add tracks.
