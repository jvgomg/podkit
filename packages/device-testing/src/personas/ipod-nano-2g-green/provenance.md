# Provenance: ipod-nano-2g-green

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — Linux capture deferred (see Linux capture session below)
**Hardware serial:** `000A27001A0647CB` (FireWire GUID; also USB serial)
**Apple serial:** `YM7275YSVQH` (from SCSI inquiry / serial-suffix VQH → A487)
**Apple model number:** A487 (4GB Green, 2nd Generation)

## Mac capture session

- Date / time: 2026-05-13
- Volume: `PARTY IPOD` mounted at `/Volumes/PARTY IPOD`
- Disk: `/dev/disk4` (FDisk_partition_scheme, 4060086272 bytes total, 2048-byte sectors)
- Commands run:
  - `system_profiler SPUSBDataType -json` → `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk4` → `raw/diskutil.plist`
  - `sudo fdisk /dev/disk4` — read MBR partition table
- Notes:
  - `vendor_id` reported as `"apple_vendor_id"`; encoded as `0x05ac`.
  - **Inventory doc discrepancy:** `documents/test-devices.md` lists this device's USB Product ID as `0x1205`, but live capture reports `0x1260`. Persona uses `0x1260` (live capture is authoritative). Inventory doc should be corrected on the next sweep.
  - USB `bDeviceClass / bDeviceSubclass / bDeviceProtocol` not surfaced — set to `0` per the composite-device convention confirmed across the four sibling personas that completed Linux capture this session.
  - Single MBR partition (FAT32) starting at sector 48195. Sectors 0..48194 (~94 MiB) are unallocated reserved space holding iPod firmware — same pattern as mini 2G and iPod 5G Video. Encoded as a synthetic `index: 1, type: 'firmware'` entry.
  - Note: 2048-byte device sectors (different from mini 2G's 512 and nano 3G's 4096).

## Linux capture session

Deferred. Linux captures completed this session for four representative personas (see `ipod-nano-3g-black`, `ipod-nano-4g-black`, `ipod-nano-7g-blue`, `echo-mini`) establish the host-side reconciliation pattern. Linux output for this MBR/FAT32 iPod is expected to follow the same shape:

- USB descriptor `bDeviceClass / Subclass / Protocol` matching Mac ioreg's `0/0/0`.
- `bNumConfigurations` reading 2 on Linux (Apple two-config descriptor MSC + iAP).
- `lsblk -J -O /dev/sdX` confirming the Mac-captured MBR/FAT32 partition layout (`pttype: "dos"`, parttype byte `0xb`).

`lsblkJson` stays `null` until a per-device need arises.

## SysInfoExtended source

- Origin: `documents/sysinfo-captures/nano-2g-4gb-green.xml`
- Copied to: `raw/sysinfo-extended.xml`
- Inquiry transport used: SCSI (USB inquiry fails on nano 2G)
- Size: 6,280 bytes

## Expected-* fields status

Provisional. Values stubbed from generation table (`nano_2g`: `supportsAlac: false`, `supportsVideo: false`, artwork 176x132) plus iPod defaults. Audio codecs from SIE highlights in `documents/test-devices.md`: AAC, MP3, AIFF, WAV (no ALAC — diverges from generation-table default; the compute-expected pass per TASK-321.02 ACs will reconcile this).

## Cross-references

- Inventory entry: `documents/test-devices.md` §"iPod nano 2nd Generation (4GB Green)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- TASK-321.02 (persona capture starter set)
