# Provenance: ipod-video-5g-iflash-1tb

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — Linux capture deferred (see Linux capture session below)
**Hardware serial:** `000A27001605D1A0` (FireWire GUID; also USB serial)
**Apple serial:** `9C642MEFV9M` (serial-suffix `V9M` → `A446`, 30GB 5.5th Generation)
**Apple model number:** A446 (per serial-suffix lookup; SysInfo `ModelNumStr` claims `MA147` — see "Identity discrepancy" below)
**Modifications:** iFlash adapter replacing original 30 GB hard drive with 1 TB flash storage.

## Mac capture session

- Date / time: 2026-05-13
- Volume: `TERAPOD` — recognized as FAT32 but **not auto-mounted** during capture (no `MountPoint` key in plist). Per `documents/test-devices.md`, manual mount target is `/private/tmp/podkit-TERAPOD`.
- Disk: `/dev/disk4` (FDisk_partition_scheme, 1003294294016 bytes total, 2048-byte sectors)
- Commands run:
  - `system_profiler SPUSBDataType -json` → `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk4` → `raw/diskutil.plist`
  - `sudo fdisk /dev/disk4` — read MBR partition table
- Notes:
  - `vendor_id` reported as `"apple_vendor_id"`; encoded as `0x05ac`.
  - USB `bDeviceClass / bDeviceSubclass / bDeviceProtocol` not surfaced — set to `0` per the composite-device convention confirmed across the four sibling personas that completed Linux capture this session.
  - Single MBR partition (FAT32) at sectors 48195..490889790 (2048-byte sectors). Sectors 0..48194 (~94 MiB) are unallocated reserved space holding iPod 5G firmware — same pattern as nano 2G and mini 2G. Encoded as `index: 1, type: 'firmware'`.
  - Volume not auto-mounted by macOS during capture — `partitionLayout.partitions[1].mountpoint` is omitted. Downstream consumers should mount on demand.
  - iFlash mod note: the 1 TB capacity is visible to the OS but does not appear in firmware identity (SCSI inquiry reads device firmware, unaffected by storage replacement).

## Identity discrepancies (from test-devices.md)

- USB PID `0x1209` is shared across Video 5G, 5.5G, Classic 6G — podkit maps it to `classic_6g` (wrong for this device).
- Serial suffix `V9M` says video_5_5g / A446 / 30 GB.
- SysInfo `ModelNumStr: MA147` claims video_5g / 60 GB — likely manually written or by a previous tool; serial is the trusted identity source.

## Linux capture session

Deferred. Linux captures completed this session for four representative personas (see `ipod-nano-3g-black`, `ipod-nano-4g-black`, `ipod-nano-7g-blue`, `echo-mini`) establish the host-side reconciliation pattern. Linux output for this MBR/FAT32 iPod is expected to follow the same shape:

- USB descriptor `bDeviceClass / Subclass / Protocol` matching Mac ioreg's `0/0/0`.
- `bNumConfigurations` reading 2 on Linux (Apple two-config descriptor MSC + iAP).
- `lsblk -J -O /dev/sdX` confirming the Mac-captured MBR/FAT32 partition layout. iFlash storage replacement does not affect partition presentation to the host.

`lsblkJson` stays `null` until a per-device need arises.

## SysInfoExtended source

- Origin: `documents/sysinfo-captures/ipod-5g-video-iflash-1tb.xml`
- Copied to: `raw/sysinfo-extended.xml`
- Inquiry transport used: SCSI (USB inquiry fails on iPod 5G — pre-nano-3G boundary)
- Size: 9,693 bytes

## Expected-* fields status

Provisional. Stubs from generation table + SIE highlights (video codecs H.264 Baseline L1.3, H.264LC L3.0, MPEG-4; artwork up to 200×200). The compute-expected pass (per TASK-321.02 ACs) re-derives these against the production resolvers.

## Mass-storage backing file (VM synthesis)

**Source:** synthesised inside `podkit-device` at `prepare()` time — no
host-side artefact, no committed binary, no git LFS.

**Recipe:** `massStorageBackingFile.synthesis = { sizeMiB: 256, filesystem:
'FAT32', label: 'IPOD_VIDEO' }` in `persona.ts`.

**mkfs.vfat invocation (from `runners/lima-test-vm-backing-files.ts`):**

```
truncate -s 256M /var/device-testing/backing-files/ipod-video-5g-iflash-1tb.img
mkfs.vfat --invariant -F 32 -n IPOD_VIDEO -I <path>
```

**Why FAT32:** podkit refuses HFS+ on Linux (TASK-317.12). FAT32 is the
universal iPod filesystem and the only one VM supports. The 5G's
historical default is FAT32/MBR for the storage partition; the iFlash
modification preserves that layout.

**Why 256 MiB:** small enough that synthesis is sub-second and re-running
the suite is cheap; large enough to host an iTunesDB + a handful of tracks
when future variants seed content. The real device is 1 TB — wildly
irrelevant to the inquiry-methods code path the daemon exercises.

**Why empty:** TASK-348 starter content policy — model a fresh iPod, not a
populated one. Future personas may seed `iPod_Control/Music/` or an
iTunesDB skeleton; out of scope here.

**Determinism:** `mkfs.vfat --invariant` fixes the FAT volume ID, the OEM
string, and any creation timestamps that would otherwise be random or
time-based. Re-running the recipe produces byte-identical output across
hosts, kernels, and tool versions (within the 4.x mkfs.vfat series). The
runner sha256-probes the result before and after; a non-deterministic
output would be caught.

**Source of truth:** the recipe in `persona.ts`. Re-derive the image at
any time with `bun run build:backing-file ipod-video-5g-iflash-1tb` (from
`test-packages/device-testing/`).

## Cross-references

- Inventory entry: `documents/test-devices.md` §"iPod 5th Generation Video (iFlash 1TB mod)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- TASK-321.02 (persona capture starter set)
- TASK-348 — mass-storage backing-file synthesis
- TASK-317.12 — HFS+ refusal on Linux (why FAT32)
