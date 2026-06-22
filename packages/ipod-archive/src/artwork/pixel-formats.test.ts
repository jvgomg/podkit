/**
 * Unit tests for the ported pixel-format decoders, with synthetic byte buffers
 * whose RGBA output is asserted exactly.
 */

import { describe, expect, test } from 'bun:test';
import {
  decodeRgb565,
  decodeRgb555,
  decodeRgb888,
  getBytesPerPixel,
  getDecoder,
} from './pixel-formats.js';

describe('decodeRgb565', () => {
  test('white (all bits set) → opaque white', () => {
    // r=31,g=63,b=31 → 0xFFFF
    const rgba = decodeRgb565(new Uint8Array([0xff, 0xff]), 1, 1);
    expect([...rgba]).toEqual([255, 255, 255, 255]);
  });

  test('black (all bits zero) → opaque black', () => {
    const rgba = decodeRgb565(new Uint8Array([0x00, 0x00]), 1, 1);
    expect([...rgba]).toEqual([0, 0, 0, 255]);
  });

  test('pure red: 0xF800, little-endian [0x00,0xF8]', () => {
    const rgba = decodeRgb565(new Uint8Array([0x00, 0xf8]), 1, 1);
    expect([...rgba]).toEqual([255, 0, 0, 255]);
  });

  test('pure green: 0x07E0 → [0xE0,0x07]', () => {
    const rgba = decodeRgb565(new Uint8Array([0xe0, 0x07]), 1, 1);
    expect([...rgba]).toEqual([0, 255, 0, 255]);
  });

  test('pure blue: 0x001F → [0x1F,0x00]', () => {
    const rgba = decodeRgb565(new Uint8Array([0x1f, 0x00]), 1, 1);
    expect([...rgba]).toEqual([0, 0, 255, 255]);
  });

  test('2x2 image decodes each pixel in order', () => {
    const input = new Uint8Array([
      0x00,
      0xf8, // red
      0xe0,
      0x07, // green
      0x1f,
      0x00, // blue
      0xff,
      0xff, // white
    ]);
    const rgba = decodeRgb565(input, 2, 2);
    expect(rgba.length).toBe(16);
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...rgba.subarray(4, 8)]).toEqual([0, 255, 0, 255]);
    expect([...rgba.subarray(8, 12)]).toEqual([0, 0, 255, 255]);
    expect([...rgba.subarray(12, 16)]).toEqual([255, 255, 255, 255]);
  });

  test('truncated input leaves trailing pixels zeroed', () => {
    // Ask for 2x2 but supply only one pixel.
    const rgba = decodeRgb565(new Uint8Array([0xff, 0xff]), 2, 2);
    expect(rgba.length).toBe(16);
    expect([...rgba.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...rgba.subarray(4, 16)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('decodeRgb555', () => {
  test('white: x=0,r=31,g=31,b=31 → 0x7FFF → [0xFF,0x7F]', () => {
    const rgba = decodeRgb555(new Uint8Array([0xff, 0x7f]), 1, 1);
    expect([...rgba]).toEqual([255, 255, 255, 255]);
  });

  test('pure red: 0x7C00 → [0x00,0x7C]', () => {
    const rgba = decodeRgb555(new Uint8Array([0x00, 0x7c]), 1, 1);
    expect([...rgba]).toEqual([255, 0, 0, 255]);
  });

  test('pure green: 0x03E0 → [0xE0,0x03]', () => {
    const rgba = decodeRgb555(new Uint8Array([0xe0, 0x03]), 1, 1);
    expect([...rgba]).toEqual([0, 255, 0, 255]);
  });

  test('pure blue: 0x001F → [0x1F,0x00]', () => {
    const rgba = decodeRgb555(new Uint8Array([0x1f, 0x00]), 1, 1);
    expect([...rgba]).toEqual([0, 0, 255, 255]);
  });

  test('the unused high bit is ignored (0xFFFF == 0x7FFF here)', () => {
    expect([...decodeRgb555(new Uint8Array([0xff, 0xff]), 1, 1)]).toEqual([255, 255, 255, 255]);
  });
});

describe('decodeRgb888', () => {
  test('three bytes map straight to R,G,B with opaque alpha', () => {
    const rgba = decodeRgb888(new Uint8Array([0x12, 0x34, 0x56]), 1, 1);
    expect([...rgba]).toEqual([0x12, 0x34, 0x56, 255]);
  });

  test('2x1 image decodes both pixels', () => {
    const rgba = decodeRgb888(new Uint8Array([1, 2, 3, 4, 5, 6]), 2, 1);
    expect([...rgba]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });
});

describe('getDecoder', () => {
  test('common 16-bit formats resolve to RGB565', () => {
    for (const id of [1027, 1028, 1029, 1030, 1031, 1055, 1057, 1060, 1061, 1068]) {
      expect(getDecoder(id)).toBe(decodeRgb565);
    }
  });

  test('1066/1067 resolve to RGB555', () => {
    expect(getDecoder(1066)).toBe(decodeRgb555);
    expect(getDecoder(1067)).toBe(decodeRgb555);
  });

  test('unknown format → null', () => {
    expect(getDecoder(9999)).toBeNull();
  });
});

describe('getBytesPerPixel', () => {
  test('decoder-backed formats are 2 bytes; unknown is null', () => {
    expect(getBytesPerPixel(1057)).toBe(2);
    expect(getBytesPerPixel(1066)).toBe(2);
    // 1068 is decoded as RGB565, so its bytes-per-pixel agrees with getDecoder.
    expect(getBytesPerPixel(1068)).toBe(2);
    expect(getBytesPerPixel(9999)).toBeNull();
  });
});
