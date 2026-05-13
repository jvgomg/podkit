# Provenance: sony-nwz-e384

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — Linux capture deferred (see Linux capture session below)
**USB serial:** `10431991572055` (real per-unit serial; not generic like Echo Mini's `USBV1.00`)
**Firmware version:** 1.00 (per `default-capability.xml` `<firmwareversion>1.00</firmwareversion>` and `DeviceInfo.txt` `PROD.1.00.2000`)
**Series marker:** `.E380` (zero-byte files in every content directory)

## Mac capture session

- Date / time: 2026-05-13
- Volume: `WALKMAN` (FAT32) mounted at `/Volumes/WALKMAN`
- Disk: `/dev/disk6` (FDisk_partition_scheme, 7,713,849,344 bytes total, 2048-byte sectors)
- Commands run:
  - `system_profiler SPUSBDataType -json` → `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk6` → `raw/diskutil.plist`
  - `sudo fdisk /dev/disk6` — read MBR partition table
  - `ioreg -p IOUSB -l -w 0 -r -n "WALKMAN"` → `raw/ioreg.txt` (authoritative USB descriptor)
  - `ls -la "/Volumes/WALKMAN/"` → `raw/dirlisting-top.txt`
  - `ls -laR "/Volumes/WALKMAN/"` → `raw/dirlisting-full.txt`
  - `cp /Volumes/WALKMAN/{capability_00.xml,default-capability.xml,DeviceInfo.txt} raw/`
  - `hexdump -C` on STDB[DATA|STR].[DAT|IDX] → `raw/stdbdata-magic.txt` (header bytes for future RE)
- Notes:
  - `vendor_id` reported as `"0x054c  (Sony Corporation)"` — note the embedded vendor name in the string. Encoded as `0x054c`.
  - USB `bDeviceClass / bDeviceSubclass / bDeviceProtocol` confirmed `0` from `ioreg.txt`. Composite-device convention; Mass Storage class (`0x08`) lives on the interface descriptor (not in this top-level dump).
  - Single MBR partition (FAT32) at sectors 5..3766527 (2048-byte sectors). Only 10 KiB reserved before — MBR padding only. No on-disk firmware region (Sony Walkman firmware lives on a separate internal NAND area).
  - Partition usable size 7,713,839,104 bytes ≈ 7,357 MiB ≈ 7.18 GiB ≈ 7.71 GB (decimal).

## Mac ioreg supplement (authoritative USB descriptor)

From `raw/ioreg.txt`:

| Key | Value | Notes |
|-----|-------|-------|
| `idVendor` | `1356` (`0x054c`) | Sony Corporation |
| `idProduct` | `2178` (`0x0882`) | E380 series (E383/E384/E385 share per community sources; only E384 firsthand-verified) |
| `bDeviceClass` | `0` | composite-device convention |
| `bDeviceSubClass` | `0` | composite-device convention |
| `bDeviceProtocol` | `0` | composite-device convention |
| `bMaxPacketSize0` | `64` | endpoint-0 max packet (USB 2.0 high speed) |
| `bcdUSB` | `512` (`0x0200`) | USB 2.0 |
| `bcdDevice` | `1` (`0x0001`) | firmware 0.01 (cf. `DeviceInfo.txt` PROD.1.00.2000 — different versioning surface) |
| `bNumConfigurations` | `1` | single configuration |
| `iManufacturer` / `iProduct` / `iSerialNumber` | `1` / `2` / `5` | string-descriptor indices |
| `USB Vendor Name` / `USB Product Name` | `SONY` / `WALKMAN` | top-level strings |
| `USB Serial Number` | `10431991572055` | per-unit serial; useful for device-identity tracking |
| `UsbDeviceSignature` | `<4c05820801003130343331393931353732303535000000080650>` | LE-encoded vid/pid/serial blob |
| `USBSpeed` / `Device Speed` | `3` / `2` | high speed (480 Mbps) |

## On-disk filesystem (`/Volumes/WALKMAN`)

Top-level layout (per `raw/dirlisting-top.txt`):

```
capability_00.xml                3652 bytes
default-capability.xml           1364 bytes
DeviceInfo.txt                     32 bytes  ("COMP.1.00.2000\nPROD.1.00.2000\n")
DEVICON.FIL                     76142 bytes  (device-icon binary)
RAMLIST.DAT                      2444 bytes
SETSTOR.DAT                       252 bytes  (settings store)
STDBDATA.DAT                  4194304 bytes  (4 MiB Sony ContentDB record area, pre-allocated)
STDBDATA.IDX                     1308 bytes
STDBSTR.DAT                   4194304 bytes  (4 MiB Sony ContentDB string heap, pre-allocated)
STDBSTR.IDX                      6864 bytes
DCIM/         (+ .E380 marker, empty)
MP_ROOT/      (+ .E380 marker, empty)
MUSIC/        (+ .E380 marker; Playlists/ with one AAC track from user)
PICTURE/      (+ .E380 marker, empty)
PICTURES/     (+ .E380 marker, empty)
VIDEO/        (+ .E380 marker, empty)
```

**`.E380` marker files**: zero-byte files in each content directory. The "E380" suffix unambiguously identifies the NWZ-E380 series (E383 / E384 / E385). Sony's content-management tools use these as device-family detection signals. Newer Walkmans use different markers (e.g. `.E573` on later series). **Do not delete these** — they survive content sync and identify the device family to Sony PC apps.

**STDB\* files = Sony Content Database**:
- `STDBDATA.DAT` / `STDBDATA.IDX` — content records + index
- `STDBSTR.DAT` / `STDBSTR.IDX` — string heap + index
- Both `.DAT` files are pre-allocated to 4 MiB; the firmware rebuilds them after every unplug.
- First 16 bytes of `STDBDATA.DAT` look like a fixed header (LE 32-bit size/count fields).
- First bytes of `STDBSTR.DAT` after a short header are high-entropy — strings appear either obfuscated, compressed, or use a non-trivial encoding. Worth reverse-engineering if podkit ever wants to write the DB directly rather than letting the device rescan.

**Capability XMLs**: see `raw/capability_00.xml` (Walkman Playback Capability v1.1.0) and `raw/default-capability.xml` (Sony default capability v3.0). Both declare `<Model>NWZ-E380 Series</Model>`. Authoritative for format support — see `devices/sony-walkman-nwz-e380.md` for the parsed contents.

**Other binaries**:
- `DEVICON.FIL` (76 KB) — device icon resource shown by Sony PC apps. Preserve untouched.
- `RAMLIST.DAT` — likely a startup/cache list. Function unknown; not edited.
- `SETSTOR.DAT` (dated 2013-06-01) — settings storage. Last-modified date suggests Sony's manufacturing imprint or first power-on date.

## Mac supplementary grabs

Captured while the device was still attached — cheap to take now, painful to revisit after the device is unplugged. Recorded for a future Sony-preset implementer or content-database reverse-engineering pass.

| File | Size | Source | What it is |
|------|------|--------|-----------|
| `raw/DEVICON.FIL` | 76 KB | `/Volumes/WALKMAN/DEVICON.FIL` (full copy) | Windows ICO container: 12 icons up to 256×256, embedded PNG + 8-bit RGBA + 4-bit 48×48 paletted variants (per `file(1)` output). This is the icon Sony's PC apps render when the device is connected. Future UI work that surfaces device thumbnails can reuse this artwork; preset metadata could reference it. |
| `raw/RAMLIST.DAT` | 2,444 B | `/Volumes/WALKMAN/RAMLIST.DAT` (full copy) | Opaque binary state file (`file(1)` reports "data"). Possibly a startup cache or last-played list. Function unverified — capturing now so a future implementer can diff after device interactions instead of needing the hardware back. |
| `raw/SETSTOR.DAT` | 252 B | `/Volumes/WALKMAN/SETSTOR.DAT` (full copy) | Opaque binary settings store. Dated 2013-06-01 (likely a factory imprint). Small enough that diffing after user actions is feasible. |
| `raw/stdbdata-first4k.hex` | 37 lines | `head -c 4096 STDBDATA.DAT \| hexdump -C` | First 4 KiB of the ContentDB record area. `hexdump` collapses long zero runs to `*`, so a short output (37 lines) here means the 4 KiB is mostly zero-padded — confirms `STDBDATA.DAT` is sparsely populated on a low-content device. Header layout still legible. |
| `raw/stdbstr-first4k.hex` | 257 lines | `head -c 4096 STDBSTR.DAT \| hexdump -C` | First 4 KiB of the ContentDB string heap. Dense data (257 lines, no zero-run compression) — confirms `STDBSTR.DAT` carries non-trivial content from byte 0. Useful seed for reverse-engineering the string encoding without committing the full 4 MiB binary. |

What was **not** captured and why:

- Full `STDBDATA.DAT` / `STDBSTR.DAT` (4 MiB each). Mostly pre-allocated empty space — the 4 KiB hexdumps give a future RE pass the structural signal it needs without bloating the repo.
- Sample music / video content from `MUSIC/Playlists/` — irrelevant to device support; what Tier 3 synthesis actually needs is the synthesised marker-file scaffold listed in `devices/sony-walkman-nwz-e380.md` § "Detection".
- A backing-image dump of the FAT32 partition (7.3 GB). Far past the playbook's 16 MiB threshold; Tier 3 should use the `synthesis` recipe in `types.ts`.

## Linux capture session

Deferred. The four Linux captures completed this session — including the related `echo-mini` mass-storage device — establish the host-side reconciliation pattern. Linux output for this MBR/FAT32 mass-storage DAP is expected to follow the same shape:

- USB descriptor `bDeviceClass / Subclass / Protocol` matching Mac ioreg's `0/0/0`.
- `bNumConfigurations` reading 1 on Linux (non-Apple devices are typically single-config — confirmed on Echo Mini; Apple iPods are the exception that advertise 2).
- `lsblk -J -O /dev/sdX` confirming the Mac-captured MBR/FAT32 layout.

`lsblkJson` stays `null` until a per-device need arises (e.g. a Tier 3 USB-replay test, or implementation work on a Sony Walkman preset that needs the exact payload).

## SysInfoExtended source

None — not an iPod. Sony Walkman exposes capability via on-disk XML files (`capability_00.xml`, `default-capability.xml`) rather than via SCSI VPD pages.

## Expected-* fields status

**Currently unsupported.** `expectedCapabilities: null` because podkit has no Sony preset registered. `expectedReadiness.level` is `'unknown'` with a `fail` USB stage carrying a synthetic `unsupportedReason`. The real cascade may emit a different shape (`'unsupported'` is not a current `ReadinessLevel` value — schema followup tracked under TASK-331; see also the "Open research questions" section below for the broader followup list).

When a Sony preset is added to `packages/devices-mass-storage/src/presets/built-in.ts` and `usb-hints.ts` maps `0x054c:0x0882` to it, update this persona to:

- `expectedCapabilities`: a populated `DeviceCapabilities` object derived from `capability_00.xml` (audio: mp3, aac, wav; artwork: 160×160 embedded JPEG; no video without a WMV path; etc.)
- `expectedReadiness`: a successful `'ready'` flow.

## Cross-references

- Device profile: `devices/sony-walkman-nwz-e380.md` (created this session)
- Inventory entry: `documents/test-devices.md` §"Sony Walkman NWZ-E384 (8GB)" (added this session)
- Mass-storage preset module: `packages/devices-mass-storage/src/presets/built-in.ts` (no Sony preset yet)
- USB hints: `packages/devices-mass-storage/src/usb-hints.ts` (no `0x054c:0x0882` entry yet)
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- Schema followups discovered while writing this persona:
  - `ReadinessLevel` lacks `'unsupported'` — see `ipod-touch-5g-unsupported/provenance.md` for the same finding.
  - `partitionLayout.partitions` lacks a `lun` field — relevant for multi-LUN mass-storage devices (Echo Mini); not affected here (Walkman is single-LUN).

## Open research questions

These are recorded so future hands don't repeat the same investigation:

1. **STDB\* string-table encoding.** Is the high-entropy data obfuscated, compressed, or just non-ASCII with offset tables? A small Python decoder against the captured header bytes could resolve in an afternoon.
2. **PID sharing.** E383 (4 GB) and E385 (16 GB) are believed to use the same PID `0x0882`. Plug in either to confirm and update `devices/sony-walkman-nwz-e380.md` and the inventory.
3. **MTP vs Mass Storage selection.** `capability_00.xml` declares `<Storage type="MTP">` but the device enumerates as Mass Storage on macOS. Is there a way to switch modes from the device UI, or is mode chosen by the host?
4. **Lyrics (.lrc) sidecar handling.** Convention exists on Sony devices; not tested on this unit. Drop a known-good `.lrc` next to an MP3 and verify the device displays synced lyrics.
5. **DSEE Engine** (upsampling DSP). User-toggle setting, not a content capability — no implementation impact for podkit unless we expose device-side DSP toggles in the UI later.
