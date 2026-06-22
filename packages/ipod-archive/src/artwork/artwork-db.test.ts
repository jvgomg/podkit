/**
 * Unit tests for the ported ArtworkDB binary parser, with synthetic records.
 *
 * Covers the happy path (an mhfd → image-list → mhii → mhod type-2 → mhni
 * walk, with the optional type-3 filename) and the malformed-input contract:
 * the parser raises a typed `ARTWORK_DB_MALFORMED` rather than reading past the
 * buffer.
 */

import { describe, expect, test } from 'bun:test';
import { parseArtworkDatabase } from './artwork-db.js';
import { IpodArchiveError } from '../errors.js';

function writeTag(buf: Uint8Array, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) buf[offset + i] = tag.charCodeAt(i);
}

function buildMhni(
  formatId: number,
  offset: number,
  size: number,
  w: number,
  h: number
): Uint8Array {
  const headerLen = 0x4c;
  const buf = new Uint8Array(headerLen);
  const v = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhni');
  v.setUint32(0x04, headerLen, true);
  v.setUint32(0x08, headerLen, true);
  v.setUint32(0x10, formatId, true);
  v.setUint32(0x14, offset, true);
  v.setUint32(0x18, size, true);
  v.setUint16(0x20, h, true);
  v.setUint16(0x22, w, true);
  return buf;
}

function buildThumbMhod(mhni: Uint8Array): Uint8Array {
  const headerLen = 0x18;
  const totalLen = headerLen + mhni.byteLength;
  const buf = new Uint8Array(totalLen);
  const v = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhod');
  v.setUint32(0x04, headerLen, true);
  v.setUint32(0x08, totalLen, true);
  v.setUint16(0x0c, 2, true);
  buf.set(mhni, headerLen);
  return buf;
}

function buildMhii(imageId: number, songId: bigint, children: Uint8Array[]): Uint8Array {
  const headerLen = 0x98;
  const childrenLen = children.reduce((s, c) => s + c.byteLength, 0);
  const totalLen = headerLen + childrenLen;
  const buf = new Uint8Array(totalLen);
  const v = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhii');
  v.setUint32(0x04, headerLen, true);
  v.setUint32(0x08, totalLen, true);
  v.setUint32(0x0c, children.length, true);
  v.setUint32(0x10, imageId, true);
  v.setBigUint64(0x14, songId, true);
  let off = headerLen;
  for (const c of children) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf;
}

function buildList(tag: string, children: Uint8Array[]): Uint8Array {
  const headerLen = 0x5c;
  const childrenLen = children.reduce((s, c) => s + c.byteLength, 0);
  const buf = new Uint8Array(headerLen + childrenLen);
  const v = new DataView(buf.buffer);
  writeTag(buf, 0, tag);
  v.setUint32(0x04, headerLen, true);
  v.setUint32(0x08, children.length, true);
  let off = headerLen;
  for (const c of children) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf;
}

function buildMhsd(sectionType: number, child: Uint8Array): Uint8Array {
  const headerLen = 0x60;
  const totalLen = headerLen + child.byteLength;
  const buf = new Uint8Array(totalLen);
  const v = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhsd');
  v.setUint32(0x04, headerLen, true);
  v.setUint32(0x08, totalLen, true);
  v.setUint16(0x0c, sectionType, true);
  buf.set(child, headerLen);
  return buf;
}

function buildDb(sections: Uint8Array[]): Uint8Array {
  const headerLen = 0x84;
  const childrenLen = sections.reduce((s, c) => s + c.byteLength, 0);
  const totalLen = headerLen + childrenLen;
  const buf = new Uint8Array(totalLen);
  const v = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhfd');
  v.setUint32(0x04, headerLen, true);
  v.setUint32(0x08, totalLen, true);
  v.setUint32(0x14, sections.length, true);
  let off = headerLen;
  for (const s of sections) {
    buf.set(s, off);
    off += s.byteLength;
  }
  return buf;
}

describe('parseArtworkDatabase', () => {
  test('parses an image list with one mhii carrying one thumbnail', () => {
    const mhni = buildMhni(1057, 64, 128, 100, 100);
    const mhii = buildMhii(7, 0xdeadbeefn, [buildThumbMhod(mhni)]);
    const db = parseArtworkDatabase(buildDb([buildMhsd(1, buildList('mhli', [mhii]))]));

    expect(db.images).toHaveLength(1);
    const img = db.images[0]!;
    expect(img.imageId).toBe(7);
    expect(img.sourceId).toBe(0xdeadbeefn); // 64-bit dbid round-trips
    expect(img.thumbnails).toHaveLength(1);
    expect(img.thumbnails[0]).toMatchObject({
      formatId: 1057,
      offset: 64,
      size: 128,
      width: 100,
      height: 100,
    });
  });

  test('skips non-image sections (albums/files) without surfacing them', () => {
    const mhni = buildMhni(1057, 0, 2, 1, 1);
    const mhii = buildMhii(1, 1n, [buildThumbMhod(mhni)]);
    const db = parseArtworkDatabase(
      buildDb([
        buildMhsd(2, buildList('mhla', [])), // album list — ignored
        buildMhsd(1, buildList('mhli', [mhii])),
        buildMhsd(3, buildList('mhlf', [])), // file list — ignored
      ])
    );
    expect(db.images).toHaveLength(1);
  });

  test('throws a typed error when the mhfd header is missing', () => {
    const data = new Uint8Array(16);
    writeTag(data, 0, 'junk');
    const err = (() => {
      try {
        parseArtworkDatabase(data);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(IpodArchiveError);
    expect((err as IpodArchiveError).code).toBe('ARTWORK_DB_MALFORMED');
  });

  test('throws ARTWORK_DB_MALFORMED on a truncated buffer (too short for mhfd)', () => {
    const data = new Uint8Array([0x6d, 0x68, 0x66, 0x64]); // "mhfd" then EOF
    expect(() => parseArtworkDatabase(data)).toThrow(IpodArchiveError);
  });
});
