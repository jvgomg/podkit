/**
 * Unit tests for `rgbaToPng` — encode a small RGBA buffer and assert a valid
 * PNG (signature + dimensions), then round-trip-decode to confirm the pixels.
 */

import { describe, expect, test } from 'bun:test';
import { PNG } from 'pngjs';
import { rgbaToPng } from './rgba-to-png.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('rgbaToPng', () => {
  test('produces a PNG with the magic signature', () => {
    const png = rgbaToPng({ width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) });
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  test('IHDR width/height match the input dimensions', () => {
    const data = new Uint8Array(2 * 3 * 4);
    const png = rgbaToPng({ width: 2, height: 3, data });
    // IHDR width/height are the first two big-endian u32s of the IHDR chunk
    // data, which starts at byte 16 (8 sig + 4 len + 4 "IHDR").
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(3);
  });

  test('round-trips: decoded pixels equal the input RGBA', () => {
    const input = new Uint8Array([
      255,
      0,
      0,
      255, // red
      0,
      255,
      0,
      255, // green
      0,
      0,
      255,
      255, // blue
      255,
      255,
      255,
      255, // white
    ]);
    const png = rgbaToPng({ width: 2, height: 2, data: input });

    const decoded = PNG.sync.read(png);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect([...decoded.data]).toEqual([...input]);
  });

  test('throws when data length does not match width*height*4', () => {
    expect(() => rgbaToPng({ width: 2, height: 2, data: new Uint8Array(4) })).toThrow(RangeError);
  });
});
