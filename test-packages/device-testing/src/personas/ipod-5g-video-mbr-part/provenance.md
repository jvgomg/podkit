# Provenance — ipod-5g-video-mbr-part

**Source:** synthesised (no direct hardware capture).

## Identity

USB identity, SysInfoExtended, and firmware capabilities are inherited verbatim
from the physically-captured `ipod-video-5g-iflash-1tb` persona (TERAPOD, iPod
5th Generation Video). The SIE XML is imported directly from that persona's
`raw/sysinfo-extended.xml`; only the USB product id differs (`0x120a` vs
`0x1209`) so this gadget's `/dev/sd<x>` node is unambiguous when both personas
are known to the harness. The two are never bound simultaneously.

## What is synthesised, and why

This persona exists to model the **MBR-partitioned FAT32 on-disk shape** that a
real MBR/FAT32 iPod presents on a host: a disk (`/dev/sd<x>`) carrying a single
FAT32 data partition (`/dev/sd<x>1`, `type: "part"`). The sibling
`ipod-video-5g-iflash-1tb` synthesises its backing as a whole-disk FAT
(`mkfs.vfat` on the bare image, no partition table), which is faster but
presents the gadget as a bare `disk` — it does not exercise the partition
detection branch of the daemon device poller, nor the CLI's partition-suffix
stripping.

The backing image is built in-VM by
`runners/lima-test-vm-backing-files.ts` when `synthesis.partitioned` is set: a
fixed-signature `dos` MBR (via `sfdisk label-id`) with one FAT32-LBA partition
starting at LBA 2048, formatted with `mkfs.vfat --invariant` through a
`losetup --partscan` loop device so the mkfs targets the partition node. The
result is byte-deterministic across runs (verified: two builds hash
identically), matching the reproducibility contract of the whole-disk path.

The image is empty (no iTunesDB). Consumers that need a seeded database
(e.g. the Tier-5 daemon lsblk-lane test) seed it via `gpod-tool init` after
mounting the partition — seeding a partitioned image via `initialContent` is
intentionally unsupported (the mtools seed path targets a bare FAT image, not a
partition offset).

## Real-hardware layout reference

The captured TERAPOD (`ipod-video-5g-iflash-1tb/provenance.md`) is a single MBR
partition (FAT32) at sectors 48195..490889790, with ~94 MiB of reserved
firmware space ahead of it. This persona models the presentation shape (disk +
`sd?1` FAT32 partition) rather than the exact sector geometry — 256 MiB models a
plausible data volume cheaply, and the ~94 MiB firmware gap is captured in
`partitionLayout` for documentation, not reproduced on the synthesised image.
