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
firmware_version: "3.2.0"        # Confirmed on test device [firsthand]
hardware_version: "1.2.0"        # Confirmed on test device [firsthand]
date_documented: "2026-03-24"    # Updated with firsthand testing results

# ============================================================================
# Detection
# ============================================================================
detection:
  usb_vendor_id: "0x071b"         # Confirmed via system_profiler [firsthand]
  usb_product_ids:
    - id: "0x3203"                # Confirmed via system_profiler [firsthand]
      model: "Echo Mini"
  usb_manufacturer_string: "ECHO MINI"  # Confirmed [firsthand]
  usb_serial: "USBV1.00"               # Confirmed [firsthand]
  usb_speed: "480 Mb/s"                 # USB 2.0 High Speed [firsthand]
  current_required_ma: 400              # [firsthand]
  filesystem_indicators: []       # No known unique files; generic mass storage volume
  dual_lun: true                        # Device presents two volumes [firsthand]
  lun_0:
    media_name: "MINI"                   # Internal storage [firsthand]
    default_volume_label: "ECHO MINI"    # [firsthand]
    filesystem: "FAT32"                  # [firsthand]
    capacity: "7.5GB"                    # [firsthand]
  lun_1:
    media_name: "MINI   SD"             # SD card — note "SD" suffix [firsthand]
    default_volume_label: ""              # User-configurable; "Echo SD" on test device [firsthand]
    filesystem: "exFAT"                  # On test device [firsthand]
    capacity: "varies"                   # Depends on inserted SD card
  notes: >
    USB vendor ID is 0x071b (NOT 0x0b98 as previously assumed from FiiO's
    registered VID — the Echo Mini uses a different vendor ID) [firsthand].
    USB product ID is 0x3203 [firsthand]. The manufacturer string "ECHO MINI"
    is a reliable detection signal.

    **Dual-volume detection:** The device always presents two USB LUNs
    (internal + SD card) [firsthand]. podkit must let the user configure which
    volume to sync to. The most reliable way to distinguish them:
    - Media name: "MINI" (internal) vs "MINI   SD" (external) — the "SD"
      suffix in the media name is the clearest programmatic signal
    - LUN number: 0 = internal, 1 = SD card
    - Volume labels ("ECHO MINI" / "Echo SD") are defaults but could be
      changed by the user, so not fully reliable for detection
    - Capacity: internal is always ~7.5GB; SD card is typically larger
    Both volumes mount simultaneously. Most users will want to sync to
    the SD card (larger capacity).

    The firmware update file pattern (HIFIEC*.img) in the root directory
    could be a secondary indicator.

# ============================================================================
# Storage
# ============================================================================
storage:
  internal:
    capacity: "7.53GB"            # Confirmed [firsthand]
    filesystem: "FAT32"           # Confirmed via system_profiler [firsthand]
    partition_map: "MBR"          # [firsthand]
    volume_label: "ECHO MINI"    # [firsthand]
  external:
    type: microsd
    max_capacity: "256GB"
    volume_label: "Echo SD"       # Default label [firsthand]
    partition_map: "MBR"          # [firsthand]
  filesystems:
    supported: [FAT32, exFAT]     # Both confirmed working [firsthand]
    unsupported: [NTFS]

# ============================================================================
# Display & Artwork
# ============================================================================
display:
  screen_resolution: "170x320"
  color_depth: "16-bit color"     # IPS LCD
  artwork_render_size: "~136x127" # Community-reported [unconfirmed]; non-square due to UI chrome

artwork:
  embedded: true                  # Reads embedded JPG artwork from audio file tags [firsthand-confirmed]
  sidecar: false                  # Confirmed: cover.jpg, folder.jpg, albumart.jpg all ignored [firsthand]
  sidecar_filenames: []
  formats: ["JPEG (baseline only, 4:2:0 chroma)"]  # Progressive JPEG does NOT display [firsthand]; 4:4:4 chroma subsampling does NOT display [firsthand]
  max_resolution: "no hard limit" # 3000x3000 works but slow; 1000x1000 recommended [firsthand]
  notes: >
    Album art display was added in firmware 1.4.0 [1]. Must be enabled in
    Music Settings. Only embedded baseline JPEG artwork is supported.
    **Progressive JPEG does not display at all** — confirmed with test files
    and with real music library (albums with progressive JPEGs showed no
    artwork while baseline JPEGs in the same library displayed fine)
    [firsthand]. **JPEG with 4:4:4 chroma subsampling (yuvj444p) also does
    not display** — only 4:2:0 (yuvj420p) is supported. Source images with
    4:4:4 chroma must be converted during sync [firsthand]. No sidecar file support — tested cover.jpg, folder.jpg,
    and albumart.jpg, all ignored [firsthand]. OGG Vorbis files have
    reported issues with cover art not displaying [6]. FW 3.1.0 introduced
    a regression where MP3 album art stopped displaying while FLAC artwork
    continued working [6].

    **Artwork loading speed is determined by file size in bytes, not pixel
    dimensions** [firsthand]:
    - 88KB (600x600): instant
    - 331KB (3000x3000, low quality): ~2 seconds
    - 4,208KB (1425x1425, high quality): ~4 seconds
    Artwork above ~3000x3000 may cause rendering artifacts (red line on
    top/left edge observed) [firsthand].

    FiiO rep recommended max 1000x1000 [4]. 600x600 is the optimal size
    for instant loading [4][firsthand]. The deezer2EchoMini tool converts
    to 750x750 baseline JPEG, quality 90 [7][11].

# ============================================================================
# Audio Format Support
# ============================================================================
audio_formats:
  podkit_supported:
    lossy:
      - codec: "MP3"
        extensions: [".mp3"]
        max_sample_rate: ""
        max_bit_depth: ""
        notes: ""
      - codec: "AAC"
        extensions: [".m4a"]
        max_sample_rate: ""
        max_bit_depth: ""
        notes: ""
      - codec: "OGG Vorbis"
        extensions: [".ogg"]
        max_sample_rate: ""
        max_bit_depth: ""
        notes: ""
    lossless:
      - codec: "FLAC"
        extensions: [".flac"]
        max_sample_rate: "192kHz"
        max_bit_depth: "24-bit"
        notes: ""
      - codec: "ALAC"
        extensions: [".m4a"]
        max_sample_rate: ""
        max_bit_depth: ""
        notes: "Confirmed playable via folder browser and library [firsthand]. Not officially listed [2]."
      - codec: "WAV"
        extensions: [".wav"]
        max_sample_rate: "192kHz"
        max_bit_depth: "24-bit"
        notes: "Playable via folder browser but NOT indexed by library scanner [firsthand]"
    notes: >
      podkit declares support for: AAC, ALAC, MP3, FLAC, OGG, WAV.
      These are the codecs podkit will actively use for sync operations.
  device_supports:
    lossy:
      - codec: "MP3"
      - codec: "OGG Vorbis"
      - codec: "AAC"
      - codec: "WMA"
    lossless:
      - codec: "FLAC"
      - codec: "ALAC"
      - codec: "WAV"
      - codec: "APE"
      - codec: "DSD (DSD64, DSD128, DSD256)"
    notes: >
      The device supports additional codecs beyond what podkit actively uses.
      WMA, APE, and DSD can be played on the device but are not in podkit's
      default codec preference stack. Users can configure custom codec
      preferences to enable these if desired.
  unsupported_common_formats:
    - "Opus — files with .opus extension are hidden from both library and folder browser [firsthand]"
    - "SACD"
    - "DTS"

# ============================================================================
# Metadata
# ============================================================================
metadata:
  tag_formats: ["ID3v2.3", "ID3v2.4", "Vorbis Comments"]  # ID3v2.3 and v2.4 both work for MP3 [firsthand]; FLAC must use Vorbis Comments [firsthand]; APEv2 unconfirmed
  browsing_mode: "both"           # Database (scans and indexes tags) + folder browsing
  display_source: "filename"      # Library shows FILENAMES, not title tags [firsthand]
  library_scan: "automatic"       # Triggers on device boot / storage mount [firsthand]
  notes: >
    **Critical: the library browser displays filenames, not the TITLE tag**
    [firsthand][11]. This means podkit must generate meaningful filenames
    like "{track} - {title}.{ext}" for tracks to be identifiable in the
    library. Confirmed by testing: a file named "filename_mismatch.flac"
    with TITLE="TITLE TAG Says Hello" displayed as "filename_mismatch".
    Files with no TITLE tag display the filename as expected.

    The device scans and indexes audio files into a library database
    automatically when storage is mounted [firsthand]. The library scan
    also triggers on device boot. The ntr0n echo-mini-file-processor [11]
    documents this and provides workarounds.

    **Compound track numbers break ordering** — TRACKNUMBER values like
    "3/10" are not parsed correctly [11]. Use clean integer values only.

    **Disc number sorting is inverted** — the device sorts by track number
    first, disc number second. A multi-disc album with d1t1, d1t2, d2t1,
    d2t2 displays as d1t1, d2t1, d1t2, d2t2 [firsthand]. Workaround:
    append "(disc N)" to the album name to split into separate albums [11].

    FAQ mentions that incorrect ID3 formatting can cause display issues,
    resolved by switching system language and updating media library.

    **ID3 tags in FLAC containers are ignored** — confirmed that a FLAC
    file with ID3v2 prepended (and no Vorbis Comments) shows as "Unknown"
    in the library [firsthand]. FLAC files must use Vorbis Comments.

    **ID3v2.3 and ID3v2.4 both work** for MP3 files — no compatibility
    difference observed [firsthand].

    **Unicode support:** accented Latin (Café, Björk), Japanese (日本語),
    and Korean (한국어) all display correctly in both filenames and tags.
    Emoji characters display as blank spaces [firsthand].

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
  - label: "echo-mini-file-processor (community)"
    url: "https://github.com/ntr0n/echo-mini-file-processor"
```

## Sync Mechanism

USB mass storage. Connect via USB-C and two volumes mount: internal storage
("ECHO MINI", ~7.5GB FAT32) and the microSD card ("Echo SD", exFAT)
[firsthand]. Drag and drop files — no proprietary database or software required.

The device scans audio files and builds an internal media library automatically
when storage is mounted or on boot [firsthand]. File and folder organization is
up to the user. The device supports both tag-based browsing (database) and
folder-based browsing. A `Music/Artist/Album/` hierarchy works well [firsthand].

Note: macOS creates `._` resource fork files on FAT32/exFAT volumes. These are
harmless but visible in the device's folder browser.

### Firmware Updates

Firmware is updated by placing a `HIFIECxxx.img` file in the root directory of
the SD card, then restarting the device. The SD card must be removed from the
device before updating. This means podkit should avoid placing files named
`HIFIEC*.img` in the root directory.

## Quirks & Limitations

- **Library shows filenames, not title tags** — the database browser displays
  the filename (minus extension) as the track name, ignoring the TITLE tag
  entirely. podkit must use meaningful filenames [firsthand][11].
- **Progressive JPEG artwork not displayed** — only baseline JPEG works for
  embedded artwork. Progressive JPEGs are silently ignored [firsthand].
- **Artwork loading speed depends on byte size** — large JPEG files (>300KB)
  cause visible loading delays regardless of pixel dimensions [firsthand].
  Artwork above ~3000x3000 may cause rendering artifacts [firsthand].
- **Compound track numbers break** — TRACKNUMBER="3/10" is not parsed correctly;
  use clean integers [11].
- **Disc number sorting inverted** — sorts by track number first, disc second.
  Multi-disc albums display interleaved [firsthand][11].
- **WAV not indexed by library** — playable via folder browser only [firsthand].
- **Opus files hidden** — .opus files do not appear in library or folder browser
  [firsthand].
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

### Remaining unknowns

- **Exact artwork render size** — community report of 136x127 [unconfirmed].
  Screen width is 170px so render area is constrained by that.
- **Format support page** — the device has a "System Settings > Music Support
  list" that shows compatible formats. Worth photographing for reference.
- **APEv2 tag support** — FLAC uses Vorbis Comments (confirmed working), MP3
  uses ID3v2, but APE tag reading is unconfirmed.
- **PNG embedded artwork** — untested; likely unsupported given JPEG-only
  behavior.

### Confirmed (firsthand testing, 2026-03-24)

- USB vendor ID: 0x071b, product ID: 0x3203, manufacturer string: "ECHO MINI"
- Two USB LUNs: internal storage (FAT32, "ECHO MINI") + SD card (exFAT, "Echo SD")
- Library displays filenames, not TITLE tags
- Progressive JPEG artwork does not display; baseline JPEG works
- No sidecar artwork (tested cover.jpg, folder.jpg, albumart.jpg — all ignored)
- Artwork loading speed correlates with byte size, not pixel dimensions
- 3000x3000 artwork causes rendering artifact (red line on top/left edge)
- Compound TRACKNUMBER values (e.g. "3/10") not parsed correctly
- Disc number used as secondary sort (after track number) — wrong order
- ALAC (.m4a) plays successfully in both library and folder browser
- WAV plays via folder browser but is not indexed by library scanner
- Opus (.opus) files completely hidden from device (library and folder browser)
- OGG Vorbis indexed and playable
- Library scan triggers automatically on storage mount / boot
- Folder structure Music/Artist/Album/Track works fine
- ID3 tags in FLAC containers are ignored — only Vorbis Comments work
- ID3v2.3 and ID3v2.4 both work for MP3
- Unicode: accented Latin, Japanese, Korean all display correctly; emoji shows as blank
- Firmware 3.2.0 / Hardware 1.2.0 on test device

### Confirmed (via community research)

- No M3U/M3U8 playlist support [4][5]
- No ReplayGain support [4]
- No gapless playback (hardware limitation) [5]
- No ratings or play count tracking
- LRC lyrics supported since FW 2.8.0 [3][9]
- FiiO rep recommended artwork max 1000x1000, optimal 600x600 [4]

## Implementation Notes

_Not yet implemented. Target: mass-storage ContentTypeHandler (MassStorageAdapter)._

Key considerations for implementation:

- **No database** — unlike iPod, files can be copied directly with meaningful
  names and folder structure. podkit will need a new handler that doesn't depend
  on libgpod.
- **Meaningful filenames required** — the library displays filenames, not title
  tags. Use `{track:02d} - {title}.{ext}` format. Sanitize filenames for
  FAT32/exFAT compatibility (no `:`, `?`, `"`, `*`, `<`, `>`, `|`, `/`, `\`).
- **Minimal transcoding** — the device supports FLAC, MP3, AAC, OGG, WAV, APE,
  WMA, and ALAC natively. Transcoding only needed for Opus. Since there's no
  gapless playback, lossless-to-lossy transcoding has fewer downsides than on
  Rockbox.
- **Metadata from tags** — the device reads Vorbis Comments (FLAC) and ID3v2
  (MP3) directly from file tags. Ensure tags are correct and use clean integer
  TRACKNUMBER values (no compound "N/M" format).
- **Multi-disc workaround** — append "(disc N)" to album name in tags when
  disc count > 1, to avoid the inverted sort order bug.
- **Artwork strategy** — embed **baseline JPEG** artwork in audio file tags
  (progressive JPEG will not display). Resize to 600x600 at quality 85-90
  for instant loading (~50-100KB). If source artwork is progressive, convert
  to baseline during sync. No sidecar support.
- **Folder structure** — `Music/Artist/Album/{track} - {title}.{ext}`. The
  device handles nested folders fine.
- **No playlists** — folder structure is the only organizational tool.
- **LRC lyrics** — podkit could optionally sync .lrc files alongside audio files
  (same filename, same directory).
- **Detection** — match USB vendor ID 0x071b + product ID 0x3203, or
  manufacturer string "ECHO MINI".
- **Dual-volume handling** — the device always mounts two volumes (internal
  + SD card). podkit config must let the user specify which to target.
  Distinguish by media name ("MINI" vs "MINI   SD"), LUN number (0 vs 1),
  or capacity. Default to the SD card (LUN 1) since it's larger.

## Citations

1. [FiiO Echo Mini FAQ](https://www.fiio.com/echomini_faq) — official FAQ covering firmware updates, format support, album art enablement
2. [FiiO Echo Mini Specifications](https://www.fiio.com/echomini_parameters) — official specs: screen resolution, audio formats, storage, DAC
3. [FiiO Echo Mini Product Page](https://www.fiio.com/echomini) — official product page mentioning LRC lyrics and embedded JPG cover support
4. [Head-Fi Discussion Thread](https://www.head-fi.org/threads/fiio%E2%80%99s-innovative-sub-brand-snowsky-pure-music-player-echo-mini-is-officially-released.975162/) — main community thread; artwork size limits (FiiO rep "FiiO Kang" confirmed 1000x1000), ALAC reports, ReplayGain requests, gapless complaints, playlist requests
5. [HiFi Oasis Review](https://www.hifioasis.com/reviews/snowsky-echo-mini-review/) — review confirming no gapless playback, no playlist support
6. [HiFi Hub: FW 3.1 Issues](https://www.hifihub.com.br/en/firmware-driver-and-app-updates/fiio-snowsky-echo-mini-firmware-3-1-causes-issues) — FW 3.1.0 MP3 artwork regression, OGG artwork issues
7. [deezer2EchoMini (GitHub)](https://github.com/Alexeido/deezer2EchoMini) — community Deezer downloader tuned for Echo Mini; embeds 750x750 baseline JPEG, uses Vorbis Comments for FLAC, downloads LRC lyrics
8. [Thodia: Echo Mini FW 3.0.0](https://www.thodia.media/echo-mini-gets-new-v3-0-0-firmware-update/) — FW 3.0.0 changelog covering Favorites feature
9. [FW 2.8.0 Changelog](https://x.com/tamilhollywood2/status/1996222684792008742) — FW 2.8.0 adding lyrics display switch
10. [USB ID Repository: FiiO (VID 2972)](https://usb-ids.gowdy.us/read/UD/2972) — FiiO USB vendor ID registration (note: actual device uses VID 0x071b, not 0x0b98)
11. [echo-mini-file-processor (GitHub)](https://github.com/ntr0n/echo-mini-file-processor) — community tool that works around filename-as-title, compound tracknumber, and disc ordering bugs
