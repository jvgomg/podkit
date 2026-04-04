import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhypRecord, MhipRecord, MhodRecord } from '../types.js';
import { parseMhod } from './mhod.js';
import { parseMhip } from './mhip.js';

/**
 * Parse an MHYP (playlist) record.
 *
 * Layout:
 *   [0]  tag "mhyp"       (4 bytes)
 *   [4]  headerLen         (uint32)
 *   [8]  totalLen          (uint32)
 *   [12] mhodCount         (uint32) — number of child MHOD records
 *   [16] itemCount         (uint32) — number of child MHIP records
 *   [20] hidden (byte 0=type, 1=flag1, 2=flag2, 3=flag3)  (uint32)
 *   [24] timestamp         (uint32)
 *   [28] playlistId        (uint64)
 *   [36] unknown           (uint32)
 *   [40] unknown           (uint16)
 *   [42] podcastFlag       (uint16)
 *   [44] sortOrder         (uint32)
 *   ... possible extra header bytes ...
 *   [headerLen] child MHODs followed by child MHIPs
 */
export function parseMhyp(reader: BufferReader): MhypRecord {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhyp') {
    throw new ParseError('Expected mhyp tag', {
      offset: startOffset,
      expected: 'mhyp',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const mhodCount = reader.readUInt32(); // +12
  const itemCount = reader.readUInt32(); // +16
  const hidden = reader.readUInt32(); // +20
  const timestamp = reader.readUInt32(); // +24
  const playlistId = reader.readUInt64(); // +28
  reader.readUInt32(); // +36 unknown
  reader.readUInt16(); // +40 unknown
  const podcastFlag = reader.readUInt16(); // +42
  const sortOrder = reader.readUInt32(); // +44

  // Preserve unknown header bytes beyond offset 48
  const consumed = reader.offset - startOffset;
  const unknownHeaderBytes =
    consumed < headerLen ? reader.readBytes(headerLen - consumed) : new Uint8Array(0);

  reader.seek(startOffset + headerLen);

  const bodyEnd = startOffset + totalLen;

  // Parse child MHODs
  const mhods: MhodRecord[] = [];
  for (let i = 0; i < mhodCount && reader.offset < bodyEnd; i++) {
    mhods.push(parseMhod(reader));
  }

  // Parse child MHIPs
  const items: MhipRecord[] = [];
  for (let i = 0; i < itemCount && reader.offset < bodyEnd; i++) {
    items.push(parseMhip(reader));
  }

  reader.seek(bodyEnd);

  return {
    mhodCount,
    itemCount,
    hidden,
    timestamp,
    playlistId,
    podcastFlag,
    sortOrder,
    items,
    mhods,
    unknownHeaderBytes,
  };
}
