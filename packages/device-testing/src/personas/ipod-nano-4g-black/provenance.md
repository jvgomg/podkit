# Provenance: ipod-nano-4g-black

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka (Debian 12, kernel 6.1.0-41-amd64)
**Hardware serial:** `000A27001DCECFB5` (FireWire GUID; also USB serial)
**Apple serial:** `5U851AEH3R0` (from SCSI inquiry / SysInfoExtended)
**Apple model number:** B754 (8GB Black, 4th Generation)

## Mac capture session

- Date / time: 2026-05-13
- Volume: `James' iPod` mounted at `/Volumes/James' iPod`
- Disk: `/dev/disk4` (Apple_partition_scheme, 7971016704 bytes total)
- Commands run:
  - `system_profiler SPUSBDataType -json` → `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk4` → `raw/diskutil.plist`
- Notes:
  - `vendor_id` reported as `"apple_vendor_id"`; encoded as `0x05ac`.
  - USB `bDeviceClass / bDeviceSubclass / bDeviceProtocol` not surfaced by `system_profiler` — Linux sysfs confirmed `0/0/0`.
  - **First APM-formatted persona** in this set. Apple Partition Map scheme rather than MBR — fdisk is not applicable for inspection. `diskutil` shows two entries: `disk4s1` (Apple_partition_map header, 253952 bytes) + `disk4s2` (HFS+ Journaled, 7970623488 bytes).
  - Standard Apple iPod-Updater layout for HFS+ iPods includes an `Apple_MDFW` firmware partition between the APM header and the HFS+ data partition. `diskutil list` does not show this partition (it does not display non-mountable types by default). The Linux session will reveal whether an `Apple_MDFW` partition exists on this device; if so, append it to `partitionLayout` between indices 1 and 2.
  - Partition-type mapping: `Apple_partition_map` (plist `Content`) → `"apple_partition_map"`; `Apple_HFS` → `"HFS+"`.

## Linux capture session

- Date / time: 2026-05-13
- Capture host: linka (Debian 12, kernel 6.1.0-41-amd64)
- Device node: `/dev/sdc` (two visible partitions: `/dev/sdc1` APM header, `/dev/sdc2` HFS+ data)
- USB enumeration: `lsusb` → `ID 05ac:1263 Apple, Inc. iPod Nano 4.Gen`
- Commands run:
  - `lsblk -J -O /dev/sdc` → `raw/lsblk.json`
  - `udevadm info -q all -n /dev/sdc{,1,2}` → `raw/udev.txt`
  - sysfs USB descriptor dump → `raw/sysfs-usb.txt`

### USB descriptor sysfs reconciliation (vs Mac ioreg)

| Field | Mac ioreg | Linux sysfs | Status |
|-------|-----------|-------------|--------|
| `idVendor` | `0x05ac` | `0x05ac` | ✓ agree |
| `idProduct` | `0x1263` | `0x1263` | ✓ agree |
| `serial` (USB descriptor) | `000A27001DCECFB5` | `000A27001DCECFB5` | ✓ agree |
| `bDeviceClass` | `0` | `0` | ✓ agree |
| `bDeviceSubClass` | `0` | `0` | ✓ agree |
| `bDeviceProtocol` | `0` | `0` | ✓ agree |
| `bMaxPacketSize0` | `64` | `64` | ✓ agree |
| `bcdDevice` | `0x0001` | `0x0001` | ✓ agree |
| `bcdUSB` / `version` | `0x0200` | `2.00` | ✓ agree |
| `bNumConfigurations` | `1` | `2` | **divergence — matches nano 3G; Apple two-config descriptor (MSC + iAP)** |
| `manufacturer` | `Apple Inc.` | `Apple Inc.` | ✓ agree |
| `product` | `iPod` | `iPod` | ✓ agree |

### Resolved Mac-session hypothesis — hidden Apple_MDFW

Mac diskutil exposed only two partitions: `disk4s1` (Apple_partition_map header, 254 KB) + `disk4s2` (HFS+). Mac-session provenance flagged "standard Apple iPod-Updater layout would also include an `Apple_MDFW` firmware partition between them — if present here it is hidden by diskutil. Linux session will reveal any hidden partition."

**Linux confirms: no hidden Apple_MDFW.** `lsblk -J -O /dev/sdc` shows exactly two partitions:

```
sdc        7.4G                                                  4096 B sectors
├─sdc1     248K   Apple_partition_map           start=8    (512-byte units)
└─sdc2     7.4G   Apple_HFS / hfsplus           start=520
```

`pttype: "mac"` (Apple Partition Map) confirmed at both the disk and child-partition level. The persona's `partitionLayout` (APM header + HFS+ only) is correct as-captured; no additional partition entry needed.

### Linux-side new observations

- **`pttype: "mac"`** — Linux's lsblk identifier for Apple Partition Map (vs `"dos"` for MBR seen on nano 3G). Useful detection signal for APM-formatted devices.
- **`parttype: "Apple_partition_map"`** (sdc1) and **`parttype: "Apple_HFS"`** (sdc2) — Linux exposes the raw APM partition-type strings as-is. These are the original Apple type identifiers (`Apple_partition_map` is the descriptor type, `Apple_HFS` for HFS/HFS+ payload). Match the iocontent values seen in Mac's plist.
- **Sector offsets** in lsblk `start` field (512-byte units): sdc1 at sector 8 (= 4 KiB into disk), sdc2 at sector 520 (= 260 KiB into disk). The APM header is the first 4 KiB (block 0 — boot block + APM driver signature), the APM map table itself is sectors 8–519 (= 256 KiB), then HFS+ data starts. Total APM region ≈ 260 KiB — diskutil's 253,952 B (254 KB) figure was just the APM-map-table portion, missing block 0.
- **`log-sec: 4096`, `phy-sec: 4096`** — same 4096-byte device-native sectors as nano 3G (Apple flash storage convention).
- **Linux does not mount HFS+ by default** — HFS+ filesystem readable but no `/media/...` mount appeared. macOS treats HFS+ as a first-class filesystem; Linux requires explicit mount with `mount -t hfsplus`. Cosmetic for the persona; not a podkit blocker.

### Linux capture status

Complete. `lsblkJson` populated; all USB-descriptor checks reconciled; the Apple_MDFW hypothesis is conclusively resolved (no such partition). Persona `partitionLayout` is correct as captured during the Mac session.

## SysInfoExtended source

- Origin: `documents/sysinfo-captures/nano-4g-8gb-black.xml`
- Copied to: `raw/sysinfo-extended.xml`
- Inquiry transport used: USB (preferred) — also captured via SCSI in prior sessions; USB capture contains a per-read crypto blob (content otherwise identical)
- Size: 14,297 bytes

## Expected-* fields status

Provisional. Values stubbed from generation table (`nano_4g`: `supportsAlac: true`, `supportsVideo: true`, artwork up to 320x240) plus iPod defaults. The compute-expected pass (per TASK-321.02 ACs) re-derives these by invoking `resolveCapabilities` + `checkReadiness` against this persona's inputs.

## Cross-references

- Inventory entry: `documents/test-devices.md` §"iPod nano 4th Generation (8GB Black)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- TASK-321.02 (persona capture starter set)
