import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhlpRecord } from '../types.js';
import { parseMhyp } from './mhyp.js';

/**
 * Parse an MHLP (playlist list) record.
 *
 * Layout:
 *   [0]  tag "mhlp"         (4 bytes)
 *   [4]  headerLen           (uint32)
 *   [8]  playlistCount       (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] first MHYP child
 */
export function parseMhlp(reader: BufferReader, sectionEnd: number): MhlpRecord {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhlp') {
    throw new ParseError('Expected mhlp tag', {
      offset: startOffset,
      expected: 'mhlp',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const playlistCount = reader.readUInt32();

  reader.seek(startOffset + headerLen);

  const playlists = [];
  for (let i = 0; i < playlistCount && reader.offset < sectionEnd; i++) {
    playlists.push(parseMhyp(reader));
  }

  return { playlistCount, playlists };
}
