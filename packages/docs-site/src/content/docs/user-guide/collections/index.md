---
title: Media Sources
description: Overview of music and video media sources supported by podkit.
sidebar:
  order: 1
---

podkit syncs media from **media sources** — locations where your music or video files live. Each source is configured as a named collection in your config file and can be synced independently.

## Source Types

podkit currently supports two source types:

| Type | Description | Config `type` field |
|------|-------------|---------------------|
| [Directory](/user-guide/collections/directory) | Local filesystem path containing audio/video files | *(default, no type needed)* |
| [Subsonic](/user-guide/collections/subsonic) | Subsonic-compatible server (Navidrome, Airsonic, Gonic) | `"subsonic"` |

## Music vs Video Collections

Collections are defined under `[music.*]` or `[video.*]` sections in the config file:

```toml
# Music collections
[music.main]
path = "/Volumes/Media/music/library"

[music.navidrome]
type = "subsonic"
url = "https://music.example.com"
username = "user"
path = "/tmp/navidrome-cache"

# Video collections
[video.movies]
path = "/Volumes/Media/movies"
```

Music and video collections are synced together by default, or independently:

```bash
# Sync everything
podkit sync

# Sync only music
podkit sync -t music

# Sync a specific collection
podkit sync -t music -c main
```

## Adding Collections

Use the CLI to add a new collection:

```bash
# Add a directory source
podkit collection add -t music -c main --path /path/to/your/music

# Add a Subsonic source (configure in config file)
```

Or edit `~/.config/podkit/config.toml` directly.

## Default Collections

If you have multiple collections, you can set defaults so `podkit sync` knows which to use without the `-c` flag:

```toml
[defaults]
music = "main"
video = "movies"
```

With defaults set, `podkit sync -t music` syncs the `main` music collection automatically. You can always override with `-c`:

```bash
podkit sync -t music -c navidrome
```

If you only have one collection of a given type, it's used automatically — no default needed.

## Multiple Collections

You can define as many collections as you need. Each gets a name and can be synced independently or together. See [Configuration](/user-guide/configuration) for examples of multi-collection setups.
