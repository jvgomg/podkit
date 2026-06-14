/**
 * Unit tests for the pure-TypeScript HFS+ Volume Header writer.
 *
 * Asserts the magic + version + block-size fields land at the byte offsets
 * specified by Apple TN1150 — exactly the bytes kernel-side `blkid` reads
 * to identify a volume as `hfsplus`. We do NOT exhaustively verify every
 * field; the writer only sets the minimum-viable subset and zeroes the
 * rest, and that's the contract the test pins.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  buildMinimalHfsplusImage,
  buildVolumeHeader,
  HFSPLUS_VOLUME_HEADER_OFFSET,
  HFSPLUS_VOLUME_HEADER_SIZE,
  writeMinimalHfsplusImage,
} from './hfsplus-image-writer.js';

describe('buildVolumeHeader', () => {
  it('writes the HFS+ signature "H+" at offset 0 (big-endian)', () => {
    const vh = buildVolumeHeader(256);
    expect(vh.readUInt16BE(0)).toBe(0x482b);
    // Same bytes interpreted as ASCII: 'H' = 0x48, '+' = 0x2B.
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

  it('writes the caller-provided totalBlocks at offset 44', () => {
    const vh = buildVolumeHeader(8192);
    expect(vh.readUInt32BE(44)).toBe(8192);
  });

  it('writes a sensible freeBlocks (≤ totalBlocks)', () => {
    const vh = buildVolumeHeader(8192);
    expect(vh.readUInt32BE(48)).toBeLessThanOrEqual(8192);
    expect(vh.readUInt32BE(48)).toBeGreaterThan(0);
  });

  it('returns a 512-byte buffer (the HFS+ Volume Header struct size)', () => {
    const vh = buildVolumeHeader(256);
    expect(vh.length).toBe(HFSPLUS_VOLUME_HEADER_SIZE);
  });

  it('rejects zero / negative totalBlocks', () => {
    expect(() => buildVolumeHeader(0)).toThrow(/totalBlocks/);
    expect(() => buildVolumeHeader(-1)).toThrow(/totalBlocks/);
  });
});

describe('buildMinimalHfsplusImage', () => {
  it('embeds the volume header at offset 1024', () => {
    const buf = buildMinimalHfsplusImage({ sizeMiB: 1 });
    expect(buf.length).toBe(1024 * 1024);
    // Bytes before the header offset are pristine zeros — boot sector area.
    expect(buf.subarray(0, HFSPLUS_VOLUME_HEADER_OFFSET).every((b) => b === 0)).toBe(true);
    // Signature lands exactly at the offset.
    expect(buf.readUInt16BE(HFSPLUS_VOLUME_HEADER_OFFSET)).toBe(0x482b);
    expect(buf.readUInt16BE(HFSPLUS_VOLUME_HEADER_OFFSET + 2)).toBe(4);
  });

  it('rejects sub-MiB sizes', () => {
    expect(() => buildMinimalHfsplusImage({ sizeMiB: 0 })).toThrow();
    expect(() => buildMinimalHfsplusImage({ sizeMiB: 0.5 })).toThrow();
  });
});

describe('writeMinimalHfsplusImage', () => {
  it('produces a sparse file with the signature readable at offset 1024', () => {
    const dest = path.join(os.tmpdir(), `hfsplus-test-${randomUUID()}.img`);
    try {
      writeMinimalHfsplusImage(dest, { sizeMiB: 1 });
      const stat = fs.statSync(dest);
      expect(stat.size).toBe(1024 * 1024);
      // Sparse file: actual blocks should be much less than logical size.
      // We don't assert an exact block count (filesystem-dependent), only
      // that the magic is at offset 1024 when read back.
      const fd = fs.openSync(dest, 'r');
      try {
        const magic = Buffer.alloc(2);
        fs.readSync(fd, magic, 0, 2, HFSPLUS_VOLUME_HEADER_OFFSET);
        expect(magic.readUInt16BE(0)).toBe(0x482b);
      } finally {
        fs.closeSync(fd);
      }
    } finally {
      fs.rmSync(dest, { force: true });
    }
  });

  it('produces a file blkid would identify as hfsplus (signature + version)', () => {
    const dest = path.join(os.tmpdir(), `hfsplus-test-${randomUUID()}.img`);
    try {
      writeMinimalHfsplusImage(dest, { sizeMiB: 2 });
      const fd = fs.openSync(dest, 'r');
      try {
        const header = Buffer.alloc(HFSPLUS_VOLUME_HEADER_SIZE);
        fs.readSync(fd, header, 0, header.length, HFSPLUS_VOLUME_HEADER_OFFSET);
        expect(header.readUInt16BE(0)).toBe(0x482b); // 'H+'
        expect(header.readUInt16BE(2)).toBe(4); // version
        expect(header.readUInt32BE(40)).toBe(4096); // blockSize
        expect(header.readUInt32BE(44)).toBe((2 * 1024 * 1024) / 4096); // totalBlocks
      } finally {
        fs.closeSync(fd);
      }
    } finally {
      fs.rmSync(dest, { force: true });
    }
  });
});
