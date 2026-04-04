/**
 * Read-only parser for iPod ArtworkDB binary files.
 *
 * The ArtworkDB uses the same mh-record format as iTunesDB but with
 * different record types:
 *
 * ```
 * mhfd (file header)
 * ├── mhsd type=1 (image list)
 * │   └── mhli
 * │       └── mhii × N (image items)
 * │           └── mhod × M (thumbnail containers)
 * │               └── mhni (thumbnail data with ithmb offsets)
 * │                   └── mhod type=3 (optional filename)
 * ├── mhsd type=2 (album list)
 * │   └── mhla
 * │       └── mhba × N (albums)
 * │           ├── mhod × M (album name)
 * │           └── mhia × K (album items)
 * └── mhsd type=3 (file list)
 *     └── mhlf
 *         └── mhif × N (file info)
 * ```
 */

import { BufferReader } from '../binary/reader.js';
import { ParseError } from '../binary/errors.js';
import type {
  ArtworkDatabase,
  ArtworkImage,
  ArtworkThumbnail,
  ArtworkAlbum,
  ArtworkFile,
} from './types.js';

// ── Public API ──────────────────────────────────────────────────────

/**
 * Parse a complete ArtworkDB binary file into a structured object.
 *
 * Auto-detects byte order by looking for the "mhfd" tag.
 */
export function parseArtworkDatabase(data: Uint8Array): ArtworkDatabase {
  let reader = new BufferReader(data);

  // Auto-detect endianness
  const tag = reader.readTag();
  reader.seek(0);

  if (tag !== 'mhfd') {
    // Try big-endian
    const beReader = new BufferReader(data, true);
    const beTag = beReader.readTag();
    beReader.seek(0);

    if (beTag !== 'mhfd') {
      throw new ParseError('Not an ArtworkDB: missing mhfd header', {
        offset: 0,
        expected: 'mhfd',
        actual: tag,
      });
    }
    reader = beReader;
  }

  return parseMhfd(reader);
}

// ── mhfd (file header) ─────────────────────────────────────────────

/**
 * Parse the mhfd file header and all child mhsd sections.
 *
 * Layout:
 *   [0x00] tag "mhfd"          (4 bytes)
 *   [0x04] headerLen            (uint32)
 *   [0x08] totalLen             (uint32)
 *   [0x0c] unknown1             (uint32)
 *   [0x10] unknown2             (uint32)
 *   [0x14] numChildren          (uint32)
 *   [0x18] unknown3             (uint32)
 *   [0x1c] nextId               (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] first mhsd child
 */
function parseMhfd(reader: BufferReader): ArtworkDatabase {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhfd') {
    throw new ParseError('Expected mhfd tag', {
      offset: startOffset,
      expected: 'mhfd',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  reader.readUInt32(); // unknown1
  reader.readUInt32(); // unknown2
  const numChildren = reader.readUInt32();

  // Jump to first child
  reader.seek(startOffset + headerLen);

  const images: ArtworkImage[] = [];
  const albums: ArtworkAlbum[] = [];
  const files: ArtworkFile[] = [];
  const fileEnd = startOffset + totalLen;

  for (let i = 0; i < numChildren && reader.offset < fileEnd; i++) {
    parseMhsd(reader, images, albums, files);
  }

  return { images, albums, files };
}

// ── mhsd (section data) ────────────────────────────────────────────

/**
 * Parse an mhsd section.
 *
 * Layout:
 *   [0x00] tag "mhsd"    (4 bytes)
 *   [0x04] headerLen      (uint32)
 *   [0x08] totalLen       (uint32)
 *   [0x0c] sectionType    (uint16) — note: 16 bits in ArtworkDB, not 32
 *   [0x0e] unknown        (uint16)
 *   ... padding to headerLen ...
 *   [headerLen] child list
 */
function parseMhsd(
  reader: BufferReader,
  images: ArtworkImage[],
  albums: ArtworkAlbum[],
  files: ArtworkFile[]
): void {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhsd') {
    throw new ParseError('Expected mhsd tag', {
      offset: startOffset,
      expected: 'mhsd',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  // ArtworkDB uses 16-bit section type (unlike iTunesDB which uses 32-bit)
  const sectionType = reader.readUInt16();

  const sectionEnd = startOffset + totalLen;
  reader.seek(startOffset + headerLen);

  switch (sectionType) {
    case 1: // image list
      parseMhli(reader, sectionEnd, images);
      break;
    case 2: // album list
      parseMhla(reader, sectionEnd, albums);
      break;
    case 3: // file list
      parseMhlf(reader, sectionEnd, files);
      break;
    default:
      // Unknown section type — skip
      break;
  }

  reader.seek(sectionEnd);
}

// ── mhli (image list) ──────────────────────────────────────────────

/**
 * Parse an mhli record and its mhii children.
 *
 * Layout:
 *   [0x00] tag "mhli"      (4 bytes)
 *   [0x04] headerLen        (uint32)
 *   [0x08] numChildren      (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] first mhii child
 */
function parseMhli(reader: BufferReader, sectionEnd: number, images: ArtworkImage[]): void {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhli') {
    throw new ParseError('Expected mhli tag', {
      offset: startOffset,
      expected: 'mhli',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const numChildren = reader.readUInt32();

  reader.seek(startOffset + headerLen);

  for (let i = 0; i < numChildren && reader.offset < sectionEnd; i++) {
    images.push(parseMhii(reader));
  }
}

// ── mhii (image item) ──────────────────────────────────────────────

/**
 * Parse an mhii record.
 *
 * Layout (from libgpod MhiiHeader):
 *   [0x00] tag "mhii"        (4 bytes)
 *   [0x04] headerLen          (uint32)
 *   [0x08] totalLen           (uint32)
 *   [0x0c] numChildren        (uint32)
 *   [0x10] imageId            (uint32)
 *   [0x14] songId             (int64)  — packed, no alignment padding
 *   [0x1c] unknown4           (uint32)
 *   [0x20] rating             (uint32)
 *   [0x24] unknown6           (uint32)
 *   [0x28] origDate           (uint32)
 *   [0x2c] digitizedDate      (uint32)
 *   [0x30] origImgSize        (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] mhod children
 */
function parseMhii(reader: BufferReader): ArtworkImage {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhii') {
    throw new ParseError('Expected mhii tag', {
      offset: startOffset,
      expected: 'mhii',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const numChildren = reader.readUInt32();
  const imageId = reader.readUInt32();
  const songId = reader.readInt64();

  // Skip to origImgSize
  reader.seek(startOffset + 0x30);
  const imageSize = reader.readUInt32();

  // Jump to children
  reader.seek(startOffset + headerLen);

  const bodyEnd = startOffset + totalLen;
  const thumbnails: ArtworkThumbnail[] = [];

  for (let i = 0; i < numChildren && reader.offset < bodyEnd; i++) {
    parseMhod_artwork(reader, thumbnails);
  }

  reader.seek(bodyEnd);

  return {
    imageId,
    imageSize,
    sourceId: songId,
    thumbnails,
  };
}

// ── mhod (artwork container) ────────────────────────────────────────

/**
 * Parse an ArtworkDB mhod record.
 *
 * ArtworkDB mhod layout:
 *   [0x00] tag "mhod"      (4 bytes)
 *   [0x04] headerLen        (uint32)
 *   [0x08] totalLen         (uint32)
 *   [0x0c] type             (uint16) — note: 16 bits in ArtworkDB
 *   [0x0e] unknown          (uint16)
 *   [0x10] unknown1         (uint32)
 *   [0x14] unknown2         (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] body (mhni for type 2, string for type 3)
 *
 * Type 2 = thumbnail container (contains an mhni child).
 * Type 3 = filename string.
 */
function parseMhod_artwork(reader: BufferReader, thumbnails: ArtworkThumbnail[]): void {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhod') {
    throw new ParseError('Expected mhod tag', {
      offset: startOffset,
      expected: 'mhod',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const mhodType = reader.readUInt16();

  const recordEnd = startOffset + totalLen;

  if (mhodType === 2) {
    // Thumbnail container — child is an mhni record
    reader.seek(startOffset + headerLen);
    if (reader.offset < recordEnd) {
      const thumb = parseMhni(reader);
      if (thumb !== null) {
        thumbnails.push(thumb);
      }
    }
  }
  // Type 3 (filename) is handled inside mhni parsing as a child mhod

  reader.seek(recordEnd);
}

// ── mhni (thumbnail data) ──────────────────────────────────────────

/**
 * Parse an mhni record containing ithmb thumbnail location data.
 *
 * Layout (from libgpod MhniHeader):
 *   [0x00] tag "mhni"          (4 bytes)
 *   [0x04] headerLen            (uint32)
 *   [0x08] totalLen             (uint32)
 *   [0x0c] numChildren          (uint32)
 *   [0x10] formatId             (uint32)
 *   [0x14] ithmbOffset          (uint32)
 *   [0x18] imageSize            (uint32)
 *   [0x1c] verticalPadding      (int16)
 *   [0x1e] horizontalPadding    (int16)
 *   [0x20] imageHeight          (int16)
 *   [0x22] imageWidth           (int16)
 *   ... padding to headerLen ...
 *   [headerLen] optional mhod type 3 (filename)
 */
function parseMhni(reader: BufferReader): ArtworkThumbnail | null {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhni') {
    // Not an mhni — skip
    reader.seek(startOffset);
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

  const recordEnd = startOffset + totalLen;

  // Try to read optional filename mhod (type 3)
  let filename: string | undefined;
  reader.seek(startOffset + headerLen);
  if (reader.offset < recordEnd) {
    filename = tryParseMhodFilename(reader, recordEnd);
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
    filename,
  };
}

// ── mhod type 3 (filename string) ──────────────────────────────────

const textDecoderUtf8 = new TextDecoder('utf-8');
const textDecoderUtf16le = new TextDecoder(
  'utf-16le' as ConstructorParameters<typeof TextDecoder>[0]
);

/**
 * Try to parse an mhod type 3 filename string.
 * Returns the filename or undefined if parsing fails.
 *
 * ArtworkDB string mhod layout:
 *   [0x00] tag "mhod"         (4 bytes)
 *   [0x04] headerLen           (uint32)
 *   [0x08] totalLen            (uint32)
 *   [0x0c] type                (uint16)
 *   [0x0e] unknown13           (int8)
 *   [0x0f] paddingLen          (int8)
 *   [0x10] unknown1            (uint32)
 *   [0x14] unknown2            (uint32)
 *   [0x18] stringLen           (uint32)
 *   [0x1c] encoding            (int8)  — 0/1 = UTF-8, 2 = UTF-16LE
 *   [0x1d] unknown5            (int8)
 *   [0x1e] unknown6            (int16)
 *   [0x20] unknown4            (uint32)
 *   [0x24] string bytes
 */
function tryParseMhodFilename(reader: BufferReader, boundary: number): string | undefined {
  const startOffset = reader.offset;

  if (reader.remaining < 12) return undefined;

  const tag = reader.readTag();
  if (tag !== 'mhod') {
    reader.seek(startOffset);
    return undefined;
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const mhodType = reader.readUInt16();

  const recordEnd = startOffset + totalLen;

  if (mhodType !== 3) {
    reader.seek(Math.min(recordEnd, boundary));
    return undefined;
  }

  // Skip to stringLen at offset 0x18
  if (headerLen < 0x24 || totalLen < 0x24) {
    reader.seek(Math.min(recordEnd, boundary));
    return undefined;
  }

  reader.seek(startOffset + 0x18);
  const stringLen = reader.readUInt32();
  const encoding = reader.readUInt8();

  // String starts at offset 0x24
  reader.seek(startOffset + 0x24);

  if (reader.offset + stringLen > boundary) {
    reader.seek(Math.min(recordEnd, boundary));
    return undefined;
  }

  let value: string;
  if (encoding === 2) {
    value = textDecoderUtf16le.decode(reader.readBytes(stringLen));
  } else {
    value = textDecoderUtf8.decode(reader.readBytes(stringLen));
  }

  reader.seek(Math.min(recordEnd, boundary));
  return value;
}

// ── mhla (album list) ──────────────────────────────────────────────

/**
 * Parse an mhla record and its mhba children.
 *
 * Layout:
 *   [0x00] tag "mhla"      (4 bytes)
 *   [0x04] headerLen        (uint32)
 *   [0x08] numChildren      (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] first mhba child
 */
function parseMhla(reader: BufferReader, sectionEnd: number, albums: ArtworkAlbum[]): void {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhla') {
    throw new ParseError('Expected mhla tag', {
      offset: startOffset,
      expected: 'mhla',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const numChildren = reader.readUInt32();

  reader.seek(startOffset + headerLen);

  for (let i = 0; i < numChildren && reader.offset < sectionEnd; i++) {
    albums.push(parseMhba(reader));
  }
}

// ── mhba (album) ───────────────────────────────────────────────────

/**
 * Parse an mhba record.
 *
 * Layout (from libgpod MhbaHeader):
 *   [0x00] tag "mhba"       (4 bytes)
 *   [0x04] headerLen         (uint32)
 *   [0x08] totalLen          (uint32)
 *   [0x0c] numMhods          (uint32)
 *   [0x10] numMhias          (uint32)
 *   [0x14] albumId           (uint32)
 *   ... more fields ...
 *   [headerLen] mhod children, then mhia children
 */
function parseMhba(reader: BufferReader): ArtworkAlbum {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhba') {
    throw new ParseError('Expected mhba tag', {
      offset: startOffset,
      expected: 'mhba',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const numMhods = reader.readUInt32();
  const numMhias = reader.readUInt32();
  const albumId = reader.readUInt32();

  const bodyEnd = startOffset + totalLen;
  reader.seek(startOffset + headerLen);

  // Parse mhod children (album name)
  let name: string | undefined;
  for (let i = 0; i < numMhods && reader.offset < bodyEnd; i++) {
    const parsed = tryParseMhodAlbumName(reader, bodyEnd);
    if (parsed !== undefined) {
      name = parsed;
    }
  }

  // Parse mhia children (image references)
  const imageIds: number[] = [];
  for (let i = 0; i < numMhias && reader.offset < bodyEnd; i++) {
    const imageId = parseMhia(reader);
    if (imageId !== null) {
      imageIds.push(imageId);
    }
  }

  reader.seek(bodyEnd);

  return { albumId, name, imageIds };
}

/**
 * Try to parse an mhod type 1 album name string.
 * Uses the same ArtworkDB string mhod layout as type 3.
 */
function tryParseMhodAlbumName(reader: BufferReader, boundary: number): string | undefined {
  const startOffset = reader.offset;

  if (reader.remaining < 12) return undefined;

  const tag = reader.readTag();
  if (tag !== 'mhod') {
    reader.seek(startOffset);
    return undefined;
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const mhodType = reader.readUInt16();

  const recordEnd = startOffset + totalLen;

  if (mhodType !== 1) {
    reader.seek(Math.min(recordEnd, boundary));
    return undefined;
  }

  if (headerLen < 0x24 || totalLen < 0x24) {
    reader.seek(Math.min(recordEnd, boundary));
    return undefined;
  }

  reader.seek(startOffset + 0x18);
  const stringLen = reader.readUInt32();
  const encoding = reader.readUInt8();

  reader.seek(startOffset + 0x24);

  if (reader.offset + stringLen > boundary) {
    reader.seek(Math.min(recordEnd, boundary));
    return undefined;
  }

  let value: string;
  if (encoding === 2) {
    value = textDecoderUtf16le.decode(reader.readBytes(stringLen));
  } else {
    value = textDecoderUtf8.decode(reader.readBytes(stringLen));
  }

  reader.seek(Math.min(recordEnd, boundary));
  return value;
}

// ── mhia (album item) ──────────────────────────────────────────────

/**
 * Parse an mhia record to extract the referenced image ID.
 *
 * Layout (from libgpod MhiaHeader):
 *   [0x00] tag "mhia"      (4 bytes)
 *   [0x04] headerLen        (uint32)
 *   [0x08] totalLen         (uint32)
 *   [0x0c] unknown1         (uint32)
 *   [0x10] imageId          (uint32)
 *   ... padding to headerLen/totalLen ...
 */
function parseMhia(reader: BufferReader): number | null {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhia') {
    reader.seek(startOffset);
    return null;
  }

  reader.readUInt32(); // headerLen
  const totalLen = reader.readUInt32();
  reader.readUInt32(); // unknown1
  const imageId = reader.readUInt32();

  reader.seek(startOffset + totalLen);
  return imageId;
}

// ── mhlf (file list) ───────────────────────────────────────────────

/**
 * Parse an mhlf record and its mhif children.
 *
 * Layout:
 *   [0x00] tag "mhlf"      (4 bytes)
 *   [0x04] headerLen        (uint32)
 *   [0x08] numChildren      (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] first mhif child
 */
function parseMhlf(reader: BufferReader, sectionEnd: number, files: ArtworkFile[]): void {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhlf') {
    throw new ParseError('Expected mhlf tag', {
      offset: startOffset,
      expected: 'mhlf',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const numChildren = reader.readUInt32();

  reader.seek(startOffset + headerLen);

  for (let i = 0; i < numChildren && reader.offset < sectionEnd; i++) {
    files.push(parseMhif(reader));
  }
}

// ── mhif (file info) ───────────────────────────────────────────────

/**
 * Parse an mhif record.
 *
 * Layout (from libgpod MhifHeader):
 *   [0x00] tag "mhif"      (4 bytes)
 *   [0x04] headerLen        (uint32)
 *   [0x08] totalLen         (uint32)
 *   [0x0c] unknown1         (uint32)
 *   [0x10] formatId         (uint32)
 *   [0x14] imageSize        (uint32)
 *   ... padding to headerLen/totalLen ...
 */
function parseMhif(reader: BufferReader): ArtworkFile {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhif') {
    throw new ParseError('Expected mhif tag', {
      offset: startOffset,
      expected: 'mhif',
      actual: tag,
    });
  }

  const _headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  reader.readUInt32(); // unknown1
  const formatId = reader.readUInt32();
  const imageSize = reader.readUInt32();

  reader.seek(startOffset + totalLen);

  return { formatId, imageSize };
}

// Re-export types for convenience
export type { ArtworkDatabase } from './types.js';
