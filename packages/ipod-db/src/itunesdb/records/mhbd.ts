import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhbdRecord } from '../types.js';
import { parseMhsd } from './mhsd.js';

/**
 * Parse an MHBD (database header) record.
 *
 * Layout:
 *   [0x00] tag "mhbd"        (4 bytes)
 *   [0x04] headerLen          (uint32) — typically 0xf4 (244)
 *   [0x08] totalLen           (uint32)
 *   [0x0c] unknown1           (uint32)
 *   [0x10] version            (uint32)
 *   [0x14] childCount         (uint32) — number of MHSD sections
 *   [0x18] dbId               (uint64)
 *   [0x20] platform           (uint16)
 *   [0x22] unknown            (uint16)
 *   [0x24] id_0x24            (uint64)
 *   [0x2c] unknown            (uint32)
 *   [0x30] hashingScheme      (uint16)
 *   [0x32] unknown            (20 bytes)
 *   [0x46] language           (uint16)
 *   [0x48] persistentId       (uint64)
 *   [0x50] unknown            (uint32)
 *   [0x54] unknown            (uint32)
 *   [0x58] hash58             (20 bytes)
 *   [0x6c] timezoneOffset     (int32)
 *   ... more fields and hashes to headerLen ...
 *   [headerLen] first MHSD child
 */
export function parseMhbd(reader: BufferReader): MhbdRecord {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhbd') {
    throw new ParseError('Expected mhbd tag', {
      offset: startOffset,
      expected: 'mhbd',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32(); // +4
  const totalLen = reader.readUInt32(); // +8

  if (headerLen < 32) {
    throw new ParseError('mhbd header too small', {
      offset: startOffset,
      expected: '>= 32 bytes',
      actual: `${headerLen} bytes`,
    });
  }

  reader.readUInt32(); // +12 unknown1
  const version = reader.readUInt32(); // +16
  const childCount = reader.readUInt32(); // +20
  const dbId = reader.readUInt64(); // +24
  const platform = reader.readUInt16(); // +32

  // Read remaining known fields if header is large enough
  let language = 0;
  let persistentId = 0n;
  let timezoneOffset = 0;

  if (headerLen >= 0x50) {
    reader.seek(startOffset + 0x46);
    language = reader.readUInt16(); // +0x46
    persistentId = reader.readUInt64(); // +0x48
  }

  if (headerLen >= 0x70) {
    reader.seek(startOffset + 0x6c);
    timezoneOffset = reader.readInt32(); // +0x6c
  }

  // Preserve unknown header bytes
  // Read everything from current position to headerLen
  const consumed = reader.offset - startOffset;
  const unknownHeaderBytes =
    consumed < headerLen
      ? (() => {
          reader.seek(startOffset + consumed);
          return reader.readBytes(headerLen - consumed);
        })()
      : new Uint8Array(0);

  reader.seek(startOffset + headerLen);

  // Parse child MHSD sections
  const sections = [];
  for (let i = 0; i < childCount && reader.offset < startOffset + totalLen; i++) {
    sections.push(parseMhsd(reader));
  }

  return {
    headerLen,
    totalLen,
    version,
    childCount,
    dbId,
    platform,
    language,
    persistentId,
    timezoneOffset,
    sections,
    unknownHeaderBytes,
  };
}
