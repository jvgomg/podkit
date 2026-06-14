/**
 * Pure-TypeScript HFS+ volume-header writer.
 *
 * Used by the HFS+-on-Linux refusal Tier-3 scenario. The runner needs a
 * synthesised block image that kernel `lsblk` / `blkid` identify as
 * `fstype: 'hfsplus'`; the only consumer of the image is podkit's
 * filesystem-policy refusal path which short-circuits before any mount
 * attempt. We therefore do NOT need a fully valid, mountable HFS+ volume —
 * just a volume header at offset 1024 with the `H+` signature and a
 * valid version byte.
 *
 * # Why pure TypeScript?
 *
 * `hfsprogs` (which provides `mkfs.hfsplus`) is not packaged for arm64 in
 * Debian bookworm — the source recipe restricts it to a small set of archs
 * that the original Mac-OS-X port supports. The device-harness test VM is
 * arm64-on-Apple-Silicon, so we can't shell out to a binary tool. Writing
 * the volume header from TypeScript:
 *
 *   - works on any host architecture (host runs Node — Lima is irrelevant);
 *   - has zero runtime dependencies (no Docker, no pre-built blob, no apt
 *     contrib repo to coordinate);
 *   - is small (≤100 LOC), bounded (the HFS+ on-disk format is frozen
 *     since 2009 — Apple TN1150 is the canonical reference);
 *   - produces a sparse file (only ~4 KiB of actual on-disk content per
 *     image, regardless of declared size).
 *
 * # On-disk shape
 *
 * The HFS+ Volume Header (a.k.a. "MDB" in HFS-classic terminology) sits at
 * byte offset 1024 (sector 2 of a 512-byte sectored device). It is a
 * 512-byte struct. blkid's HFS+ probe (`libblkid/src/superblocks/hfs.c`)
 * needs three fields to identify a volume as `hfsplus`:
 *
 *   - `signature` — `0x482B` (`'H+'` BE) for HFS+, `0x4858` (`'HX'`) for HFSX.
 *   - `version` — `4` for HFS+, `5` for HFSX.
 *   - `blockSize` — a non-zero allocation block size (we set 4096).
 *
 * All other fields can be zero. The label is carried in the catalog file
 * (not the volume header), which we do not synthesise — blkid surfaces the
 * volume as `hfsplus` with no label, which is correct (real Mac-formatted
 * iPods on Linux behave identically because the catalog isn't probed).
 *
 * # All values are big-endian
 *
 * HFS+ on-disk format is big-endian regardless of host architecture
 * (legacy of the PowerPC era). Node's `Buffer.writeUInt*BE` family does
 * the byte-swap for us; never use `writeUInt*LE` here.
 *
 * # See also
 *
 * - Apple TN1150 — HFS+ Volume Format spec.
 * - `documents/architecture/testing/vm-testing.md` §5.6 — VM-side rationale.
 * - `lima-test-vm-backing-files.ts` — caller; dispatches FAT32 vs HFS+ on
 *   the persona's `synthesis.filesystem` field.
 *
 * @module
 */

import * as fs from 'node:fs';

/** Byte offset of the HFS+ Volume Header within the volume. */
export const HFSPLUS_VOLUME_HEADER_OFFSET = 1024;

/** Size of the HFS+ Volume Header struct. */
export const HFSPLUS_VOLUME_HEADER_SIZE = 512;

/** Allocation block size we burn into every synthesised header. Apple's iPod-default. */
const HFSPLUS_BLOCK_SIZE = 4096;

/**
 * Build the 512-byte HFS+ Volume Header for a volume of `totalBlocks`
 * 4 KiB allocation blocks.
 *
 * Returns a freshly-allocated `Buffer` you can splice into a sparse file
 * via {@link writeMinimalHfsplusImage}.
 *
 * Exported for {@link buildMinimalHfsplusImage} + unit tests; production
 * callers should normally use {@link writeMinimalHfsplusImage}.
 */
export function buildVolumeHeader(totalBlocks: number): Buffer {
  if (!Number.isInteger(totalBlocks) || totalBlocks <= 0) {
    throw new Error(
      `buildVolumeHeader: totalBlocks must be a positive integer (got ${String(totalBlocks)})`
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
  vh.writeUInt32BE(totalBlocks, 44); // totalBlocks
  // freeBlocks (offset 48) — claim almost all blocks free. blkid does not
  // validate this against totalBlocks, but keeping it sensible avoids
  // tripping any future probe-side sanity check.
  vh.writeUInt32BE(totalBlocks > 16 ? totalBlocks - 16 : totalBlocks, 48);
  // All remaining fields (nextAllocation, clumpSizes, finderInfo, fork
  // descriptors for the five system files) stay zero. The system files
  // never get walked by blkid; a real Mac-formatted volume would have them
  // populated and a real mount() would fail, but mount is exactly the path
  // podkit's refusal short-circuits.
  return vh;
}

/**
 * Build the full HFS+ image as a single in-memory `Buffer`.
 *
 * Intended for unit tests + small images. Production callers that write
 * multi-MiB images should prefer {@link writeMinimalHfsplusImage}, which
 * produces a sparse file (~4 KiB on disk for a 32 MiB declared size)
 * without materialising the entire buffer in memory.
 *
 * @throws if `sizeMiB` is not a positive integer, or if the resulting
 *   volume would be too small to host any allocation block.
 */
export function buildMinimalHfsplusImage(opts: { sizeMiB: number }): Buffer {
  validateSize(opts.sizeMiB);
  const sizeBytes = opts.sizeMiB * 1024 * 1024;
  const totalBlocks = Math.floor(sizeBytes / HFSPLUS_BLOCK_SIZE);
  const buf = Buffer.alloc(sizeBytes);
  const vh = buildVolumeHeader(totalBlocks);
  vh.copy(buf, HFSPLUS_VOLUME_HEADER_OFFSET);
  return buf;
}

/**
 * Write a sparse HFS+ image of `sizeMiB` MiB to `dest`. The file is
 * truncate-allocated (sparse on every filesystem that supports holes —
 * ext4, APFS, NTFS, btrfs); only the 512 bytes of the volume header
 * physically land on disk.
 *
 * The caller owns `dest`'s lifecycle (delete after copying into the VM).
 */
export function writeMinimalHfsplusImage(dest: string, opts: { sizeMiB: number }): void {
  validateSize(opts.sizeMiB);
  const sizeBytes = opts.sizeMiB * 1024 * 1024;
  const totalBlocks = Math.floor(sizeBytes / HFSPLUS_BLOCK_SIZE);
  const vh = buildVolumeHeader(totalBlocks);
  const fd = fs.openSync(dest, 'w');
  try {
    fs.ftruncateSync(fd, sizeBytes);
    fs.writeSync(fd, vh, 0, vh.length, HFSPLUS_VOLUME_HEADER_OFFSET);
  } finally {
    fs.closeSync(fd);
  }
}

function validateSize(sizeMiB: number): void {
  if (!Number.isInteger(sizeMiB) || sizeMiB <= 0) {
    throw new Error(`HFS+ image: sizeMiB must be a positive integer (got ${String(sizeMiB)})`);
  }
  // 1 MiB = 256 blocks of 4 KiB. blkid is happy with any non-zero
  // totalBlocks, but ≥1 MiB gives the synthesised volume enough space that
  // any future test extension (e.g. a single-block "catalog" stub) has
  // room to land without revisiting this guard.
  if (sizeMiB < 1) {
    throw new Error(`HFS+ image: sizeMiB must be ≥1 (got ${sizeMiB})`);
  }
}
