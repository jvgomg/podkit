/**
 * Unit tests for the MBR-wrapped HFS+ image writer.
 *
 * Pins the on-disk byte shape blkid + the kernel partition reader
 * depend on. We do NOT exhaustively verify every HFS+ Volume Header
 * field; the writer only sets the minimum-viable subset (signature,
 * version, blockSize, totalBlocks, freeBlocks, finderInfo UUID seed)
 * and zeroes the rest, and that's the contract the test pins.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  buildMbr,
  buildMbrWrappedHfsplusImage,
  buildVolumeHeader,
  HFSPLUS_PARTITION_START_OFFSET,
  HFSPLUS_VOLUME_HEADER_OFFSET,
  HFSPLUS_VOLUME_HEADER_SIZE,
  writeMbrWrappedHfsplusImage,
} from './hfsplus-image-writer.js';

describe('buildVolumeHeader', () => {
  it('writes the HFS+ signature "H+" at offset 0 (big-endian)', () => {
    const vh = buildVolumeHeader(256);
    expect(vh.readUInt16BE(0)).toBe(0x482b);
    expect(String.fromCharCode(vh[0]!)).toBe('H');
    expect(String.fromCharCode(vh[1]!)).toBe('+');
  });

  it('writes version=4 (HFS+; HFSX uses 5)', () => {
    const vh = buildVolumeHeader(256);
    expect(vh.readUInt16BE(2)).toBe(4);
  });

  it('writes blockSize=4096 at offset 40', () => {
    const vh = buildVolumeHeader(256);
    expect(vh.readUInt32BE(40)).toBe(4096);
  });

  it('writes the caller-provided partitionBlocks at offset 44', () => {
    const vh = buildVolumeHeader(8192);
    expect(vh.readUInt32BE(44)).toBe(8192);
  });

  it('writes a non-zero finderInfo[6..7] UUID seed at offset 80+24 / 80+28', () => {
    // blkid reads these two UInt32 BE words; when their concatenation is
    // non-zero it hashes them via MD5 to synthesise the volume UUID. A
    // zero seed → blkid surfaces no UUID → walk() in linux.ts drops the
    // device → readiness pipeline never reaches the filesystem stage.
    const vh = buildVolumeHeader(256);
    const hi = vh.readUInt32BE(80 + 6 * 4);
    const lo = vh.readUInt32BE(80 + 7 * 4);
    expect(hi).not.toBe(0);
    expect(lo).not.toBe(0);
  });

  it('returns a 512-byte buffer (the HFS+ Volume Header struct size)', () => {
    expect(buildVolumeHeader(256).length).toBe(HFSPLUS_VOLUME_HEADER_SIZE);
  });

  it('rejects zero / negative partitionBlocks', () => {
    expect(() => buildVolumeHeader(0)).toThrow(/partitionBlocks/);
    expect(() => buildVolumeHeader(-1)).toThrow(/partitionBlocks/);
  });
});

describe('buildMbr', () => {
  it('writes the boot signature 0x55 0xAA at offset 510', () => {
    const mbr = buildMbr(1000);
    expect(mbr[510]).toBe(0x55);
    expect(mbr[511]).toBe(0xaa);
  });

  it('writes partition entry 1 at offset 446 with type 0xAF (HFS)', () => {
    const mbr = buildMbr(1000);
    // Type byte at offset 446 + 4.
    expect(mbr[446 + 4]).toBe(0xaf);
  });

  it('writes LBA start = 2048 (1 MiB alignment) at offset 446+8', () => {
    const mbr = buildMbr(1000);
    expect(mbr.readUInt32LE(446 + 8)).toBe(2048);
  });

  it('writes LBA size = caller-provided partitionSectors at offset 446+12', () => {
    const mbr = buildMbr(63488);
    expect(mbr.readUInt32LE(446 + 12)).toBe(63488);
  });

  it('rejects zero / negative partitionSectors', () => {
    expect(() => buildMbr(0)).toThrow(/partitionSectors/);
    expect(() => buildMbr(-1)).toThrow(/partitionSectors/);
  });

  it('rejects partitionSectors exceeding 32-bit LBA limit', () => {
    expect(() => buildMbr(0x1_00_00_00_00)).toThrow(/32-bit/);
  });
});

describe('buildMbrWrappedHfsplusImage', () => {
  it('embeds the MBR at offset 0 and the HFS+ Volume Header inside the partition', () => {
    const buf = buildMbrWrappedHfsplusImage({ sizeMiB: 2 });
    // Whole-disk size matches the declared sizeMiB.
    expect(buf.length).toBe(2 * 1024 * 1024);
    // MBR signature at offset 510.
    expect(buf[510]).toBe(0x55);
    expect(buf[511]).toBe(0xaa);
    // HFS+ Volume Header at offset 1 MiB + 1024 within the disk.
    const vhOffset = HFSPLUS_PARTITION_START_OFFSET + HFSPLUS_VOLUME_HEADER_OFFSET;
    expect(buf.readUInt16BE(vhOffset)).toBe(0x482b); // 'H+'
    expect(buf.readUInt16BE(vhOffset + 2)).toBe(4); // version
  });

  it('leaves bytes between the MBR and the partition start as sparse zeros', () => {
    const buf = buildMbrWrappedHfsplusImage({ sizeMiB: 2 });
    // Bytes 512..1MiB are the alignment gap; must be untouched.
    expect(buf.subarray(512, HFSPLUS_PARTITION_START_OFFSET).every((b) => b === 0)).toBe(true);
  });

  it('rejects sub-2-MiB sizes (need 1 MiB for MBR + alignment + partition)', () => {
    expect(() => buildMbrWrappedHfsplusImage({ sizeMiB: 1 })).toThrow();
    expect(() => buildMbrWrappedHfsplusImage({ sizeMiB: 0 })).toThrow();
  });
});

describe('writeMbrWrappedHfsplusImage', () => {
  it('produces a sparse file with the MBR + HFS+ header at the right offsets', () => {
    const dest = path.join(os.tmpdir(), `hfsplus-test-${randomUUID()}.img`);
    try {
      writeMbrWrappedHfsplusImage(dest, { sizeMiB: 2 });
      expect(fs.statSync(dest).size).toBe(2 * 1024 * 1024);
      const fd = fs.openSync(dest, 'r');
      try {
        // MBR signature at offset 510.
        const sig = Buffer.alloc(2);
        fs.readSync(fd, sig, 0, 2, 510);
        expect(sig.readUInt16BE(0)).toBe(0x55aa);
        // HFS+ Volume Header at partition start + 1024.
        const vhOffset = HFSPLUS_PARTITION_START_OFFSET + HFSPLUS_VOLUME_HEADER_OFFSET;
        const header = Buffer.alloc(HFSPLUS_VOLUME_HEADER_SIZE);
        fs.readSync(fd, header, 0, header.length, vhOffset);
        expect(header.readUInt16BE(0)).toBe(0x482b); // 'H+'
        expect(header.readUInt16BE(2)).toBe(4); // version
        expect(header.readUInt32BE(40)).toBe(4096); // blockSize
        // finderInfo[6..7] non-zero (UUID seed).
        expect(header.readUInt32BE(80 + 24)).not.toBe(0);
        expect(header.readUInt32BE(80 + 28)).not.toBe(0);
      } finally {
        fs.closeSync(fd);
      }
    } finally {
      fs.rmSync(dest, { force: true });
    }
  });

  it('totalBlocks reflects the partition size (not the whole disk)', () => {
    const dest = path.join(os.tmpdir(), `hfsplus-test-${randomUUID()}.img`);
    try {
      writeMbrWrappedHfsplusImage(dest, { sizeMiB: 4 });
      const fd = fs.openSync(dest, 'r');
      try {
        const vhOffset = HFSPLUS_PARTITION_START_OFFSET + HFSPLUS_VOLUME_HEADER_OFFSET;
        const header = Buffer.alloc(HFSPLUS_VOLUME_HEADER_SIZE);
        fs.readSync(fd, header, 0, header.length, vhOffset);
        // 4 MiB disk - 1 MiB alignment = 3 MiB partition = 3 * 256 = 768 blocks.
        expect(header.readUInt32BE(44)).toBe(768);
      } finally {
        fs.closeSync(fd);
      }
    } finally {
      fs.rmSync(dest, { force: true });
    }
  });
});
