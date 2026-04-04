import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhiaRecord } from '../types.js';

/**
 * Parse an MHIA (album item) record.
 *
 * Layout:
 *   [0]  tag "mhia"       (4 bytes)
 *   [4]  headerLen         (uint32)
 *   [8]  totalLen          (uint32) — usually == headerLen
 *   [12] unknown1          (uint32)
 *   [16] imageId           (uint32)
 */
export function parseMhia(reader: BufferReader): MhiaRecord {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhia') {
    throw new ParseError('Expected mhia tag', {
      offset: startOffset,
      expected: 'mhia',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  reader.readUInt32(); // unknown1
  const imageId = reader.readUInt32();

  const consumed = reader.offset - startOffset;
  const unknownHeaderBytes =
    consumed < headerLen ? reader.readBytes(headerLen - consumed) : new Uint8Array(0);

  reader.seek(startOffset + totalLen);

  return { imageId, unknownHeaderBytes };
}
