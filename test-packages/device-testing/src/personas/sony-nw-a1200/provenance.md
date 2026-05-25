# Provenance: sony-nw-a1200

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — Linux capture deferred (see Linux capture session below)
**USB serial:** *(none — `iSerialNumber = 0`)*
**Volume UUID:** `B0D74B8F-47CD-39D5-A1A9-1F58518EB837`
**Firmware version:** 1.00 (`bcdDevice = 0x0100`)
**Capacity:** 8 GB HDD (7,838,243,328 bytes)
**Last-sync host:** Windows (per `System Volume Information/`)
**Last-sync software:** Media Go (per `MEDIAGO/MediaGo.xml` presence)
**Manufacturing imprint:** 2005-12-31 (`A_WM/ARDETECT.DAT` and `A_WM/USREVENT.LOG` mtime)

## Read first

This persona shares Mac-side capture methodology and the OpenMG / EA3 / SonicStage analysis with `sony-nw-a1000` and `sony-nw-a3000`. Read `sony-nw-a1000/provenance.md` for the full background, then read the **Differences** sections below for what makes A1200 distinct.

## Mac capture session

- Date / time: 2026-05-13
- Volume: `NO NAME` (FAT32-LBA) mounted at `/Volumes/NO NAME`
- Disk: `/dev/disk4` (FDisk_partition_scheme, 7,838,243,328 bytes total, 512-byte sectors)
- Commands run: same as the other NW-A personas (`system_profiler`, `diskutil`, `sudo fdisk`, `ioreg`, `ls -laR`, selective hexdumps and full copies of small DAT files).
- New artefacts captured this session: `raw/MediaGo.xml`, `raw/IndexerVolumeGuid`, `raw/WPSettings.dat`.

## Differences vs `sony-nw-a1000` and `sony-nw-a3000`

> **Read this section with care:** the only hardware-level difference between NW-A1000 and NW-A1200 is HDD capacity (6 GB vs 8 GB). Everything else in the tables below — OpenMG DB version, EKB / SRCIDLST presence, `MEDIAGO/`, `System Volume Information/`, factory imprint dates — is **host-side state**, not a hardware property. It's the result of which sync software last touched this particular unit and on which host. An A1000 kept current with Media Go on Windows would converge to the same filesystem state seen on this A1200; this A1200 reset and synced only with SonicStage 4.x on Mac would converge to the A1000's state.
>
> NW-A3000 is the only sibling that's a genuinely different platform — distinct PID, 20 GB HDD, different chassis.

### USB identity

| Field | A1000 | A1200 | A3000 |
|-------|-------|-------|-------|
| `idVendor` | `0x054c` | `0x054c` | `0x054c` |
| `idProduct` | `0x026a` | **`0x026a`** (shared with A1000) | `0x0269` |
| `iSerialNumber` | `0` | `0` | `0` |
| `bcdDevice` | `0x0100` | `0x0100` | `0x0100` |
| USB Vendor / Product Name | `Sony` / `HDD WALKMAN` | same | same |

**Per-model PID story (refined this session):** PIDs are tied to hardware platform, not to capacity or generation. NW-A1000 (6 GB) and NW-A1200 (8 GB) are different HDD sizes on the same chassis and share `0x026a`. NW-A3000 (20 GB) is a different platform with a distinct PID `0x0269`. The device profile's per-model PID table has been updated.

### OpenMG database version

| File | A1000 | A1200 | A3000 |
|------|-------|-------|-------|
| `00GTRLST.DAT` | `01 01 00 00` (v1.1) | **`02 00 00 00` (v2.0)** | `02 00 00 00` (v2.0) |
| `02TREINF.DAT` | v1.1 | **v2.0** | v2.0 |
| `04CNTINF.DAT` | v1.1 | **v2.0** | v2.0 |

NW-A1200 carries DB v2.0 — same as A3000, despite sharing hardware platform with A1000 (which has v1.1). **DB version is determined by the last SonicStage or Media Go version used to sync, not by hardware platform.** The version word is mutable per device.

### Filesystem additions vs A3000

| Path | A1000 | A1200 | A3000 |
|------|-------|-------|-------|
| `OMGAUDIO/0001001D.DAT` (EKB v29) | absent | **present** | present |
| `OMGAUDIO/00010021.DAT` (EKB v33) | absent | **present** | present |
| `OMGAUDIO/SRCIDLST.DAT` + `.BAK` | absent | **present** (32 KiB pre-alloc) | present |
| `OMGAUDIO/30GRCT/` | absent | **present** (empty here) | present |
| `OMGAUDIO/A_WM/ARDETECT.DAT` | absent | **present** (factory-dated 2005-12-31) | present (2006-01-28) |
| **`MEDIAGO/MediaGo.xml`** | absent | **present** (NEW — Media Go marker) | absent |
| **`System Volume Information/`** | absent | **present** (NEW — Windows host) | absent |

### `MEDIAGO/MediaGo.xml` contents

`raw/MediaGo.xml` (357 bytes):

```xml
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<media-go>
  <version>1</version>
  <device-ids>
    <device-id>{F952ECD7-4115-4821-9131-B5EE6C8EB778}</device-id>
  </device-ids>
  <preferred-name></preferred-name>
  <preferred-name-device-id>Generic</preferred-name-device-id>
  <device-subtype>Unknown</device-subtype>
</media-go>
```

Significant fields:

- **`<device-id>`**: per-unit Media Go UUID. Privacy-sensitive — this is a software-generated unique identifier for the device-host pairing. If this persona is committed to a public branch, consider scrubbing the UUID.
- **`<preferred-name-device-id>Generic</preferred-name-device-id>` + `<device-subtype>Unknown</device-subtype>`**: Media Go classifies this Walkman generically — it does not have an entry for NW-A1200 in its device database. Reasonable since Media Go primarily targets later Sony devices.
- **`<version>1</version>`**: Media Go config-file schema version.

**Detection implication:** the file `MEDIAGO/MediaGo.xml` is a strong indicator that a Walkman has been synced with Media Go (vs SonicStage). Either software writes OMGAUDIO/ files, but only Media Go writes a top-level `MEDIAGO/` directory. A future preset could differentiate "SonicStage-only" devices (no MEDIAGO/) from "Media Go-touched" devices (MEDIAGO/ present) — useful if implementation paths diverge.

### `System Volume Information/` contents

`raw/IndexerVolumeGuid` (76 bytes): a binary Windows Search index volume GUID. Written by Windows when the FAT32 volume is mounted and indexed by Windows Search. Cosmetic for podkit's purposes.

`raw/WPSettings.dat` (12 bytes): Windows Properties settings. Likely caches the user's per-volume Explorer preferences.

These are **Windows-host artefacts**, not Sony-software artefacts. They appear on any FAT32 volume that has been mounted on Windows with default settings. Useful as evidence that this device's host is Windows-based, but not specific to Sony or to Walkmans.

### Activity dates

- Factory imprint (preserved): `ARDETECT.DAT` 2005-12-31, `USREVENT.LOG` 2005-12-31
- Last database rebuild: 2021-11-12
- Last activity record (`ACTIVITY.DAT`): 2022-08-31
- Volume root mtime: 1980-03-14 (FAT32 sentinel — volume root)

Most recently active of the three NW-A units captured. Confirms the user kept syncing this unit into the early 2020s via Media Go.

## Mac ioreg supplement

From `raw/ioreg.txt`:

| Key | Value |
|-----|-------|
| `idVendor` / `idProduct` | `1356` (`0x054c`) / `618` (`0x026a`) |
| `bDeviceClass` / `Subclass` / `Protocol` | `0` / `0` / `0` |
| `bMaxPacketSize0` | `64` |
| `bcdUSB` / `bcdDevice` | `0x0200` / `0x0100` |
| `bNumConfigurations` | `1` |
| `iManufacturer` / `iProduct` / `iSerialNumber` | `1` / `2` / `0` |
| `USB Vendor Name` / `USB Product Name` | `Sony` / `HDD WALKMAN` |
| `UsbDeviceSignature` | `<4c056a020001000000080650>` (identical to NW-A1000's signature) |

## Privacy considerations

This persona's `raw/` captures three categories of potentially private data; review before committing to a public branch:

1. **`raw/headers-omgaudio-dat.hex`** — first 128 bytes of `04CNTINF.DAT` contain user music metadata (track / artist / album) in cleartext UTF-16LE. Same concern as the A1000 / A3000 personas.
2. **`raw/MediaGo.xml`** — contains the Media Go device UUID `{F952ECD7-4115-4821-9131-B5EE6C8EB778}`. A per-unit software identifier, not personally identifying but unique to this device-host pairing.
3. **`raw/IndexerVolumeGuid`** + **`raw/WPSettings.dat`** — Windows-side IDs, low-sensitivity.

Recommended mitigations if commit-as-public:

- Regenerate `headers-omgaudio-dat.hex` with only the first 16 bytes of `04CNTINF.DAT` (enough for magic + version word).
- Replace the `<device-id>` UUID in `MediaGo.xml` with a placeholder (preserve the structural information about Media Go's XML format).
- Drop the Windows-host artefacts (they're documented in this provenance, so the persona doesn't lose information).

## Linux capture session

Deferred. Same rationale as `sony-nw-a1000` and `sony-nw-a3000` — Linux output expected to match the four sibling captures in shape (`bDeviceClass/Subclass/Protocol = 0/0/0`, no USB serial, MBR FAT32-LBA `pttype: "dos"` + parttype `0xc`). The Windows-host artefacts (`System Volume Information/`) recorded under the Mac session will be visible on Linux as-is.

## Expected-* fields status

**Currently unsupported.** Same rationale as `sony-nw-a1000` / `sony-nw-a3000`. The rejection message specifies that the device shares its PID with NW-A1000 and additionally distinguishes Media Go from SonicStage as the last-sync software.

## Cross-references

- Sibling personas: `sony-nw-a1000`, `sony-nw-a3000`.
- Device profile: `devices/sony-walkman-nw-a-series.md` (updated this session to add NW-A1200 to the per-model PID table, document `MEDIAGO/MediaGo.xml` as a new detection signal, and clarify that PIDs follow hardware platform — not capacity or generation — and that DB version is mutable per device).
- Inventory entry: `documents/test-devices.md` §"Sony Walkman NW-A1200 (8GB HDD)" (added this session).

## Open research questions

1. **Why does NW-A1200 (DB v2.0) share a PID with NW-A1000 (DB v1.1)?** PID identifies hardware platform; DB version identifies the last software that wrote to it. The A1000 unit captured here was last touched by an older SonicStage that wrote v1.1; the A1200 was kept current with Media Go through 2022 and now carries v2.0. Both could theoretically be upgraded to v2.0 by syncing with Media Go.
2. **Media Go vs SonicStage differences in OMGAUDIO/ writes.** Both write OpenMG-encoded `.OMA` files into `10FXX/` directories and update `04CNTINF.DAT` etc. — but does Media Go write different chunk fields (e.g. higher-resolution artwork, different audio frame formats) that SonicStage cannot read back? Cross-syncing one device between SonicStage and Media Go would resolve.
3. **The `30GRCT/` directory empty case.** Empty on every captured NW-A device that has it (A1200, A3000). Hypothesis: it only gains content when the user uses the "Recently Played" feature or the "Group Recently Added" view extensively. Worth confirming.
4. **Windows IndexerVolumeGuid / WPSettings.dat — do these confuse the device?** Probably no, FAT32 firmware ignores files it doesn't recognize, but worth confirming on a fresh Walkman-restore-after-Windows-use cycle.
