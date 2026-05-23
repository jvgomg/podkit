# Provenance: ipod-nano-7g-space-gray

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — Linux capture deferred (see Linux capture session below)
**Hardware serial:** `000A270024A23E9E` (FireWire GUID; also USB serial)
**Apple serial:** `DCYN72R8FJQ1` (serial-suffix `FJQ1` — not in podkit's serial-to-model lookup table; family + variant inferred via SCSI/USB inquiry)
**Apple model number:** unknown — serial suffix `FJQ1` not in podkit's lookup table (see `documents/test-devices.md`)

## Mac capture session

- Date / time: 2026-05-13
- Volume: `IPOD` (uppercase) mounted at `/Volumes/IPOD`
- Disk: `/dev/disk4` (FDisk_partition_scheme, 15798411264 bytes total, 4096-byte sectors)
- Commands run:
  - `system_profiler SPUSBDataType -json` → `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk4` → `raw/diskutil.plist`
  - `sudo fdisk /dev/disk4` — read MBR partition table
- Notes:
  - `vendor_id` reported as `"apple_vendor_id"`; encoded as `0x05ac`.
  - USB `bDeviceClass / bDeviceSubclass / bDeviceProtocol` not surfaced — set to `0` per the composite-device convention confirmed across the four sibling personas that completed Linux capture this session.
  - Single MBR partition (FAT32) at sectors 63..3857032 — same pattern as nano 3G. Only ~252 KiB of reserved space before; firmware lives in NOR flash. No synthetic firmware entry needed.
  - 4096-byte device sectors (matches nano 3G).
  - Contrast with sibling nano 7G #2 Blue (`ipod-nano-7g-blue`): identical PID `0x1267` but different filesystem (FAT32/MBR vs HFS+/APM) and uppercase volume name (`IPOD` vs `iPod`).
  - hashAB checksum — current podkit `device add` refuses unsupported generations; warn-but-allow is backlog.

## Linux capture session

Deferred. Linux captures completed this session for four representative personas (see `ipod-nano-3g-black`, `ipod-nano-4g-black`, `ipod-nano-7g-blue`, `echo-mini`) establish the host-side reconciliation pattern. Linux output for this MBR/FAT32 iPod is expected to follow the same shape:

- USB descriptor `bDeviceClass / Subclass / Protocol` matching Mac ioreg's `0/0/0`.
- `bNumConfigurations` reading 2 on Linux (Apple two-config descriptor MSC + iAP).
- `lsblk -J -O /dev/sdX` confirming the Mac-captured MBR/FAT32 partition layout (`pttype: "dos"`, parttype byte `0xb`).

`lsblkJson` stays `null` until a per-device need arises.

## SysInfoExtended source

- Origin: `documents/sysinfo-captures/nano-7g-16gb-usb.xml` (preferred — playbook also lists a `-scsi.xml` for this device but USB carries 14x more data)
- Copied to: `raw/sysinfo-extended.xml`
- Inquiry transport used: USB
- Size: 47,100 bytes

## Expected-* fields status

Provisional. Stubs from generation table + SIE highlights. The compute-expected pass (per TASK-321.02 ACs) re-derives these against the production resolvers.

## Mass-storage backing file (Tier-3 synthesis)

**Source:** synthesised inside `podkit-test-vm` at `prepare()` time — no
host-side artefact, no committed binary, no git LFS.

**Recipe:** `massStorageBackingFile.synthesis = { sizeMiB: 128, filesystem:
'FAT32', label: 'IPOD_NANO' }` in `persona.ts`.

**mkfs.vfat invocation (from `runners/lima-test-vm-backing-files.ts`):**

```
truncate -s 128M /var/device-testing/backing-files/ipod-nano-7g-space-gray.img
mkfs.vfat --invariant -F 32 -n IPOD_NANO -I <path>
```

**Why FAT32:** matches the captured real-device layout (`partitionLayout`
above) and contrasts with sibling `ipod-nano-7g-blue` which is HFS+/APM.
HFS+ synthesis is out of scope (TASK-317.12 — podkit refuses HFS+ on
Linux at `device-add`).

**Why 128 MiB:** smaller than the 5G's 256 MiB recipe because the 7G has
no on-disk firmware partition (firmware is in NOR flash). The whole image
is user-data space; 128 MiB is plenty for an iTunesDB + a handful of
tracks once future variants seed content.

**Why empty:** TASK-348 starter content policy — model a fresh iPod. The
real device captured 6,103 tracks in `system_profiler` output, but that
data is not relevant to the inquiry-methods code path the daemon
exercises. Future variants may seed marker files.

**Determinism:** `mkfs.vfat --invariant` fixes the FAT volume ID, OEM
string, and any timestamps. Re-running the recipe is byte-identical.

**Source of truth:** the recipe in `persona.ts`. Re-derive with
`bun run build:backing-file ipod-nano-7g-space-gray` from
`packages/device-testing/`.

## Cross-references

- Inventory entry: `documents/test-devices.md` §"iPod nano 7th Generation (16GB)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- TASK-321.02 (persona capture starter set)
- TASK-348 — mass-storage backing-file synthesis
- TASK-317.12 — HFS+ refusal on Linux (why FAT32)
