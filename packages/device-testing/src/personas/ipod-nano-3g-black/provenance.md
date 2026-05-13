# Provenance: ipod-nano-3g-black

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka (Debian 12, kernel 6.1.0-41-amd64)
**Hardware serial:** `000A27001BC8EED6` (FireWire GUID; also USB serial)
**Apple serial:** `XXXXXXXXEED6` (from SysInfoExtended)

## Mac capture session

- Date / time: 2026-05-13
- Volume: `IPOD` mounted at `/Volumes/IPOD`
- Disk: `/dev/disk4` (FDisk_partition_scheme, 7952142336 bytes total, 4096-byte sectors)
- Commands run:
  - `system_profiler SPUSBDataType -json` — Apple iPod subtree extracted to `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk4` → `raw/diskutil.plist`
  - `sudo fdisk /dev/disk4` — read MBR partition table
- Notes:
  - `vendor_id` reported as `"apple_vendor_id"`; encoded as `0x05ac`.
  - USB `bDeviceClass / bDeviceSubclass / bDeviceProtocol` not surfaced by `system_profiler` — Linux sysfs confirmed `0/0/0` (see Linux capture session below).
  - Single MBR partition (FAT32) at sectors 63..1941439. Only ~252 KiB of reserved space before — MBR padding only. Unlike mini 2G, nano 3G has no on-disk firmware partition (firmware in NOR flash). `partitionLayout` reflects this with a single FAT32 entry.
  - Note: 4096-byte device sectors (different from mini 2G's 512-byte).
  - Partition lives at `disk4s1` (not `disk4s2` like the mini).

## Linux capture session

- Date / time: 2026-05-13
- Capture host: linka (Debian 12, kernel 6.1.0-41-amd64)
- Device node: `/dev/sdc` (single LUN, single partition `/dev/sdc1`)
- USB enumeration: `lsusb` → `ID 05ac:1262 Apple, Inc. iPod Nano 3.Gen`
- Commands run:
  - `lsblk -J -O /dev/sdc` → `raw/lsblk.json`
  - `udevadm info -q all -n /dev/sdc` → `raw/udev.txt`
  - `cat /sys/.../usb1/1-1/{idVendor,idProduct,serial,bDeviceClass,bDeviceSubClass,bDeviceProtocol,bcdDevice,bMaxPacketSize0,bNumConfigurations,manufacturer,product,version}` → `raw/sysfs-usb.txt`

### USB descriptor sysfs reconciliation (vs Mac ioreg)

| Field | Mac ioreg | Linux sysfs | Status |
|-------|-----------|-------------|--------|
| `idVendor` | `0x05ac` | `0x05ac` | ✓ agree |
| `idProduct` | `0x1262` | `0x1262` | ✓ agree |
| `serial` (USB descriptor) | `000A27001BC8EED6` | `000A27001BC8EED6` | ✓ agree |
| `bDeviceClass` | `0` | `0` | ✓ agree |
| `bDeviceSubClass` | `0` | `0` | ✓ agree |
| `bDeviceProtocol` | `0` | `0` | ✓ agree |
| `bMaxPacketSize0` | `64` | `64` | ✓ agree |
| `bcdDevice` | `0x0001` | `0x0001` | ✓ agree |
| `bcdUSB` / `version` | `0x0200` | `2.00` | ✓ agree |
| `bNumConfigurations` | `1` | `2` | **divergence — Linux value is authoritative; see note** |
| `manufacturer` | `Apple Inc.` | `Apple Inc.` | ✓ agree |
| `product` | `iPod` | `iPod` | ✓ agree |

**`bNumConfigurations` divergence is expected, not a bug.** Linux value (`2`) is authoritative — sysfs reads from the cached USB device descriptor regardless of which configuration is active. macOS `ioreg -p IOUSB` typically reports only the currently-selected configuration (post-`SET_CONFIGURATION`). Apple iPods advertise **two configurations** in their device descriptor:

- **Config 1** — USB Mass Storage (disk mode; what podkit uses)
- **Config 2** — iAP / iPod sync protocol (used by iTunes / iOS hosts)

Same pattern will surface on every other iPod in the inventory. No persona schema change here — the current `DevicePersona.usbDescriptor` is single-config-flat (one set of class/subclass/protocol). A full configurations[] / interfaces[] / endpoints[] hierarchy is already flagged as a known schema gap by the ADR-017 reviewer for Tier 3 FunctionFS synthesis, and will land as one coordinated extension when Tier 3 needs it — not piecemeal.

### Linux-side new observations

- **Partition table UUID = `20202020`** (all spaces, the FAT32 default). Mac's diskutil exposed only the volume UUID (`AB8977B6-C5CA-3C4D-9EB0-060322E44A90`, macOS-internal). Linux exposes the on-disk partition-table identifier (4 bytes of `0x20`). Indicates the MBR was never written with an explicit signature — typical of Apple's iPod firmware.
- **Partition UUID = `20202020-01`** (partition 1, suffix-appended).
- **FAT32 volume serial = `968A-2063`** (32-bit on-disk serial; different from macOS's 128-bit-UUID representation).
- **`parttype: "0xb"` / `parttypename: "W95 FAT32"`** — matches Mac fdisk's `0B` partition-type byte.
- **Sector start in lsblk = `504`**. The lsblk `start` field is in 512-byte units; 504 × 512 = 258,048 B = same physical offset as Mac fdisk's "sector 63" reported in 4096-byte-sector units (63 × 4096 = 258,048 B). Consistent across tools — Linux normalises sector counts to 512-byte units regardless of device-native sector size.
- **`log-sec: 4096` / `phy-sec: 4096`** — confirms the device-native 4096-byte sectors observed via Mac fdisk.
- **`rota: true`** — Linux defaults `QUEUE/rotational` to true for USB Mass Storage devices regardless of underlying medium. Nano 3G is solid-state flash; this is a Linux-driver default, not a hardware property. Cosmetic.
- **`fsver: "FAT32"`, `fstype: "vfat"`** — confirms FAT32.
- **udev exposes `ID_SERIAL_SHORT=000A27001BC8EED6`** — Linux uses the iPod's FireWire GUID as `ID_SERIAL_SHORT`. Useful detection key.

### Linux capture status

Complete. `lsblkJson` field on the persona is now populated; all USB-descriptor checks reconciled; one `bNumConfigurations` discrepancy noted but does not affect the persona.

## SysInfoExtended source

- Origin: `documents/sysinfo-captures/nano-3g-8gb-black.xml`
- Copied to: `raw/sysinfo-extended.xml`
- Inquiry transport used: USB (preferred — nano 3G boundary case; SIE is byte-stable across reads, no per-read crypto blob)
- Size: 12,131 bytes

## Expected-* fields status

Provisional. Values stubbed from generation table (`nano_3g`: `supportsAlac: true`, `supportsVideo: true`, artwork 320x240) plus iPod defaults. The compute-expected pass (per TASK-321.02 ACs) re-derives these by invoking `resolveCapabilities` + `checkReadiness` against this persona's inputs.

## Cross-references

- Inventory entry: `documents/test-devices.md` §"iPod nano 3rd Generation (8GB Black)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- TASK-321.02 (persona capture starter set)
