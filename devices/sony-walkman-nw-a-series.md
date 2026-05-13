# Sony Walkman NW-A Series (HDD generation, 2005–2007)

Sony's first-generation HDD-based Walkmans, predating the mass-storage-compatible NWZ era. Models in this family enumerate as USB Mass Storage on macOS / Linux but **only play DRM-encrypted ATRAC content** authored by SonicStage (Windows). Drag-and-drop sync of MP3/FLAC/etc. is **not supported** on stock firmware.

This profile is captured from an NW-A1000 (6 GB HDD) on 2026-05-13. Family characteristics (OpenMG database layout, OMA/EA3 container, SonicStage dependency) apply to all units in the NW-A series (A1000 / A1200 / A1100 / A3000 / A800 / A805 / A806 / A808 / etc.) unless noted.

---

```yaml
# ============================================================================
# Device Identity
# ============================================================================
name: "Sony Walkman NW-A Series (HDD Walkman, SonicStage era)"
manufacturer: "Sony Corporation"
product_url: "https://www.sony.com/electronics/support/personal-portable-audio-walkman-nw-a-series/"
device_family: "mass-storage-dap"          # caveat: not user-syncable as plain mass storage — see notes
connection_method: "usb-mass-storage"      # transport only; content layer requires SonicStage

# Documentation metadata
firmware_version: "1.00"                    # NW-A1000 bcdDevice 0x0100; later A1000 firmware reached 2.10
date_documented: "2026-05-13"

# ============================================================================
# Detection
# ============================================================================
detection:
  usb_vendor_id: "0x054c"                   # Sony Corporation
  usb_product_ids:
    - id: "0x026a"
      model: "NW-A1000 (6 GB HDD) + NW-A1200 (8 GB HDD) — shared platform"
    - id: "0x0269"
      model: "NW-A3000 (20 GB HDD)"
    # PIDs identify hardware platform, not capacity. NW-A1000 + A1200 share
    # the same chassis with different HDD sizes and share PID 0x026a.
    # NW-A3000 is a distinct platform with PID 0x0269. A1100 / A800 / A805 /
    # A806 / A808 PIDs unknown — plug-and-confirm if any are encountered.
  filesystem_indicators:
    - "/OMGAUDIO/"                          # presence of this dir is definitive for SonicStage/Media Go-era Walkmans
    - "/OMGAUDIO/00GTRLST.DAT"              # group/track list — magic 'GTLT'
    - "/OMGAUDIO/02TREINF.DAT"              # tree info — magic 'GTIF'
    - "/OMGAUDIO/04CNTINF.DAT"              # content info — magic 'CNIF'
    - "/OMGAUDIO/07GTCHLG.DAT"              # challenge log — magic 'GTCL'
    - "/OMGAUDIO/A_WM/"                     # Walkman-extension subdir
    - "/OMGAUDIO/CONNECT/"                  # SonicStage CONNECT remnant
    - "/OMGAUDIO/10F00/*.OMA"               # ATRAC content folder (EA3 magic on file)
    - "/MEDIAGO/MediaGo.xml"                # Media Go sync marker (absent on SonicStage-only units; see notes)
  notes: |
    The device exposes **no `serial_num`** in its USB descriptor (`iSerialNumber = 0`),
    in contrast to the NWZ era. Device-identity tracking must use the FAT32
    volume UUID or the per-track CID in the OpenMG database, not USB serial.

    Volume label is typically `"NO NAME"` on a freshly-restored device —
    SonicStage rebrands it during initial setup. Do not key detection off
    the volume label.

    USB descriptor strings: `USB Vendor Name = "Sony"` (mixed case),
    `USB Product Name = "HDD WALKMAN"`. Note "HDD" in product name —
    distinguishes this generation from later flash-based NW-A (A810/A820/A840
    onwards).

# ============================================================================
# Storage
# ============================================================================
storage:
  type: "internal"                          # spinning HDD, no microSD slot
  max_capacity: "20 GB (A1200); 6 GB (A1000)"
  filesystems:
    supported: [FAT32]                      # MBR partition type 0C (FAT32 LBA)
    unsupported: [NTFS, HFS+, exFAT]
  notes: |
    HDD-based device. Power management is sensitive — yanking USB during
    a database rebuild can leave the OpenMG tree in an inconsistent state.
    SonicStage repairs by overwriting all `.DAT` files; manual recovery is
    impractical.

# ============================================================================
# Display & Artwork
# ============================================================================
display:
  screen_resolution: "monochrome dot-matrix (small)"
  color_depth: "monochrome"
  artwork_render_size: "n/a — device does not render album art"

artwork:
  embedded: false                           # device does not render artwork; APIC in EA3 may exist but is not displayed
  sidecar: false
  sidecar_filenames: []
  formats: []
  max_resolution: "n/a"
  notes: |
    **The NW-A HDD series has a monochrome display and does not render
    album art on the device.** SonicStage may still embed an ID3v2 APIC
    frame into the EA3 (.OMA) header at sync time (for forward
    compatibility / PC-side display), but the device firmware ignores it.

    Practical implication for podkit: any future Sony preset for this
    device family should not emit album artwork — it's effort the device
    doesn't use. Skip artwork transcoding entirely.

    Only the **NWZ** generation of Sony Walkmans (e.g. NWZ-E384) has a
    colour display and renders album art on-device. See `devices/sony-walkman-nwz-e380.md`.

# ============================================================================
# Audio Format Support (DRM-bound; see "Quirks & Limitations")
# ============================================================================
audio_formats:
  lossy:
    - codec: "ATRAC3"
      extensions: [".oma"]                  # OMA = OpenMG Audio = EA3 header + ID3v2 + ATRAC3 payload
      max_sample_rate: "44.1 kHz"
      max_bit_depth: "16-bit"
      notes: "Bitrates 66 / 105 / 132 kbps. Native Sony codec. DRM-bound via CID."
    - codec: "ATRAC3plus"
      extensions: [".oma"]
      max_sample_rate: "44.1 kHz"
      max_bit_depth: "16-bit"
      notes: "Bitrates 48 / 64 / 96 / 128 / 192 / 256 / 320 kbps. Higher-quality ATRAC variant."
    - codec: "MP3"
      extensions: [".oma"]                  # repackaged into EA3 wrapper by SonicStage
      max_sample_rate: "48 kHz"
      max_bit_depth: "16-bit"
      notes: |
        Stock firmware **does** play MP3 — but only after SonicStage has
        repackaged the file into an EA3 (.OMA) container with a CID. Plain
        MP3 dropped into `OMGAUDIO/` will not appear in the device library.
        Later firmwares (NW-A1000 v2.0+) added a "Use the Walkman as a USB
        mass-storage device" mode that allowed drag-drop MP3, but with
        feature limitations (no library browse, only folder navigation).
  lossless:
    - codec: "PCM (WAV)"
      extensions: [".wav"]
      max_sample_rate: "44.1 kHz"
      max_bit_depth: "16-bit"
      notes: "Listed in SonicStage specs; rarely used due to file-size cost on small HDDs."

# ============================================================================
# Metadata
# ============================================================================
metadata:
  tag_formats: ["ID3v2.3 inside EA3 (.OMA)", "OpenMG OMG_* custom frames"]
  browsing_mode: "database"                 # OpenMG library; no folder browser on stock firmware
  notes: |
    The OpenMG database lives in `OMGAUDIO/` as a set of chunked binary
    files. Each `.DAT` file uses a 4-byte ASCII magic + chunks containing
    embedded ID3v2 frames (UTF-16LE) for human-readable metadata. The
    captured headers (`raw/headers-omgaudio-dat.hex`) show:

      File           | Magic | Chunk types        | Notes
      ---------------|-------|--------------------|------------------------------
      00GTRLST.DAT   | GTLT  | SYSB, GTLB         | Group/track list
      02TREINF.DAT   | GTIF  | GTFB               | Tree info (browse hierarchy)
      03GINF01-37.DAT| GPIF  | GPFB               | Group info (per-tree details)
      04CNTINF.DAT   | CNIF  | CNFB               | Content info (canonical track table)
      07GTCHLG.DAT   | GTCL  | BFCL               | Challenge log (DRM-related)
      A_WM/EXCNTINF  | (per A_WM/) | …            | Walkman extensions to OpenMG
      CONNECT/*.DAT  | (CONNECT) | …              | SonicStage Connect server remnants

    Track ID3 frames seen in 04CNTINF.DAT chunks: TIT2 (title), TPE1
    (artist), TALB (album), TCON (genre), TYER (year), TXXX (OpenMG
    extensions: OMG_TPE1S = sortable artist, OMG_TRACK = track number).

# ============================================================================
# Playlists
# ============================================================================
playlists:
  supported_formats: []                     # no user-managed playlist files; library managed inside OpenMG DB
  path_style: "n/a"
  location: "n/a"
  notes: |
    "Bookmarks" and "Playlists" exist as device features but live inside
    the OpenMG database (likely in 01TREE* and A_WM/EXTREE* files), not
    as user-visible playlist files. They cannot be authored from outside
    SonicStage without writing the binary DB format.

# ============================================================================
# Features
# ============================================================================
features:
  ratings: true                             # 5-star ratings; stored in 04CNTINF.DAT chunks
  play_counts: true
  scrobbling: false
  lyrics: false
  replaygain: false
  gapless_playback: true                    # ATRAC native gapless
  video: false                              # NW-A1000 is audio-only; later NW-A800 had video
  podcasts: false                           # podcast UI added in later firmware on different models
  audiobooks: false
  photos: false
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
  - label: "NW-A1000 spec sheet (archive.org)"
    url: "https://web.archive.org/web/2006*/sony.com/electronics/walkman/nw-a1000"
  - label: "OpenMG / EA3 / ATRAC reverse-engineering notes (FFmpeg + community)"
    url: "https://wiki.multimedia.cx/index.php/Sony_OpenMG"
  - label: "SonicStage software (discontinued 2008; SonicStage CP 4.3 final)"
    url: "https://en.wikipedia.org/wiki/SonicStage"
```

## Sync Mechanism

Stock firmware on NW-A1000 expects content to live inside `/OMGAUDIO/` in the OpenMG layout:

```
/OMGAUDIO/
├── 00GTRLST.DAT          group/track list      (magic: GTLT)
├── 01TREE01.DAT … 37.DAT browse-tree structure (magic: GTFB chunks)
├── 02TREINF.DAT          tree info             (magic: GTIF)
├── 03GINF01.DAT … 37.DAT group info (per tree) (magic: GPIF)
├── 04CNTINF.DAT          content info table    (magic: CNIF)
├── 05CIDLST.DAT          content-ID list
├── 07GTCHLG.DAT          challenge log         (magic: GTCL)
├── 10F00/ … 10F05/       OMA content folders   (.OMA files = EA3 + ID3v2 + ATRAC3plus)
├── A_WM/                 Walkman extensions    (ARTISTLK, EXCNTINF, EXTREE, MISCNIDL, USREVENT.LOG)
└── CONNECT/              SonicStage Connect    (ARTSTINF, DELCNLST, EXCNTMTA)
```

A track is "synced" by:

1. Encoding source audio into ATRAC3 or ATRAC3plus (or repackaging existing MP3 as EA3-wrapped).
2. Generating a per-track Content ID (CID) and packaging the audio + CID + metadata into a `.OMA` file under `OMGAUDIO/10FXX/`.
3. Adding the track's entry to `04CNTINF.DAT`, updating tree files in `01TREE*.DAT`, the group list in `00GTRLST.DAT`, and recomputing checksums across the database.
4. (DRM-bound content) registering the CID in `07GTCHLG.DAT` and binding the license to the device key.

SonicStage performs all of this opaquely. **There is no documented standalone path to write the database from outside SonicStage.** Community tools (e.g. `qmtwalkman`, "OMGTOOL") existed but are abandoned and tightly coupled to specific SonicStage versions.

## Quirks & Limitations

- **Not user-syncable as plain mass storage.** Files copied into `OMGAUDIO/10FXX/` without corresponding database entries are invisible to the device's library browser. Files in any other directory (root-level, `MUSIC/`, etc.) are ignored entirely.
- **SonicStage is dead.** Sony discontinued SonicStage in 2008 (final version CP 4.3). It runs only on 32-bit Windows XP/Vista/7. Modern hosts cannot author OpenMG content without a Windows VM with SonicStage installed.
- **DRM bonded to device.** The CID + challenge-log scheme prevents tracks from being copied between Walkmans. Tracks transferred from a SonicStage library to one NW-A1000 cannot be re-transferred to another even if the library file is shared.
- **Later firmware adds USB Mass Storage mode.** NW-A1000 firmware v2.0+ ("Mass Storage Mode" toggle in settings) lets the user drop plain MP3 into a separate `Music/` directory — but the on-device UI is degraded to folder browsing only (no library / artist / album browse), and ATRAC OpenMG content from SonicStage stops being indexed. It's an either-or.
- **HDD is power-sensitive.** USB unplug during a database rebuild can corrupt the OpenMG tree. SonicStage's repair flow is the only path back to a healthy state.
- **No `iSerialNumber`** in USB descriptor. Per-unit identification must use the FAT32 volume UUID (assigned at format time) or per-track CID; the device itself doesn't surface a unique USB serial.

## Research Notes

- **OpenMG DB chunk format.** The `.DAT` files use a uniform 4-byte ASCII magic + length-prefixed chunks. Captured magic bytes confirm: GTLT, GTIF, GPIF, CNIF, GTCL. Chunks (SYSB, GTLB, GTFB, GPFB, CNFB, BFCL) carry length headers + payloads. Metadata payloads are ID3v2 frames encoded in UTF-16LE with the standard ID3v2 frame format (`TIT2 size 02 00 <utf16>`). Reverse-engineering the database fully is plausibly a 1–2 week project for someone motivated; FFmpeg's libavformat already parses the EA3 container half of the equation, just not the surrounding OpenMG library files.
- **OpenMG DB version word.** Bytes 4–7 of each chunked DAT file carry a 32-bit-LE version. Observed values:
  - NW-A1000: `01 01 00 00` (v1.1)
  - NW-A3000: `02 00 00 00` (v2.0)
  Different NW-A HDD models ship different database format versions despite identical-looking USB descriptor (`bcdDevice = 0x0100` on both). A future writer implementation must handle both versions — chunk layouts within the SYSB/GTLB/GTFB/etc. payloads may differ.
- **EKB (Encrypted Key Block) files.** NW-A3000 has `0001001D.DAT` (EKB v29) and `00010021.DAT` (EKB v33) at the OpenMG root; NW-A1000 has neither. Magic `EKB ` (with trailing space). Filename hex = EKB version number. These carry encrypted OpenMG DRM key material — without the matching EKB version, DRM-bound OMA content from a different device/era cannot be decrypted. Multiple EKBs coexist on a device that has had content from multiple SonicStage versions.
- **SRCIDLST.DAT** (NW-A3000, absent on A1000): 32 KiB pre-allocated "Source ID List" tracking content provenance (SonicStage rip vs Sony CONNECT store vs direct import). Backed up as `SRCIDLST.BAK`.
- **ARDETECT.DAT / C2DETECT.DAT format** (`A_WM/`): magic `MCKF` with `MCKB` chunks. Likely device-authentication challenge files used in SonicStage's device-handshake. ARDETECT seen only on A3000; C2DETECT on both.
- **30GRCT/** (A3000 only, empty on this unit): directory name suggests "30 group recent / count" — likely a per-genre or per-group recent-play tracker. Not seen on A1000.
- **EA3 / OMA container.** `.OMA` files start with `ea3 03 00 00` (literal ASCII "ea3" + version 3). The EA3 header is followed by ID3v2 frames (UTF-16LE, including OpenMG-specific TXXX entries `OMG_TPE1S`, `OMG_TRACK`, `OMG_TYER`, etc.), then the ATRAC3plus audio payload. FFmpeg can decode the audio with `-f oma` once the EA3 header is parsed.
- **Mass-Storage-Mode firmware.** Whether the user's NW-A1000 captured for this profile is on the v1.00 firmware (SonicStage-only) or a later v2.x (MSM-capable) needs verification. The `DeviceInfo`-style files we see on NWZ-E380 do not exist here — the firmware version is exposed only via the bcdDevice USB descriptor (`bcdDevice = 256 / 0x0100` ⇒ v1.00) and via SonicStage's "About this device" panel.
- **PID sharing.** `0x026a` is firsthand-verified for NW-A1000. NW-A1200 (20 GB) and other A-series HDD units in 2005–2007 are believed to share this PID, but not verified.
- **DSEE Engine.** Same as the NWZ family — playback-time DSP, not a content capability.

## Implementation Notes

**podkit support is impractical on stock firmware.** Adding NW-A1000 to the mass-storage preset framework would expose the device as detected but writes would silently fail because no podkit code path emits OpenMG-encoded OMA + database updates.

Realistic paths forward (in order of effort):

1. **Detect-and-reject.** Add `0x054c:0x026a` to the unsupported-PID table with a friendly message: *"Sony NW-A1000 requires SonicStage (Windows only). Switch the device to USB Mass Storage Mode in its Settings menu for limited folder-browser sync."* Smallest delivery; preserves user trust by failing loudly with cause.
2. **MSM-Mode preset.** If the user reports their device is in Mass Storage Mode (firmware v2.0+), add a `sony-walkman-msm` preset that treats the device as a generic FAT32 DAP writing MP3 into a `Music/` folder. Detection: presence of MSM mode UI marker — exact marker is unknown and would need to be identified on a firmware-v2.0+ device. This avoids the OpenMG database entirely.
3. **OpenMG writer.** Full SonicStage replacement. Out of scope.

When implementing option 1 or 2:

- USB hints entry: `0x054c:0x026a → 'sony-nw-a-hdd'` (in `packages/devices-mass-storage/src/usb-hints.ts`).
- For option 1, surface via the same unsupported-PID mechanism used in `packages/devices-ipod/src/tables/unsupported.ts` — extend it to non-iPod vendors or create a parallel `unsupported-mass-storage.ts`.
- Preserve the OpenMG database files. Even in MSM mode, deleting `OMGAUDIO/` may brick the device's stock-mode library.

## Inventory

This profile is firsthand-verified for **three** physical SKUs:

| SKU | USB PID | DB version | Last-sync software | Capacity | Captured | Persona ID |
|-----|---------|------------|--------------------|----------|----------|------------|
| NW-A1000 | `0x026a` | OpenMG 1.1 | SonicStage (≤2008) | 6 GB HDD | 2026-05-13 | `sony-nw-a1000` |
| NW-A1200 | `0x026a` (shared) | OpenMG 2.0 | Media Go (~2021) | 8 GB HDD | 2026-05-13 | `sony-nw-a1200` |
| NW-A3000 | `0x0269` | OpenMG 2.0 | SonicStage (~2012) | 20 GB HDD | 2026-05-13 | `sony-nw-a3000` |

**Notes:**

- **NW-A1000 and NW-A1200 are the same hardware.** Firsthand confirmed: identical USB descriptors, identical chassis, identical firmware (`bcdDevice = 0x0100`). The only hardware-level difference is HDD size (6 GB vs 8 GB SKU). Sony's product taxonomy treats them as different models, but from a host-software perspective they are indistinguishable except by capacity. **A preset for one is a preset for the other.**
- **NW-A3000 is a different platform.** Distinct USB PID (`0x0269`) — different hardware, larger HDD (20 GB), but the same OpenMG content layer.
- **Database version is host-side state, not a hardware property.** Each row's "DB version" column reflects only the last SonicStage / Media Go that wrote to that particular unit — not anything intrinsic about the device. A1200 has v2.0 only because it was kept current with Media Go through 2021; A1000 stayed on v1.1 because it was last synced by an older SonicStage. Either device could carry either version after a sync.
- **`MEDIAGO/MediaGo.xml` is host-side state too.** Presence/absence indicates only whether Media Go (vs SonicStage-only) has ever synced this unit. Useful if Media Go and SonicStage write subtly different OMGAUDIO content — but not a hardware-detection signal.
- **PID-based detection is sufficient for the family-level preset**; per-SKU disambiguation (e.g. "A1000 vs A1200") is not needed for sync purposes.
- A1100 / A800 / A805 / A806 / A808 PIDs are unknown.
