# Provenance: ipod-nano-7g-blue

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka (Debian 12, kernel 6.1.0-41-amd64)
**Hardware serial:** `000A270024565D97` (FireWire GUID; also USB serial)
**Apple serial:** `DCYL44J8F0GP` (serial-suffix `0GP` → `D477`)
**Apple model number:** D477 (16GB Blue, 7th Generation)

## Mac capture session

- Date / time: 2026-05-13
- Volume: `iPod` (lowercase) mounted at `/Volumes/iPod`
- Disk: `/dev/disk4` (Apple_partition_scheme, 15798411264 bytes total)
- Commands run:
  - `system_profiler SPUSBDataType -json` → `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk4` → `raw/diskutil.plist`
- Notes:
  - `vendor_id` reported as `"apple_vendor_id"`; encoded as `0x05ac`.
  - USB `bDeviceClass / bDeviceSubclass / bDeviceProtocol` not surfaced — Linux sysfs confirmed `0/0/0`.
  - APM (Apple Partition Map) scheme — same as nano 4G. `diskutil` shows APM header (253952 bytes) + HFS+ data (15798108160 bytes); any hidden `Apple_MDFW` firmware partition will be revealed in the Linux session.
  - Volume name is lowercase `iPod` — distinguishes from nano 7G #1 Space Gray's uppercase `IPOD`.
  - hashAB checksum generation — current podkit `device add` refuses unsupported generations; warn-but-allow gate is backlog.

## Linux capture session

- Date / time: 2026-05-13
- Capture host: linka (Debian 12, kernel 6.1.0-41-amd64)
- Device node: `/dev/sdc` (two partitions: `sdc1` APM header, `sdc2` HFS+)
- USB enumeration: `lsusb` → `ID 05ac:1267 Apple, Inc. iPod Nano 7.Gen`
- Commands run: same script as nano 4G — `lsblk -J -O`, `udevadm info`, sysfs USB descriptor dump.

### USB descriptor sysfs reconciliation (vs Mac ioreg)

| Field | Mac ioreg | Linux sysfs | Status |
|-------|-----------|-------------|--------|
| `idVendor` | `0x05ac` | `0x05ac` | ✓ agree |
| `idProduct` | `0x1267` | `0x1267` | ✓ agree |
| `serial` (USB descriptor) | `000A270024565D97` | `000A270024565D97` | ✓ agree |
| `bDeviceClass` | `0` | `0` | ✓ agree |
| `bDeviceSubClass` | `0` | `0` | ✓ agree |
| `bDeviceProtocol` | `0` | `0` | ✓ agree |
| `bMaxPacketSize0` | `64` | `64` | ✓ agree |
| `bcdDevice` | `0x0001` | `0x0001` | ✓ agree |
| `bcdUSB` / `version` | `0x0200` | `2.00` | ✓ agree |
| `bNumConfigurations` | `1` | `2` | **divergence — matches nano 3G/4G; Apple two-config descriptor (MSC + iAP)** |
| `manufacturer` | `Apple Inc.` | `Apple Inc.` | ✓ agree |
| `product` | `iPod` | `iPod` | ✓ agree |

### Resolved Mac-session hypothesis — hidden Apple_MDFW

Same finding as nano 4G. **Linux confirms no hidden Apple_MDFW.** `lsblk -J -O /dev/sdc` shows exactly two partitions, same as Mac diskutil:

```
sdc        14.7G                                                  4096 B sectors
├─sdc1     248K   Apple_partition_map           start=8     (512-byte units)
└─sdc2     14.7G  Apple_HFS / hfsplus           start=512    UUID 0d9f9053-...
```

`pttype: "mac"` (APM) at the disk and child level. Persona `partitionLayout` correct as captured.

### Linux-side new observations

- **HFS+ filesystem UUID matches Mac.** Linux: `0d9f9053-6ce5-3c9c-9e4d-7605622b16aa`. Mac diskutil: `0D9F9053-6CE5-3C9C-9E4D-7605622B16AA`. Same volume, case-only difference — HFS+ UUIDs are portable across hosts (unlike FAT32's macOS-side regenerated UUID).
- **HFS+ partition starts at sector 512** (= 256 KiB into disk) — slightly earlier than nano 4G's sector 520 (= 260 KiB). The APM map table on this unit is ~252 KiB vs nano 4G's ~256 KiB. Cosmetic; both well-formed APM layouts.
- **`log-sec: 4096`, `phy-sec: 4096`** — 4096-byte device sectors (same as nano 3G/4G; Apple flash convention).
- **`pttype: "mac"`**, **`parttype: "Apple_partition_map"`** + **`Apple_HFS"`** — same pattern as nano 4G.

### Linux capture status

Complete. `lsblkJson` populated; APM hypothesis resolved (no hidden Apple_MDFW); HFS+ UUID confirmed portable.

## SysInfoExtended source

- Origin: `documents/sysinfo-captures/nano-7g-16gb-blue-usb.xml`
- Copied to: `raw/sysinfo-extended.xml`
- Inquiry transport used: USB (preferred; includes per-read crypto blob — otherwise content-identical to nano 7G #1)
- Size: 47,000 bytes

## Expected-* fields status

Provisional. Stubs based on generation table + SIE highlights (nano 7G capabilities). The compute-expected pass (per TASK-321.02 ACs) re-derives these against the production resolvers.

## Cross-references

- Inventory entry: `documents/test-devices.md` §"iPod nano 7th Generation #2 (16GB Blue)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- TASK-321.02 (persona capture starter set)
