/**
 * Pure-TypeScript MBR-wrapped HFS+ image writer.
 *
 * Used by the HFS+-on-Linux refusal Tier-3 scenario. The runner needs a
 * synthesised block image that the kernel partition reader + `blkid`
 * present to podkit's discovery pipeline as a partitioned disk carrying
 * a UUID'd `hfsplus` partition — matching the shape a real Mac-formatted
 * iPod presents on a Linux host. The refusal short-circuits before any
 * mount attempt, so we do NOT produce a fully valid, mountable HFS+
 * volume — just enough on-disk structure that:
 *
 *   - the kernel reads a partition table at the start of the disk;
 *   - blkid identifies the partition's filesystem as `hfsplus`;
 *   - blkid surfaces a UUID for the partition (without one, the Linux
 *     platform's `findIpodDevices()` filter drops the entry — see
 *     `packages/podkit-core/src/device/platforms/linux.ts:199`).
 *
 * # Why pure TypeScript?
 *
 * `hfsprogs` (which provides `mkfs.hfsplus`) is not packaged for arm64 in
 * Debian bookworm — the source recipe restricts it to a small set of archs
 * that the original Mac-OS-X port supports. The device-harness test VM is
 * arm64-on-Apple-Silicon, so we can't shell out to a binary tool. Writing
 * the image from TypeScript:
 *
 *   - works on any host architecture (host runs Node — Lima is irrelevant);
 *   - has zero runtime dependencies (no Docker, no pre-built blob, no apt
 *     contrib repo to coordinate);
 *   - is small (~200 LOC), bounded (the HFS+ on-disk format is frozen
 *     since 2009 — Apple TN1150 is the canonical reference; MBR is older
 *     still);
 *   - produces a sparse file (only ~1 KiB of actual on-disk content per
 *     image, regardless of declared size).
 *
 * # On-disk shape
 *
 * ```
 *   offset 0           MBR sector (512 bytes)
 *     offset 446         partition entry 1 (16 bytes)
 *       type=0xAF (HFS), LBA start=2048, LBA size=<rest of disk>
 *     offset 510         boot signature 0x55 0xAA
 *   offset 512..1MiB   sparse zeros (1 MiB-align convention; matches most
 *                      partitioners' default starting LBA so future
 *                      regressions in lsblk parsing don't surprise us).
 *   offset 1 MiB       start of HFS+ partition.
 *     offset 1 MiB + 1024  HFS+ Volume Header (512 bytes)
 *       signature='H+', version=4, blockSize=4096, totalBlocks=<rest>,
 *       finderInfo[6..7] = non-zero seed → blkid synthesises a UUID.
 * ```
 *
 * # UUID synthesis
 *
 * blkid (libblkid/src/superblocks/hfs.c) reads `finderInfo[6]` and
 * `finderInfo[7]` (two consecutive UInt32 BE words at offsets 80+24 and
 * 80+28 within the Volume Header). When their concatenation is non-zero,
 * blkid hashes the 8 bytes via MD5 and presents the result as the volume
 * UUID — which lsblk surfaces as the `UUID` column. We seed with a
 * stable, distinctively-recognisable 8-byte value so test images produce
 * a deterministic UUID across runs.
 *
 * # All HFS+ values are big-endian
 *
 * HFS+ on-disk format is big-endian regardless of host architecture
 * (legacy of the PowerPC era). MBR is little-endian. Node's
 * `Buffer.writeUInt*BE` / `writeUInt*LE` family does the byte-swap.
 *
 * # See also
 *
 * - Apple TN1150 — HFS+ Volume Format spec (Volume Header, finderInfo).
 * - libblkid HFS+ probe — `libblkid/src/superblocks/hfs.c` (UUID synthesis).
 * - `documents/architecture/testing/vm-testing.md` §5.6 — VM-side rationale.
 * - `packages/podkit-core/src/device/platforms/linux.ts` (`walk()` —
 *   the consumer of the partition-with-UUID shape).
 *
 * @module
 */

import * as fs from 'node:fs';

/** Byte offset of the MBR partition entry table within the boot sector. */
const MBR_PARTITION_TABLE_OFFSET = 446;

/** MBR boot-signature offset. Two bytes (0x55, 0xAA). */
const MBR_SIGNATURE_OFFSET = 510;

/** MBR partition type byte for HFS / HFS+ — `0xAF`. */
const MBR_PARTITION_TYPE_HFS = 0xaf;

/**
 * LBA where the HFS+ partition starts (1 MiB alignment).
 *
 * 1 MiB / 512 B = 2048 sectors. Matches what `parted` / `fdisk` /
 * `sgdisk` produce by default — keeps the synthesised image looking
 * conventional to lsblk parsers.
 */
const PARTITION_START_LBA = 2048;

/** Byte offset of the HFS+ partition's start within the whole disk image. */
export const HFSPLUS_PARTITION_START_OFFSET = PARTITION_START_LBA * 512;

/**
 * Byte offset of the HFS+ Volume Header within its **partition** (not the
 * whole disk). The header sits at sector 2 of the partition.
 */
export const HFSPLUS_VOLUME_HEADER_OFFSET = 1024;

/** Size of the HFS+ Volume Header struct. */
export const HFSPLUS_VOLUME_HEADER_SIZE = 512;

/** Allocation block size we burn into every synthesised header. iPod-default. */
const HFSPLUS_BLOCK_SIZE = 4096;

/**
 * Seed value written into `finderInfo[6..7]` so blkid synthesises a
 * non-zero UUID for the partition. Stable across runs → deterministic
 * UUID, which keeps `lsblk -o UUID` output byte-stable for tests.
 *
 * The actual UUID is the MD5 of these 8 bytes; the bytes themselves
 * never appear in any user-facing surface.
 */
const FINDER_INFO_UUID_SEED_HI = 0xde_ad_be_ef;
const FINDER_INFO_UUID_SEED_LO = 0xca_fe_ba_be;

/**
 * Build the 512-byte HFS+ Volume Header for a partition of `partitionBlocks`
 * 4 KiB allocation blocks.
 *
 * `partitionBlocks` is the count within the **partition**, not the whole
 * disk — the volume header describes the partition's storage layout, not
 * the disk's. Use {@link writeMbrWrappedHfsplusImage} which computes this
 * correctly from the disk's declared size.
 */
export function buildVolumeHeader(partitionBlocks: number): Buffer {
  if (!Number.isInteger(partitionBlocks) || partitionBlocks <= 0) {
    throw new Error(
      `buildVolumeHeader: partitionBlocks must be a positive integer (got ${String(partitionBlocks)})`
    );
  }
  const vh = Buffer.alloc(HFSPLUS_VOLUME_HEADER_SIZE);
  // Field offsets follow Apple TN1150 §HFSPlusVolumeHeader.
  vh.writeUInt16BE(0x482b, 0); // signature 'H+'
  vh.writeUInt16BE(4, 2); // version (HFS+ = 4)
  // attributes (4 B at offset 4) — leave 0 (volume not journaled, not flagged unmounted).
  // lastMountedVersion (4 B at offset 8) — leave 0.
  // journalInfoBlock, dates, fileCount, folderCount (offsets 12-39) — leave 0.
  vh.writeUInt32BE(HFSPLUS_BLOCK_SIZE, 40); // blockSize
  vh.writeUInt32BE(partitionBlocks, 44); // totalBlocks (within the partition)
  // freeBlocks (offset 48) — claim almost all blocks free.
  vh.writeUInt32BE(partitionBlocks > 16 ? partitionBlocks - 16 : partitionBlocks, 48);

  // finderInfo is 32 bytes (8 × UInt32 BE) at offset 80. Slots 0-5 carry
  // boot-info / blessed-folder pointers that blkid ignores. Slots 6-7
  // form the volume-UUID seed: when their 8-byte concatenation is
  // non-zero, blkid hashes it via MD5 and presents the result as the
  // partition's UUID. We seed with a stable, distinctive value so the
  // test image produces a deterministic UUID across runs.
  vh.writeUInt32BE(FINDER_INFO_UUID_SEED_HI, 80 + 6 * 4);
  vh.writeUInt32BE(FINDER_INFO_UUID_SEED_LO, 80 + 7 * 4);

  // All remaining fields stay zero. The five system files (catalog,
  // extents, attributes, allocation, startup) get walked at mount time —
  // mount is exactly the path podkit's refusal short-circuits.
  return vh;
}

/**
 * Build a 512-byte MBR boot sector with a single partition entry of
 * type `0xAF` (HFS/HFS+) starting at LBA `PARTITION_START_LBA` and
 * spanning `partitionSectors` sectors of 512 bytes.
 *
 * Exported for unit tests. Production callers should use
 * {@link writeMbrWrappedHfsplusImage}.
 */
export function buildMbr(partitionSectors: number): Buffer {
  if (!Number.isInteger(partitionSectors) || partitionSectors <= 0) {
    throw new Error(
      `buildMbr: partitionSectors must be a positive integer (got ${String(partitionSectors)})`
    );
  }
  if (partitionSectors > 0xff_ff_ff_ff) {
    throw new Error(
      `buildMbr: partitionSectors exceeds 32-bit LBA limit (got ${partitionSectors})`
    );
  }
  const mbr = Buffer.alloc(512);
  // Bytes 0..445 stay zero (no boot code).
  // Partition entry at offset 446 (16 bytes):
  //   0:    boot indicator (0x00 = not bootable)
  //   1-3:  CHS start (legacy; LBA mode uses 0xFE 0xFF 0xFF)
  //   4:    partition type
  //   5-7:  CHS end (legacy; 0xFE 0xFF 0xFF)
  //   8-11: LBA start (UInt32 LE)
  //   12-15: LBA size (UInt32 LE)
  mbr.writeUInt8(0x00, MBR_PARTITION_TABLE_OFFSET + 0);
  mbr.writeUInt8(0xfe, MBR_PARTITION_TABLE_OFFSET + 1);
  mbr.writeUInt8(0xff, MBR_PARTITION_TABLE_OFFSET + 2);
  mbr.writeUInt8(0xff, MBR_PARTITION_TABLE_OFFSET + 3);
  mbr.writeUInt8(MBR_PARTITION_TYPE_HFS, MBR_PARTITION_TABLE_OFFSET + 4);
  mbr.writeUInt8(0xfe, MBR_PARTITION_TABLE_OFFSET + 5);
  mbr.writeUInt8(0xff, MBR_PARTITION_TABLE_OFFSET + 6);
  mbr.writeUInt8(0xff, MBR_PARTITION_TABLE_OFFSET + 7);
  mbr.writeUInt32LE(PARTITION_START_LBA, MBR_PARTITION_TABLE_OFFSET + 8);
  mbr.writeUInt32LE(partitionSectors, MBR_PARTITION_TABLE_OFFSET + 12);
  // Boot signature.
  mbr.writeUInt8(0x55, MBR_SIGNATURE_OFFSET);
  mbr.writeUInt8(0xaa, MBR_SIGNATURE_OFFSET + 1);
  return mbr;
}

/**
 * Build the full MBR-wrapped HFS+ image as a single in-memory `Buffer`.
 *
 * Intended for unit tests + small images. Production callers that write
 * multi-MiB images should prefer {@link writeMbrWrappedHfsplusImage},
 * which produces a sparse file (~1 KiB on disk for a 32 MiB declared
 * size) without materialising the entire buffer in memory.
 */
export function buildMbrWrappedHfsplusImage(opts: { sizeMiB: number }): Buffer {
  validateSize(opts.sizeMiB);
  const sizeBytes = opts.sizeMiB * 1024 * 1024;
  const partitionBytes = sizeBytes - HFSPLUS_PARTITION_START_OFFSET;
  const partitionSectors = partitionBytes / 512;
  const partitionBlocks = Math.floor(partitionBytes / HFSPLUS_BLOCK_SIZE);
  const buf = Buffer.alloc(sizeBytes);
  const mbr = buildMbr(partitionSectors);
  const vh = buildVolumeHeader(partitionBlocks);
  mbr.copy(buf, 0);
  vh.copy(buf, HFSPLUS_PARTITION_START_OFFSET + HFSPLUS_VOLUME_HEADER_OFFSET);
  return buf;
}

/**
 * Write a sparse MBR-wrapped HFS+ image of `sizeMiB` MiB to `dest`. The
 * file is truncate-allocated (sparse on every filesystem that supports
 * holes — ext4, APFS, NTFS, btrfs); only the 512-byte MBR and the
 * 512-byte HFS+ Volume Header physically land on disk.
 *
 * The caller owns `dest`'s lifecycle (delete after copying into the VM).
 */
export function writeMbrWrappedHfsplusImage(dest: string, opts: { sizeMiB: number }): void {
  validateSize(opts.sizeMiB);
  const sizeBytes = opts.sizeMiB * 1024 * 1024;
  const partitionBytes = sizeBytes - HFSPLUS_PARTITION_START_OFFSET;
  const partitionSectors = partitionBytes / 512;
  const partitionBlocks = Math.floor(partitionBytes / HFSPLUS_BLOCK_SIZE);
  const mbr = buildMbr(partitionSectors);
  const vh = buildVolumeHeader(partitionBlocks);
  const fd = fs.openSync(dest, 'w');
  try {
    fs.ftruncateSync(fd, sizeBytes);
    fs.writeSync(fd, mbr, 0, mbr.length, 0);
    fs.writeSync(
      fd,
      vh,
      0,
      vh.length,
      HFSPLUS_PARTITION_START_OFFSET + HFSPLUS_VOLUME_HEADER_OFFSET
    );
  } finally {
    fs.closeSync(fd);
  }
}

function validateSize(sizeMiB: number): void {
  if (!Number.isInteger(sizeMiB) || sizeMiB <= 0) {
    throw new Error(`HFS+ image: sizeMiB must be a positive integer (got ${String(sizeMiB)})`);
  }
  // The first 1 MiB is reserved for MBR + alignment padding; the
  // partition needs at least 1 MiB of its own for the HFS+ Volume
  // Header to fit (header sits at offset 1024 inside the partition).
  // Bumping the minimum to 2 MiB keeps the math + future test
  // extensions comfortable without over-restricting.
  if (sizeMiB < 2) {
    throw new Error(`HFS+ image: sizeMiB must be ≥2 (got ${sizeMiB})`);
  }
}
