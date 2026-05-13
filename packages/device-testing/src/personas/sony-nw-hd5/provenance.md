# Provenance: sony-nw-hd5

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — Linux capture deferred (see Linux capture session below)
**USB serial:** *(none — `iSerialNumber = 0`)*
**Volume UUID:** `A243C550-F56E-3048-BC31-1EA5D7939C71`
**Firmware version:** 1.00 (`bcdDevice = 0x0100`)
**Capacity:** 20 GB HDD (20,000,268,288 bytes)
**Last-sync software:** SonicStage (per database v1.1; no MEDIAGO/ artefacts)
**Manufacturing imprint:** 2005-06-16 (`OMGAUDIO/` directory mtime)
**Last active sync:** 2009-03-04

## Read first

This persona uses the same OpenMG / EA3 / SonicStage analysis framework as `sony-nw-a1000`. Read its provenance for the shared background. The sections below focus on what makes NW-HD5 distinct from the NW-A generation.

## Mac capture session

- Date / time: 2026-05-13
- Volume: `NO NAME` (FAT32-LBA) mounted at `/Volumes/NO NAME`
- Disk: `/dev/disk4` (FDisk_partition_scheme, 20,000,268,288 bytes total, 512-byte sectors)
- Commands run: same set as the NW-A personas (`system_profiler`, `diskutil`, `sudo fdisk`, `ioreg`, `ls -laR`, selective hexdumps + small file copies)
- Outputs in `raw/`: `system-profiler.json`, `diskutil.plist`, `ioreg.txt`, `dirlisting-top.txt`, `dirlisting-full.txt`, `headers-omgaudio-dat.hex`, `00GTRLST.DAT`, `00010021.DAT`, `MACLIST0.DAT`, `MACLIST0.BAK`, `01TREE0B.BAK`, `03GINF22.DAT`.

## Differences vs the NW-A personas (hardware + filesystem)

### USB identity

| Field | NW-HD5 | NW-A1000/A1200 | NW-A3000 |
|-------|--------|----------------|----------|
| `idVendor` | `0x054c` | `0x054c` | `0x054c` |
| `idProduct` | **`0x0233`** | `0x026a` | `0x0269` |
| **`USB Product Name`** | **`ATRAC HDD`** | `HDD WALKMAN` | `HDD WALKMAN` |
| Media `_name` (system_profiler) | `ATRAC HDD PA` | `HDD WALKMAN` | `HDD WALKMAN` |
| `bcdDevice` | `0x0100` | `0x0100` | `0x0100` |
| `iSerialNumber` | `0` | `0` | `0` |
| `bDeviceClass/Subclass/Protocol` | `0/0/0` | `0/0/0` | `0/0/0` |
| `UsbDeviceSignature` | `<4c0533020001000000080650>` | `<4c056a020001000000080650>` | `<4c0569020001000000080650>` |

NW-HD5 is a **different product line** from NW-A. The descriptor brands the device as `ATRAC HDD` (Sony's "Network Walkman" naming from 2004–2005) rather than the later `HDD WALKMAN` of the NW-A rebrand. PID is in a distinct numeric range (0x023X vs 0x026X).

### Filesystem layout

| Path / file | NW-HD5 | NW-A series |
|-------------|--------|-------------|
| `OMGAUDIO/` | present | present |
| `OMGAUDIO/00GTRLST.DAT` | present (v1.1) | present (v1.1 or v2.0) |
| `OMGAUDIO/02TREINF.DAT` | present (v1.1) | present |
| `OMGAUDIO/04CNTINF.DAT` | present (v1.1, 1.92 MiB) | present |
| `OMGAUDIO/05CIDLST.DAT` | present | present |
| `OMGAUDIO/01TREE*.DAT` | `01–04, 0A, 0B–0F (with .BAK), 10–14, 22` (16 trees) | `01–15, 22, 2D–37` (27 trees) |
| `OMGAUDIO/03GINF*.DAT` | `01–04, 0A–0F, 10–14, 22` | `01–04, 10–15, 22, 2D–37` |
| `OMGAUDIO/MACLIST0.DAT` + `.BAK` | **present (32 KiB each)** | absent |
| `OMGAUDIO/0001001D.DAT` (EKB v29) | absent | absent (A1000) / present (A1200/A3000) |
| `OMGAUDIO/00010021.DAT` (EKB v33) | present | absent (A1000) / present (A1200/A3000) |
| `OMGAUDIO/07GTCHLG.DAT` | absent | present |
| `OMGAUDIO/SRCIDLST.DAT/.BAK` | absent | absent (A1000) / present (A1200/A3000) |
| `OMGAUDIO/A_WM/` | **absent** | present (Walkman extensions) |
| `OMGAUDIO/CONNECT/` | **absent** | present (SonicStage CONNECT remnant) |
| `OMGAUDIO/30GRCT/` | **absent** | absent (A1000) / present (A1200/A3000) |
| `OMGAUDIO/10F00–10F0B/` (12 folders) | present (audio content) | present (audio, fewer folders typical) |
| `OMGAUDIO/20PXX/` (5 folders observed) | **present (JPG album artwork)** | absent — NW-A embeds in EA3 |
| `MEDIAGO/` | **absent** | absent (A1000/A3000) / present (A1200) |
| `System Volume Information/` | absent | absent (A1000/A3000) / present (A1200) |

### Generational architecture difference — album artwork

NW-HD5 has `20PXX/` directories holding **separate JPG files** that SonicStage writes at sync time. Filename scheme:

```
20P03/1G00C301.JPG    — content `1G00C3`, size variant 01    3,189 B
20P03/1G00C302.JPG    — content `1G00C3`, size variant 02    1,088 B
20P03/1G00C3P0.JPG    — content `1G00C3`, primary/preview    9,980 B
```

`1G<6-hex-chars>` is the content identifier. Three size variants per artwork (`01`, `02`, `P0`). The mapping from artwork ID to track records is in `04CNTINF.DAT`.

**These JPGs are not used by the device's monochrome firmware.** The NW-HD5 (and all NW-A HDD-era Walkmans) have small monochrome dot-matrix displays and do not render album art on-screen. SonicStage writes the JPGs for use by its own PC-side device-browser UI. Only the later NWZ generation of Sony Walkmans (colour LCD) renders artwork on-device.

NW-A series abandoned the `20PXX/` scheme entirely. APIC frames may exist inside EA3 (.OMA) headers in some NW-A databases, but the on-device behaviour is the same: no rendering, monochrome screen.

Implication for any future OpenMG writer: **skip artwork emission entirely for NW-HD and NW-A**. The device doesn't use it; PC-side library managers regenerate it on their own.

### New file: `MACLIST0.DAT` + `MACLIST0.BAK`

Both 32 KiB. Captured `raw/MACLIST0.DAT` shows high-entropy content from byte 0 (no plaintext magic — see `raw/headers-omgaudio-dat.hex` § "MACLIST0.DAT (256B head)"). Likely an encrypted or signed Message Authentication Code list — one record per track providing DRM integrity over the CID + key material. Sony documents an "OpenMG MAC" scheme in patents; the on-disk layout is not publicly reverse-engineered.

Modifying any `.OMA` file without updating its `MACLIST0` record will probably cause playback to fail. This is an additional gate beyond NW-A's CID/EKB scheme.

### Tree-numbering scheme

NW-HD: `01TREE` ids include hex `0A–0F` (used) plus `10–14, 22`. NW-A: `01TREE` ids include `13–15, 22, 2D–37`. The hex `0A–0F` slots are NW-HD-specific; the `2D–37` slots are NW-A-specific.

This is likely an artefact of which SonicStage versions wrote to each device — the schema isn't truly per-hardware-platform, just like the DB version is mutable. But empirically, NW-HD-era SonicStage emitted the `0A–0F` set; later SonicStage (writing for NW-A) emitted `2D–37`.

NW-HD keeps `.BAK` backups for `01TREE0B`–`0F` (5 backup files, ~17 KiB each). NW-A does not keep `.BAK` tree backups. Possibly an older SonicStage safety feature.

## Mac ioreg supplement

From `raw/ioreg.txt`:

| Key | Value |
|-----|-------|
| `idVendor` / `idProduct` | `1356` (`0x054c`) / `563` (`0x0233`) |
| `bDeviceClass/Subclass/Protocol` | `0` / `0` / `0` |
| `bMaxPacketSize0` | `64` |
| `bcdUSB` / `bcdDevice` | `0x0200` / `0x0100` |
| `bNumConfigurations` | `1` |
| `iManufacturer` / `iProduct` / `iSerialNumber` | `1` / `2` / `0` |
| `USB Vendor Name` / `USB Product Name` | `Sony` / `ATRAC HDD` |
| `UsbDeviceSignature` | `<4c0533020001000000080650>` |

## Activity timeline

- Factory imprint: `OMGAUDIO/` mtime 2005-06-16 (matches NW-HD5 release date)
- `01TREE0B.BAK` and other `.BAK` files dated 2000-04-01 — uninitialized FAT date sentinel ("never written" or "preserved across re-syncs")
- Most database files: 2009-03-04 (last active sync)
- One audio file in `10F00/`: 2009-01-15 (`10000001.OMA`)
- Several audio files: 2005-10-06 (early sync content, near-original device population)

This unit was actively used 2005–2009. No Media Go evidence (no `MEDIAGO/` directory), so it was retired before Media Go's 2009 release.

## Privacy considerations

Same as the NW-A personas: `raw/headers-omgaudio-dat.hex` captures the first 64 bytes of `04CNTINF.DAT`. The chunked DB layout means the first 64 bytes are structural (CNIF magic + CNFB chunk headers + record counters) — **no user metadata in the captured portion this time**. The reduced 64-byte capture (vs 128 on A1200, 256 on A1000) was conservative. Verified visually that the captured bytes contain no readable strings.

`raw/MACLIST0.DAT` is opaque encrypted data — safe to commit.

`raw/00010021.DAT` is an EKB key block — opaque encrypted key material — safe to commit.

## Linux capture session

Deferred. Same rationale as the NW-A personas — Linux output expected to match the sibling captures in shape (`bDeviceClass/Subclass/Protocol = 0/0/0`, no USB serial, MBR FAT32-LBA `pttype: "dos"` + parttype `0xc`). The `ATRAC HDD` descriptor string (vs NW-A's `HDD WALKMAN`) is visible to both Mac ioreg and Linux sysfs the same way, so no Linux-specific surprises are expected.

## Expected-* fields status

**Currently unsupported.** Rejection message mentions the additional MACLIST integrity gate and the `ATRAC HDD` descriptor (so users get a friendly explanation that includes the product-line distinction).

## Cross-references

- Family device profile: `devices/sony-walkman-nw-hd-series.md` (created this session)
- Sibling Sony personas: `sony-nw-a1000`, `sony-nw-a1200`, `sony-nw-a3000` (different product line — NW-A "HDD WALKMAN")
- Sony mass-storage Walkman: `sony-nwz-e384` (yet another Sony product line — NWZ flash Walkman, fully mass-storage compatible without SonicStage)
- Inventory entry: `documents/test-devices.md` §"Sony Walkman NW-HD5 (20GB HDD)" (added this session)
- Schema followups: same as the NW-A personas (`deviceSerial: string | null`, `ReadinessLevel` lacks `'unsupported'`)

## Open research questions

1. **MACLIST0 format.** Is it a static signed table over per-track CIDs, or does it carry running counters that mutate per playback? RE candidate: capture MACLIST0 before and after playing one track on-device; diff.
2. **`20PXX/` content-ID → track mapping.** Does `1G00C3` correspond to a specific field in `04CNTINF.DAT`? Should be discoverable by searching for `1G00C3` (or its 24-bit value `0x1G00C3` mod hex interpretation) inside `04CNTINF.DAT`'s record area.
3. **NW-HD1 / HD2 / HD3 PIDs.** Likely similar pattern (0x0231 / 0x0232 / 0x0234?) but unverified. None in the user's possession.
4. **Tree-numbering versioning.** Empirically the `0A–0F` ids appear only on NW-HD-era devices and the `2D–37` ids only on NW-A-era. Could be SonicStage version–dependent rather than hardware-dependent; cross-syncing an NW-HD with a late SonicStage could resolve.
5. **`ATRAC HDD PA` media-name suffix.** Is "PA" a marketing tag for ATRAC3plus support, or a stock-firmware variant indicator? Sony's English documentation is sparse on the inner naming convention.
