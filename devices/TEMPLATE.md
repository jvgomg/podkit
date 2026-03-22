# Device Documentation Template

Copy this file and rename it to document a new device. Fill in all sections that apply.
Delete any sections that are not relevant to the device.

---

```yaml
# ============================================================================
# Device Identity
# ============================================================================
name: ""                          # Full device name
manufacturer: ""                  # Manufacturer name
product_url: ""                   # Official product page
device_family: ""                 # stock-ipod | rockbox | mass-storage-dap
connection_method: ""             # usb-mass-storage | libgpod | mtp

# Documentation metadata
firmware_version: ""              # Firmware version at time of documentation
date_documented: ""               # YYYY-MM-DD

# ============================================================================
# Detection
# ============================================================================
# How podkit can identify this device when mounted. USB IDs alone may not be
# sufficient (e.g., Rockbox uses the same IDs as stock firmware).
detection:
  usb_vendor_id: ""               # e.g. "0x05ac"
  usb_product_ids:                # List of known product IDs
    - id: ""
      model: ""
  filesystem_indicators: []       # Files/dirs that identify this device type
                                  # e.g. [".rockbox/rockbox-info.txt", "iPod_Control/Device/SysInfo"]
  notes: ""                       # How to distinguish from similar devices

# ============================================================================
# Storage
# ============================================================================
storage:
  type: ""                        # internal | microsd | both
  max_capacity: ""                # e.g. "256GB"
  filesystems:
    supported: []                 # e.g. [FAT32, exFAT]
    unsupported: []               # e.g. [NTFS, HFS+]

# ============================================================================
# Display & Artwork
# ============================================================================
display:
  screen_resolution: ""           # e.g. "170x320"
  color_depth: ""                 # e.g. "16-bit color"
  artwork_render_size: ""         # e.g. "170x170" — actual album art display size

artwork:
  embedded: false                 # Reads artwork embedded in audio file tags
  sidecar: false                  # Reads artwork from sidecar files (folder.jpg, cover.jpg, etc.)
  sidecar_filenames: []           # e.g. ["folder.jpg", "cover.jpg", "album.jpg"]
  formats: []                     # e.g. ["JPEG", "PNG", "BMP"]
  max_resolution: ""              # Max supported artwork resolution, if known
  notes: ""                       # Any quirks or firmware version requirements

# ============================================================================
# Audio Format Support
# ============================================================================
audio_formats:
  lossy:
    - codec: ""                   # e.g. "MP3"
      extensions: []              # e.g. [".mp3"]
      max_sample_rate: ""         # e.g. "48kHz"
      max_bit_depth: ""           # e.g. "16-bit"
      notes: ""
  lossless:
    - codec: ""                   # e.g. "FLAC"
      extensions: []              # e.g. [".flac"]
      max_sample_rate: ""         # e.g. "192kHz"
      max_bit_depth: ""           # e.g. "24-bit"
      notes: ""

# ============================================================================
# Metadata
# ============================================================================
metadata:
  tag_formats: []                 # e.g. ["ID3v2", "Vorbis Comments", "APEv2"]
  browsing_mode: ""               # database | folder | both
  notes: ""

# ============================================================================
# Playlists
# ============================================================================
playlists:
  supported_formats: []           # e.g. ["M3U", "M3U8", "PLS"]
  path_style: ""                  # relative | absolute | both
  location: ""                    # Where playlists must live (e.g. "anywhere", "root directory")
  notes: ""

# ============================================================================
# Features
# ============================================================================
features:
  ratings: false                  # Star rating support
  play_counts: false              # Play count tracking
  scrobbling: false               # Last.fm scrobbling / play logging
  lyrics: false                   # Lyrics display (synced or unsynced)
  replaygain: false               # ReplayGain tag support
  gapless_playback: false         # Gapless playback support
  video: false                    # Video playback support
  podcasts: false                 # Podcast-specific features (bookmarking, media type)
  audiobooks: false               # Audiobook-specific features (bookmarking, media type)
  photos: false                   # Photo viewing/syncing
  contacts: false                 # Contact syncing (vCard, etc.)
  notes: false                    # Note syncing
  calendar: false                 # Calendar syncing (iCal, etc.)
  custom_themes: false            # Custom theme/skin support
  eq: false                       # Equalizer
  usb_dac: false                  # USB DAC mode

# ============================================================================
# Links
# ============================================================================
links:
  - label: ""                     # e.g. "Spec sheet"
    url: ""
  - label: ""                     # e.g. "FAQ"
    url: ""
```

## Sync Mechanism

_How files are transferred to the device. Describe the expected folder structure,
any naming conventions, and how the device discovers and indexes music files._

## Quirks & Limitations

_Known issues, firmware-specific behaviors, format edge cases, or anything an
implementer should be aware of._

## Research Notes

_Open questions, links to forum threads, areas that need further investigation._

## Implementation Notes

_Once podkit implementation begins, document how this device maps to podkit's
abstractions: which handler, transcoding rules, content type decisions, etc._
