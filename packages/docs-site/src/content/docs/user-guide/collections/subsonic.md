---
title: Subsonic Source
description: Sync music from Subsonic-compatible servers like Navidrome, Airsonic, and Gonic to your device. Supports full-library and playlist-scoped collections.
sidebar:
  order: 3
---

podkit supports syncing from Subsonic-compatible servers including Navidrome, Airsonic, Gonic, and the original Subsonic server. You can sync your entire library or scope a collection to a single named server playlist.

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
Keychain and secret manager integration is on the [roadmap](/project/roadmap/). Vote and comment on the [discussion](https://github.com/jvgomg/podkit/discussions/11) to help us prioritise.
:::

## Playlist-Scoped Collections

Add `playlist = "<name>"` to a Subsonic collection to sync only that server playlist's tracks instead of the whole library. Everything else — credentials, cache path, transcoding, artwork, self-healing — works exactly as it does for a full-library collection.

```toml
# Full library
[music.navidrome]
type = "subsonic"
url = "https://music.example.com"
username = "james"
path = "/tmp/nav-cache"

# Only the "Workout" playlist on the same server
[music.workout]
type = "subsonic"
url = "https://music.example.com"
username = "james"
path = "/tmp/nav-cache"
playlist = "Workout"
```

The playlist is identified by name. Any CLI track filters (`--artist`, `--album`, etc.) that you pass at sync time apply on top of the playlist scope, narrowing it further.

### Using a playlist-scoped collection

A device syncs through a playlist collection the same way it uses any other collection — via `[defaults].music` or the `-c` flag:

```toml
[defaults]
device = "terapod"
music = "workout"   # sync only the Workout playlist by default
```

```bash
podkit sync -c workout          # one-off playlist sync
podkit sync -c navidrome        # full library sync
```

### Multiple playlists on one server

Create one collection per playlist. Each re-declares the server connection:

```toml
[music.workout]
type = "subsonic"
url = "https://music.example.com"
username = "james"
path = "/tmp/nav-cache"
playlist = "Workout"

[music.focus]
type = "subsonic"
url = "https://music.example.com"
username = "james"
path = "/tmp/nav-cache"
playlist = "Focus"

[music.roadtrip]
type = "subsonic"
url = "https://music.example.com"
username = "james"
path = "/tmp/nav-cache"
playlist = "Road Trip"
```

### Playlist validation

podkit validates the playlist **before transferring anything**. If there is a problem it aborts with a clear error:

- **Name not found** — the named playlist does not exist on the server. Check the name and try again.
- **Ambiguous name** — two or more playlists on the server share the name. Rename one on the server.

You can check a playlist collection without running a sync:

```bash
podkit collection info workout
```

This does a quick server lookup and shows the playlist name, whether it resolves, and the track count (or `MISSING` / `AMBIGUOUS` if there is a problem).

### Viewing playlist constraints

`podkit collection list` includes a PLAYLIST column — collections with a `playlist` field show the name; others show `-`:

```
NAME       TYPE      PLAYLIST
navidrome  subsonic  -
workout    subsonic  Workout
focus      subsonic  Focus
```

`podkit collection music workout` annotates its heading with the playlist name so it is clear you are viewing a subset of the server:

```
Music in "workout" (playlist: Workout) — 42 tracks
```

### Empty-playlist guard

If a playlist resolves to zero tracks, podkit protects you from accidentally wiping your device's music:

- **Interactive sync** — podkit warns you and asks for confirmation before proceeding.
- **Non-interactive sync** (daemon, `--json`, or no TTY) — the sync aborts with a non-zero exit code.

To override this for a specific run, pass `--yes`:

```bash
podkit sync -c workout --yes    # proceed even if the playlist is empty
```

For the daemon or any non-interactive environment where you genuinely want empty-playlist syncs to proceed without a prompt, set `allowEmptyPlaylist = true` in the **top level** of your config file, or use the environment variable `PODKIT_ALLOW_EMPTY_PLAYLIST=true`:

```toml
allowEmptyPlaylist = true

[music.workout]
type = "subsonic"
url = "https://music.example.com"
username = "james"
path = "/tmp/nav-cache"
playlist = "Workout"
```

## How It Works

1. Connect to the Subsonic server using the API
2. If `playlist` is set, resolve the playlist by name and fetch its tracks; otherwise fetch the complete catalog (paginating through albums)
3. Extract track metadata from the API response
4. During sync, download audio files from the server with prefetching (files are downloaded ahead of transcoding so network I/O overlaps with CPU work)
5. Transcode as needed and copy to the device

## Supported Servers

| Server | Status | Notes |
|--------|--------|-------|
| Navidrome | Tested | Full support |
| Airsonic | Untested | Should work (same API) |
| Gonic | Untested | Should work (same API) |
| Subsonic | Untested | Should work (original API) |

## Sound Check / ReplayGain

Servers that implement the [OpenSubsonic](https://opensubsonic.netlify.app/) extensions (Navidrome, Gonic, LMS) expose ReplayGain data via the API. podkit reads this automatically and handles normalization based on your device's `audioNormalization` capability — writing Sound Check values on iPods, preserving existing ReplayGain tags on Rockbox, or skipping normalization on devices set to `none`. No extra configuration needed. See [Sound Check](/user-guide/syncing/sound-check) for details.

Classic Subsonic and Airsonic servers do not expose ReplayGain data. Tracks synced from these servers will have no Sound Check adjustment.

See [Sound Check](/user-guide/syncing/sound-check) for more details.

## Artwork

Album artwork embedded in audio files is automatically transferred to your device during sync.

With `--check-artwork` enabled, podkit fetches cover art from the server to detect artwork changes — including artwork being added, removed, or replaced with a different image. Navidrome generates placeholder images for albums without real artwork; podkit detects and filters these automatically.

See [Track Upgrades](/user-guide/syncing/upgrades#artwork-change-detection) for details.

## Limitations

- **Fresh catalog fetch each sync** - the track catalog is re-fetched from the server on every sync (audio files are downloaded on-demand and pipelined efficiently)
- **Single server per collection** - create multiple collections for multiple servers
- **Single playlist per collection** - one `playlist` value per collection; create multiple collections for multiple playlists

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
