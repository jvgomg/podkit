/**
 * Read-only parser for the iPod `ArtworkDB` binary file.
 *
 * The ArtworkDB uses the same mh-record framing as the iTunesDB but with its
 * own record types. We only need the image list (track-dbid → thumbnail
 * descriptors), so this parser walks just that branch and skips the album/file
 * sections:
 *
 * ```
 * mhfd (file header)
 * └── mhsd type=1 (image list)
 *     └── mhli
 *         └── mhii × N (image items)            ← imageId, songId (track dbid)
 *             └── mhod type=2 × M (thumbnail container)
 *                 └── mhni (thumbnail data)      ← formatId, offset, size, dims
 *                     └── mhod type=3 (optional ithmb filename)
 * ```
 *
 * Ported from `@podkit/ipod-db`'s `artworkdb/parser.ts`. The package keeps its
 * own tiny little-endian cursor (see {@link ArtworkReader}) so it doesn't take
 * an `@podkit/ipod-db` dependency.
 *
 * @module
 */

import { IpodArchiveError } from '../errors.js';
import type { ArtworkDatabase, ArtworkImage, ArtworkThumbnail } from './types.js';

const utf8Decoder = new TextDecoder('utf-8');
const utf16leDecoder = new TextDecoder('utf-16le' as ConstructorParameters<typeof TextDecoder>[0]);
const asciiDecoder = new TextDecoder('ascii' as ConstructorParameters<typeof TextDecoder>[0]);

/**
 * A minimal little-endian cursor over a `Uint8Array`, backed by `DataView`.
 *
 * The ArtworkDB is always little-endian on the generations podkit archives
 * (the big-endian firmware variants predate USB-readable artwork), so — unlike
 * the iTunesDB — no endianness auto-detection is needed here.
 */
class ArtworkReader {
  private readonly data: Uint8Array;
  private readonly view: DataView;
  private cursor = 0;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get offset(): number {
    return this.cursor;
  }

  get length(): number {
    return this.data.byteLength;
  }

  seek(position: number): void {
    if (position < 0 || position > this.data.byteLength) {
      throw new IpodArchiveError(
        'ARTWORK_DB_MALFORMED',
        `ArtworkDB seek out of bounds: ${position} (length ${this.data.byteLength})`
      );
    }
    this.cursor = position;
  }

  readTag(): string {
    this.ensure(4);
    const bytes = this.data.subarray(this.cursor, this.cursor + 4);
    this.cursor += 4;
    return asciiDecoder.decode(bytes);
  }

  readUInt16(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.cursor, true);
    this.cursor += 2;
    return value;
  }

  readUInt32(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.cursor, true);
    this.cursor += 4;
    return value;
  }

  readUInt64(): bigint {
    this.ensure(8);
    const value = this.view.getBigUint64(this.cursor, true);
    this.cursor += 8;
    return value;
  }

  readBytes(n: number): Uint8Array {
    this.ensure(n);
    const sub = this.data.subarray(this.cursor, this.cursor + n);
    this.cursor += n;
    return sub;
  }

  private ensure(n: number): void {
    if (this.cursor + n > this.data.byteLength) {
      throw new IpodArchiveError(
        'ARTWORK_DB_MALFORMED',
        `ArtworkDB truncated: needed ${n} bytes at offset ${this.cursor}, ` +
          `${this.data.byteLength - this.cursor} remaining`
      );
    }
  }
}

/**
 * Parse a complete `ArtworkDB` binary into its image list.
 *
 * @throws IpodArchiveError('ARTWORK_DB_MALFORMED') when the `mhfd` header is
 *   missing or a record runs past the end of the buffer.
 */
export function parseArtworkDatabase(data: Uint8Array): ArtworkDatabase {
  const reader = new ArtworkReader(data);
  return parseMhfd(reader);
}

// ── mhfd (file header) ──────────────────────────────────────────────────────

/**
 * Layout:
 *   [0x00] tag "mhfd"   (4)
 *   [0x04] headerLen    (u32)
 *   [0x08] totalLen     (u32)
 *   [0x0c] unknown1     (u32)
 *   [0x10] unknown2     (u32)
 *   [0x14] numChildren  (u32)
 *   ... padding to headerLen ...
 *   [headerLen] first mhsd child
 */
function parseMhfd(reader: ArtworkReader): ArtworkDatabase {
  const start = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhfd') {
    throw new IpodArchiveError(
      'ARTWORK_DB_MALFORMED',
      `Not an ArtworkDB: expected "mhfd" header, found "${tag}"`
    );
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  reader.readUInt32(); // unknown1
  reader.readUInt32(); // unknown2
  const numChildren = reader.readUInt32();

  reader.seek(start + headerLen);

  const images: ArtworkImage[] = [];
  const fileEnd = Math.min(start + totalLen, reader.length);

  for (let i = 0; i < numChildren && reader.offset < fileEnd; i++) {
    parseMhsd(reader, images);
  }

  return { images };
}

// ── mhsd (section) ──────────────────────────────────────────────────────────

/**
 * Layout:
 *   [0x00] tag "mhsd"   (4)
 *   [0x04] headerLen    (u32)
 *   [0x08] totalLen     (u32)
 *   [0x0c] sectionType  (u16) — note: 16-bit in ArtworkDB (32-bit in iTunesDB)
 *   ... padding to headerLen ...
 *   [headerLen] child list
 *
 * Only section type 1 (image list) is consumed; types 2 (albums) and 3 (files)
 * are skipped.
 */
function parseMhsd(reader: ArtworkReader, images: ArtworkImage[]): void {
  const start = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhsd') {
    throw new IpodArchiveError(
      'ARTWORK_DB_MALFORMED',
      `Expected "mhsd" section, found "${tag}" at offset ${start}`
    );
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const sectionType = reader.readUInt16();

  const sectionEnd = Math.min(start + totalLen, reader.length);
  reader.seek(start + headerLen);

  if (sectionType === 1) {
    parseMhli(reader, sectionEnd, images);
  }

  reader.seek(sectionEnd);
}

// ── mhli (image list) ───────────────────────────────────────────────────────

/**
 * Layout:
 *   [0x00] tag "mhli"   (4)
 *   [0x04] headerLen    (u32)
 *   [0x08] numChildren  (u32)
 *   ... padding to headerLen ...
 *   [headerLen] first mhii child
 */
function parseMhli(reader: ArtworkReader, sectionEnd: number, images: ArtworkImage[]): void {
  const start = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhli') {
    throw new IpodArchiveError(
      'ARTWORK_DB_MALFORMED',
      `Expected "mhli", found "${tag}" at offset ${start}`
    );
  }

  const headerLen = reader.readUInt32();
  const numChildren = reader.readUInt32();

  reader.seek(start + headerLen);

  for (let i = 0; i < numChildren && reader.offset < sectionEnd; i++) {
    images.push(parseMhii(reader));
  }
}

// ── mhii (image item) ───────────────────────────────────────────────────────

/**
 * Layout (libgpod `MhiiHeader`):
 *   [0x00] tag "mhii"     (4)
 *   [0x04] headerLen      (u32)
 *   [0x08] totalLen       (u32)
 *   [0x0c] numChildren    (u32)
 *   [0x10] imageId        (u32)
 *   [0x14] songId         (u64) — track dbid, packed, no alignment padding
 *   ...
 *   [headerLen] mhod children
 */
function parseMhii(reader: ArtworkReader): ArtworkImage {
  const start = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhii') {
    throw new IpodArchiveError(
      'ARTWORK_DB_MALFORMED',
      `Expected "mhii", found "${tag}" at offset ${start}`
    );
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const numChildren = reader.readUInt32();
  const imageId = reader.readUInt32();
  const songId = reader.readUInt64();

  reader.seek(start + headerLen);

  const bodyEnd = Math.min(start + totalLen, reader.length);
  const thumbnails: ArtworkThumbnail[] = [];

  for (let i = 0; i < numChildren && reader.offset < bodyEnd; i++) {
    parseArtworkMhod(reader, bodyEnd, thumbnails);
  }

  reader.seek(bodyEnd);

  return { imageId, sourceId: songId, thumbnails };
}

// ── mhod (artwork container) ─────────────────────────────────────────────────

/**
 * Layout:
 *   [0x00] tag "mhod"   (4)
 *   [0x04] headerLen    (u32)
 *   [0x08] totalLen     (u32)
 *   [0x0c] type         (u16) — note: 16-bit in ArtworkDB
 *   ... padding to headerLen ...
 *   [headerLen] body (mhni for type 2, string for type 3)
 *
 * Type 2 holds a thumbnail container (an `mhni` child). Type 3 (a filename) is
 * read as a child of the `mhni`, so here only type 2 is handled.
 */
function parseArtworkMhod(
  reader: ArtworkReader,
  boundary: number,
  thumbnails: ArtworkThumbnail[]
): void {
  const start = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhod') {
    throw new IpodArchiveError(
      'ARTWORK_DB_MALFORMED',
      `Expected "mhod", found "${tag}" at offset ${start}`
    );
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const mhodType = reader.readUInt16();

  const recordEnd = Math.min(start + totalLen, boundary);

  if (mhodType === 2) {
    reader.seek(start + headerLen);
    if (reader.offset < recordEnd) {
      const thumb = parseMhni(reader, recordEnd);
      if (thumb !== null) {
        thumbnails.push(thumb);
      }
    }
  }

  reader.seek(recordEnd);
}

// ── mhni (thumbnail data) ────────────────────────────────────────────────────

/**
 * Layout (libgpod `MhniHeader`):
 *   [0x00] tag "mhni"          (4)
 *   [0x04] headerLen           (u32)
 *   [0x08] totalLen            (u32)
 *   [0x0c] numChildren         (u32)
 *   [0x10] formatId            (u32)
 *   [0x14] ithmbOffset         (u32)
 *   [0x18] imageSize           (u32)
 *   [0x1c] verticalPadding     (u16)
 *   [0x1e] horizontalPadding   (u16)
 *   [0x20] imageHeight         (u16)
 *   [0x22] imageWidth          (u16)
 *   ... padding to headerLen ...
 *   [headerLen] optional mhod type-3 (filename)
 */
function parseMhni(reader: ArtworkReader, boundary: number): ArtworkThumbnail | null {
  const start = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhni') {
    reader.seek(start);
    return null;
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  reader.readUInt32(); // numChildren
  const formatId = reader.readUInt32();
  const offset = reader.readUInt32();
  const size = reader.readUInt32();
  const verticalPadding = reader.readUInt16();
  const horizontalPadding = reader.readUInt16();
  const height = reader.readUInt16();
  const width = reader.readUInt16();

  const recordEnd = Math.min(start + totalLen, boundary);

  let filename: string | undefined;
  reader.seek(start + headerLen);
  if (reader.offset < recordEnd) {
    filename = tryParseFilenameMhod(reader, recordEnd);
  }

  reader.seek(recordEnd);

  return {
    formatId,
    width,
    height,
    offset,
    size,
    horizontalPadding,
    verticalPadding,
    ...(filename !== undefined ? { filename } : {}),
  };
}

// ── mhod type 3 (filename string) ────────────────────────────────────────────

/**
 * Try to read an `mhod` type-3 filename string. Returns the string, or
 * `undefined` when the record isn't a type-3 string mhod or is malformed.
 *
 * ArtworkDB string mhod layout:
 *   [0x00] tag "mhod"   (4)
 *   [0x04] headerLen    (u32)
 *   [0x08] totalLen     (u32)
 *   [0x0c] type         (u16)
 *   ...
 *   [0x18] stringLen    (u32)
 *   [0x1c] encoding     (u8)  — 0/1 = UTF-8, 2 = UTF-16LE
 *   ...
 *   [0x24] string bytes
 */
function tryParseFilenameMhod(reader: ArtworkReader, boundary: number): string | undefined {
  const start = reader.offset;

  if (boundary - start < 12) return undefined;

  const tag = reader.readTag();
  if (tag !== 'mhod') {
    reader.seek(start);
    return undefined;
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const mhodType = reader.readUInt16();

  const recordEnd = Math.min(start + totalLen, boundary);

  if (mhodType !== 3 || headerLen < 0x24 || totalLen < 0x24) {
    reader.seek(recordEnd);
    return undefined;
  }

  reader.seek(start + 0x18);
  const stringLen = reader.readUInt32();
  const encoding = reader.readBytes(1)[0]!;

  reader.seek(start + 0x24);
  if (reader.offset + stringLen > boundary) {
    reader.seek(recordEnd);
    return undefined;
  }

  const bytes = reader.readBytes(stringLen);
  const value = encoding === 2 ? utf16leDecoder.decode(bytes) : utf8Decoder.decode(bytes);

  reader.seek(recordEnd);
  return value;
}
