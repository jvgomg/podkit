---
title: Subsonic Source
description: Sync music from Subsonic-compatible servers like Navidrome, Airsonic, and Gonic to your iPod.
sidebar:
  order: 3
---

podkit supports syncing from Subsonic-compatible servers including Navidrome, Airsonic, Gonic, and the original Subsonic server.

## Configuration

```toml
[music.navidrome]
type = "subsonic"
url = "https://your-server.example.com"
username = "your-username"
password = "your-password"
path = "/path/to/download/cache"
```

## Required Fields

| Key | Description |
|-----|-------------|
| `type` | Must be `"subsonic"` |
| `url` | The base URL of your Subsonic-compatible server |
| `username` | Your Subsonic username |
| `path` | A local directory where podkit caches downloaded audio files |

The `path` directory is used as a local cache for audio files streamed from the server during sync. It does not need to be permanent storage, but keeping it between syncs avoids re-downloading unchanged files.

## Password Options

The password can be provided in several ways (checked in this order):

1. **Config file** - Add `password = "..."` to the collection config
2. **Collection-specific env var** - Set `PODKIT_MUSIC_{NAME}_PASSWORD` where `{NAME}` is the collection name in uppercase (hyphens become underscores, e.g. `my-server` becomes `PODKIT_MUSIC_MY_SERVER_PASSWORD`)
3. **Fallback env var** - Set `SUBSONIC_PASSWORD` for any Subsonic collection

**Example with environment variable:**

```bash
# For a collection named "navidrome"
export PODKIT_MUSIC_NAVIDROME_PASSWORD="your-password"
podkit sync -c navidrome
```

> **Security note:** Storing passwords in config files is convenient but less secure than environment variables.

:::note[Want more secure options?]
Keychain and secret manager integration is on the [roadmap](/roadmap/). Vote and comment on the [discussion](https://github.com/jvgomg/podkit/discussions/11) to help us prioritise.
:::

## How It Works

1. Connect to the Subsonic server using the API
2. Fetch the complete catalog (paginating through albums)
3. Extract track metadata from the API response
4. During sync, download audio files from the server with prefetching (files are downloaded ahead of transcoding so network I/O overlaps with CPU work)
5. Transcode as needed and copy to iPod

## Supported Servers

| Server | Status | Notes |
|--------|--------|-------|
| Navidrome | Tested | Full support |
| Airsonic | Untested | Should work (same API) |
| Gonic | Untested | Should work (same API) |
| Subsonic | Untested | Should work (original API) |

## Sound Check / ReplayGain

Servers that implement the [OpenSubsonic](https://opensubsonic.netlify.app/) extensions (Navidrome, Gonic, LMS) expose ReplayGain data via the API. podkit reads this automatically and writes Sound Check values to the iPod database during sync — no extra configuration needed.

Classic Subsonic and Airsonic servers do not expose ReplayGain data. Tracks synced from these servers will have no Sound Check adjustment.

See [Sound Check](/user-guide/syncing/sound-check) for more details.

## Artwork

Album artwork embedded in audio files is automatically transferred to the iPod during sync.

With `--check-artwork` enabled, podkit fetches cover art from the server to detect artwork changes — including artwork being added, removed, or replaced with a different image. Navidrome generates placeholder images for albums without real artwork; podkit detects and filters these automatically.

See [Track Upgrades](/user-guide/syncing/upgrades#artwork-change-detection) for details.

## Limitations

- **No playlist sync** (yet) - only tracks are synced
- **Fresh catalog fetch each sync** - the track catalog is re-fetched from the server on every sync (audio files are downloaded on-demand and pipelined efficiently)
- **Single server per collection** - create multiple collections for multiple servers

## Example with Multiple Servers

```toml
[music.home-server]
type = "subsonic"
url = "https://home.example.com"
username = "user"
path = "/tmp/subsonic-cache"

[music.work-server]
type = "subsonic"
url = "https://work.example.com"
username = "workuser"
path = "/tmp/work-cache"
```

## See Also

- [Directory Source](/user-guide/collections/directory) - Local filesystem collections
- [Configuration](/user-guide/configuration) - Full configuration reference
- [Audio Transcoding](/user-guide/transcoding/audio) - Quality settings for transcoding
