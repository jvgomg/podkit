import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhltRecord } from '../types.js';
import { parseMhit } from './mhit.js';

/**
 * Parse an MHLT (track list) record.
 *
 * Layout:
 *   [0]  tag "mhlt"      (4 bytes)
 *   [4]  headerLen        (uint32)
 *   [8]  trackCount       (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] first MHIT child
 */
export function parseMhlt(reader: BufferReader, sectionEnd: number): MhltRecord {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhlt') {
    throw new ParseError('Expected mhlt tag', {
      offset: startOffset,
      expected: 'mhlt',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const trackCount = reader.readUInt32();

  // Skip any remaining header bytes
  reader.seek(startOffset + headerLen);

  const tracks = [];
  for (let i = 0; i < trackCount && reader.offset < sectionEnd; i++) {
    tracks.push(parseMhit(reader));
  }

  return { trackCount, tracks };
}
