/**
 * Unit tests for the FunctionFS descriptor + strings table byte-packing.
 *
 * Pure tests — no kernel, no filesystem. They verify the bytes we write to
 * ep0 match what `<linux/usb/functionfs.h>` and `<linux/usb/ch9.h>` expect,
 * so a regression here is caught on the macOS dev host before we ever ship
 * the binary to `podkit-device-harness` (AC #9 of TASK-322.05.01).
 */

import { describe, it, expect } from 'bun:test';

import {
  DESCRIPTOR_LAYOUT,
  FUNCTIONFS_DESCRIPTORS_MAGIC_V2,
  FUNCTIONFS_HAS_FS_DESC,
  FUNCTIONFS_HAS_HS_DESC,
  FUNCTIONFS_STRINGS_MAGIC,
  buildDescriptorsBuffer,
  buildStringsBuffer,
} from '../descriptors.js';

function readU32(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(offset, true);
}

function readU16(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(offset, true);
}

describe('buildDescriptorsBuffer()', () => {
  const buf = buildDescriptorsBuffer();

  it('matches the documented total length (52 bytes)', () => {
    expect(buf.byteLength).toBe(DESCRIPTOR_LAYOUT.TOTAL_DESCRIPTORS_LEN);
    expect(buf.byteLength).toBe(52);
  });

  it('starts with FUNCTIONFS_DESCRIPTORS_MAGIC_V2 in little-endian', () => {
    expect(readU32(buf, 0)).toBe(FUNCTIONFS_DESCRIPTORS_MAGIC_V2);
    expect(readU32(buf, 0)).toBe(0x00000003);
  });

  it('encodes total length as the second u32', () => {
    expect(readU32(buf, 4)).toBe(buf.byteLength);
  });

  it('encodes flags = HAS_FS_DESC | HAS_HS_DESC', () => {
    expect(readU32(buf, 8)).toBe(FUNCTIONFS_HAS_FS_DESC | FUNCTIONFS_HAS_HS_DESC);
    expect(readU32(buf, 8)).toBe(0x3);
  });

  it('declares fs_count=2 and hs_count=2 (interface + endpoint per speed)', () => {
    expect(readU32(buf, 12)).toBe(2);
    expect(readU32(buf, 16)).toBe(2);
  });

  describe('FS speed descriptor table', () => {
    const fsStart = DESCRIPTOR_LAYOUT.HEAD_V2_LEN; // 20

    it('begins with a 9-byte interface descriptor', () => {
      expect(buf[fsStart + 0]).toBe(DESCRIPTOR_LAYOUT.INTERFACE_DESC_LEN);
      expect(buf[fsStart + 1]).toBe(0x04); // USB_DT_INTERFACE
      expect(buf[fsStart + 4]).toBe(1); // bNumEndpoints
      expect(buf[fsStart + 5]).toBe(0xff); // vendor-specific class
      expect(buf[fsStart + 8]).toBe(0); // iInterface (no string)
    });

    it('then a 7-byte bulk-IN endpoint descriptor with FS max-packet size', () => {
      const epStart = fsStart + DESCRIPTOR_LAYOUT.INTERFACE_DESC_LEN; // 29
      expect(buf[epStart + 0]).toBe(DESCRIPTOR_LAYOUT.ENDPOINT_DESC_LEN);
      expect(buf[epStart + 1]).toBe(0x05); // USB_DT_ENDPOINT
      expect(buf[epStart + 2]).toBe(0x81); // IN, ep1
      expect(buf[epStart + 3]).toBe(0x02); // bulk
      expect(readU16(buf, epStart + 4)).toBe(DESCRIPTOR_LAYOUT.FS_BULK_MAX_PACKET);
      expect(readU16(buf, epStart + 4)).toBe(0x40);
      expect(buf[epStart + 6]).toBe(0); // bInterval
    });
  });

  describe('HS speed descriptor table', () => {
    const hsStart =
      DESCRIPTOR_LAYOUT.HEAD_V2_LEN +
      DESCRIPTOR_LAYOUT.INTERFACE_DESC_LEN +
      DESCRIPTOR_LAYOUT.ENDPOINT_DESC_LEN; // 36

    it('begins with a 9-byte interface descriptor (same shape as FS)', () => {
      expect(buf[hsStart + 0]).toBe(DESCRIPTOR_LAYOUT.INTERFACE_DESC_LEN);
      expect(buf[hsStart + 1]).toBe(0x04);
      expect(buf[hsStart + 4]).toBe(1);
      expect(buf[hsStart + 5]).toBe(0xff);
    });

    it('then a 7-byte bulk-IN endpoint descriptor with HS max-packet size', () => {
      const epStart = hsStart + DESCRIPTOR_LAYOUT.INTERFACE_DESC_LEN; // 45
      expect(buf[epStart + 0]).toBe(DESCRIPTOR_LAYOUT.ENDPOINT_DESC_LEN);
      expect(buf[epStart + 1]).toBe(0x05);
      expect(buf[epStart + 2]).toBe(0x81);
      expect(buf[epStart + 3]).toBe(0x02);
      expect(readU16(buf, epStart + 4)).toBe(DESCRIPTOR_LAYOUT.HS_BULK_MAX_PACKET);
      expect(readU16(buf, epStart + 4)).toBe(0x200);
    });

    it('ends exactly at the buffer boundary', () => {
      const epEnd =
        hsStart + DESCRIPTOR_LAYOUT.INTERFACE_DESC_LEN + DESCRIPTOR_LAYOUT.ENDPOINT_DESC_LEN;
      expect(epEnd).toBe(buf.byteLength);
    });
  });
});

describe('buildStringsBuffer()', () => {
  const buf = buildStringsBuffer();

  it('is exactly the 16-byte empty-strings head', () => {
    expect(buf.byteLength).toBe(DESCRIPTOR_LAYOUT.STRINGS_HEAD_LEN);
    expect(buf.byteLength).toBe(16);
  });

  it('begins with FUNCTIONFS_STRINGS_MAGIC in little-endian', () => {
    expect(readU32(buf, 0)).toBe(FUNCTIONFS_STRINGS_MAGIC);
    expect(readU32(buf, 0)).toBe(0x00000002);
  });

  it('encodes the head length as the second u32', () => {
    expect(readU32(buf, 4)).toBe(16);
  });

  it('declares zero strings and zero languages (empty-strings table)', () => {
    expect(readU32(buf, 8)).toBe(0); // str_count
    expect(readU32(buf, 12)).toBe(0); // lang_count
  });
});
