---
title: Config File Reference
description: Complete reference for the podkit configuration file schema and options.
sidebar:
  order: 2
---

Complete reference for the podkit configuration file (`~/.config/podkit/config.toml`).

## File Location

Default location: `~/.config/podkit/config.toml`

Override with `--config <path>` or the `PODKIT_CONFIG` environment variable.

## Schema Overview

```toml
# Global defaults
quality = "high"             # Unified quality: max | high | medium | low
audioQuality = "high"        # Audio override: max | high | medium | low
videoQuality = "high"        # Video override: max | high | medium | low
encoding = "vbr"             # Encoding mode: vbr | cbr
transferMode = "fast"        # Transfer mode: fast | optimized | portable
artwork = true               # Include album artwork
checkArtwork = false         # Detect changed artwork between syncs
tips = true                  # Show contextual tips
skipUpgrades = false         # Skip file-replacement upgrades for changed source files
allowEmptyPlaylist = false   # Allow headless syncs to proceed when a playlist resolves to zero tracks

# Lossy reduction (defaults shown — omit to use these)
[bitrate]
reduce = "auto"              # auto | always | never
tolerance = 0.25             # source-proximity tolerance (fraction of cap)

# Codec preferences (defaults shown — omit to use these)
[codec]
lossy = ["opus", "aac", "mp3"]
lossless = ["source", "flac", "alac"]

# Clean up featured artist credits (simple form)
cleanArtists = true

# Or with options (table form):
# [cleanArtists]
# drop = false
# format = "feat. {}"
# ignore = []

# Music collections
[music.<name>]
path = "/path/to/music"
type = "directory"           # or "subsonic"

# Video collections
[video.<name>]
path = "/path/to/videos"

# Devices
[devices.<name>]
volumeUuid = "..."
volumeName = "..."
quality = "high"             # Unified quality for this device
audioQuality = "high"        # Audio override for this device
videoQuality = "high"        # Video override for this device
encoding = "vbr"             # Encoding mode override for this device
transferMode = "fast"        # Transfer mode override for this device
artwork = true

# Per-device lossy reduction
[devices.<name>.bitrate]
reduce = "auto"

# Per-device codec preferences
[devices.<name>.codec]
lossy = "aac"

# Per-device clean artists
[devices.<name>.cleanArtists]
format = "feat. {}"

# Defaults
[defaults]
device = "myipod"
music = "main"
video = "movies"
```

## version

**Type:** Integer
**Required:** Yes (added automatically by `podkit init` and `podkit migrate`)

The config file version. Used by podkit to detect outdated configs and guide users through migrations.

```toml
version = 1
```

If this field is missing, the config is treated as version 0 (pre-versioning). Running any podkit command with an outdated config will show an error directing you to run `podkit migrate`.

## Global Settings

These apply to all devices unless overridden at the device level.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `quality` | string | `"high"` | Unified quality preset for both audio and video: `max`, `high`, `medium`, `low`. The `max` preset is device-aware — it uses ALAC (lossless) on devices that support it when the source is lossless, otherwise falls back to `high`-quality AAC. |
| `audioQuality` | string | - | Audio-specific quality override: `max`, `high`, `medium`, `low`. Overrides `quality` for audio. |
| `videoQuality` | string | - | Video-specific quality override: `max`, `high`, `medium`, `low`. Overrides `quality` for video. |
| `encoding` | string | `"vbr"` | Encoding mode for lossy transcoding: `vbr` (variable bitrate) or `cbr` (constant bitrate). VBR produces better quality per MB; CBR produces predictable file sizes and more reliable preset change detection. Applies to whichever codec the [preference stack](/user-guide/transcoding/codec-preferences) resolves. |
| `transferMode` | string | `"fast"` | Transfer mode controlling how extra file data (e.g. embedded artwork) is handled, and — for iPod — whether on-disk file tags are kept in sync with the iTunesDB. See [Transfer Mode](#transfer-mode) below. |
| `customBitrate` | integer | - | Override the preset's target bitrate (64-320 kbps). Ignored when `max` resolves to ALAC. |
| `[bitrate].tolerance` | number | `0.25` | Source-proximity tolerance for lossy reduction on the add path (fraction of the cap). Reduce only when `source > cap × (1 + tolerance)`. Applies only when the reduction axis is `convert`. See [Lossy Reduction](#lossy-reduction). |
| `artwork` | boolean | `true` | Include album artwork during sync |
| `checkArtwork` | boolean | `false` | Detect artwork changes between syncs (added, removed, or replaced). For Subsonic sources, adds one HTTP request per unique album during scanning. Consider using the `--check-artwork` CLI flag for periodic checks instead of enabling permanently on large libraries. |
| `tips` | boolean | `true` | Show contextual tips (e.g., Sound Check, eject reminders). Also controllable via `--no-tips` flag or `PODKIT_TIPS=false`. |
| `skipUpgrades` | boolean | `false` | Skip file-replacement upgrades for changed source files |
| `allowEmptyPlaylist` | boolean | `false` | Allow a headless sync to proceed when a [playlist-scoped Subsonic collection](/user-guide/collections/subsonic#playlist-scoped-collections) resolves to zero tracks. When `false` (the default), a non-interactive sync aborts with a non-zero exit. Set to `true` for the daemon when you genuinely want empty-playlist syncs to pass through. Also overridable per-run with `--yes` or `PODKIT_ALLOW_EMPTY_PLAYLIST=true`. |

## Transfer Mode

`transferMode` controls two related decisions: how extra in-file data
(embedded artwork) is treated during transfer, and whether podkit keeps
the audio file's embedded tags (title, artist, albumArtist, etc.) in
sync with the source on every sync.

The contract differs between device families because the iPod plays
metadata out of the iTunesDB while mass-storage players (Echo Mini,
Rockbox, generic DAPs) read tags directly from the file.

| Mode | iPod | Mass-storage |
|------|------|--------------|
| `fast` | iTunesDB only — file tags are whatever the source happened to carry. Embedded artwork is stripped from transcoded files. | File tags always written. Embedded artwork stripped from transcoded files. |
| `optimized` | iTunesDB only — file tags untouched, even on first sync. Embedded artwork stripped. | File tags always written. Embedded artwork stripped. |
| `portable` | iTunesDB **and** on-disk file tags. Embedded artwork preserved. Best-effort: writes that fail are surfaced as warnings, not sync failures. | File tags always written. Embedded artwork preserved. |

Why mass-storage always writes tags: most non-iPod DAPs read metadata
from the file's embedded tags during playback, so if podkit didn't keep
them in sync the device UI would show stale values.

Why iPod portable is a separate case: the iPod's firmware plays from
the iTunesDB and never looks at file tags during playback, but a user
who copies files off the device (recovery, ripping back to a library)
needs the file to be self-describing. `portable` opts into that extra
write at the cost of a small per-track tag-write.

After upgrading from a podkit version that did not write file tags,
the first sync on an existing mass-storage device will likely show a
long list of `metadata-correction` operations as stale on-disk tags
converge to the source. These are zero-byte writes — no transfers
happen — and the noise clears after one cycle.

### Codecs that always transcode on mass-storage

WAV and AIFF appear in preset `supportedAudioCodecs` lists for
documentation (the device firmware can play them), but podkit refuses
to use them as device-output on mass-storage. Tag-writing through the
RIFF/IFF container formats is unreliable across players, so source
files in these formats are transcoded to a managed codec (typically
AAC, ALAC, or FLAC depending on the codec preference stack) before
being placed on the device. iPod is exempt — libgpod and the iTunesDB
handle metadata for WAV/AIFF tracks on iPod natively.

## Lossy Reduction

The `[bitrate]` block controls when podkit re-encodes a device-native lossy source
(MP3, AAC) to fit the quality cap. Set it globally under `[bitrate]` or per-device
under `[devices.<name>.bitrate]` (the device block overrides the global one).
Override `reduce` for a single run with
[`--bitrate-reduce`](/reference/cli-commands#sync); override `tolerance` with
[`--bitrate-tolerance`](/reference/cli-commands#sync).

```toml
[bitrate]
reduce = "auto"        # auto | always | never
tolerance = 0.25       # source-proximity tolerance (fraction of cap, default 0.25)
```

### `[bitrate].reduce`

| Value | Behaviour |
|-------|-----------|
| `auto` (default) | Follows the transfer mode: `optimized` converts (reduces over-cap sources); `fast` and `portable` preserve (copy device-native lossy as-is). |
| `always` | Always reduce an over-cap device-native lossy source down to the cap. |
| `never` | Always preserve — copy device-native lossy sources untouched, even if above the cap. |

**Lossy reduction is down-only.** Re-encoding a lossy source up cannot recover
discarded information (ADR-023), so podkit never does it automatically. When you
raise the cap, tracks previously reduced below the new cap are surfaced as a
`below-cap` report ("N tracks below your quality target; `--force-transcode` to
lift them") and left alone — re-lifting is an explicit opt-in with `--force-transcode`.

**The cap is a hard ceiling.** Even on the `preserve` axis, a source the device
cannot play natively (an incompatible codec) must be transcoded; the cap still
applies to that forced transcode.

**The `preserve` axis and an incompatible source.** When a device cannot play the
source codec natively (e.g. OGG on a device that only supports AAC/MP3), a transcode
is unavoidable regardless of the `reduce` setting. `preserve` targets
`min(round(source × eff[target] / eff[source]), cap)` — quality-matching in the
forced codec, still bounded by the cap. `always`/`auto`→convert targets
`min(source, cap)` — file-size first.

### `[bitrate].tolerance`

A fraction of the cap (default `0.25`). On the **add path**, a device-native
lossy source is reduced only when `source > cap × (1 + tolerance)`. A source within
25% of the cap is copied as-is. Set `tolerance = 0` for exact cap enforcement
(reduce every source at all above the cap).

On re-sync, the recorded-vs-cap comparison uses `tolerance: 0` (exact) — the sync
tag records what podkit actually encoded, so there is no ffprobe wobble to damp.

### Source-down is never destructive

When a source is re-ripped to a **lower** bitrate than the device copy, podkit
keeps the better copy and reports the situation (a `source-down-suppressed` entry
in `qualityChanges[]` and a per-collection count in the summary). It never
re-encodes the good copy down to a worse source.

### Untagged tracks are opted out

Quality detection is driven entirely by the [sync tag](/reference/sync-tags) podkit
writes — the only authoritative record of what it encoded. A track podkit never
wrote (no sync tag) is left alone; there is no fallback to the unreliable
device-database bitrate. Adopt such tracks deliberately with
[`--force-sync-tags-transcode`](/reference/cli-commands#sync).

### `skipUpgrades` is the master veto

A device with `skipUpgrades = true` never replaces an existing file for any
quality reason — including format corrections and the lossless/lossy boundary
crossing. Use it for a curated, purely-additive device.

## Codec Preferences

The `[codec]` section controls which audio codec podkit uses for transcoding. podkit walks the preference list top-to-bottom and selects the first codec the target device supports and whose encoder is available in FFmpeg. See [Codec Preferences](/user-guide/transcoding/codec-preferences) for the full guide.

```toml
[codec]
lossy = ["opus", "aac", "mp3"]        # Default lossy stack
lossless = ["source", "flac", "alac"] # Default lossless stack
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `lossy` | string or string[] | `["opus", "aac", "mp3"]` | Ordered preference list for lossy transcoding. First supported codec with an available encoder wins. |
| `lossless` | string or string[] | `["source", "flac", "alac"]` | Ordered preference list for lossless transcoding (used when quality is `max` and source is lossless). The `source` keyword means "keep original format if the device supports it." |

Per-device codec overrides are set under `[devices.<name>.codec]`:

```toml
[devices.classic.codec]
lossy = "aac"           # Single value is fine (treated as one-element list)

[devices.rockbox.codec]
lossy = ["opus", "aac"]
lossless = "flac"
```

Valid codec identifiers: `opus`, `aac`, `mp3`, `flac`, `alac`, `source` (lossless stack only).

## Music Collections

Each music collection is defined under `[music.<name>]` where `<name>` is an identifier you choose.

### Directory Source

```toml
[music.main]
path = "/path/to/music"
```

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `path` | string | yes | - | Path to the music directory |
| `type` | string | no | `"directory"` | Source type |

### Subsonic Source

```toml
[music.navidrome]
type = "subsonic"
url = "https://server.example.com"
username = "user"
password = "password"
path = "/cache/path"
```

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `type` | string | yes | - | Must be `"subsonic"` |
| `url` | string | yes | - | Subsonic server URL |
| `username` | string | yes | - | Subsonic username |
| `password` | string | no | - | Subsonic password (can also use env var) |
| `path` | string | yes | - | Local cache path for downloaded files |
| `playlist` | string | no | - | Sync only this named server playlist instead of the whole library. The name must match exactly one playlist on the server — the sync aborts before transferring anything if the name is not found or is ambiguous. Only valid on `subsonic` collections; setting it on a directory collection is a config error. See [Playlist-Scoped Collections](/user-guide/collections/subsonic#playlist-scoped-collections). |

The password can be provided via the config file, or through environment variables (see [Environment Variables](/reference/environment-variables)).

## Video Collections

Each video collection is defined under `[video.<name>]`.

```toml
[video.movies]
path = "/path/to/movies"
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `path` | string | yes | Path to the video directory |

## Devices

Each device is defined under `[devices.<name>]`. Use `podkit device add -d <name>` to auto-detect and register a connected device.

```toml
# iPod — type is auto-detected
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "IPOD"
quality = "max"               # Best quality — ALAC on Classic (supports it)
videoQuality = "high"
encoding = "vbr"              # Encoding mode for this device
transferMode = "fast"         # Transfer mode for this device
artwork = true
skipUpgrades = false          # Allow file-replacement upgrades (default)

# Mass-storage DAP — specify type for predefined capabilities
[devices.echomini]
type = "echo-mini"
volumeUuid = "WXYZ-9012"
quality = "high"

# Generic mass-storage player with custom capabilities
[devices.mydap]
type = "generic"
volumeUuid = "HIJK-3456"
supportedAudioCodecs = ["aac", "alac", "mp3", "flac", "ogg"]
artworkMaxResolution = 320
musicDir = "Music"                    # Content paths (use "/" or "" for device root)
moviesDir = "Video/Movies"
tvShowsDir = "Video/Shows"
```

A minimal device entry only needs the settings you want to override — `volumeUuid` is only required for auto-detection:

```toml
[devices.classic]
quality = "max"               # Use --device <path> to specify mount point
```

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `type` | string | no | auto-detected | Device type: `ipod`, `echo-mini`, `rockbox`, or `generic`. iPods are auto-detected; mass-storage devices should specify a type. See [Supported Devices](/devices/supported-devices) for predefined profiles. |
| `volumeUuid` | string | no | - | Volume UUID for device auto-detection. Required if you want podkit to automatically find your device without specifying `--device <path>`. |
| `volumeName` | string | no | - | Volume name for display |
| `quality` | string | no | global `quality` | Unified quality preset override for this device |
| `audioQuality` | string | no | global `audioQuality` | Audio-specific quality override for this device |
| `videoQuality` | string | no | global `videoQuality` | Video-specific quality override for this device |
| `encoding` | string | no | global `encoding` | Encoding mode override: `vbr` or `cbr` |
| `transferMode` | string | no | global `transferMode` | Transfer mode override: `fast`, `optimized`, or `portable`. See [Transfer Mode](#transfer-mode) for the device-specific contract (file-tag writes differ between iPod and mass-storage). |
| `customBitrate` | integer | no | global `customBitrate` | Override the preset's target bitrate for this device |
| `bitrate` | table | no | global `[bitrate]` | Lossy reduction block (`[devices.<name>.bitrate]`). See [Lossy Reduction](#lossy-reduction). |
| `artwork` | boolean | no | global `artwork` | Artwork override for this device |
| `checkArtwork` | boolean | no | global `checkArtwork` | Detect changed artwork for this device |
| `skipUpgrades` | boolean | no | global `skipUpgrades` | Skip file-replacement upgrades for this device |

### Device Capability Overrides

Mass-storage devices use predefined capability profiles based on their `type`. You can override individual capabilities for devices that differ from their profile, or to configure the `generic` type for your specific hardware:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `supportedAudioCodecs` | string[] | from profile | Audio codecs the device can play natively: `aac`, `alac`, `mp3`, `flac`, `ogg`, `opus`, `wav`, `aiff`. Note: `wav` and `aiff` are listed for documentation only — podkit transcodes sources in those formats to a managed codec on mass-storage devices regardless of preset support. See [Transfer Mode → Codecs that always transcode](#codecs-that-always-transcode-on-mass-storage). |
| `artworkSources` | string[] | from profile | How the device reads artwork, in priority order (first = preferred): `embedded`, `sidecar`, `database` |
| `artworkMaxResolution` | integer | from profile | Maximum artwork dimension in pixels (square). podkit resizes artwork to fit. |
| `supportsVideo` | boolean | from profile | Whether the device supports video playback |
| `audioNormalization` | string | from profile | Volume normalization mode: `soundcheck` (writes to iPod database), `replaygain` (writes ReplayGain track + album tags to files for Rockbox and other DAPs), or `none` (skip normalization). podkit adapts its behavior — hiding normalization UI, skipping normalization upgrade detection — based on this value. |
| `supportsAlbumArtistBrowsing` | boolean | from profile | Whether the device uses Album Artist for browse navigation. When `true`, the device groups tracks by Album Artist in its artist list. When `false` (e.g. iPod stock firmware), the device only uses the Artist field for browsing. |
| `musicDir` | string | `"Music"` | Music directory path on the device. Use `/`, `.`, or `""` for device root. Defaults vary by device type (e.g., Echo Mini defaults to root). |
| `moviesDir` | string | `"Video/Movies"` | Movies directory path on the device. Use `/`, `.`, or `""` for device root. |
| `tvShowsDir` | string | `"Video/Shows"` | TV shows directory path on the device. Use `/`, `.`, or `""` for device root. |
| `pathTemplate` | string | `"{albumArtist}/{album}/{trackNumber} - {title}{ext}"` | Override the music file path layout under `musicDir`. Variables: `{albumArtist}`, `{artist}`, `{album}`, `{title}`, `{trackNumber}`, `{discNumber}`, `{totalDiscs}`, `{genre}`, `{year}`, `{ext}`. Must contain `{title}` and `{ext}`. Changing this between syncs triggers a self-healing relocate — existing files are moved via `fs.rename()` to match the new layout, without re-transcoding. Also settable via `PODKIT_PATH_TEMPLATE`. |
| `manufacturer` | string | from profile | Vendor / brand shown in `device add` / `device info` output. Useful with the `generic` and `rockbox` profiles to label a no-name DAP with your own brand. |
| `productName` | string | from profile | Product label shown in `device list` (TYPE column), `device info` (Type line), and `device add` (rich form). Useful for the same reason as `manufacturer`. |

These fields are only relevant for mass-storage devices (`echo-mini`, `rockbox`, `generic`). iPod capabilities are determined automatically from the device generation; `pathTemplate` is rejected on iPod since libgpod manages the F00/F01 file layout, and `manufacturer`/`productName` are similarly rejected since iPod display labels come from the libgpod model name.

#### Example: labelling a no-name DAP

The `generic` and `rockbox` profiles ship with placeholder labels (`Mass-storage device`, `Rockbox device`). Override per-device for a friendlier name:

```toml
[devices.mp3player]
type         = "generic"
volumeUuid   = "USB1-2345"
manufacturer = "AliExpress"
productName  = "USB MP3 player"
```

`podkit device info -d mp3player` now reads:

```
Device: mp3player
  Type:          USB MP3 player
```

`podkit device add` (rich form) shows `AliExpress USB MP3 player (generic)` — the preset id stays in parentheses so you can still tell which `--type` token the device uses.

### Per-Device Clean Artists

Devices can override the global `cleanArtists` setting:

```toml
[devices.classic.cleanArtists]
format = "feat. {}"
```

## Custom Mass-Storage Presets

Beyond the built-in `echo-mini`, `rockbox`, and `generic` presets, you can declare custom mass-storage device presets in the `[presets.<id>]` section. A custom preset captures the device's capabilities (what codecs it plays, artwork limits, content paths) once, then any number of `[devices.X]` entries can `type = "<id>"` to use it.

```toml
[presets.my-walkman]
extends = "generic"
manufacturer = "Sony"
productName = "NW-A105"
supportedAudioCodecs = ["aac", "flac", "mp3"]
artworkMaxResolution = 240
musicDir = "MUSIC"

[devices.walkman]
type = "my-walkman"
path = "/Volumes/MyWalkman"
```

| Key | Type | Description |
|-----|------|-------------|
| `extends` | string | Inherit defaults from another preset (built-in id or another `[presets.X]`). |
| `manufacturer` | string | Display label vendor / brand (e.g. `"Sony"`). |
| `productName` | string | Display label short name (e.g. `"NW-A105"`). |
| `supportedAudioCodecs` | string[] | Codecs the device firmware plays natively. |
| `artworkMaxResolution` | number | Max artwork dimension in pixels. |
| `artworkSources` | string[] | One of `database`, `embedded`, `sidecar`. |
| `supportsVideo` | boolean | Whether the device plays video. |
| `audioNormalization` | string | One of `soundcheck`, `replaygain`, `none`. |
| `supportsAlbumArtistBrowsing` | boolean | Whether the device groups by album artist. |
| `musicDir` / `moviesDir` / `tvShowsDir` | string | Device-relative content paths. |

`extends` chains are resolved at load time. A preset that omits `extends` inherits from the `generic` baseline so it has sensible defaults.

**Rules:**

- Preset ids are unique. Declaring `[presets.echo-mini]` (a built-in id) fails to load — pick a different id and use `extends = "echo-mini"` instead.
- `[presets.ipod]` is also refused (`ipod` is the iPod provider, not a mass-storage preset).
- Cycles in `extends` chains (`a → b → a`) are rejected with the preset names named in the error.
- Listing `wav` or `aiff` in `supportedAudioCodecs` emits a warning: podkit transcodes sources in those formats rather than direct-copying them.

Two devices configured with the same preset id resolve independently. They share the preset baseline but per-device `[devices.X]` capability overrides apply on top, so an Echo Mini and a `[devices.echo2]` echo-mini-typed device can have different `quality` / codec / artwork settings.

## Clean Artists

Extracts featured artist information from the artist field and moves it to the title field. Applied globally to all devices unless overridden.

The simplest form is a boolean:

```toml
cleanArtists = true
```

For more control, use the table form (implies enabled):

```toml
[cleanArtists]
drop = false
format = "feat. {}"
ignore = ["Simon & Garfunkel"]
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `drop` | boolean | `false` | If `true`, drop featuring info entirely instead of moving to title |
| `format` | string | `"feat. {}"` | Format string for featuring text in title (`{}` is replaced with artist names) |
| `ignore` | string[] | `[]` | Artist names to ignore when splitting on ambiguous separators (`and`, `&`, `with`) |

## Defaults

Specifies which named collection and device to use when CLI flags are omitted.

```toml
[defaults]
device = "classic"
music = "main"
video = "movies"
```

| Key | Type | Description |
|-----|------|-------------|
| `device` | string | Default device name |
| `music` | string | Default music collection name |
| `video` | string | Default video collection name |

## Quality Resolution Order

Audio and video quality each have their own resolution chain. More specific settings always win over less specific ones.

**Audio quality** (first match wins):

1. CLI `--audio-quality`
2. CLI `--quality`
3. Device `audioQuality`
4. Device `quality`
5. Global `audioQuality`
6. Global `quality`
7. Default: `"high"`

**Video quality** (first match wins):

1. CLI `--video-quality`
2. CLI `--quality`
3. Device `videoQuality`
4. Device `quality`
5. Global `videoQuality`
6. Global `quality`
7. Default: `"high"`

## Full Example

```toml
# Global defaults
quality = "high"              # Unified quality for audio and video
encoding = "vbr"              # VBR encoding (default)
transferMode = "fast"         # Direct-copy compatible files, strip artwork from transcodes
artwork = true

# Codec preferences (defaults — omit to use these)
[codec]
lossy = ["opus", "aac", "mp3"]
lossless = ["source", "flac", "alac"]

# Clean up featured artist credits
[cleanArtists]
format = "feat. {}"
ignore = ["Simon & Garfunkel", "Hall & Oates"]

# Music collections
[music.main]
path = "/Volumes/Media/music/library"

[music.vinyl-rips]
path = "/Volumes/Media/vinyl-rips"

[music.navidrome]
type = "subsonic"
url = "https://music.example.com"
username = "user"
path = "/tmp/navidrome-cache"

# Playlist-scoped collection — only the "Workout" playlist on the same server
[music.workout]
type = "subsonic"
url = "https://music.example.com"
username = "user"
path = "/tmp/navidrome-cache"
playlist = "Workout"

# Video collections
[video.movies]
path = "/Volumes/Media/movies"

[video.shows]
path = "/Volumes/Media/tv-shows"

# Devices
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "CLASSIC"
audioQuality = "max"          # ALAC on Classic (it supports lossless)
videoQuality = "high"
artwork = true

[devices.echomini]
type = "echo-mini"
volumeUuid = "WXYZ-9012"
quality = "high"
musicDir = "Music"              # Custom content paths (mass-storage devices only)
moviesDir = "Videos/Movies"
tvShowsDir = "Videos/Shows"

[devices.nano]
volumeUuid = "EFGH-5678"
volumeName = "NANO"
quality = "medium"            # Both audio and video use medium
artwork = false
skipUpgrades = true           # Nano has limited space, skip file upgrades

# Defaults
[defaults]
device = "classic"
music = "main"
video = "movies"
```

## See Also

- [Configuration Guide](/user-guide/configuration) - Conceptual overview
- [Codec Preferences](/user-guide/transcoding/codec-preferences) - How codec selection works
- [Environment Variables](/reference/environment-variables) - Env var overrides and config priority
- [CLI Commands](/reference/cli-commands) - Command-line options
- [Quality Presets](/reference/quality-presets) - Audio and video quality details
