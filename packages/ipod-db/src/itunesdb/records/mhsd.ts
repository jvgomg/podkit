import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhsdRecord } from '../types.js';
import { parseMhlt } from './mhlt.js';
import { parseMhlp } from './mhlp.js';
import { parseMhla } from './mhla.js';

/**
 * Parse an MHSD (section data) record.
 *
 * Layout:
 *   [0]  tag "mhsd"       (4 bytes)
 *   [4]  headerLen         (uint32)
 *   [8]  totalLen          (uint32)
 *   [12] sectionType       (uint32)
 *   ... padding to headerLen ...
 *   [headerLen] child list (mhlt, mhlp, or mhla)
 *
 * Section types:
 *   1 = tracks    → child is mhlt
 *   2 = playlists → child is mhlp
 *   3 = podcasts  → child is mhlp (same structure as playlists)
 *   4 = albums    → child is mhla
 *   5 = smart playlists → child is mhlp
 *   6,8,9,10 etc → opaque (preserve bytes)
 */
export function parseMhsd(reader: BufferReader): MhsdRecord {
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
  const sectionType = reader.readUInt32();

  const sectionEnd = startOffset + totalLen;

  // Jump to child
  reader.seek(startOffset + headerLen);

  let result: MhsdRecord;

  switch (sectionType) {
    case 1: {
      const trackList = parseMhlt(reader, sectionEnd);
      result = { sectionType: 1, trackList };
      break;
    }
    case 2:
    case 3:
    case 5: {
      const playlistList = parseMhlp(reader, sectionEnd);
      result = { sectionType: sectionType as 2 | 3 | 5, playlistList };
      break;
    }
    case 4: {
      const albumList = parseMhla(reader, sectionEnd);
      result = { sectionType: 4, albumList };
      break;
    }
    default: {
      // Unknown section type — preserve body as opaque bytes
      const bodyLen = totalLen - headerLen;
      const data = bodyLen > 0 ? reader.readBytes(bodyLen) : new Uint8Array(0);
      result = { sectionType, data };
      break;
    }
  }

  reader.seek(sectionEnd);
  return result;
}
