# Provenance: sony-nw-a1000

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — Linux capture deferred (see Linux capture session below)
**USB serial:** *(none — `iSerialNumber = 0` in USB descriptor; older Sony pre-serial pattern)*
**Volume UUID:** `9AED81A8-CDE2-3ED2-B01E-1E0FEB8898B9` (FAT32 — preferred per-unit identifier in absence of USB serial)
**Firmware version:** 1.00 (`bcdDevice = 0x0100` from `raw/ioreg.txt`; firmware-version surface is the USB descriptor only — this device has no `DeviceInfo.txt` or capability XMLs)
**Manufacturing date imprint:** 2005-10-17 (FAT32 root mtime) / 2005-12-08 (OMGAUDIO/ mtime)

## Mac capture session

- Date / time: 2026-05-13
- Volume: `NO NAME` (FAT32-LBA) mounted at `/Volumes/NO NAME`
- Disk: `/dev/disk4` (FDisk_partition_scheme, 5,982,523,904 bytes total, 512-byte sectors)
- Commands run:
  - `system_profiler SPUSBDataType -json` → `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk4` → `raw/diskutil.plist`
  - `sudo fdisk /dev/disk4` — read MBR (partition type `0x0C` FAT32-LBA, not `0x0B` CHS as on the other Sony)
  - `ioreg -p IOUSB -l -w 0 -r -n "HDD WALKMAN"` → `raw/ioreg.txt`
  - `ls -la "/Volumes/NO NAME/"` → `raw/dirlisting-top.txt`
  - `ls -laR "/Volumes/NO NAME/"` → `raw/dirlisting-full.txt`
  - hexdump headers of representative OpenMG database files → `raw/headers-omgaudio-dat.hex`
  - full copies of the smallest OpenMG database files (size-conscious; only files < 16 KiB) → `raw/00GTRLST.DAT`, `raw/02TREINF.DAT`, `raw/07GTCHLG.DAT`, `raw/C2DETECT.DAT`
- Notes:
  - `vendor_id` reported as `"0x054c  (Sony Corporation)"` — encoded as `0x054c`.
  - **No `serial_num` field** in `system_profiler` JSON. **No `kUSBSerialNumberString` / `USB Serial Number`** in `ioreg.txt`. **`iSerialNumber = 0`** in the descriptor — definitive evidence this generation of Sony Walkman does not expose a USB serial. Persona `deviceSerial` set to empty string.
  - USB descriptor strings: `USB Vendor Name = "Sony"` (mixed-case, contrast NWZ-E384's `"SONY"`); `USB Product Name = "HDD WALKMAN"` (the "HDD" prefix identifies this as the spinning-disk generation, distinct from later flash NW-A models).
  - Single MBR partition (FAT32-LBA, type `0x0C`) at sectors 63..11,684,616 (512-byte sectors). Only ~32 KiB MBR padding before — no on-disk firmware region.
  - Volume label "NO NAME" is the FAT32 default — likely the device was restored / never re-labelled by SonicStage. Do not use volume label for detection.
  - Volume UUID `9AED81A8-CDE2-3ED2-B01E-1E0FEB8898B9` is the most reliable per-unit identifier in the absence of USB serial.

## Mac ioreg supplement (authoritative USB descriptor)

From `raw/ioreg.txt`:

| Key | Value | Notes |
|-----|-------|-------|
| `idVendor` | `1356` (`0x054c`) | Sony Corporation |
| `idProduct` | `618` (`0x026a`) | NW-A1000 (verified); A1200 / other A-series HDD believed-but-unverified to share |
| `bDeviceClass` | `0` | composite-device convention |
| `bDeviceSubClass` | `0` | composite-device convention |
| `bDeviceProtocol` | `0` | composite-device convention |
| `bMaxPacketSize0` | `64` | endpoint-0 max packet (USB 2.0 high speed) |
| `bcdUSB` | `512` (`0x0200`) | USB 2.0 |
| `bcdDevice` | `256` (`0x0100`) | **firmware v1.00** — newer A1000 units may report 2.10 (MSM-Mode firmware) |
| `bNumConfigurations` | `1` | single configuration |
| `iManufacturer` / `iProduct` / `iSerialNumber` | `1` / `2` / **`0`** | string-descriptor indices; `iSerialNumber = 0` means **no serial descriptor** |
| `USB Vendor Name` / `USB Product Name` | `Sony` / `HDD WALKMAN` | mixed-case Sony (vs NWZ-E384's uppercase SONY) |
| `UsbDeviceSignature` | `<4c056a020001000000080650>` | compact LE-encoded vid/pid/version; no serial bytes |
| `USBSpeed` / `Device Speed` | `3` / `2` | high speed (480 Mbps) |

## On-disk filesystem (`/Volumes/NO NAME`)

Top-level layout (per `raw/dirlisting-top.txt`):

```
OMGAUDIO/          (only meaningful directory)
.fseventsd/        (macOS-generated)
.Spotlight-V100/   (macOS-generated; permission-denied during ls)
```

There is **no** `MUSIC/`, **no** `PICTURE/`, **no** capability XML, **no** `DeviceInfo.txt`, **no** `.E380` marker. All device content lives inside `OMGAUDIO/`.

### `OMGAUDIO/` structure

```
OMGAUDIO/
├── 00GTRLST.DAT        4,560 B    Group/track list           (magic: GTLT)
├── 01TREE01.DAT       19,440 B    Browse tree #1             (magic: GTFB chunks)
├── 01TREE02.DAT       19,264 B    Browse tree #2
├── …                  …           up to 01TREE37.DAT
├── 02TREINF.DAT        7,968 B    Tree info                  (magic: GTIF)
├── 03GINF01.DAT        1,616 B    Group info #1              (magic: GPIF)
├── 03GINF02.DAT       60,384 B    Group info #2 (large — likely artist group)
├── …                  …           up to 03GINF37.DAT (some > 500 KiB)
├── 04CNTINF.DAT      972,240 B    Content info (canonical track table; magic: CNIF)
├── 05CIDLST.DAT       71,184 B    Content-ID list
├── 07GTCHLG.DAT          160 B    Challenge log              (magic: GTCL; DRM-related)
├── 10F00/ … 10F05/    (6 dirs)    .OMA content folders
├── A_WM/                          Walkman extensions
│   ├── ARTISTLK.DAT  110,432 B    Artist link table
│   ├── C2DETECT.DAT      176 B    Device-detection challenge
│   ├── EXCNTINF.DAT   71,184 B    Extended content info
│   ├── EXGINF01.DAT   27,840 B    Extended group info
│   ├── EXGINF02.DAT      192 B
│   ├── EXTREE01.DAT   26,096 B    Extended tree
│   ├── EXTREE02.DAT   16,912 B
│   ├── MISCNIDL.DAT   13,200 B    Misc-channel idle (?)
│   ├── MISCNMTD.DAT  355,152 B    Misc-channel metadata
│   ├── USREVENT.LOG  367,392 B    User event log (large — may carry session traces)
│   └── USREVENT.OLD  614,416 B    Previous user event log
├── ACTIVITY.DAT    2,621,440 B    Activity tracking (2.5 MiB)
└── CONNECT/                       SonicStage CONNECT remnant
    ├── ARTSTINF.DAT       80 B
    ├── DELCNLST.DAT    8,880 B    Delete-content list
    └── EXCNTMTA.DAT  995,952 B    Extended content metadata (largest single DB file)
```

### Database file magic bytes (from `raw/headers-omgaudio-dat.hex`)

| File | Magic | Chunk type(s) | Notes |
|------|-------|---------------|-------|
| `00GTRLST.DAT` | `GTLT` | `SYSB`, `GTLB` | Group/track list; SYSB likely system header, GTLB = group/track list block |
| `02TREINF.DAT` | `GTIF` | `GTFB` | Tree info; payload includes ID3v2 frames (`TIT2` title) in UTF-16LE — observed string `"Tinks Walkman"` (likely the device's library name) |
| `03GINF01.DAT` | `GPIF` | `GPFB` | Group info; ID3v2 frames (`TIT2`, `TPE1`) |
| `04CNTINF.DAT` | `CNIF` | `CNFB` | Content info table — the canonical per-track record; ID3v2 frames in UTF-16LE carry track title / artist / album in cleartext (see Privacy note below) |
| `07GTCHLG.DAT` | `GTCL` | `BFCL` | Challenge log; payload looks like time-stamped 24-byte records (`20 08 04 24 22 17 14` = 2020-04-24 22:17:14 BCD-ish? — confirm) tied to track IDs |

### .OMA file structure (from `raw/headers-omgaudio-dat.hex`, last block)

First bytes of `10F00/10000001.OMA`:

```
65 61 33 03 00 00 00 00   "ea3" + version 3 + flags
17 76                     header size?
54 49 54 32 …             standard ID3v2 frames begin (TIT2 / TPE1 / TALB / TCON / TXXX / TYER)
```

EA3 v3 is the well-documented OpenMG Audio container. Following the header is a standard ID3v2 tag block (UTF-16LE) with Sony's `TXXX` extensions (`OMG_TPE1S` = sortable performer, `OMG_TRACK` = OpenMG track ID), then the ATRAC3plus audio payload.

## Privacy note

`raw/headers-omgaudio-dat.hex` captures the first 256 bytes of `04CNTINF.DAT` (and a few other database files). The captured bytes include user music metadata in cleartext UTF-16LE — specifically a track title, artist, album, and genre from the user's library. The user-visible string `"Tinks Walkman"` (apparently the device's library name set in SonicStage) is also visible in `02TREINF.DAT`.

This is private user content. Before committing this persona's `raw/` directory to a public branch:

1. Review the contents of `raw/headers-omgaudio-dat.hex`, `raw/00GTRLST.DAT`, `raw/02TREINF.DAT`, `raw/07GTCHLG.DAT`.
2. Decide whether to:
   - Keep them as-is (acceptable for a private repo or if the user is fine with the metadata being public),
   - Regenerate the magic-header captures using `xxd -l 16` (just enough for magic-byte detection, no payload) to scrub metadata, or
   - Replace with synthesised database files of the same magic + chunk structure.

The persona's structural value (detection patterns, file sizes, magic bytes) is fully preserved by alternative 2 or 3.

## Mac supplementary grabs

Small DAT files captured in full alongside the headers hexdump — useful for future reverse-engineering of the OpenMG database without needing the hardware back:

| File | Size | Source | Why |
|------|------|--------|-----|
| `raw/00GTRLST.DAT` | 4,560 B | `/Volumes/NO NAME/OMGAUDIO/00GTRLST.DAT` | Group/track list (the master index; small enough to commit) |
| `raw/02TREINF.DAT` | 7,968 B | `/Volumes/NO NAME/OMGAUDIO/02TREINF.DAT` | Tree info (browse-hierarchy root) |
| `raw/07GTCHLG.DAT` | 160 B | `/Volumes/NO NAME/OMGAUDIO/07GTCHLG.DAT` | DRM challenge log (smallest; useful for understanding the device-identity binding) |
| `raw/C2DETECT.DAT` | 176 B | `/Volumes/NO NAME/OMGAUDIO/A_WM/C2DETECT.DAT` | Walkman device-detection challenge (tiny) |

What was **not** captured and why:

- Larger DAT files (`04CNTINF.DAT` 972 KiB, `03GINF02.DAT` 60 KiB, `EXCNTMTA.DAT` 996 KiB, `MISCNMTD.DAT` 347 KiB, `ARTISTLK.DAT` 108 KiB, `USREVENT.*` 358–600 KiB, `ACTIVITY.DAT` 2.5 MiB). Several of these contain user-private metadata that would expand the privacy concern significantly. Magic-byte hexdumps in `headers-omgaudio-dat.hex` already document their structure.
- `.OMA` content files (multi-MiB each, DRM-bound user music). Privacy + size + DRM all argue against committing.
- Full FAT32 backing image (5.7 GiB). Way past the playbook's 16 MiB threshold.

## Linux capture session

Deferred. The four Linux captures completed this session — including the related `echo-mini` mass-storage device — establish the host-side reconciliation pattern. Linux output for this MBR FAT32-LBA SonicStage-era Walkman is expected to follow the same shape:

- USB descriptor `bDeviceClass / Subclass / Protocol` matching Mac ioreg's `0/0/0`.
- `bNumConfigurations` reading whatever Mac ioreg reported (non-Apple devices typically single-config; confirmed on Echo Mini).
- `lsblk -J -O /dev/sdX` confirming the Mac-captured MBR/FAT32-LBA layout (`pttype: "dos"`, parttype byte `0xc`).
- udev / sysfs likely to show the same lack of USB serial (`iSerialNumber = 0`) as Mac ioreg recorded.

`lsblkJson` stays `null` until a per-device need arises.

## SysInfoExtended source

None — not an iPod. NW-A1000 also has no on-disk capability XMLs (unlike the NWZ-E380 series). Device identity is exposed only via USB descriptor + the OpenMG database files.

## Expected-* fields status

**Currently unsupported.** `expectedCapabilities: null`. `expectedReadiness.level` is `'unknown'` with a `fail` USB stage carrying a synthetic `unsupportedReason` describing the SonicStage dependency and the firmware-v2.0+ Mass Storage Mode workaround.

When implementation begins (`devices/sony-walkman-nw-a-series.md` § "Implementation Notes" lists three viable paths):

- **Path 1 (detect-and-reject):** persona stays as-is; rejection message becomes the canonical user-facing copy.
- **Path 2 (MSM-mode preset):** `expectedCapabilities` becomes a populated `DeviceCapabilities` for plain-MP3 folder sync; `expectedReadiness` shifts to `'ready'` for MSM-firmware units. Persona may need a sibling `sony-nw-a1000-msm` for the alternative firmware-mode shape.
- **Path 3 (full OpenMG writer):** out of scope; not planned.

## Cross-references

- Device profile: `devices/sony-walkman-nw-a-series.md` (created this session)
- Inventory entry: `documents/test-devices.md` §"Sony Walkman NW-A1000 (6GB HDD)" (added this session)
- Mass-storage preset module: `packages/devices-mass-storage/src/presets/built-in.ts` (no Sony NW-A preset)
- USB hints: `packages/devices-mass-storage/src/usb-hints.ts` (no `0x054c:0x026a` entry)
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- Schema followups observed here:
  - `usbDescriptor.deviceSerial` is typed as `string` (not `string | null`) — NW-A1000 has no serial, encoded as empty string. Consider making the field nullable for older / non-serial devices.
  - `ReadinessLevel` lacks `'unsupported'` (same gap as touch-5G and sony-nwz-e384).
- External:
  - FFmpeg OpenMG / EA3 demuxer: `libavformat/oma.c`
  - MultimediaWiki Sony OpenMG: <https://wiki.multimedia.cx/index.php/Sony_OpenMG>

## Open research questions

1. **Firmware version variants.** NW-A1000 v1.00 (this unit, no MSM mode) vs v2.0+ (MSM-Mode toggle). Is the bcdDevice 0x0100 a fixed identifier or does it bump on firmware update? An NW-A1000 with a known v2.x firmware would resolve.
2. **OpenMG database chunk-layout RE.** The captured magic bytes + smallest-DAT-files dataset is enough to start, but the relationship between `01TREE*.DAT` (browse trees) and `04CNTINF.DAT` (canonical content table) is undocumented in public sources at the byte level.
3. **C2DETECT.DAT format.** 176 bytes; appears in `A_WM/` not in the root OMGAUDIO. Name suggests "C2 detection" — a Walkman-side device-identity challenge. Worth disassembling.
4. **PID sharing across NW-A HDD models.** Plug an A1200 / A3000 to confirm whether they all use `0x054c:0x026a` or distinct PIDs.
5. **SonicStage Connect remnants.** `OMGAUDIO/CONNECT/` is empty of useful content here (one 80 B file + two small DAT). Did this device ever connect to Sony's CONNECT music store? If so, `EXCNTMTA.DAT` (996 KiB) may carry the purchase history.
