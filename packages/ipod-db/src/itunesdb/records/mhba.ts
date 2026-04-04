import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhbaRecord, MhodRecord } from '../types.js';
import { parseMhod } from './mhod.js';

/**
 * Parse an album entry record (tag "mhba" or "mhia" depending on context).
 *
 * In the iTunesDB, album list entries use the "mhia" tag. In the ArtworkDB,
 * they use "mhba". Both have similar structure:
 *
 *   [0]  tag "mhia" or "mhba" (4 bytes)
 *   [4]  headerLen              (uint32)
 *   [8]  totalLen               (uint32)
 *   [12] mhodCount              (uint32)
 *   [16] albumId                (uint32)
 *   ... remaining header ...
 *   [headerLen] child MHODs
 */
export function parseAlbumEntry(reader: BufferReader): MhbaRecord {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhba' && tag !== 'mhia') {
    throw new ParseError('Expected mhba or mhia tag', {
      offset: startOffset,
      expected: 'mhba or mhia',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const mhodCount = reader.readUInt32(); // +12
  const albumId = reader.readUInt32(); // +16

  // Read albumType if header is large enough (at offset +30 for mhba)
  // For mhia, there's no albumType field in the same position
  const albumType = 0;

  const consumed = reader.offset - startOffset;
  const unknownHeaderBytes =
    consumed < headerLen ? reader.readBytes(headerLen - consumed) : new Uint8Array(0);

  reader.seek(startOffset + headerLen);

  const bodyEnd = startOffset + totalLen;

  const mhods: MhodRecord[] = [];
  for (let i = 0; i < mhodCount && reader.offset < bodyEnd; i++) {
    mhods.push(parseMhod(reader));
  }

  reader.seek(bodyEnd);

  return {
    mhodCount,
    mhiaCount: 0,
    albumId,
    albumType,
    items: [],
    mhods,
    unknownHeaderBytes,
  };
}

// Keep backward-compatible name
export const parseMhba = parseAlbumEntry;
