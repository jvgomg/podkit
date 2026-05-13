# Provenance: ipod-mini-2g-pink

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — Linux capture deferred (see Linux capture session below)
**Hardware serial:** `000A270014198517` (FireWire GUID; also USB serial)
**Apple serial:** `JQ5141TFS4G` (from SysInfo `pszSerialNumber`)
**Apple model number:** 9804 (`P9804` in SysInfo `ModelNumStr`)

## Mac capture session

- Date / time: 2026-05-13
- Volume: `SALLYS IPOD` mounted at `/Volumes/SALLYS IPOD`
- Disk: `/dev/disk4` (FDisk_partition_scheme, 4095737856 bytes total)
- Commands run:
  - `system_profiler SPUSBDataType -json` — Apple iPod mini subtree extracted to `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk4` → `raw/diskutil.plist`
  - `sudo fdisk /dev/disk4` — read MBR partition table (output not committed; layout encoded into `partitionLayout`)
- Notes:
  - `vendor_id` reported by `system_profiler` as the literal string `"apple_vendor_id"` rather than `"0x05ac"`. Encoded as `0x05ac` in the persona based on inventory cross-reference.
  - USB `bDeviceClass / bDeviceSubclass / bDeviceProtocol` not surfaced by `system_profiler` — set to `0` per the composite-device convention confirmed across the four sibling personas that completed Linux capture this session.
  - Single MBR partition (FAT32) starting at sector 80325. Sectors 0..80324 (~39 MiB) are unallocated reserved space holding iPod firmware. Encoded as a synthetic `index: 1, type: 'firmware'` entry in `partitionLayout` so consumers see the firmware region explicitly.
  - Partition-type mapping: `DOS_FAT_32` (plist `Content`) → `"FAT32"`.
  - USB product ID `0x1205` is shared between mini 1G and 2G per linux-usb.org. `packages/devices-ipod/src/tables/usb-ids.ts:36-41` documents this and intentionally maps `0x1205` to `mini_1g` with the generic display name `"iPod mini"`; precise generation comes from the USB-then-SysInfo cascade via SysInfo `FamilyID = 3` (→ `mini_2g`). The cascade is doing exactly what it's designed to do. (Earlier provenance characterized this as a "known podkit bug" — corrected 2026-05-13.)

## Linux capture session

Deferred. Linux captures completed this session for four representative personas — `ipod-nano-3g-black` (MBR/FAT32, 4 KiB sectors), `ipod-nano-4g-black` (APM/HFS+), `ipod-nano-7g-blue` (APM/HFS+), and `echo-mini` (multi-LUN) — establish the host-side reconciliation pattern. Linux output for this device is expected to follow the same shape:

- USB descriptor `bDeviceClass / Subclass / Protocol` matching Mac ioreg's `0/0/0` (composite-device convention).
- `bNumConfigurations` reading 2 on Linux vs 1 on Mac (Apple two-config descriptor: MSC + iAP). Documented under `ipod-nano-3g-black/provenance.md` § "USB descriptor sysfs reconciliation".
- `lsblk -J -O /dev/sdX` confirming the Mac-captured MBR/FAT32 partition layout (`pttype: "dos"`, parttype byte `0xb` or `0xc`).

`lsblkJson` stays `null` until a per-device need arises (e.g. a Tier 3 USB-replay test needs the exact payload, or this device shows partition geometry diverging from the four reconciled patterns). Re-plug and re-run the same capture commands used for the completed personas to populate.

## SysInfoExtended source

- Origin: `documents/sysinfo-captures/mini-2g.xml`
- Copied to: `raw/sysinfo-extended.xml`
- Inquiry transport used: SCSI (USB inquiry fails on mini 2G — see `documents/test-devices.md`)
- Size: 2,413 bytes (smallest capture in the inventory — no artwork, no video)

## Expected-* fields status

Provisional. Values stubbed from the generation table (`mini_2g`: `supportsAlac: true`, no artwork, no video) plus iPod defaults (`audioNormalization: 'soundcheck'`, `supportsAlbumArtistBrowsing: false`). The compute-expected pass (per TASK-321.02 ACs) re-derives these by invoking `resolveCapabilities` + `checkReadiness` against this persona's inputs.

## Cross-references

- Inventory entry: `documents/test-devices.md` §"iPod mini 2nd Generation (4GB Pink)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- TASK-321.02 (persona capture starter set)
