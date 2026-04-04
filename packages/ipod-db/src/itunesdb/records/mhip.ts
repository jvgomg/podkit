import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhipRecord, MhodRecord } from '../types.js';
import { parseMhod } from './mhod.js';

/**
 * Parse an MHIP (playlist item) record.
 *
 * Layout:
 *   [0]  tag "mhip"             (4 bytes)
 *   [4]  headerLen              (uint32)
 *   [8]  totalLen               (uint32)
 *   [12] dataObjectCount        (uint32)  — number of child MHODs
 *   [16] podcastGroupingFlag    (uint32)
 *   [20] groupId                (uint32)
 *   [24] trackId                (uint32)
 *   [28] timestamp              (uint32)
 *   ... possible extra header bytes ...
 *   [headerLen] child MHODs
 */
export function parseMhip(reader: BufferReader): MhipRecord {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhip') {
    throw new ParseError('Expected mhip tag', {
      offset: startOffset,
      expected: 'mhip',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const dataObjectCount = reader.readUInt32(); // +12
  const podcastGroupingFlag = reader.readUInt32(); // +16
  const groupId = reader.readUInt32(); // +20
  const trackId = reader.readUInt32(); // +24
  const timestamp = reader.readUInt32(); // +28

  // Preserve unknown header bytes
  const consumed = reader.offset - startOffset;
  const unknownHeaderBytes =
    consumed < headerLen ? reader.readBytes(headerLen - consumed) : new Uint8Array(0);

  reader.seek(startOffset + headerLen);

  // Parse child MHODs
  const bodyEnd = startOffset + totalLen;
  const mhods: MhodRecord[] = [];
  for (let i = 0; i < dataObjectCount && reader.offset < bodyEnd; i++) {
    mhods.push(parseMhod(reader));
  }

  // Handle the old iTunesDB bug where totalLen == headerLen but MHODs exist
  if (totalLen === headerLen && dataObjectCount > 0) {
    reader.seek(mhods.length > 0 ? reader.offset : startOffset + totalLen);
  } else {
    reader.seek(bodyEnd);
  }

  return {
    dataObjectCount,
    podcastGroupingFlag,
    groupId,
    trackId,
    timestamp,
    mhods,
    unknownHeaderBytes,
  };
}
