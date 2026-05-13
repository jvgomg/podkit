# Sony Walkman NWZ-E380 Series

Sony's E380 series of entry-level Walkman DAPs (E383 / E384 / E385) covering 4 / 8 / 16 GB SKUs, released 2013. Mass-storage capable on macOS/Linux; Windows hosts the Content Transfer / Media Go suite over MTP.

This profile is captured from an NWZ-E384 (8 GB) on 2026-05-13. Per-series characteristics (capability XMLs, content database layout, USB IDs) apply to all units in the series unless noted.

---

```yaml
# ============================================================================
# Device Identity
# ============================================================================
name: "Sony Walkman NWZ-E380 Series"
manufacturer: "Sony Corporation"
product_url: "https://www.sony.com/electronics/walkman/nwz-e380-series"
device_family: "mass-storage-dap"
connection_method: "usb-mass-storage"  # also supports MTP per capability_00.xml

# Documentation metadata
firmware_version: "1.00"               # from default-capability.xml / DeviceInfo.txt (COMP/PROD.1.00.2000)
date_documented: "2026-05-13"

# ============================================================================
# Detection
# ============================================================================
detection:
  usb_vendor_id: "0x054c"              # Sony Corporation
  usb_product_ids:
    - id: "0x0882"
      model: "NWZ-E384 (8 GB) — also reported for E383 / E385 by community sources; confirm per-SKU"
  filesystem_indicators:
    - "/capability_00.xml"             # XML with <Model>NWZ-E380 Series</Model>
    - "/default-capability.xml"        # XML with <model>NWZ-E380 Series</model>
    - "/DeviceInfo.txt"                # 2-line: COMP.<ver>.<build> + PROD.<ver>.<build>
    - "/DEVICON.FIL"                   # 76 KB device-icon resource
    - "/MP_ROOT/.E380"                 # zero-byte series-marker file (E380 family)
    - "/MUSIC/.E380"                   # same marker; replicated across content dirs
    - "/PICTURE/.E380"
    - "/PICTURES/.E380"
    - "/DCIM/.E380"
    - "/VIDEO/.E380"
    - "/STDBDATA.DAT"                  # Sony Content Database (binary, 4 MiB pre-alloc)
    - "/STDBSTR.DAT"                   # Sony Content DB string table (binary, 4 MiB pre-alloc)
    - "/STDBDATA.IDX"                  # database index
    - "/STDBSTR.IDX"                   # string index
  notes: |
    The `.E380` zero-byte marker files are placed in every content directory
    and identify the series unambiguously. Newer Walkmans (NW-A/ZX series)
    use different markers (e.g. `.E573` family). Series detection should key
    off the marker filename, not just vendor/product.

    Capability XML files are authoritative for format support — read them
    via `<Model>` / `<model>` (capability_00.xml uses CamelCase, default-
    capability.xml uses lowercase) and parse the embedded format tables.

# ============================================================================
# Storage
# ============================================================================
storage:
  type: "internal"                     # also accepts microSDHC card on E385 (16 GB built-in + slot); E384 internal-only
  max_capacity: "16 GB internal (E385); 8 GB (E384); 4 GB (E383)"
  filesystems:
    supported: [FAT32]
    unsupported: [NTFS, HFS+, exFAT]   # FAT32 only — firmware will not mount other filesystems

# ============================================================================
# Display & Artwork
# ============================================================================
display:
  screen_resolution: "160x128"         # from capability_00.xml <Display><Dimension>
  color_depth: "QVGA-class (exact bit depth not documented in firmware)"
  artwork_render_size: "≤160x128"      # device caps album art at display size

artwork:
  embedded: true                       # device reads ID3 APIC / iTunes covr
  sidecar: false                       # no folder.jpg / cover.jpg sidecar reading on the E380 series
  sidecar_filenames: []
  formats: ["JPEG"]                    # capability_00.xml lists JPEG only as preferred image format
  max_resolution: "160x128"
  notes: |
    The capability_00.xml `<Image>` block declares JPEG (extension `jpg`,
    MIME `image/jpeg`) as the preferred format with `CapableProgressive=false`.
    Larger embedded artwork is downsampled to display size at index time.

# ============================================================================
# Audio Format Support
# ============================================================================
audio_formats:
  lossy:
    - codec: "MP3"
      extensions: [".mp3"]
      max_sample_rate: "48 kHz"        # implied from <SamplingRate> values in WMV audio capability
      max_bit_depth: "16-bit"
      notes: "Preferred audio format per capability_00.xml (`<Audio preferred=\"true\">`)"
    - codec: "AAC (MP4 / M4A)"
      extensions: [".mp4", ".m4a"]
      max_sample_rate: "48 kHz"
      max_bit_depth: "16-bit"
      notes: "MIME types audio/mp4 + audio/m4a per capability_00.xml. Single AAC file confirmed playing on captured device (`MUSIC/Playlists/*.m4a`)."
    - codec: "Windows Media Audio (WMA)"
      extensions: [".wma"]
      max_sample_rate: "48 kHz"
      max_bit_depth: "16-bit"
      notes: "MIME types audio/wma + audio/x-ms-wma. DRM-capable (`<DRM target=\"wmdrm\" capable=\"true\"/>`)."
    - codec: "3GPP audio"
      extensions: [".3gp"]
      max_sample_rate: "48 kHz"
      max_bit_depth: "16-bit"
      notes: "Listed only in default-capability.xml — capability_00.xml omits it. Likely AMR/AAC payloads in 3GPP container."
  lossless:
    - codec: "Linear PCM (WAV)"
      extensions: [".wav"]
      max_sample_rate: "48 kHz"
      max_bit_depth: "16-bit"
      notes: "Stereo, uncompressed. No FLAC / ALAC / Vorbis / Opus support — firmware predates lossless-codec adoption on entry Walkmans."

# ============================================================================
# Metadata
# ============================================================================
metadata:
  tag_formats: ["ID3v2 (MP3)", "MP4 atoms (M4A/MP4)", "WMA tags"]
  browsing_mode: "database"            # Sony ContentDB (STDBDATA.* / STDBSTR.*) is the indexed view; folder browsing is also exposed as "Folder" mode
  notes: |
    The Sony Content Database is a pair of pre-allocated binary files +
    indexes:
      - STDBDATA.DAT  (4 MiB)  — fixed-size content records
      - STDBDATA.IDX  (small)  — record index
      - STDBSTR.DAT   (4 MiB)  — string heap (artist / album / title / etc.)
      - STDBSTR.IDX   (small)  — string offset table
    The string heap on the captured E384 contains high-entropy bytes after a
    short header — the strings appear to be either obfuscated or stored in a
    non-trivial encoding. Reverse-engineering this format would let podkit
    re-build the DB after sync without rescan. The device also performs a
    full content rescan whenever it is unplugged with FAT changes, so
    leaving the DB stale is a safe degraded mode.

# ============================================================================
# Playlists
# ============================================================================
playlists:
  supported_formats: ["M3U"]           # default-capability.xml declares `format id="m3u8"` with extension `m3u` — UTF-8 M3U
  path_style: "relative"
  location: "MUSIC/Playlists/ (observed on captured device)"
  notes: |
    The default-capability.xml declares one playlist format with `id="m3u8"`
    but `extension="m3u"` — i.e. a UTF-8-encoded M3U file with the
    plain `.m3u` extension. Standard M3U/M3U8 should be interoperable.

# ============================================================================
# Features
# ============================================================================
features:
  ratings: true                        # 5-star ratings via menus (Sony standard)
  play_counts: true                    # tracked in ContentDB
  scrobbling: false
  lyrics: true                         # synced lyrics via LRC sidecar (Sony convention) — untested on captured device
  replaygain: false                    # no replaygain support; Sony's normalization is "Dynamic Normalizer" (firmware-side, no tag input)
  gapless_playback: true               # firmware-side gapless on MP3 + AAC
  video: true                          # WMV (VC1MP / VC1SP) — see capability_00.xml video block
  podcasts: true                       # PODCAST folder; "Podcast" content-type recognized
  audiobooks: false
  photos: true                         # JPEG only; DCIM/ + PICTURE/ + PICTURES/ exposed
  contacts: false
  notes: false
  calendar: false
  custom_themes: false
  eq: true                             # firmware EQ presets + custom 5-band
  usb_dac: false

# ============================================================================
# Links
# ============================================================================
links:
  - label: "Manufacturer product page (E380 series)"
    url: "https://www.sony.com/electronics/walkman/nwz-e380-series"
  - label: "Sony USB Vendor ID registration (0x054c)"
    url: "https://devicehunt.com/view/type/usb/vendor/054C"
```

## Sync Mechanism

Files are written to the FAT32 partition under `MUSIC/` (per default-capability.xml). The device's `capability_00.xml` declares the canonical path as `\MUSIC\` (Windows-style backslash, uppercase) with `depth="7"` — folder hierarchy up to 7 levels deep is indexed. Note the case mismatch: capability_00.xml uses `\MUSIC\` while default-capability.xml uses `\Music\`. FAT32 is case-insensitive on the device side; case in the actual filesystem is `MUSIC/` (uppercase).

Other content paths from capability_00.xml `<FileSystem>`:

| Content type | Path | Depth |
|--------------|------|-------|
| camera       | `\DCIM\`    | 6 |
| image        | `\PICTURE\` | 6 |
| video        | `\VIDEO\`   | 6 |
| sound        | `\MUSIC\`   | 7 |

Indexing trigger: the device rescans the FAT32 partition and rebuilds the Content Database (`STDBDATA.*` / `STDBSTR.*`) on every USB unplug. A full rescan takes seconds to minutes depending on track count. This is the safe path for third-party tools — write files into `MUSIC/`, unplug, and the device picks them up without further coordination.

## Quirks & Limitations

- **No FLAC, ALAC, Vorbis, or Opus.** The E380 series predates Sony's adoption of these codecs on the lower-end Walkmans (added to NW-A and ZX series later). Lossless input must be transcoded to MP3 or AAC.
- **Maximum bitrate caps** are documented for video (256 kbps audio in WMV, 768 kbps video) but not stated for standalone audio in the capability XML. Empirically MP3 at 320 kbps and AAC at 256 kbps play without issue.
- **DRM-capable.** The device declares `<DRM target="wmdrm" capable="true"/>` — Windows Media DRM is supported for content downloaded via Sony's PC apps. Not relevant for podkit (we only ship unprotected content).
- **The `.E380` marker files are sticky.** Deleting them does not break playback but may cause some Sony PC-side apps to misidentify the device. Preserve them.
- **`DEVICON.FIL` is the device-icon resource** (~76 KB binary). Modifying it is undocumented and risks bricking the device's PC-side identity.
- **Two `PICTURE` directories** exist (`PICTURE/` and `PICTURES/`). The `<FileSystem>` block in capability_00.xml lists only `\PICTURE\`; `PICTURES/` is likely a Sony PC-app convention. Use `PICTURE/` per the XML.
- **MTP and Mass Storage coexist.** capability_00.xml declares `<Storage type="MTP">`, but the device enumerates as a USB Mass Storage class device on macOS/Linux hosts by default. Windows hosts may prefer MTP via Sony's drivers. podkit can rely on the mass-storage path on macOS/Linux.

## Research Notes

- **Content Database reverse-engineering.** The STDB* binary format would let podkit incrementally update the DB rather than relying on the device's full rescan. Initial bytes captured in `packages/device-testing/src/personas/sony-nwz-e384/raw/stdbdata-magic.txt` — first 16 bytes of STDBDATA.DAT look like a header with size/count fields (4-byte LE). STDBSTR.DAT bytes after the initial header are high-entropy — needs investigation whether strings are obfuscated, compressed, or whether the entropy is purely from the offset/hash structure.
- **Per-SKU PID confirmation.** E383 / E385 are believed to share PID `0x0882` with E384 based on community sources, but only E384 is firsthand-verified. Plug in E383 / E385 hardware to confirm.
- **DSEE Engine** (Sony's high-frequency upsampling DSP). Available on this series per Sony marketing. Capability XMLs don't mention it (it's a playback-time DSP setting, not a content capability).
- **Bluetooth.** NWZ-E380 series has no Bluetooth (added in the W-series and later).
- **Lyrics.** Sony devices conventionally accept `.lrc` sidecar files alongside the audio. The captured device wasn't tested with lyrics; the capability XML doesn't surface lyrics support explicitly.

## Implementation Notes

Not yet implemented in podkit (2026-05-13). When implementing:

1. **Detection.** Add `0x054c:0x0882` to `packages/devices-mass-storage/src/usb-hints.ts` mapping to a new `sony-walkman-e380` preset. Optionally augment with filesystem-indicator detection (`.E380` marker) to disambiguate from later Walkmans that may eventually share the PID.
2. **Preset.** Add `sony-walkman-e380` to `packages/devices-mass-storage/src/presets/built-in.ts`:
   ```ts
   'sony-walkman-e380': {
     artworkSources: ['embedded'],
     artworkMaxResolution: 160,
     supportedAudioCodecs: ['aac', 'mp3', 'wav'],   // wma intentionally omitted — podkit has no WMA encoder
     supportsVideo: false,                          // WMV-only video; podkit has no WMV encoder
     audioNormalization: 'none',                    // Dynamic Normalizer is firmware-side, no tag input
     supportsAlbumArtistBrowsing: true,             // verify on hardware before committing
     contentPaths: { musicDir: 'MUSIC', moviesDir: 'VIDEO', tvShowsDir: 'VIDEO' },
   }
   ```
3. **Capability XML parser.** Future-proof by reading `/capability_00.xml` at sync time and reconciling with the preset — if a unit reports different formats than the preset, the XML wins. Generalizes to other Walkman series (NW-A / ZX) which use the same XML schema.
4. **Marker-file preservation.** When writing files, never delete `.E380`. Add to a global "protected paths" list.
5. **Persona fixture.** `packages/device-testing/src/personas/sony-nwz-e384/` carries the captured probes, capability XMLs, ContentDB magic bytes, and a directory listing — see `packages/device-testing/src/personas/sony-nwz-e384/provenance.md` for the full session record.

## Inventory

This profile is firsthand-verified for **one** physical SKU:

| SKU | Capacity | Color | Captured | Persona ID |
|-----|----------|-------|----------|------------|
| NWZ-E384 | 8 GB | (note color in test-devices.md) | 2026-05-13 | `sony-nwz-e384` |

NWZ-E383 (4 GB) and NWZ-E385 (16 GB) are believed compatible but unverified.
