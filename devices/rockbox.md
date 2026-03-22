# Rockbox

```yaml
# ============================================================================
# Device Identity
# ============================================================================
name: "Rockbox"
manufacturer: "Rockbox Open Source Project"
product_url: "https://www.rockbox.org/"
device_family: rockbox
connection_method: usb-mass-storage

# Documentation metadata
firmware_version: ""              # Varies by target device; Rockbox is rolling release
date_documented: "2026-03-22"

# ============================================================================
# Detection
# ============================================================================
# Rockbox uses the underlying hardware's USB controller and presents the same
# VID/PID as the original firmware. Auto-detection should instead check for
# the .rockbox/ directory (specifically .rockbox/rockbox-info.txt) on the
# mounted volume [1].
detection:
  usb_vendor_id: ""               # Varies — same as underlying hardware
  usb_product_ids: []             # Same as stock firmware for the underlying hardware
  filesystem_indicators:
    - ".rockbox/rockbox-info.txt" # Primary indicator; contains Target and Features fields [1]
    - ".rockbox/"                 # Fallback; directory always present on Rockbox installs
  notes: >
    USB IDs cannot distinguish Rockbox from stock firmware. Parse
    .rockbox/rockbox-info.txt to identify the target hardware model and
    capabilities. The Target field maps to screen resolution and color
    depth. The Features field (colon-separated) includes "albumart" if
    album art is supported.

# ============================================================================
# Storage
# ============================================================================
storage:
  type: "varies"                  # Internal HDD, CF/SD card mods, or both
  max_capacity: ""                # Limited by hardware; LBA48 support enables >137GB
  filesystems:
    supported: [FAT16, FAT32]
    unsupported: [HFS+, NTFS, exFAT]
  notes: >
    FAT32 required [2]. exFAT is not supported [2]. iPods must be FAT32
    formatted (not HFS+) for Rockbox. LBA48 support enables drives larger
    than 137GB, relevant for iPod Classic mods with SD/CF card adapters.
    Cards >32GB that ship exFAT-formatted must be reformatted to FAT32.

# ============================================================================
# Display & Artwork
# ============================================================================
# Screen size and color depth vary by target hardware. See the target device
# table below the frontmatter for the full list. Artwork render size is
# determined by the WPS theme's %Cl tag, not a fixed device property [3].
#
# LCD depth categories:
#   1-bit monochrome:    Sansa Clip/Clip+/Clip v2, xDuoo X3 — NO album art
#   2-bit grayscale:     iPod 1G-4G, iPod Mini, iriver H100/H120 — album art with dithering
#   16-bit color:        Most targets (iPod Video/Classic/Nano, Sansa, etc.)
#   24/32-bit color:     Creative Zen X-Fi, HiBy Linux devices
display:
  screen_resolution: "varies"     # See target device table below
  color_depth: "varies"           # 1-bit mono, 2-bit grayscale, 16/24/32-bit color
  artwork_render_size: "varies"   # Determined by WPS theme %Cl tag [3]

artwork:
  embedded: true                  # JPEG only; from ID3v2 or MP4 tags [3]
  sidecar: true
  sidecar_filenames:              # Search order [3] (each tried with and without size suffix like .100x100):
    - "<trackname>.{jpeg,jpg,bmp}"
    - "<albumname>.{jpeg,jpg,bmp}"
    - "cover.{jpeg,jpg,bmp}"
    - "folder.jpg"
    - ".rockbox/albumart/<artist>-<albumname>.{jpeg,jpg,bmp}"
    - "../<albumname>.{jpeg,jpg,bmp}"
    - "../cover.{jpeg,jpg,bmp}"
  formats: ["JPEG", "BMP"]       # PNG is NOT supported for album art [3] (only in image viewer)
  max_resolution: ""              # No hard limit; larger images take longer to scale
  notes: >
    Artwork preference is configurable: "Prefer Embedded" (default), "Prefer
    Image File", or "Off" [3]. Sidecar files can include a size suffix
    (e.g., cover.100x100.jpg) for pre-scaled versions. The PictureFlow plugin
    accepts larger-than-screen artwork but cannot use embedded art [3].

    Embedded artwork supports JPEG only (not BMP). Sidecar supports JPEG and
    BMP. Progressive/multi-scan JPEG and RLE-compressed BMP are not supported [3].

    WPS themes control artwork display size and position via the %Cl tag [3]:
      %Cl(x,y,[maxwidth],[maxheight],hor_align,vert_align)
    podkit should pre-scale sidecar artwork to match the target device's
    screen resolution for fast loading.

    Grayscale rendering: on 2-bit grayscale devices (iPod 1G-4G, Mini, iriver
    H100/H120), color artwork is converted to grayscale with Bayer ordered
    dithering [4]. 1-bit monochrome devices do not support album art at all [4].

# ============================================================================
# Audio Format Support
# ============================================================================
audio_formats:
  lossy:
    - codec: "MP3"
      extensions: [".mp3"]
      max_sample_rate: "48kHz"
      max_bit_depth: "16-bit"
      notes: "MAD decoder"
    - codec: "OGG Vorbis"
      extensions: [".ogg", ".oga"]
      max_sample_rate: "48kHz"
      max_bit_depth: ""
      notes: "Tremor integer decoder"
    - codec: "AAC / HE-AAC"
      extensions: [".m4a", ".mp4"]
      max_sample_rate: "48kHz"
      max_bit_depth: ""
      notes: "libfaad decoder"
    - codec: "Opus"
      extensions: [".opus"]
      max_sample_rate: "48kHz"
      max_bit_depth: ""
      notes: ""
    - codec: "WMA"
      extensions: [".wma"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: "WMA and WMA Pro supported"
    - codec: "Musepack"
      extensions: [".mpc"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: "SV7 and SV8"
    - codec: "AC3"
      extensions: [".ac3"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: "5.1 downmixed to stereo"
    - codec: "Speex"
      extensions: [".spx"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: ""
  lossless:
    - codec: "FLAC"
      extensions: [".flac"]
      max_sample_rate: "48kHz"
      max_bit_depth: "24-bit"
      notes: >
        Realtime on all targets. Supports up to 8K block sizes and 7 channels.
        Higher sample rates are decoded but downsampled to the DAC's native
        rate (typically 48kHz).
    - codec: "ALAC"
      extensions: [".m4a"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: "Realtime. Limited performance on PP5002 targets."
    - codec: "WAV"
      extensions: [".wav"]
      max_sample_rate: "48kHz"
      max_bit_depth: "24-bit"
      notes: "PCM, ADPCM, ALAW, MULAW, DVI-ADPCM"
    - codec: "AIFF"
      extensions: [".aif", ".aiff"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: ""
    - codec: "WavPack"
      extensions: [".wv"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: ""
    - codec: "APE"
      extensions: [".ape"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: "Realtime varies by compression level (-c1000 to -c4000 on faster targets)"
    - codec: "TTA"
      extensions: [".tta"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: "Limited realtime on slower targets"
    - codec: "Shorten"
      extensions: [".shn"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: "Play only, no seeking"
  chiptune:
    - "SID, MOD, NSF/NSFE, SPC, GBS, HES, SAP, MIDI"

# ============================================================================
# Metadata
# ============================================================================
metadata:
  tag_formats: ["ID3v1", "ID3v2", "Vorbis Comments", "APEv2"]
  browsing_mode: "both"           # Database (tag index) + folder browsing
  notes: >
    Database mode indexes tags and provides browsing by Artist, Album, Genre,
    Composer, Year, etc. Customizable via tagnavi.config. Can auto-update on
    boot or manual initialize/update. "Load to RAM" option for faster browsing
    on disk-based players. Folder browsing also available as alternative.

# ============================================================================
# Playlists
# ============================================================================
playlists:
  supported_formats: ["M3U", "M3U8"]
  path_style: "both"             # Relative and absolute paths supported
  location: "anywhere"
  notes: >
    .m3u files are treated as ISO-8859-1 encoding. .m3u8 files default to
    UTF-8. UTF-8 BOM is detected and honored regardless of extension.
    Backslashes are normalized to forward slashes. Windows drive letter paths
    are auto-converted. Relative paths are resolved against the playlist
    directory. PLS format is not supported.

# ============================================================================
# Features
# ============================================================================
features:
  ratings: true                   # Per-track ratings stored in runtime database
  play_counts: true               # Play count, last played, cumulative play time, autoscore
  scrobbling: true                # .scrobbler.log in device root (Audioscrobbler protocol)
  lyrics: true                    # LRC plugin: .lrc, .lrc8, .snc, .txt; embedded SYLT/USLT
  replaygain: true                # Album/Track gain, prevent clipping, pre-amp (-12 to +12 dB)
  gapless_playback: true          # Native when crossfade is off; MP3 needs --nogap encoding
  video: true                     # MPEGplayer plugin: MPEG-1/2 in .mpg/.mpeg containers
  podcasts: true                  # Via bookmarking: save/resume position, per-directory auto-resume
  audiobooks: true                # Via bookmarking: save/resume position, cuesheet chapter navigation
  photos: true                    # Image viewer plugin: JPEG (incl. progressive), BMP, PNG, GIF, PPM
  contacts: false
  notes: false
  calendar: false
  custom_themes: true             # Fully themeable WPS, downloadable themes
  eq: true                       # 10-band fully-parametric EQ
  usb_dac: false                  # USB HID support (mouse emulation), but not USB DAC

# ============================================================================
# Links
# ============================================================================
links:
  - label: "Rockbox home"
    url: "https://www.rockbox.org/"
  - label: "Supported codecs"
    url: "https://www.rockbox.org/wiki/SoundCodecs"
  - label: "Album art guide"
    url: "https://www.rockbox.org/wiki/AlbumArt"
  - label: "Database / tagcache"
    url: "https://www.rockbox.org/wiki/DataBase"
  - label: "Scrobbler"
    url: "https://www.rockbox.org/wiki/LastFMLog"
  - label: "Theme site"
    url: "https://themes.rockbox.org/"
  - label: "Supported targets"
    url: "https://www.rockbox.org/wiki/TargetStatus"
  - label: "Source: config headers (per-target specs)"
    url: "https://git.rockbox.org/cgit/rockbox.git/tree/firmware/export/config/"
  - label: "Source: bmp.c (artwork rendering)"
    url: "https://git.rockbox.org/cgit/rockbox.git/tree/apps/recorder/bmp.c"
  - label: "Source: mkinfo.pl (rockbox-info.txt format)"
    url: "https://git.rockbox.org/cgit/rockbox.git/tree/tools/mkinfo.pl"
  - label: "Rockbox manual (iPod Classic)"
    url: "https://download.rockbox.org/daily/manual/rockbox-ipod6g/"
```

## Sync Mechanism

USB mass storage. Rockbox devices mount as standard USB drives. Files can be
placed anywhere on the filesystem — there is no required directory structure.

The device builds a tag database from audio file metadata. Users can browse by
tags (database mode) or by folder structure. Both modes work simultaneously.

A typical folder structure for podkit might be:

```
Music/
├── Artist Name/
│   ├── Album Name/
│   │   ├── 01 Track.flac
│   │   ├── 02 Track.flac
│   │   └── cover.jpg        # Sidecar artwork
│   └── Another Album/
│       └── ...
Playlists/
├── playlist.m3u8
└── ...
.scrobbler.log                    # Auto-generated by Rockbox
.rockbox/                         # Rockbox system directory (do not modify)
```

### Database Initialization

After syncing new files, the Rockbox database needs to be updated. This can be
configured to happen automatically on boot, or triggered manually via
Settings > Database > Update Now. podkit cannot trigger this remotely — it
happens on the device.

### Scrobbler Log

Rockbox writes a `.scrobbler.log` file to the device root after playback.
Tracks must be >30 seconds with valid artist + title tags and listened to >=50%
of their length. Devices without a real-time clock write
`.scrobbler-timeless.log` with zero timestamps.

## Quirks & Limitations

- **No remote database update** — after syncing, the user must update the
  database on the device. There's no way for podkit to trigger this.
- **FAT32 only** — no exFAT support [2]. This limits individual file sizes to
  4GB. Cards >32GB that ship exFAT-formatted must be reformatted to FAT32.
- **DAC sample rate limit** — most iPod hardware DACs max out at 48kHz/16-bit.
  Higher-res files are decoded and downsampled in software. Syncing 96kHz/24-bit
  files works but provides no benefit on iPod hardware.
- **MP3 gapless** — requires LAME `--nogap` encoding for truly seamless MP3
  transitions. Lossless formats are inherently gapless.
- **Video very limited** — MPEGplayer only supports MPEG-1/2 (not H.264). On
  iPod Video: ~19fps at 320x240. Not practical for most use cases.
- **PNG not supported for album art** — only JPEG and BMP. PNG works in the
  image viewer plugin but not for album art display.
- **macOS USB mounting** — some macOS versions have a bug preventing proper
  mounting unless USB HID is disabled in Rockbox settings.
- **APE performance** — high compression levels (-c5000) may not decode in
  realtime on slower targets.

## Device Detection

Rockbox uses the same USB VID/PID as the underlying hardware, so USB IDs
cannot distinguish Rockbox from stock firmware. Instead, detect Rockbox by
checking for `.rockbox/rockbox-info.txt` on the mounted volume [1].

### rockbox-info.txt

This file is created during installation and contains structured metadata [1]:

```
Target: iPod Classic (6G)
Target id: 73
Memory: 67108864
CPU: S5L8702
Manufacturer: Apple
Version: rNNNNNNNNNN-YYMMDD
Features: albumart:tagcache:...
```

Key fields for podkit:
- **Target** — identifies the hardware model (maps to screen resolution, color depth)
- **Features** — colon-separated list; `albumart` indicates album art support

### .rockbox/ Directory Structure

```
.rockbox/
├── rockbox-info.txt          # Device/build metadata
├── rockbox.{target}          # Main firmware binary (e.g., rockbox.ipod6g)
├── config.cfg                # User settings (created after first config change)
├── codecs/                   # Audio codec plugins (.codec files)
├── codepages/                # Character encoding tables
├── langs/                    # Language files
├── fonts/                    # Font files
├── wps/                      # While Playing Screen themes
├── themes/                   # Theme configuration files
├── icons/                    # Icon sets
├── backdrops/                # Background images (bitmap targets only)
├── eqs/                      # Equalizer presets
├── rocks/                    # Plugins (games/, apps/, demos/, viewers/)
├── albumart/                 # Centralized album art storage
├── tagnavi.config            # Database navigation config
├── viewers.config            # File type associations
└── database.ignore           # Marker to exclude .rockbox from DB scanning
```

## Research Notes

- **Scrobbler log parsing** — podkit could read `.scrobbler.log` to import play
  counts back into the collection source (e.g., update Subsonic play counts).
- **tagnavi.config** — Rockbox's database view configuration could potentially
  be generated by podkit to provide custom browsing views.
- **Cuesheet support** — Rockbox supports .cue files for chapter navigation.
  Could be useful for audiobook/podcast sync.
- **ReplayGain writing** — podkit could optionally compute and write ReplayGain
  tags during sync since Rockbox reads them natively.

## Implementation Notes

_Not yet implemented. Target: mass-storage ContentTypeHandler._

Key considerations for implementation:

- **Broad format support** — Rockbox plays almost everything. Transcoding would
  rarely be needed. The main sync value is collection management, not format
  conversion.
- **Playlist generation** — M3U8 playlists with relative paths and UTF-8
  encoding. podkit could generate playlists from collections.
- **Artwork strategy** — two options: embed in tags (supported for most formats)
  or write sidecar `cover.jpg` files. Sidecar is simpler and avoids modifying
  source files. Pre-scale to device screen resolution for faster loading.
- **No database writing** — unlike iPod, podkit cannot write to the Rockbox
  database. Metadata comes from file tags, so tags must be correct in source
  files.
- **Folder structure matters** — unlike iPod (where files are in F00-F49 with
  random names), Rockbox users browse by folder. podkit should create a clean
  `Artist/Album/Track` hierarchy.
- **Grayscale artwork** — on 2-bit grayscale devices, podkit should still sync
  artwork (Rockbox dithers it automatically [4]). Could optionally pre-convert
  to grayscale BMP for faster rendering. 1-bit monochrome devices don't support
  album art at all [4].

## Target Device Table

Screen resolutions, color depths, and album art support for Rockbox targets [5].
This informs artwork pre-scaling and color space decisions.

### iPod Targets

| Device | Resolution | Color Depth | Album Art |
|--------|-----------|-------------|-----------|
| iPod 1st/2nd Gen | 160x128 | 2-bit grayscale | Yes (dithered) |
| iPod 3rd Gen | 160x128 | 2-bit grayscale | Yes (dithered) |
| iPod 4th Gen | 160x128 | 2-bit grayscale | Yes (dithered) |
| iPod Color/Photo | 220x176 | 16-bit RGB565 | Yes |
| iPod Video (5G) | 320x240 | 16-bit RGB565 | Yes |
| iPod Classic (6G) | 320x240 | 16-bit RGB565 | Yes |
| iPod Mini 1st Gen | 138x110 | 2-bit grayscale | Yes (dithered) |
| iPod Mini 2nd Gen | 138x110 | 2-bit grayscale | Yes (dithered) |
| iPod Nano 1st Gen | 176x132 | 16-bit RGB565 | Yes |
| iPod Nano 2nd Gen | 176x132 | 16-bit RGB565 | Yes |

### SanDisk Targets

| Device | Resolution | Color Depth | Album Art |
|--------|-----------|-------------|-----------|
| Sansa Clip | 128x64 | 1-bit mono (OLED) | No |
| Sansa Clip+ | 128x64 | 1-bit mono (OLED) | No |
| Sansa Clip v2 | 128x64 | 1-bit mono (OLED) | No |
| Sansa Clip Zip | 96x96 | 16-bit RGB565 | Yes |
| Sansa e200 | 176x220 | 16-bit RGB565 | Yes |
| Sansa e200v2 | 176x220 | 16-bit RGB565 | Yes |
| Sansa c200 | 132x80 | 16-bit RGB565 | Yes |
| Sansa Fuze | 220x176 | 16-bit RGB565 | Yes |
| Sansa Fuze v2 | 220x176 | 16-bit RGB565 | Yes |
| Sansa Fuze+ | 240x320 | 16-bit RGB565 | Yes |

### iriver Targets

| Device | Resolution | Color Depth | Album Art |
|--------|-----------|-------------|-----------|
| iriver H100/H115 | 160x128 | 2-bit grayscale | Yes (dithered) |
| iriver H120/H140 | 160x128 | 2-bit grayscale | Yes (dithered) |
| iriver H320/H340 | 220x176 | 16-bit RGB565 | Yes |
| iriver H10 20GB | 160x128 | 16-bit RGB565 | Yes |
| iriver H10 5GB | 128x128 | 16-bit RGB565 | Yes |

### Other Notable Targets

| Device | Resolution | Color Depth | Album Art |
|--------|-----------|-------------|-----------|
| FiiO M3K | 240x320 | 16-bit RGB565 | Yes |
| Shanling Q1 | 360x400 | 16-bit RGB565 | Yes |
| AGPTek Rocker | 128x160 | 32-bit XRGB8888 | Yes |
| AIGO EROS Q/K | 320x240 | 32-bit XRGB8888 | Yes |
| xDuoo X3 | 128x64 | 1-bit mono (OLED) | No |
| xDuoo X3ii | 240x320 | 32-bit XRGB8888 | Yes |
| xDuoo X20 | 240x320 | 32-bit XRGB8888 | Yes |
| Creative Zen X-Fi | 320x240 | 24-bit RGB888 | Yes |
| Sony NW-A20 | 240x320 | 16-bit RGB565 | Yes |
| Sony NWZ-E360 | 240x320 | 16-bit RGB565 | Yes |
| Toshiba Gigabeat F/X | 240x320 | 16-bit RGB565 | Yes |
| Anbernic RG Nano | 240x240 | 16-bit RGB565 | Yes |

### Album Art Color Space Summary

| LCD Depth | Rendering | Artwork Strategy |
|-----------|-----------|------------------|
| 1-bit mono | No album art support | Skip artwork sync |
| 2-bit grayscale (4 levels) | Bayer ordered dithering from color [4] | Sync JPEG; Rockbox dithers automatically. Optionally pre-convert to grayscale. |
| 16-bit color (RGB565) | Native color | Sync JPEG, pre-scale to screen width |
| 24-bit color (RGB888) | Native color | Sync JPEG, pre-scale to screen width |
| 32-bit color (XRGB8888) | Native color | Sync JPEG, pre-scale to screen width |

## Citations

1. [Rockbox source: mkinfo.pl](https://git.rockbox.org/cgit/rockbox.git/tree/tools/mkinfo.pl) — generates rockbox-info.txt with Target, Features, and other build metadata
2. [Rockbox forums](https://forums.rockbox.org/) — multiple threads confirm FAT32 only, no exFAT support
3. [Rockbox wiki: AlbumArt](https://www.rockbox.org/wiki/AlbumArt) — sidecar search order, embedded art support, WPS %Cl tag, format requirements
4. [Rockbox source: bmp.c](https://git.rockbox.org/cgit/rockbox.git/tree/apps/recorder/bmp.c) — Bayer dithering for grayscale, image decoding pipeline, per-depth output
5. [Rockbox source: config headers](https://git.rockbox.org/cgit/rockbox.git/tree/firmware/export/config/) — per-target LCD resolution, color depth, and HAVE_ALBUMART definitions
