/**
 * Unit tests for the `.ithmb` tile extractor — offset reads and padding crop,
 * all with synthetic byte buffers.
 */

import { describe, expect, test } from 'bun:test';
import { extractThumbnail } from './ithmb.js';
import type { ArtworkThumbnail } from './types.js';

function thumb(overrides: Partial<ArtworkThumbnail>): ArtworkThumbnail {
  return {
    formatId: 1057, // RGB565
    width: 1,
    height: 1,
    offset: 0,
    size: 2,
    horizontalPadding: 0,
    verticalPadding: 0,
    ...overrides,
  };
}

describe('extractThumbnail', () => {
  test('extracts an unpadded 2x2 RGB565 tile', () => {
    const ithmb = new Uint8Array([
      0x00,
      0xf8, // red
      0xe0,
      0x07, // green
      0x1f,
      0x00, // blue
      0xff,
      0xff, // white
    ]);
    const result = extractThumbnail(ithmb, thumb({ width: 2, height: 2, size: 8 }));
    expect(result).not.toBeNull();
    expect(result!.width).toBe(2);
    expect(result!.height).toBe(2);
    expect(result!.data.length).toBe(16);
    expect([...result!.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  test('reads from a non-zero offset', () => {
    const ithmb = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x00, // 4 bytes of leading padding
      0xff,
      0xff, // white pixel at offset 4
    ]);
    const result = extractThumbnail(ithmb, thumb({ offset: 4, size: 2 }));
    expect(result).not.toBeNull();
    expect([...result!.data]).toEqual([255, 255, 255, 255]);
  });

  test('crops horizontal + vertical padding (3x3 stored, 2x2 content)', () => {
    // 3x3 RGB565 grid = 9 px * 2 bytes = 18 bytes. Content is the top-left 2x2.
    const ithmb = new Uint8Array([
      // row 0: red, green, pad
      0x00, 0xf8, 0xe0, 0x07, 0x00, 0x00,
      // row 1: blue, white, pad
      0x1f, 0x00, 0xff, 0xff, 0x00, 0x00,
      // row 2: pad, pad, pad
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const result = extractThumbnail(
      ithmb,
      thumb({ width: 2, height: 2, size: 18, horizontalPadding: 1, verticalPadding: 1 })
    );
    expect(result).not.toBeNull();
    expect(result!.width).toBe(2);
    expect(result!.height).toBe(2);
    expect(result!.data.length).toBe(16); // padding dropped
    // (0,0) red, (1,0) green, (0,1) blue, (1,1) white — padding column/row gone.
    expect([...result!.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...result!.data.subarray(4, 8)]).toEqual([0, 255, 0, 255]);
    expect([...result!.data.subarray(8, 12)]).toEqual([0, 0, 255, 255]);
    expect([...result!.data.subarray(12, 16)]).toEqual([255, 255, 255, 255]);
  });

  test('returns null for an unknown pixel format', () => {
    expect(extractThumbnail(new Uint8Array(100), thumb({ formatId: 9999 }))).toBeNull();
  });

  test('returns null when offset+size runs past the ithmb', () => {
    expect(extractThumbnail(new Uint8Array(4), thumb({ offset: 10, size: 2 }))).toBeNull();
  });
});
