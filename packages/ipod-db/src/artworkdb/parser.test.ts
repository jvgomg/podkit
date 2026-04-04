import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseArtworkDatabase } from './parser.js';
import {
  decodeRGB565,
  decodeRGB555,
  decodeRGB888,
  getDecoder,
  getBytesPerPixel,
} from './pixel-formats.js';
import { extractThumbnail } from './ithmb.js';
import type { ArtworkThumbnail } from './types.js';

const FIXTURES_DIR = join(import.meta.dir, '../../fixtures/databases');

// ── Pixel format decoder tests ──────────────────────────────────────

describe('pixel formats', () => {
  describe('decodeRGB565', () => {
    it('converts white pixel (all bits set)', () => {
      // RGB565: r=31, g=63, b=31 → 0xFFFF
      const input = new Uint8Array([0xff, 0xff]);
      const rgba = decodeRGB565(input, 1, 1);
      expect(rgba[0]).toBe(255); // red
      expect(rgba[1]).toBe(255); // green
      expect(rgba[2]).toBe(255); // blue
      expect(rgba[3]).toBe(255); // alpha
    });

    it('converts black pixel (all bits zero)', () => {
      const input = new Uint8Array([0x00, 0x00]);
      const rgba = decodeRGB565(input, 1, 1);
      expect(rgba[0]).toBe(0);
      expect(rgba[1]).toBe(0);
      expect(rgba[2]).toBe(0);
      expect(rgba[3]).toBe(255);
    });

    it('converts pure red pixel', () => {
      // RGB565: r=31, g=0, b=0 → 0xF800 → LE: [0x00, 0xF8]
      const input = new Uint8Array([0x00, 0xf8]);
      const rgba = decodeRGB565(input, 1, 1);
      expect(rgba[0]).toBe(255); // red
      expect(rgba[1]).toBe(0); // green
      expect(rgba[2]).toBe(0); // blue
      expect(rgba[3]).toBe(255);
    });

    it('converts pure green pixel', () => {
      // RGB565: r=0, g=63, b=0 → 0x07E0 → LE: [0xE0, 0x07]
      const input = new Uint8Array([0xe0, 0x07]);
      const rgba = decodeRGB565(input, 1, 1);
      expect(rgba[0]).toBe(0); // red
      expect(rgba[1]).toBe(255); // green
      expect(rgba[2]).toBe(0); // blue
      expect(rgba[3]).toBe(255);
    });

    it('converts pure blue pixel', () => {
      // RGB565: r=0, g=0, b=31 → 0x001F → LE: [0x1F, 0x00]
      const input = new Uint8Array([0x1f, 0x00]);
      const rgba = decodeRGB565(input, 1, 1);
      expect(rgba[0]).toBe(0); // red
      expect(rgba[1]).toBe(0); // green
      expect(rgba[2]).toBe(255); // blue
      expect(rgba[3]).toBe(255);
    });

    it('handles multiple pixels (2x2 image)', () => {
      // 4 pixels: red, green, blue, white
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
      const rgba = decodeRGB565(input, 2, 2);
      expect(rgba.length).toBe(16); // 4 pixels * 4 bytes

      // Pixel 0: red
      expect(rgba[0]).toBe(255);
      expect(rgba[1]).toBe(0);
      expect(rgba[2]).toBe(0);

      // Pixel 1: green
      expect(rgba[4]).toBe(0);
      expect(rgba[5]).toBe(255);
      expect(rgba[6]).toBe(0);

      // Pixel 2: blue
      expect(rgba[8]).toBe(0);
      expect(rgba[9]).toBe(0);
      expect(rgba[10]).toBe(255);

      // Pixel 3: white
      expect(rgba[12]).toBe(255);
      expect(rgba[13]).toBe(255);
      expect(rgba[14]).toBe(255);
    });

    it('handles truncated input gracefully', () => {
      // Request 2x2 but only provide 2 pixels worth of data
      const input = new Uint8Array([0xff, 0xff, 0x00, 0x00]);
      const rgba = decodeRGB565(input, 2, 2);
      expect(rgba.length).toBe(16);
      // First pixel decoded
      expect(rgba[0]).toBe(255);
      // Third pixel not decoded (remains 0)
      expect(rgba[8]).toBe(0);
    });
  });

  describe('decodeRGB555', () => {
    it('converts white pixel', () => {
      // RGB555: x=1, r=31, g=31, b=31 → 0x7FFF → LE: [0xFF, 0x7F]
      const input = new Uint8Array([0xff, 0x7f]);
      const rgba = decodeRGB555(input, 1, 1);
      expect(rgba[0]).toBe(255);
      expect(rgba[1]).toBe(255);
      expect(rgba[2]).toBe(255);
      expect(rgba[3]).toBe(255);
    });

    it('converts black pixel', () => {
      const input = new Uint8Array([0x00, 0x00]);
      const rgba = decodeRGB555(input, 1, 1);
      expect(rgba[0]).toBe(0);
      expect(rgba[1]).toBe(0);
      expect(rgba[2]).toBe(0);
      expect(rgba[3]).toBe(255);
    });

    it('converts pure red pixel', () => {
      // RGB555: r=31, g=0, b=0 → 0x7C00 → LE: [0x00, 0x7C]
      const input = new Uint8Array([0x00, 0x7c]);
      const rgba = decodeRGB555(input, 1, 1);
      expect(rgba[0]).toBe(255);
      expect(rgba[1]).toBe(0);
      expect(rgba[2]).toBe(0);
    });
  });

  describe('decodeRGB888', () => {
    it('converts white pixel', () => {
      const input = new Uint8Array([255, 255, 255]);
      const rgba = decodeRGB888(input, 1, 1);
      expect(rgba[0]).toBe(255);
      expect(rgba[1]).toBe(255);
      expect(rgba[2]).toBe(255);
      expect(rgba[3]).toBe(255);
    });

    it('converts black pixel', () => {
      const input = new Uint8Array([0, 0, 0]);
      const rgba = decodeRGB888(input, 1, 1);
      expect(rgba[0]).toBe(0);
      expect(rgba[1]).toBe(0);
      expect(rgba[2]).toBe(0);
      expect(rgba[3]).toBe(255);
    });

    it('converts arbitrary color', () => {
      const input = new Uint8Array([128, 64, 32]);
      const rgba = decodeRGB888(input, 1, 1);
      expect(rgba[0]).toBe(128);
      expect(rgba[1]).toBe(64);
      expect(rgba[2]).toBe(32);
      expect(rgba[3]).toBe(255);
    });
  });

  describe('getDecoder', () => {
    it('returns decodeRGB565 for common format IDs', () => {
      expect(getDecoder(1057)).toBe(decodeRGB565);
      expect(getDecoder(1055)).toBe(decodeRGB565);
      expect(getDecoder(1031)).toBe(decodeRGB565);
    });

    it('returns decodeRGB555 for format IDs 1066/1067', () => {
      expect(getDecoder(1066)).toBe(decodeRGB555);
      expect(getDecoder(1067)).toBe(decodeRGB555);
    });

    it('returns null for unknown format IDs', () => {
      expect(getDecoder(9999)).toBeNull();
    });
  });

  describe('getBytesPerPixel', () => {
    it('returns 2 for 16-bit formats', () => {
      expect(getBytesPerPixel(1057)).toBe(2);
      expect(getBytesPerPixel(1066)).toBe(2);
    });

    it('returns 3 for RGB888 format', () => {
      expect(getBytesPerPixel(1068)).toBe(3);
    });

    it('returns null for unknown formats', () => {
      expect(getBytesPerPixel(9999)).toBeNull();
    });
  });
});

// ── ithmb extractor tests ───────────────────────────────────────────

describe('extractThumbnail', () => {
  it('extracts a simple thumbnail without padding', () => {
    // Create a 2x2 RGB565 ithmb buffer (8 bytes)
    const ithmbData = new Uint8Array([
      0x00,
      0xf8, // red
      0xe0,
      0x07, // green
      0x1f,
      0x00, // blue
      0xff,
      0xff, // white
    ]);

    const thumb: ArtworkThumbnail = {
      formatId: 1057,
      width: 2,
      height: 2,
      offset: 0,
      size: 8,
      horizontalPadding: 0,
      verticalPadding: 0,
    };

    const result = extractThumbnail(ithmbData, thumb);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(2);
    expect(result!.height).toBe(2);
    expect(result!.data.length).toBe(16); // 2*2*4

    // First pixel is red
    expect(result!.data[0]).toBe(255);
    expect(result!.data[1]).toBe(0);
    expect(result!.data[2]).toBe(0);
  });

  it('extracts thumbnail at a non-zero offset', () => {
    // 4 bytes padding + 2 pixel bytes
    const ithmbData = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x00, // padding
      0xff,
      0xff, // white pixel
    ]);

    const thumb: ArtworkThumbnail = {
      formatId: 1057,
      width: 1,
      height: 1,
      offset: 4,
      size: 2,
      horizontalPadding: 0,
      verticalPadding: 0,
    };

    const result = extractThumbnail(ithmbData, thumb);
    expect(result).not.toBeNull();
    expect(result!.data[0]).toBe(255); // white
    expect(result!.data[1]).toBe(255);
    expect(result!.data[2]).toBe(255);
  });

  it('crops out horizontal and vertical padding', () => {
    // 3x3 image (2x2 content + 1 padding on each axis)
    // RGB565, 9 pixels = 18 bytes
    const ithmbData = new Uint8Array([
      // Row 0: red, green, pad
      0x00, 0xf8, 0xe0, 0x07, 0x00, 0x00,
      // Row 1: blue, white, pad
      0x1f, 0x00, 0xff, 0xff, 0x00, 0x00,
      // Row 2 (padding): pad, pad, pad
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);

    const thumb: ArtworkThumbnail = {
      formatId: 1057,
      width: 2,
      height: 2,
      offset: 0,
      size: 18,
      horizontalPadding: 1,
      verticalPadding: 1,
    };

    const result = extractThumbnail(ithmbData, thumb);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(2);
    expect(result!.height).toBe(2);
    expect(result!.data.length).toBe(16); // 2*2*4 = cropped

    // (0,0) = red
    expect(result!.data[0]).toBe(255);
    expect(result!.data[1]).toBe(0);
    expect(result!.data[2]).toBe(0);

    // (1,0) = green
    expect(result!.data[4]).toBe(0);
    expect(result!.data[5]).toBe(255);
    expect(result!.data[6]).toBe(0);
  });

  it('returns null for unknown format ID', () => {
    const ithmbData = new Uint8Array(100);
    const thumb: ArtworkThumbnail = {
      formatId: 9999,
      width: 1,
      height: 1,
      offset: 0,
      size: 2,
      horizontalPadding: 0,
      verticalPadding: 0,
    };

    expect(extractThumbnail(ithmbData, thumb)).toBeNull();
  });

  it('returns null when offset exceeds ithmb size', () => {
    const ithmbData = new Uint8Array(4);
    const thumb: ArtworkThumbnail = {
      formatId: 1057,
      width: 1,
      height: 1,
      offset: 10,
      size: 2,
      horizontalPadding: 0,
      verticalPadding: 0,
    };

    expect(extractThumbnail(ithmbData, thumb)).toBeNull();
  });
});

// ── ArtworkDB parser tests ──────────────────────────────────────────

describe('parseArtworkDatabase', () => {
  describe('fixture: empty', () => {
    it('parses an empty ArtworkDB with no images', () => {
      const dbPath = join(FIXTURES_DIR, 'empty', 'iPod_Control/Artwork/ArtworkDB');
      const data = new Uint8Array(readFileSync(dbPath));
      const db = parseArtworkDatabase(data);

      expect(db.images).toHaveLength(0);
      expect(db.albums).toHaveLength(0);
      expect(db.files.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('fixture: ipod-nano-4', () => {
    it('parses the ArtworkDB with file info records', () => {
      const dbPath = join(FIXTURES_DIR, 'ipod-nano-4', 'iPod_Control/Artwork/ArtworkDB');
      const data = new Uint8Array(readFileSync(dbPath));
      const db = parseArtworkDatabase(data);

      expect(db.images).toHaveLength(0);
      expect(db.albums).toHaveLength(0);
      // ipod-nano-4 has 6 mhif records
      expect(db.files).toHaveLength(6);

      // Each file should have a formatId and imageSize
      for (const file of db.files) {
        expect(file.formatId).toBeGreaterThan(0);
        expect(file.imageSize).toBeGreaterThan(0);
      }
    });
  });

  describe('all fixtures', () => {
    const fixtures = [
      'empty',
      'ipod-classic',
      'ipod-nano-4',
      'many-tracks',
      'playlists',
      'single-track',
      'unicode-strings',
    ];

    for (const name of fixtures) {
      it(`parses ${name} ArtworkDB without throwing`, () => {
        const dbPath = join(FIXTURES_DIR, name, 'iPod_Control/Artwork/ArtworkDB');
        const data = new Uint8Array(readFileSync(dbPath));
        const db = parseArtworkDatabase(data);

        expect(db.images).toBeInstanceOf(Array);
        expect(db.albums).toBeInstanceOf(Array);
        expect(db.files).toBeInstanceOf(Array);
      });
    }
  });

  describe('synthetic data', () => {
    it('parses a minimal ArtworkDB with one image and one file', () => {
      const db = parseArtworkDatabase(buildMinimalArtworkDB());

      expect(db.images).toHaveLength(1);
      expect(db.images[0]!.imageId).toBe(42);
      expect(db.images[0]!.thumbnails).toHaveLength(0);

      expect(db.files).toHaveLength(1);
      expect(db.files[0]!.formatId).toBe(1057);
      expect(db.files[0]!.imageSize).toBe(0x9800);
    });

    it('throws for invalid header tag', () => {
      const data = new Uint8Array(16);
      data[0] = 0x62; // 'b' instead of 'm'
      expect(() => parseArtworkDatabase(data)).toThrow('mhfd');
    });
  });
});

// ── Test helpers ────────────────────────────────────────────────────

/** Build a minimal ArtworkDB binary with 1 image, 0 albums, and 1 file. */
function buildMinimalArtworkDB(): Uint8Array {
  const parts: Uint8Array[] = [];
  let totalLen = 0;

  // We build the sections first, then prepend the mhfd header

  // ── Section 1: image list ──
  const mhiiHeader = buildMhii(42, 1234n, 5000);
  const mhli = buildListRecord('mhli', 1, [mhiiHeader]);
  const mhsd1 = buildMhsd(1, mhli);

  // ── Section 2: album list ──
  const mhla = buildListRecord('mhla', 0, []);
  const mhsd2 = buildMhsd(2, mhla);

  // ── Section 3: file list ──
  const mhif = buildMhif(1057, 0x9800);
  const mhlf = buildListRecord('mhlf', 1, [mhif]);
  const mhsd3 = buildMhsd(3, mhlf);

  // ── mhfd header ──
  const mhfdHeaderLen = 0x84; // 132 bytes, matches fixtures
  const mhfdTotalLen = mhfdHeaderLen + mhsd1.byteLength + mhsd2.byteLength + mhsd3.byteLength;
  const mhfd = new Uint8Array(mhfdHeaderLen);
  const mhfdView = new DataView(mhfd.buffer);
  writeTag(mhfd, 0, 'mhfd');
  mhfdView.setUint32(4, mhfdHeaderLen, true);
  mhfdView.setUint32(8, mhfdTotalLen, true);
  mhfdView.setUint32(0x10, 2, true); // unknown2 (version flag)
  mhfdView.setUint32(0x14, 3, true); // numChildren

  parts.push(mhfd, mhsd1, mhsd2, mhsd3);

  // Concatenate all parts
  totalLen = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

function buildMhsd(sectionType: number, child: Uint8Array): Uint8Array {
  const headerLen = 0x60; // 96 bytes, matches fixtures
  const totalLen = headerLen + child.byteLength;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  writeTag(buf, 0, 'mhsd');
  view.setUint32(4, headerLen, true);
  view.setUint32(8, totalLen, true);
  view.setUint16(12, sectionType, true); // 16-bit in ArtworkDB

  buf.set(child, headerLen);
  return buf;
}

function buildListRecord(tag: string, numChildren: number, children: Uint8Array[]): Uint8Array {
  const headerLen = 0x5c; // 92 bytes, matches fixtures
  const childrenLen = children.reduce((sum, c) => sum + c.byteLength, 0);
  const buf = new Uint8Array(headerLen + childrenLen);
  const view = new DataView(buf.buffer);

  writeTag(buf, 0, tag);
  view.setUint32(4, headerLen, true);
  view.setUint32(8, numChildren, true);

  let offset = headerLen;
  for (const child of children) {
    buf.set(child, offset);
    offset += child.byteLength;
  }

  return buf;
}

function buildMhii(imageId: number, songId: bigint, imageSize: number): Uint8Array {
  const headerLen = 0x34; // 52 bytes (minimum based on struct)
  const totalLen = headerLen; // no mhod children
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  writeTag(buf, 0, 'mhii');
  view.setUint32(4, headerLen, true);
  view.setUint32(8, totalLen, true);
  view.setUint32(12, 0, true); // numChildren
  view.setUint32(16, imageId, true);
  view.setBigInt64(20, songId, true); // songId (packed)
  view.setUint32(0x30, imageSize, true); // origImgSize

  return buf;
}

function buildMhif(formatId: number, imageSize: number): Uint8Array {
  const headerLen = 0x7c; // 124 bytes, matches fixtures
  const totalLen = headerLen;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  writeTag(buf, 0, 'mhif');
  view.setUint32(4, headerLen, true);
  view.setUint32(8, totalLen, true);
  view.setUint32(12, 0, true); // unknown1
  view.setUint32(16, formatId, true);
  view.setUint32(20, imageSize, true);

  return buf;
}

function writeTag(buf: Uint8Array, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = tag.charCodeAt(i);
  }
}
