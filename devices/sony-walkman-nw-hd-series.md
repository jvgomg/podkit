# Sony Walkman NW-HD Series (HDD generation, 2004–2005)

Sony's original "Network Walkman" HDD line, predating the NW-A series. Released 2004–2005 (NW-HD1, NW-HD2, NW-HD3, NW-HD5). These devices enumerate as USB Mass Storage but exclusively play DRM-encrypted ATRAC content authored by SonicStage (Windows). They are a distinct product line from NW-A — different USB descriptor branding (`ATRAC HDD` vs NW-A's `HDD WALKMAN`), different USB PIDs, and an earlier / simpler OpenMG library schema with separate-JPG album artwork.

This profile is captured from an NW-HD5 (20 GB HDD) on 2026-05-13. Family characteristics apply to NW-HD1 / HD2 / HD3 / HD5 unless noted.

---

```yaml
# ============================================================================
# Device Identity
# ============================================================================
name: "Sony Walkman NW-HD Series (Network Walkman, pre-NW-A)"
manufacturer: "Sony Corporation"
product_url: "https://www.sony.com/electronics/support/personal-portable-audio-walkman-nw-hd-series/"
device_family: "mass-storage-dap"          # caveat: not user-syncable as plain mass storage
connection_method: "usb-mass-storage"      # transport only; content layer requires SonicStage

# Documentation metadata
firmware_version: "1.00"                    # NW-HD5 bcdDevice 0x0100
date_documented: "2026-05-13"

# ============================================================================
# Detection
# ============================================================================
detection:
  usb_vendor_id: "0x054c"                   # Sony Corporation
  usb_product_ids:
    - id: "0x0233"
      model: "NW-HD5 (20 GB HDD); NW-HD1 / HD2 / HD3 PIDs unknown (likely related but unverified)"
  filesystem_indicators:
    # Same OMGAUDIO/ root as NW-A — confirms SonicStage/OpenMG content layer
    - "/OMGAUDIO/"
    - "/OMGAUDIO/00GTRLST.DAT"              # magic 'GTLT'
    - "/OMGAUDIO/02TREINF.DAT"              # magic 'GTIF'
    - "/OMGAUDIO/04CNTINF.DAT"              # magic 'CNIF'
    # NW-HD-specific signals (NOT present on NW-A):
    - "/OMGAUDIO/MACLIST0.DAT"              # MAC integrity list — appears only on NW-HD generation
    - "/OMGAUDIO/MACLIST0.BAK"
    - "/OMGAUDIO/20PXX/"                    # JPG album-artwork folders (NW-HD-only; NW-A embeds artwork in EA3)
    - "/OMGAUDIO/20PXX/*.JPG"               # filename pattern `1G<contentID>P0.JPG` / `1G<contentID>01.JPG`
    - "/OMGAUDIO/01TREE0A.DAT"              # tree numbering uses hex 0A–0F (NW-A skips these)
    - "/OMGAUDIO/01TREE??.BAK"              # `.BAK` tree backups (NW-A doesn't keep)
  notes: |
    USB descriptor strings: `USB Vendor Name = "Sony"`, `USB Product Name = "ATRAC HDD"`
    — **distinct from NW-A's "HDD WALKMAN"**. The Media subtree's `_name`
    is reported as `ATRAC HDD PA` in `system_profiler` (the "PA" suffix
    may indicate an ATRAC3plus-capable variant).

    No USB serial (`iSerialNumber = 0`) — same pre-serial pattern as NW-A.
    Per-unit identity must use the FAT32 volume UUID.

    **No `A_WM/`, `CONNECT/`, `30GRCT/`, or `MEDIAGO/` directories** — these
    were introduced in the NW-A generation. NW-HD content lives entirely
    under `OMGAUDIO/` with no Walkman-branded extension subdirectories.

# ============================================================================
# Storage
# ============================================================================
storage:
  type: "internal"                          # spinning 1.8" HDD
  max_capacity: "20 GB (NW-HD5); smaller for earlier models (NW-HD1 = 20 GB, NW-HD2 = 20 GB, NW-HD3 = 20 GB also)"
  filesystems:
    supported: [FAT32]                      # MBR partition type 0x0C (FAT32-LBA), 512 B sectors
    unsupported: [NTFS, HFS+, exFAT]

# ============================================================================
# Display & Artwork
# ============================================================================
display:
  screen_resolution: "monochrome dot-matrix (small)"
  color_depth: "monochrome"
  artwork_render_size: "n/a — device does not render album art"

artwork:
  embedded: false                           # device does not render artwork
  sidecar: false                            # 20PXX/*.JPG files exist on disk but device firmware does not display them
  sidecar_filenames: []
  formats: []
  max_resolution: "n/a"
  notes: |
    **The NW-HD series has a monochrome display and does not render album
    art on the device.** SonicStage still writes JPG album-artwork files
    into `20PXX/` directories on the FAT32 partition — but those JPGs are
    consumed by SonicStage's own PC-side device-browser, not by the
    device's firmware. The on-device "Now Playing" / browse UI is text-only.

    Filename pattern (for forensic / RE purposes only): `1G<6-hex-chars><suffix>.JPG`
    with `P0` / `01` / `02` suffixes for variant sizes; the 6-char content
    ID maps to a record in `04CNTINF.DAT`. Documented because podkit may
    encounter these files when reading a device synced by SonicStage —
    but **podkit should not emit them**: the device doesn't use them, and
    PC-side library managers (SonicStage / Media Go) rebuild them
    independently anyway.

    Only the **NWZ** generation of Sony Walkmans renders album art
    on-device. See `devices/sony-walkman-nwz-e380.md`.

# ============================================================================
# Audio Format Support
# ============================================================================
audio_formats:
  lossy:
    - codec: "ATRAC3"
      extensions: [".oma"]
      max_sample_rate: "44.1 kHz"
      max_bit_depth: "16-bit"
      notes: "Bitrates 66 / 105 / 132 kbps. DRM-bound via CID."
    - codec: "ATRAC3plus"
      extensions: [".oma"]
      max_sample_rate: "44.1 kHz"
      max_bit_depth: "16-bit"
      notes: "ATRAC3plus support indicated by the `ATRAC HDD PA` media name (PA = `plus available`?). Bitrates 48–320 kbps."
    - codec: "MP3"
      extensions: [".oma"]
      max_sample_rate: "48 kHz"
      max_bit_depth: "16-bit"
      notes: "Repackaged into EA3 wrapper by SonicStage (same constraint as NW-A)."
  lossless:
    - codec: "PCM (WAV)"
      extensions: [".wav"]
      max_sample_rate: "44.1 kHz"
      max_bit_depth: "16-bit"
      notes: "Listed in SonicStage specs; rare due to file-size cost on the 20 GB HDD."

# ============================================================================
# Metadata
# ============================================================================
metadata:
  tag_formats: ["ID3v2.3 inside EA3 (.OMA)", "OpenMG OMG_* custom frames"]
  browsing_mode: "database"                 # OpenMG library; no folder browser
  notes: |
    Same chunked DAT format as NW-A (magic + chunks + ID3v2 frames in
    UTF-16LE), but with different tree/group numbering and no Walkman-
    extension subdirectories.

    NW-HD `01TREE` numbering observed: `01–04, 0A, 0B–0F` (some kept as
    `.BAK` backups), `10–14, 22`. Total 16 trees vs NW-A's 27. Suggests
    fewer browse-hierarchy categories — fewer per-genre / per-decade /
    per-rating slices than the later NW-A.

    DB version word observed: `01 01 00 00` (v1.1) on the captured unit,
    matching NW-A1000. Hosts running newer SonicStage versions may upgrade
    NW-HD databases to v2.0 (same mutability story as NW-A).

# ============================================================================
# Playlists
# ============================================================================
playlists:
  supported_formats: []                     # OpenMG-database-managed only
  path_style: "n/a"
  location: "n/a"
  notes: |
    Same constraints as NW-A — playlists exist inside the OpenMG database
    files, not as user-editable files in the filesystem.

# ============================================================================
# Features
# ============================================================================
features:
  ratings: true
  play_counts: true
  scrobbling: false
  lyrics: false
  replaygain: false
  gapless_playback: true
  video: false                              # audio-only
  podcasts: false
  audiobooks: false
  photos: false                             # the 20PXX/ JPGs are album artwork, not user photos
  contacts: false
  notes: false
  calendar: false
  custom_themes: false
  eq: true                                  # 5-band custom + presets
  usb_dac: false

# ============================================================================
# Links
# ============================================================================
links:
  - label: "NW-HD5 spec sheet (archive.org)"
    url: "https://web.archive.org/web/2005*/sony.com/electronics/walkman/nw-hd5"
  - label: "OpenMG / EA3 / ATRAC reverse-engineering notes"
    url: "https://wiki.multimedia.cx/index.php/Sony_OpenMG"
  - label: "SonicStage software (discontinued 2008)"
    url: "https://en.wikipedia.org/wiki/SonicStage"
```

## Sync Mechanism

Same OpenMG content layer as NW-A — content lives in `OMGAUDIO/` as `.OMA` files (`EA3` v3 container + ID3v2 + ATRAC3/ATRAC3plus payload) with database files (`*.DAT`) tracking the library. Differences:

- **`20PXX/` JPG album-artwork folders** present on disk (written by SonicStage). The on-device firmware is monochrome and ignores them — they exist for SonicStage's PC-side browser. NW-A abandoned this scheme entirely.
- **MACLIST0.DAT** + **MACLIST0.BAK** at OMGAUDIO root carry encrypted per-track Message Authentication Codes for DRM integrity. Each 32 KiB pre-alloc. High-entropy content (no plaintext magic). Required for DRM-bound playback.
- **Different tree/group numbering**: `01TREE` files use hex `0A`–`0F` ids that NW-A skips, suggesting an earlier numbering convention. NW-HD also keeps `.BAK` versions of several tree files; NW-A does not.
- **No `A_WM/`**, no `CONNECT/`, no `30GRCT/`, no `MEDIAGO/` — these were introduced with the NW-A series.

The implementation constraints are identical to NW-A: SonicStage authoring required, modern hosts cannot easily write the database, plain MP3 dropped onto the filesystem is not indexed.

## Quirks & Limitations

- **Same SonicStage dependency** as NW-A. SonicStage discontinued 2008; runs only on 32-bit Windows.
- **No "Mass Storage Mode" firmware variant** that we are aware of for NW-HD5. Unlike later NW-A1000 v2.0+, the NW-HD5 does not offer a drag-drop MP3 fallback.
- **HDD power sensitivity** same as NW-A — yanking USB during a database rebuild can corrupt the OpenMG tree.
- **No USB serial** in the descriptor.
- **MACLIST integrity check.** The `MACLIST0.DAT` file likely contains a cryptographic MAC over each track's CID + key blob. Modifying `.OMA` files without updating MACLIST will cause playback to fail with "Unknown track" or similar. This is an additional gate beyond NW-A's CID/EKB scheme.

## Research Notes

- **MACLIST0.DAT format.** Captured 256 bytes show high-entropy content from byte 0 — no plaintext magic. Likely AES-encrypted or signed records, 32 KiB total. Sony's "OpenMG MAC" scheme is described in patents and Sony's white papers; the on-disk layout has not been reverse-engineered publicly.
- **`20PXX/` artwork-ID scheme.** Filename pattern `1G<6-char-id><suffix>.JPG` where:
  - The 6-character ID after `1G` (e.g. `00C3`) maps to a record in `04CNTINF.DAT` — the canonical track table.
  - The suffix `01` / `02` / `P0` indicates artwork variant. `P0` is likely "primary / preview" (small thumbnail for browse). `01` / `02` may be full-size and alternate-size renders. To confirm: dump one JPG and inspect dimensions.
- **NW-HD generation coverage.** Only NW-HD5 is firsthand-verified. NW-HD1 / NW-HD2 / NW-HD3 may use a different USB descriptor (e.g. plain "Network Walkman") and a smaller / monochrome display. PIDs unknown.
- **Tree-numbering scheme difference vs NW-A.** The hex IDs `0A`–`0F` exist on NW-HD but are absent on NW-A. NW-A's IDs `2D`–`37` are absent on NW-HD. Likely a SonicStage-version-dependent set; if a NW-HD is synced with a much later SonicStage, it may gain the higher IDs (or not — fewer browse categories on smaller screens).

## Implementation Notes

**Same `detect-and-reject` recommendation as NW-A.** If any podkit support for the NW-HD series is added, it should be the same friendly-rejection path:

```
Sony NW-HD series (Network Walkman, 2004–2005) is not supported —
content layer requires SonicStage (Windows-only, discontinued 2008).
The NW-HD generation also requires MACLIST0.DAT integrity records that
cannot be authored from outside SonicStage.
```

USB hints entry: `0x054c:0x0233 → 'sony-nw-hd-network-walkman'`.

If a full OpenMG writer is ever attempted (out of scope), NW-HD will need:
- MACLIST0.DAT generation — requires reversing the MAC scheme.
- Older tree numbering (`0A`–`0F`).

Note: artwork emission into `20PXX/` is **not** required — the device's monochrome firmware doesn't render the JPGs. SonicStage writes them for its own PC-side UI; an alternative writer can skip them.

## Inventory

This profile is firsthand-verified for **one** physical SKU:

| SKU | USB PID | DB version | Capacity | Captured | Persona ID |
|-----|---------|------------|----------|----------|------------|
| NW-HD5 | `0x0233` | OpenMG 1.1 | 20 GB HDD | 2026-05-13 | `sony-nw-hd5` |

NW-HD1 / HD2 / HD3 are believed to share the OpenMG content layer but their USB PIDs and any USB-descriptor differences are unknown.
