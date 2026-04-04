import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhlaRecord } from '../types.js';
import { parseAlbumEntry } from './mhba.js';

/**
 * Parse an MHLA (album list) record.
 *
 * Layout:
 *   [0]  tag "mhla"       (4 bytes)
 *   [4]  headerLen         (uint32)
 *   [8]  albumCount        (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] album entry children (tagged "mhia" in iTunesDB, "mhba" in ArtworkDB)
 */
export function parseMhla(reader: BufferReader, sectionEnd: number): MhlaRecord {
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
  const albumCount = reader.readUInt32();

  reader.seek(startOffset + headerLen);

  const albums = [];
  for (let i = 0; i < albumCount && reader.offset < sectionEnd; i++) {
    albums.push(parseAlbumEntry(reader));
  }

  return { albumCount, albums };
}
