---
title: Video Syncing
description: Supported video formats, content types, and how video syncing works in podkit.
sidebar:
  order: 3
---

podkit syncs movies and TV shows from your [video collections](/user-guide/collections) to iPods that support video playback.

## Supported Devices

Not all iPods support video. These models can play video:

- **iPod Video** — 5th and 5.5th generation
- **iPod Classic** — 6th and 7th generation
- **iPod Nano** — 3rd through 5th generation

See [Supported Devices](/devices/supported-devices) for the full compatibility matrix.

## Supported Input Formats

| Format | Extensions | Notes |
|--------|------------|-------|
| Matroska | `.mkv` | Common for rips |
| MP4 | `.mp4`, `.m4v` | May passthrough if already compatible |
| AVI | `.avi` | Legacy support |
| MOV | `.mov` | QuickTime |
| WebM | `.webm` | VP8/VP9 transcoded to H.264 |
| WMV | `.wmv` | Windows Media |

All videos are transcoded to iPod-compatible M4V (H.264 video, AAC audio). Files that are already compatible are copied directly without re-encoding. See [Video Transcoding](/user-guide/transcoding/video) for quality presets and device profiles.

## Supported Content Types

| Content Type | Supported | Notes |
|--------------|-----------|-------|
| **Movies** | Yes | Standalone films with optional director/studio metadata |
| **TV Shows** | Yes | Episodes with series, season, and episode information |
| **Music Videos** | Not yet | Planned for a future release |
| **Video Podcasts** | Not yet | Planned for a future release |

:::note[Want music video or video podcast support?]
These content types are on the [roadmap](/project/roadmap/). Vote and comment on the discussions to help us prioritise: [Music Videos](https://github.com/jvgomg/podkit/discussions/4), [Video Podcasts](https://github.com/jvgomg/podkit/discussions/5).
:::

## Content Type Detection

podkit automatically determines whether a video is a movie or TV show using (in priority order):

1. **Embedded tags** — Episode/season metadata in the file container
2. **Folder structure** — `Show Name/Season 01/` pattern
3. **Filename patterns** — `S01E01`, `1x01`, anime fansub `[Group]_Show_EP`, etc.
4. **Scene release parsing** — Extracts title and year from dot-separated scene release names

If none of these match, the video is treated as a movie.

### Recommended Folder Organization

The most reliable approach is the **Plex naming standard** — podkit extracts the series title from the folder name, so it captures the full show name including any language or region markers.

**Movies:**

```
Movies/
├── The Matrix (1999).mkv
├── Inception (2010)/
│   └── Inception.mkv
└── Sci-Fi/
    └── Blade Runner (1982).mkv
```

**TV Shows:**

```
TV Shows/
└── Breaking Bad/
    ├── Season 1/
    │   ├── Breaking Bad - S01E01 - Pilot.mkv
    │   └── Breaking Bad - S01E02 - Cat's in the Bag.mkv
    └── Season 2/
        └── Breaking Bad - S02E01 - Seven Thirty-Seven.mkv
```

**Multi-language collections** — use a language/region marker in the show folder name to keep versions separate:

```
Anime/
├── Digimon Adventure (JPN)/
│   └── Season 01/
│       ├── Digimon Adventure - S01E01.mkv
│       └── Digimon Adventure - S01E02.mkv
├── Digimon Adventure (CHN)/
│   └── Season 01/
│       └── Digimon Adventure - S01E01.mp4
└── Digimon Digital Monsters (USA Dub)/
    └── Season 01/
        ├── Digimon Digital Monsters - S01E01.avi
        └── Digimon Digital Monsters - S01E02.avi
```

The language marker (e.g., `(JPN)`) is preserved in the series title on the iPod. See [Show Language](/reference/show-language) to control how it's displayed.

### Supported Filename Patterns

podkit recognizes several naming conventions commonly used by media libraries, scene releases, and anime fansub groups.

#### Standard TV patterns

| Pattern | Example |
|---------|---------|
| `SxxExx` | `Show.S01E01.720p.mkv` |
| `sxxexx` (lowercase) | `show.s01e05.mkv` |
| `NxNN` | `Show.1x01.mkv` |
| `Season X Episode Y` | `Show - Season 1 Episode 1.mp4` |
| Plex style | `Show Name - S01E01 - Episode Title.mkv` |

#### Anime fansub patterns

Fansub releases use a distinct naming convention with the group name in brackets and a standalone episode number:

| Pattern | Example |
|---------|---------|
| `[Group]_Show_EP_(codec)_[CRC]` | `[RyRo]_Digimon_Adventure_15_(h264)_[8FBCA82D].mkv` |
| `[Group] Show - EP [CRC]` | `[SubGroup] Show Name - 03 [ABCD1234].mkv` |
| `[Group] Show - EPvN` | `[Group] Show - 01v2.mkv` (version 2 release) |

Fansub files default to Season 1, since anime typically uses different series names for each season (e.g., "Digimon Adventure" vs "Digimon Adventure 02").

#### Scene release cleanup

Scene release filenames like `Show.S01E01.DVDRip.XviD-DEiMOS.avi` are handled automatically — quality tags (`720p`, `BluRay`, `DVDRip`), codecs (`x264`, `XviD`), and release group names (`-DEiMOS`) are stripped from the episode title so your iPod shows clean metadata.

#### Series title from folders

When files are inside a `Show Name/Season XX/` folder structure, podkit uses the folder name as the series title. This is preferred over filename-based parsing because folder names typically contain the full show name. This means a file like `S01E01.avi` inside `Breaking Bad/Season 1/` correctly gets "Breaking Bad" as its series title.

For scene release folders like `Show.Name.S01E01-54.DUBBED.DVDRip.XviD-GROUP/`, podkit cleans up the folder name by stripping quality indicators, codecs, episode ranges, and edition tags to extract the clean series title.

## Setting Up Video Collections

Add a video source to your [config file](/user-guide/configuration):

```toml
[video.movies]
path = "/path/to/movies"

[video.shows]
path = "/path/to/tv-shows"

[defaults]
video = "movies"
```

## Syncing Commands

```bash
# Sync all video collections
podkit sync -t video

# Sync a specific collection
podkit sync -t video -c shows

# Preview changes
podkit sync -t video --dry-run

# Remove videos no longer in source
podkit sync -t video --delete

# Override quality for this sync
podkit sync -t video --video-quality medium

# Sync to a specific device (by name or mount path)
podkit sync -t video -d classic
```

## Listing Video

See what's on your iPod or in your collections:

```bash
# Video on your iPod
podkit device video

# Video in a collection
podkit collection video

# Output as JSON
podkit device video --format json
```

## See Also

- [Syncing Overview](/user-guide/syncing) — How syncing works
- [Video Transcoding](/user-guide/transcoding/video) — Quality presets, device profiles, and resolution handling
- [Show Language](/reference/show-language) — Configure how language markers appear on iPod
- [Quality Settings](/user-guide/devices/quality) — Per-device video quality configuration
- [Supported Devices](/devices/supported-devices) — Video-capable iPod models
