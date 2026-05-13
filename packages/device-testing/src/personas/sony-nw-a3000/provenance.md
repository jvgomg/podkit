# Provenance: sony-nw-a3000

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — Linux capture deferred (see Linux capture session below)
**USB serial:** *(none — `iSerialNumber = 0`)*
**Volume UUID:** `3C8EA1A5-706B-351A-9415-160C9DA2948D` (FAT32 — primary per-unit identifier)
**Firmware version:** 1.00 (`bcdDevice = 0x0100`)
**Capacity:** 20 GB HDD (19,547,283,456 bytes — slightly under 20 × 10⁹ by HDD-vendor convention)

## Captured alongside `sony-nw-a1000` — read that provenance first

This persona was captured immediately after `sony-nw-a1000` in the same Mac session. The capture methodology and SonicStage-dependency analysis are identical; this file documents only the **deltas** from the A1000 baseline. For OpenMG database structure, EA3/OMA container details, privacy considerations on captured database hexdumps, and the three implementation paths, see `packages/device-testing/src/personas/sony-nw-a1000/provenance.md`.

## Mac capture session

- Date / time: 2026-05-13
- Volume: `NO NAME` (FAT32-LBA) mounted at `/Volumes/NO NAME`
- Disk: `/dev/disk4` (FDisk_partition_scheme, 19,547,283,456 bytes total, 512-byte sectors)
- Commands run: same set as `sony-nw-a1000` (`system_profiler`, `diskutil`, `sudo fdisk`, `ioreg`, `ls -laR`, `hexdump`, selective DAT copies).
- Outputs:
  - `raw/system-profiler.json`
  - `raw/diskutil.plist`
  - `raw/ioreg.txt`
  - `raw/dirlisting-top.txt`
  - `raw/dirlisting-full.txt`
  - `raw/headers-omgaudio-dat.hex` (magic-byte captures + selective short hexdumps)
  - `raw/00GTRLST.DAT`, `raw/07GTCHLG.DAT` (full copies of small index files)
  - `raw/0001001D.DAT`, `raw/00010021.DAT` (full copies of EKB key blocks — DRM-encrypted; safe to commit, but capture context here)
  - `raw/SRCIDLST.DAT`, `raw/SRCIDLST.BAK` (Source ID List + backup; 32 KiB each)
  - `raw/ARDETECT.DAT`, `raw/C2DETECT.DAT` (tiny `MCKF`-format DRM challenge files)

## Differences vs `sony-nw-a1000`

### USB identity

| Field | A1000 | A3000 |
|-------|-------|-------|
| `idVendor` | `0x054c` | `0x054c` |
| `idProduct` | **`0x026a`** | **`0x0269`** |
| `iSerialNumber` | `0` (none) | `0` (none) |
| `bcdDevice` | `0x0100` (firmware 1.00) | `0x0100` (firmware 1.00) |
| `USB Vendor Name` | `Sony` | `Sony` |
| `USB Product Name` | `HDD WALKMAN` | `HDD WALKMAN` |
| `UsbDeviceSignature` | `<4c056a020001000000080650>` | `<4c0569020001000000080650>` |

**Critical correction:** the prior assumption in `devices/sony-walkman-nw-a-series.md` (initial commit) that NW-A HDD models share PID `0x026a` is **wrong**. Each model has a distinct PID. The device profile has been updated to reflect this and list per-model PIDs explicitly.

### OpenMG database version

| File | A1000 version word | A3000 version word |
|------|--------------------|---------------------|
| `00GTRLST.DAT` (magic `GTLT`) | `01 01 00 00` (v1.1) | `02 00 00 00` (v2.0) |
| `02TREINF.DAT` (magic `GTIF`) | `01 01 00 00` (v1.1) | `02 00 00 00` (v2.0) |
| `04CNTINF.DAT` (magic `CNIF`) | `01 01 00 00` (v1.1) | `02 00 00 00` (v2.0) |

NW-A3000 carries OpenMG database **version 2.0**, A1000 carries **version 1.1**. Chunk layouts may differ between versions — any future OpenMG writer implementation needs to handle both. The version word sits at bytes 4–7 of every chunked DAT file, immediately after the 4-byte ASCII magic.

### New files present on A3000 but not A1000

```
OMGAUDIO/0001001D.DAT       220 B    EKB v0x001D (Encrypted Key Block)
OMGAUDIO/00010021.DAT       172 B    EKB v0x0021
OMGAUDIO/SRCIDLST.DAT    32,768 B    Source ID List (32 KiB pre-alloc)
OMGAUDIO/SRCIDLST.BAK    32,768 B    Source ID List backup
OMGAUDIO/30GRCT/             dir     "30 group recent / count" (empty on this unit)
OMGAUDIO/A_WM/ARDETECT.DAT  112 B    MCKF-format DRM challenge (factory-dated 2006-01-28)
```

**EKB (Encrypted Key Block)** files: magic `EKB ` (4 ASCII bytes with trailing space). The filename hex is the EKB version: `0001001D` = EKB v29, `00010021` = EKB v33. Multiple EKB files coexist because each SonicStage / OpenMG content batch is keyed to a specific EKB generation; the device retains old EKBs to keep older content playable. Content bytes after the header are encrypted key material — not directly readable but safe to commit (no cleartext user content).

**MCKF / MCKB format** (`ARDETECT.DAT`, `C2DETECT.DAT`): 4-byte magic `MCKF` then chunks of magic `MCKB`. Payload appears to be timestamp + 8-byte challenge records. Likely the device-side half of a SonicStage device-authentication handshake.

**SRCIDLST.DAT**: header `00 01 00 80 00 01 00 00 ...` then a small record set, padded to 32 KiB. Tracks the source of each piece of content (SonicStage rip / CONNECT purchase / direct import). Sony keeps it backed up as `SRCIDLST.BAK`.

### Filesystem layout differences

| Aspect | A1000 | A3000 |
|--------|-------|-------|
| Content folders | `10F00/` … `10F05/` (6 folders) | `10F00/` only (this unit) — folder fan-out is content-volume dependent, not model-dependent |
| Track count | many (~6 folders × tracks) | 77 OMA files in `10F00/` |
| `01TREE*.DAT` count | 27 (TREE01..15, 22, 2D..37) | 27 (same set) |
| `03GINF*.DAT` count | 27 | 27 |
| `USREVENT.*` | LOG + OLD | LOG only |
| Most recent mtime | 2008-04-24 | 2012-11-23 (with some files in 2010) |

### Privacy

`raw/headers-omgaudio-dat.hex` captures the first **128** bytes of `04CNTINF.DAT` (reduced from 256 used on A1000 to limit exposure) — but even 128 bytes is enough to leak a track title and partial artist string. Before committing this persona's `raw/` to a public branch, follow the same review process as for `sony-nw-a1000` (see that provenance § "Privacy note").

The committed full-copy files are privacy-safe by inspection: EKB files contain encrypted key material; SRCIDLST contains opaque IDs; ARDETECT/C2DETECT contain DRM-challenge bytes; 00GTRLST.DAT contains structural counters (no user strings); 07GTCHLG.DAT contains timestamp records.

## Mac ioreg supplement (authoritative USB descriptor)

From `raw/ioreg.txt`:

| Key | Value |
|-----|-------|
| `idVendor` | `1356` (`0x054c`) |
| `idProduct` | `617` (`0x0269`) |
| `bDeviceClass` / `bDeviceSubClass` / `bDeviceProtocol` | `0` / `0` / `0` |
| `bMaxPacketSize0` | `64` |
| `bcdUSB` | `0x0200` (USB 2.0) |
| `bcdDevice` | `0x0100` (firmware 1.00) |
| `bNumConfigurations` | `1` |
| `iManufacturer` / `iProduct` / `iSerialNumber` | `1` / `2` / `0` |
| `USB Vendor Name` / `USB Product Name` | `Sony` / `HDD WALKMAN` |
| `USBSpeed` / `Device Speed` | `3` / `2` (high speed) |

## Linux capture session

Deferred. Same rationale as `sony-nw-a1000` — Linux output is expected to match the four sibling captures this session in shape (`bDeviceClass/Subclass/Protocol = 0/0/0`, no USB serial, MBR FAT32-LBA via `pttype: "dos"` + parttype `0xc`). Re-plug and run the standard Linux capture script if a per-device need surfaces.

## Expected-* fields status

**Currently unsupported.** Same rationale as `sony-nw-a1000`. A friendly rejection message that mentions the OpenMG version (and per-model PID, distinct from A1000) is appropriate when the detect-and-reject path lands.

## Cross-references

- Sibling persona: `packages/device-testing/src/personas/sony-nw-a1000/` — read first for full OpenMG background.
- Device profile: `devices/sony-walkman-nw-a-series.md` (now updated with A3000 entry + PID-per-model correction + OpenMG version note).
- Inventory entry: `documents/test-devices.md` §"Sony Walkman NW-A3000 (20GB HDD)" (added this session).
- Schema followups: same as `sony-nw-a1000` (nullable `deviceSerial`, missing `'unsupported'` `ReadinessLevel`).

## Open research questions

1. **EKB versioning.** Why does this device have EKBs v29 + v33 but no others? Are EKBs additive (each SonicStage version adds a new one) or rotating (newer overwrites older)?
2. **OpenMG DB version compatibility.** Can a v2.0 database be read by v1.1 firmware (downgrade) or v1.1 by v2.0 (upgrade)? If yes, the chunk-level differences are non-breaking; if no, an implementation needs per-version writers.
3. **30GRCT/ directory purpose.** Empty here, but the name suggests "30 group recent / count" — likely a per-genre or per-group recent-play tracker.
4. **PID coverage of remaining NW-A HDD models.** A1000 = `0x026a`, A3000 = `0x0269`. A1100, A1200, A800, A805, A806, A808 PIDs are unknown — plug-and-confirm if any are available.
