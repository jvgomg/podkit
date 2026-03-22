# Snowsky Echo Mini

```yaml
# ============================================================================
# Device Identity
# ============================================================================
name: "Snowsky Echo Mini"
manufacturer: "FiiO / Snowsky"
product_url: "https://www.fiio.com/echomini"
device_family: mass-storage-dap
connection_method: usb-mass-storage

# Documentation metadata
firmware_version: "3.1.0"        # Latest known firmware at time of documentation
date_documented: "2026-03-22"

# ============================================================================
# Detection
# ============================================================================
detection:
  usb_vendor_id: "0x0b98"         # FiiO Electronics Technology (decimal 2972)
  usb_product_ids:
    - id: ""                      # TODO: connect device and check with system_profiler SPUSBDataType
      model: "Echo Mini"
  filesystem_indicators: []       # No known unique files; generic mass storage volume
  notes: >
    No known filesystem markers to distinguish from other FiiO devices.
    USB product ID (once captured) may be the primary detection method.
    The firmware update file pattern (HIFIEC*.img) in the root directory
    could be a secondary indicator.

# ============================================================================
# Storage
# ============================================================================
storage:
  type: microsd
  max_capacity: "256GB"
  filesystems:
    supported: [FAT32, exFAT]     # Inferred — NTFS explicitly unsupported
    unsupported: [NTFS]

# ============================================================================
# Display & Artwork
# ============================================================================
display:
  screen_resolution: "170x320"
  color_depth: "16-bit color"     # IPS LCD
  artwork_render_size: "~170x170" # Likely limited by 170px screen width; exact size unconfirmed

artwork:
  embedded: true                  # Reads embedded JPG artwork from audio file tags
  sidecar: false                  # No evidence of folder.jpg or cover.jpg support
  sidecar_filenames: []
  formats: ["JPEG"]               # Only JPEG confirmed; PNG not supported for artwork
  max_resolution: "1000x1000"     # FiiO rep confirmed 1000x1000 limit; 600x600 recommended
  notes: >
    Album art display was added in firmware 1.4.0 [1]. Must be enabled in
    Music Settings. Only embedded JPEG artwork is supported — no sidecar files
    (folder.jpg, cover.jpg) [7]. OGG Vorbis files have reported issues with
    cover art not displaying [6]. FW 3.1.0 introduced a regression where MP3
    album art stopped displaying while FLAC artwork continued working [6].

    Recommended embedded artwork size: 600x600 for fast loading [4]. 300x300
    loads instantly [4]. FiiO rep confirmed limit of 1000x1000 [4]. Larger
    sizes cause slow loading (3000x3000 works but is sluggish) [4]. The
    deezer2EchoMini tool converts to 750x750 baseline JPEG [7].

# ============================================================================
# Audio Format Support
# ============================================================================
audio_formats:
  lossy:
    - codec: "MP3"
      extensions: [".mp3"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: ""
    - codec: "OGG Vorbis"
      extensions: [".ogg"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: ""
    - codec: "AAC"
      extensions: [".m4a"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: ""
    - codec: "WMA"
      extensions: [".wma"]
      max_sample_rate: ""
      max_bit_depth: ""
      notes: ""
  lossless:
    - codec: "FLAC"
      extensions: [".flac"]
      max_sample_rate: "192kHz"
      max_bit_depth: "24-bit"
      notes: ""
    - codec: "WAV"
      extensions: [".wav"]
      max_sample_rate: "192kHz"
      max_bit_depth: "24-bit"
      notes: ""
    - codec: "APE"
      extensions: [".ape"]
      max_sample_rate: "192kHz"
      max_bit_depth: "24-bit"
      notes: ""
    - codec: "DSD"
      extensions: [".dsf", ".dff"]
      max_sample_rate: "DSD256"
      max_bit_depth: ""
      notes: "DSD64, DSD128, DSD256 supported"
  unsupported_common_formats:
    - "SACD"
    - "DTS"
    - "ALAC — not officially listed [2]; conflicting user reports: some success with Bandcamp files [4], others get 'File Format Error' [4]"

# ============================================================================
# Metadata
# ============================================================================
metadata:
  tag_formats: ["ID3v2", "Vorbis Comments"]  # FLAC uses Vorbis Comments; APEv2 unconfirmed
  browsing_mode: "both"           # Database (scans and indexes tags) + folder browsing
  notes: >
    The device reads ID3 metadata from audio files to build its media library.
    FAQ mentions that incorrect ID3 formatting can cause display issues,
    resolved by switching system language and updating media library. This
    suggests a database-style indexer rather than pure folder browsing.

# ============================================================================
# Playlists
# ============================================================================
playlists:
  supported_formats: []           # No M3U or standard playlist support
  path_style: ""
  location: ""
  notes: >
    No standard playlist support (M3U, M3U8, PLS) [4][5]. Users have requested
    this feature on Head-Fi [4]. The only playlist-like feature is a Favorites
    list (add/remove via long-press menu button, added in FW 3.0.0 [8]) which
    cannot be exported or backed up. Music organization relies on folder
    structure.

# ============================================================================
# Features
# ============================================================================
features:
  ratings: false                  # Not supported
  play_counts: false              # Not supported
  scrobbling: false
  lyrics: true                    # External .lrc files since FW 2.8.0 [3][9] (same name as audio file)
  replaygain: false               # Not supported; users requested on Head-Fi [4], no response from FiiO
  gapless_playback: false         # Not supported; hardware/RTOS limitation [5], cannot be added via FW
  video: false
  podcasts: false
  audiobooks: false
  photos: false
  contacts: false
  notes: false
  calendar: false
  custom_themes: true             # Custom themes supported
  eq: true                       # Built-in EQ, supports sources up to 192k/16bit
  usb_dac: true                  # Functions as USB DAC when connected to computer

# ============================================================================
# Links
# ============================================================================
links:
  - label: "Product page"
    url: "https://www.fiio.com/echomini"
  - label: "Specifications"
    url: "https://www.fiio.com/echomini_parameters"
  - label: "FAQ"
    url: "https://www.fiio.com/echomini_faq"
  - label: "Head-Fi discussion thread"
    url: "https://www.head-fi.org/threads/fiio%E2%80%99s-innovative-sub-brand-snowsky-pure-music-player-echo-mini-is-officially-released.975162/"
  - label: "HiFi Oasis review"
    url: "https://www.hifioasis.com/reviews/snowsky-echo-mini-review/"
  - label: "deezer2EchoMini tool (community)"
    url: "https://github.com/Alexeido/deezer2EchoMini"
```

## Sync Mechanism

USB mass storage. Connect via USB-C and the microSD card appears as a mounted
volume. Drag and drop files — no proprietary database or software required.

The device scans audio files and builds an internal media library from their
tags. File and folder organization is up to the user. The device supports both
tag-based browsing (database) and folder-based browsing.

### Firmware Updates

Firmware is updated by placing a `HIFIECxxx.img` file in the root directory of
the SD card, then restarting the device. The SD card must be removed from the
device before updating. This means podkit should avoid placing files named
`HIFIEC*.img` in the root directory.

## Quirks & Limitations

- **NTFS not supported** — microSD must be formatted as FAT32 or exFAT.
- **Encrypted FLAC files** — FLAC files from streaming platforms (with DRM) will
  not play. Must be converted to standard FLAC format (e.g., via Foobar2000).
- **ID3 encoding issues** — incorrect ID3 tag encoding can cause garbled text.
  The FAQ suggests switching system language to resolve display issues.
- **Bluetooth limited to SBC** — only SBC codec supported over Bluetooth. Apple
  Bluetooth headphones not supported (no AAC BT codec).
- **EQ limitation** — equalizer only supports sources up to 192kHz/16-bit.
- **Single-thread Bluetooth** — must delete pairing records before re-pairing
  with a new device.
- **No inline remote** — wired remote control not supported (hardware limitation).
- **No gapless playback** — hardware/RTOS limitation that cannot be fixed via
  firmware [5]. Users report the first ~0.5 seconds of each track is cut off [4].
- **OGG artwork issues** — OGG Vorbis files may not display cover art even with
  embedded artwork [6].
- **FW 3.1.0 MP3 artwork regression** — MP3 album art stopped displaying while
  FLAC artwork continued working [6]. May be fixed in later firmware.

## Research Notes

- **USB product ID** — vendor ID is 0x0b98 (FiiO) [10]. Product ID needs to be
  captured by connecting the device and running `system_profiler SPUSBDataType`
  (macOS) or `lsusb` (Linux).
- **Exact artwork render size** — likely ~170x170 based on screen width [2], but
  exact pixel dimensions unconfirmed. Check on device.
- **ALAC support** — not officially listed [2] but conflicting user reports [4].
  Some success with Bandcamp ALAC files, others get "File Format Error". Test
  with known ALAC files to confirm.
- **Folder structure** — does the device care about folder depth or character
  limitations beyond FAT32/exFAT constraints?
- **Format support page** — the device has a "System Settings > Music Support
  list" that shows compatible formats. Worth photographing for reference.
- **APEv2 tag support** — FLAC uses Vorbis Comments (confirmed working), MP3
  uses ID3v2, but APE tag reading is unconfirmed.

### Confirmed (via community research)

- No M3U/M3U8 playlist support [4][5]
- No ReplayGain support [4]
- No gapless playback (hardware limitation) [5]
- No sidecar artwork (embedded JPEG only) [7]
- No ratings or play count tracking
- LRC lyrics supported since FW 2.8.0 [3][9]
- Artwork max 1000x1000 [4], recommended 600x600 [4]
- USB vendor ID: 0x0b98 (FiiO Electronics Technology) [10]

## Implementation Notes

_Not yet implemented. Target: mass-storage ContentTypeHandler._

Key considerations for implementation:

- **No database** — unlike iPod, files can be copied directly with meaningful
  names and folder structure. podkit will need a new handler that doesn't depend
  on libgpod.
- **Minimal transcoding** — the device supports FLAC, MP3, AAC, OGG, WAV, APE,
  WMA natively. Transcoding only needed for Opus and possibly ALAC. Since
  there's no gapless playback, lossless-to-lossy transcoding has fewer
  downsides than on Rockbox.
- **Metadata from tags** — the device reads metadata directly from file tags, so
  podkit needs to ensure tags are correct rather than writing to a database.
- **Artwork strategy** — embed JPEG artwork in audio file tags. No sidecar
  support. Resize to 600x600 for optimal loading speed (max 1000x1000).
- **No playlists** — folder structure is the only organizational tool. podkit
  should create a clean Artist/Album/Track hierarchy.
- **LRC lyrics** — podkit could optionally sync .lrc files alongside audio files
  (same filename, same directory).

## Citations

1. [FiiO Echo Mini FAQ](https://www.fiio.com/echomini_faq) — official FAQ covering firmware updates, format support, album art enablement
2. [FiiO Echo Mini Specifications](https://www.fiio.com/echomini_parameters) — official specs: screen resolution, audio formats, storage, DAC
3. [FiiO Echo Mini Product Page](https://www.fiio.com/echomini) — official product page mentioning LRC lyrics and embedded JPG cover support
4. [Head-Fi Discussion Thread](https://www.head-fi.org/threads/fiio%E2%80%99s-innovative-sub-brand-snowsky-pure-music-player-echo-mini-is-officially-released.975162/) — main community thread; artwork size limits (FiiO rep "FiiO Kang" confirmed 1000x1000), ALAC reports, ReplayGain requests, gapless complaints, playlist requests
5. [HiFi Oasis Review](https://www.hifioasis.com/reviews/snowsky-echo-mini-review/) — review confirming no gapless playback, no playlist support
6. [HiFi Hub: FW 3.1 Issues](https://www.hifihub.com.br/en/firmware-driver-and-app-updates/fiio-snowsky-echo-mini-firmware-3-1-causes-issues) — FW 3.1.0 MP3 artwork regression, OGG artwork issues
7. [deezer2EchoMini (GitHub)](https://github.com/Alexeido/deezer2EchoMini) — community tool that embeds artwork (750x750 baseline JPEG), confirming embedded-only artwork
8. [Thodia: Echo Mini FW 3.0.0](https://www.thodia.media/echo-mini-gets-new-v3-0-0-firmware-update/) — FW 3.0.0 changelog covering Favorites feature
9. [FW 2.8.0 Changelog](https://x.com/tamilhollywood2/status/1996222684792008742) — FW 2.8.0 adding lyrics display switch
10. [USB ID Repository: FiiO (VID 2972)](https://usb-ids.gowdy.us/read/UD/2972) — FiiO USB vendor ID registration
