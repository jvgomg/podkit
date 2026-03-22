# Apple iPod (Stock Firmware)

```yaml
# ============================================================================
# Device Identity
# ============================================================================
name: "Apple iPod"
manufacturer: "Apple"
product_url: "https://support.apple.com/en-us/111702"
device_family: stock-ipod
connection_method: libgpod

# Documentation metadata
firmware_version: ""              # Multiple generations; see capability matrix below
date_documented: "2026-03-22"

# ============================================================================
# Detection
# ============================================================================
detection:
  usb_vendor_id: "0x05ac"
  usb_product_ids:
    # iPod Video
    - id: "0x1207"
      model: "iPod Video (5th gen)"
    # iPod Classic
    - id: "0x1209"
      model: "iPod Classic (6th gen)"
    - id: "0x120a"
      model: "iPod Classic (7th gen)"
    # iPod Mini
    - id: "0x1202"
      model: "iPod Mini (1st gen)"
    - id: "0x1204"
      model: "iPod Mini (2nd gen)"
    # iPod Nano
    - id: "0x1205"
      model: "iPod Nano (1st gen)"
    - id: "0x1206"
      model: "iPod Nano (2nd gen)"
    - id: "0x1208"
      model: "iPod Nano (3rd gen)"
    - id: "0x120b"
      model: "iPod Nano (4th gen)"
    - id: "0x120c"
      model: "iPod Nano (5th gen)"
    - id: "0x120d"
      model: "iPod Nano (6th gen)"
    - id: "0x120e"
      model: "iPod Nano (7th gen)"
    # iPod Shuffle
    - id: "0x1300"
      model: "iPod Shuffle (1st gen)"
    - id: "0x1301"
      model: "iPod Shuffle (2nd gen)"
    - id: "0x1302"
      model: "iPod Shuffle (3rd gen)"
    - id: "0x1303"
      model: "iPod Shuffle (4th gen)"
    # iPod Touch
    - id: "0x1291"
      model: "iPod Touch (1st gen)"
    - id: "0x1292"
      model: "iPod Touch (2nd gen)"
    - id: "0x1293"
      model: "iPod Touch (3rd gen)"
    - id: "0x129a"
      model: "iPod Touch (4th gen)"
    - id: "0x12a0"
      model: "iPod Touch (5th gen)"
    - id: "0x12ab"
      model: "iPod Touch (6th gen)"
    - id: "0x12a8"
      model: "iPod Touch (7th gen)"
  filesystem_indicators:
    - "iPod_Control/iTunes/iTunesDB"    # Main database file
    - "iPod_Control/Device/SysInfo"     # Model identification
  notes: >
    USB vendor ID 0x05ac (Apple) plus product ID uniquely identifies the iPod
    model and generation. The iPod_Control directory structure on the mounted
    volume confirms it is an iPod with a writable database. Note: if
    .rockbox/ is also present, the device is dual-booting and should be
    treated as a Rockbox device for sync purposes.

# ============================================================================
# Storage
# ============================================================================
storage:
  type: internal
  max_capacity: "160GB"           # iPod Classic 7th gen (largest)
  filesystems:
    supported: [FAT32, HFS+]
    unsupported: []
  notes: >
    libgpod works with both FAT32 and HFS+ formatted iPods. FAT32 is
    required for cross-platform compatibility and for dual-booting with
    Rockbox.

# ============================================================================
# Display & Artwork
# ============================================================================
# Screen and artwork sizes vary by generation:
#
#   iPod Classic (6-7G):    320x240 screen, artwork: 128x128 + 320x320 (JPEG, sparse)
#   iPod Video (5-5.5G):    320x240 screen, artwork: 100x100 + 200x200 (RGB565, non-sparse)
#   iPod Nano 3-5G:         varies, artwork: 128x128 + 320x320 (JPEG, sparse)
#   iPod Nano 1-2G:         176x132 screen, artwork format varies
#   iPod Photo:             220x176 screen, artwork supported
#   iPod 1-4G:              160x128 screen (grayscale on 1-4G), no artwork
#   iPod Shuffle:           no screen
display:
  screen_resolution: "varies"     # See generation table above
  color_depth: "varies"           # 16-bit color (Video/Classic/Nano) or grayscale (1-4G)
  artwork_render_size: "varies"   # See artwork formats below

artwork:
  embedded: false                 # iPod does not read embedded tags; artwork transferred via ArtworkDB
  sidecar: false                  # Artwork is stored in proprietary ArtworkDB + .ithmb files
  sidecar_filenames: []
  formats: ["JPEG", "RGB565"]    # Input: JPEG/PNG (libgpod converts). Storage: JPEG (sparse) or RGB565 (non-sparse)
  max_resolution: "320x320"       # Largest format on Classic/Nano 3+
  notes: >
    Artwork is NOT read from audio files or the filesystem. It must be
    transferred via the proprietary ArtworkDB and stored in .ithmb files under
    iPod_Control/Artwork/. libgpod handles conversion from JPEG/PNG input to
    device-specific formats.

    iPod Video (5G/5.5G) uses non-sparse RGB565 format (100x100 + 200x200,
    per-track copies). Classic and Nano 3G+ use sparse JPEG format (128x128 +
    320x320, deduplicated). .ithmb files are capped at 256MB per format.

    podkit uses SHA-256 truncated to 32-bit hash for change detection, stored
    in sync tags.

# ============================================================================
# Audio Format Support
# ============================================================================
audio_formats:
  lossy:
    - codec: "AAC"
      extensions: [".m4a", ".mp4"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: "Primary format. podkit transcodes to AAC by default."
    - codec: "MP3"
      extensions: [".mp3"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: ""
  lossless:
    - codec: "ALAC"
      extensions: [".m4a"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: >
        Generation-specific. Supported on: Video (5G/5.5G), Classic (all),
        Nano (3G-5G). Not supported on: 1G-4G, Photo, Mini, Nano 1G-2G,
        Shuffle, Touch.
    - codec: "WAV"
      extensions: [".wav"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: ""
  unsupported_common_formats:
    - "FLAC — must transcode to ALAC or AAC"
    - "OGG Vorbis — must transcode to AAC"
    - "Opus — must transcode to AAC"
    - "WMA — must transcode to AAC"

# ============================================================================
# Metadata
# ============================================================================
metadata:
  tag_formats: []                 # Not tag-based; metadata stored in iTunesDB
  browsing_mode: "database"       # iPod uses proprietary iTunesDB, not file tags
  notes: >
    The iPod does not read metadata from audio files. All track metadata is
    stored in the binary iTunesDB database under iPod_Control/iTunes/. libgpod
    reads and writes this database. Supported fields include: title, artist,
    album, album artist, genre, composer, comment, grouping, track/disc
    numbers, year, BPM, compilation flag, and media type.

    Sound Check (volume normalization) is supported on all generations.
    podkit converts ReplayGain values to Sound Check format.

# ============================================================================
# Playlists
# ============================================================================
playlists:
  supported_formats: ["iTunesDB"]  # Proprietary binary format
  path_style: ""                   # Not applicable — playlists reference track IDs
  location: "iPod_Control/iTunes/iTunesDB"
  notes: >
    Playlists are stored in the iTunesDB binary database, not as standalone
    files. Types: master playlist (all tracks, immutable), user-created
    playlists, smart playlists (rules-based with match operators, field
    filters, limits, and sort options), and podcast playlists.

# ============================================================================
# Features
# ============================================================================
features:
  ratings: true                   # 0-100 scale (20 = 1 star, 40 = 2 stars, etc.)
  play_counts: true               # play count, skip count, last played timestamp
  scrobbling: false               # No native scrobbling; stats stored in iTunesDB
  lyrics: false                   # TODO: verify lyrics support via iTunesDB
  replaygain: true                # Via Sound Check conversion (ReplayGain → soundcheck uint32)
  gapless_playback: false         # iTunes stores gapless atoms; libgpod does not replicate this
  video: true                     # H.264 Baseline/Main profile. See generation matrix.
  podcasts: true                  # Dedicated media type flag (0x0004), chapter markers
  audiobooks: true                # Dedicated media type flag (0x0008), chapter markers
  photos: true                    # Separate PhotoDB, photo albums, slideshow settings
  contacts: false                 # Not managed by podkit
  notes: false                    # Not managed by podkit
  calendar: false                 # Not managed by podkit
  custom_themes: false
  eq: false                       # iPod has built-in EQ but not configurable via sync
  usb_dac: false

# ============================================================================
# Links
# ============================================================================
links:
  - label: "iPod models (Apple Support)"
    url: "https://support.apple.com/en-us/111702"
  - label: "libgpod"
    url: "http://gtkpod.sourceforge.net/wiki/Home"
  - label: "iTunesDB format (archived)"
    url: "https://web.archive.org/web/2023/http://www.ipodlinux.org/ITunesDB/"
```

## Sync Mechanism

The iPod uses a proprietary binary database (iTunesDB) stored at
`iPod_Control/iTunes/iTunesDB`. Music files are stored in hash-distributed
directories under `iPod_Control/Music/F00` through `iPod_Control/Music/F49`
with randomized filenames (e.g., `libgpod123456.m4a`).

podkit uses libgpod (via N-API bindings) to read and write the iTunesDB. The
sync flow is:

1. Open iPod database (reads iTunesDB)
2. Diff collection tracks against device tracks
3. Plan operations (add, remove, update, transcode)
4. Execute operations (copy/transcode files, update database entries)
5. Save database (writes iTunesDB)

Artwork is stored separately in `iPod_Control/Artwork/` using `.ithmb` files
with a companion ArtworkDB.

### Directory Structure

```
iPod_Control/
├── Device/
│   ├── SysInfo              # Model identification
│   └── SysInfoExtended      # Capabilities (iTunes-created)
├── iTunes/
│   ├── iTunesDB             # Main binary database
│   ├── iTunesPrefs          # Device preferences
│   └── iTunesShuffle        # Shuffle state
├── Music/
│   └── F00-F49/             # 50 hash-distributed music directories
└── Artwork/
    └── F{format}_{n}.ithmb  # Artwork data files
```

## Generation Capability Matrix

| Generation | Music | ALAC | Artwork | Video | Video Profile | Screen |
|------------|-------|------|---------|-------|---------------|--------|
| 1st-4th Gen | Yes | No | No | No | — | 160x128 mono |
| Photo | Yes | No | Yes | No | — | 220x176 |
| Mini 1-2G | Yes | No | No | No | — | 138x110 mono |
| Shuffle 1-2G | Yes | No | No | No | — | None |
| Nano 1-2G | Yes | No | Yes | No | — | 176x132 |
| Nano 3-5G | Yes | Yes | Yes | Yes | ipod-nano-3g | Varies |
| Video 5G | Yes | Yes | Yes | Yes | ipod-video-5g | 320x240 |
| Video 5.5G | Yes | Yes | Yes | Yes | ipod-video-5g | 320x240 |
| Classic 6G | Yes | Yes | Yes | Yes | ipod-classic | 320x240 |
| Classic 6.5G | Yes | Yes | Yes | Yes | ipod-classic | 320x240 |
| Classic 7G | Yes | Yes | Yes | Yes | ipod-classic | 320x240 |

### Unsupported Generations

| Generation | Reason |
|------------|--------|
| Shuffle 3-4G | Buttonless; requires iTunes authentication hash |
| Nano 6-7G | Different database format (touch screen models) |
| Touch (all) | iOS protocol + cryptographic iTunesDB signing |
| iPhone (all) | iOS protocol + cryptographic iTunesDB signing |
| iPad | iOS protocol + cryptographic iTunesDB signing |

## Video Profiles

| Profile | Resolution | H.264 Profile | Max Video Bitrate | Max Audio | FPS | Devices |
|---------|-----------|---------------|-------------------|-----------|-----|---------|
| ipod-video-5g | 320x240 | Baseline | 768 kbps | 128 kbps | 30 | Video 5G/5.5G, Nano 3-5G |
| ipod-classic | 640x480 | Main | 2500 kbps | 160 kbps | 30 | Classic 6G/6.5G/7G |

## Quirks & Limitations

- **No file tag reading** — the iPod ignores audio file metadata entirely. All
  metadata must be written to the iTunesDB via libgpod.
- **ALAC is generation-specific** — only Video, Classic, and Nano 3-5G support
  ALAC. Other generations require AAC.
- **Artwork is proprietary** — embedded artwork in files is ignored. Must be
  transferred through ArtworkDB/.ithmb pipeline.
- **File naming** — files stored with randomized names in F00-F49 directories.
  Original filenames are not preserved.
- **Gapless playback** — requires specific MP4 metadata atoms that libgpod does
  not write. iTunes handles this natively.
- **H.264 High profile** — not supported on any iPod generation. Must use
  Baseline or Main profile.
- **SysInfoExtended** — capabilities file created by iTunes. May not exist if
  the iPod was never synced with iTunes. libgpod can work without it but some
  features may be limited.

## Research Notes

- **Contacts, Notes, Calendar** — iPods support these via vCard, plain text, and
  iCal files placed in specific directories. Not currently managed by podkit but
  could be added as content types.
- **Lyrics** — iTunesDB may support lyrics storage; needs investigation of
  libgpod capabilities.
- **Gapless metadata** — could potentially be implemented by writing the correct
  MP4 atoms during transcode, but this is not currently done.
- **Photo syncing** — PhotoDB infrastructure exists in libgpod-node bindings but
  is not integrated into the sync pipeline.

## Implementation Notes

Fully implemented in podkit. Key implementation files:

- **Device management:** `packages/podkit-core/src/device/`
- **iPod database:** `packages/podkit-core/src/ipod/`
- **libgpod bindings:** `packages/libgpod-node/`
- **Music handler:** `packages/podkit-core/src/sync/handlers/music-handler.ts`
- **Video handler:** `packages/podkit-core/src/sync/handlers/video-handler.ts`
- **Generation metadata:** `packages/podkit-core/src/ipod/generation.ts`
- **Model identification:** `packages/podkit-core/src/device/ipod-models.ts`
