import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhodRecord } from '../types.js';
import { MhodType } from '../types.js';

const textDecoderUtf8 = new TextDecoder('utf-8');

/**
 * Set of MHOD types that carry UTF-16 (or UTF-8) encoded strings using
 * the standard string sub-header (position, stringLen, encoding, pad,
 * then string bytes starting 16 bytes into the body).
 */
const STRING_MHOD_TYPES = new Set<number>([
  MhodType.Title,
  MhodType.Path,
  MhodType.Album,
  MhodType.Artist,
  MhodType.Genre,
  MhodType.Filetype,
  MhodType.EqSetting,
  MhodType.Comment,
  MhodType.Category,
  MhodType.Composer,
  MhodType.Grouping,
  MhodType.Description,
  MhodType.Subtitle,
  MhodType.TvShow,
  MhodType.TvEpisode,
  MhodType.TvNetwork,
  MhodType.AlbumArtist,
  MhodType.SortArtist,
  MhodType.Keywords,
  MhodType.SortTitle,
  MhodType.SortAlbum,
  MhodType.SortAlbumArtist,
  MhodType.SortComposer,
  MhodType.SortTvShow,
  MhodType.AlbumAlbum,
  MhodType.AlbumArtistName,
  MhodType.AlbumSortArtist,
  MhodType.AlbumArtistMhii,
]);

/**
 * MHOD types for podcast URLs — these are raw UTF-8 strings with no
 * sub-header. The string length is totalLen - headerLen.
 */
const PODCAST_URL_TYPES = new Set<number>([MhodType.PodcastUrl, MhodType.PodcastRss]);

/**
 * Parse an MHOD (object data) record.
 *
 * Layout:
 *   [0]  tag "mhod"            (4 bytes)
 *   [4]  headerLen              (uint32) — typically 24
 *   [8]  totalLen               (uint32)
 *   [12] mhodType               (uint32)
 *   [16] unknown1               (uint32)
 *   [20] unknown2               (uint32)
 *   ... possible extra header bytes ...
 *   [headerLen] body starts
 *
 * For string types the body is:
 *   [0]  encoding               (uint32) — 0/1 = UTF-16LE, 2 = UTF-8
 *   [4]  stringLen              (uint32)
 *   [8]  unknown3               (uint32)
 *   [12] unknown4               (uint32)
 *   [16] string bytes           (stringLen bytes)
 *
 * For podcast URL types the body is raw UTF-8 bytes (totalLen - headerLen).
 *
 * For type 100 (playlist order), the position uint32 is at offset 24.
 */
export function parseMhod(reader: BufferReader): MhodRecord {
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
  const mhodType = reader.readUInt32();

  // Seek past the rest of the mhod to its end before returning
  const recordEnd = startOffset + totalLen;

  if (STRING_MHOD_TYPES.has(mhodType)) {
    // Jump to body start
    reader.seek(startOffset + headerLen);

    const bodyLen = totalLen - headerLen;
    if (bodyLen < 16) {
      // Degenerate string MHOD — treat as opaque
      const data = bodyLen > 0 ? reader.readBytes(bodyLen) : new Uint8Array(0);
      reader.seek(recordEnd);
      return { type: 'opaque', mhodType, data };
    }

    const encoding = reader.readUInt32();
    const stringLen = reader.readUInt32();
    reader.skip(8); // unknown3, unknown4

    let value: string;
    if (encoding === 2) {
      // UTF-8
      const bytes = reader.readBytes(stringLen);
      value = textDecoderUtf8.decode(bytes);
    } else {
      // UTF-16LE (encoding 0 or 1)
      value = reader.readUtf16(stringLen);
    }

    reader.seek(recordEnd);
    return { type: 'string', mhodType, value };
  }

  if (PODCAST_URL_TYPES.has(mhodType)) {
    reader.seek(startOffset + headerLen);
    const bodyLen = totalLen - headerLen;
    const bytes = reader.readBytes(bodyLen);
    const value = textDecoderUtf8.decode(bytes);

    reader.seek(recordEnd);
    return { type: 'string', mhodType, value };
  }

  if (mhodType === MhodType.PlaylistOrder) {
    // Position value is at absolute offset 24 in the record
    reader.seek(startOffset + 24);
    const position = reader.readUInt32();
    reader.seek(recordEnd);
    return { type: 'position', mhodType: 100, position };
  }

  // Unknown/opaque type — preserve the body bytes
  reader.seek(startOffset + headerLen);
  const bodyLen = totalLen - headerLen;
  const data = bodyLen > 0 ? reader.readBytes(bodyLen) : new Uint8Array(0);
  reader.seek(recordEnd);
  return { type: 'opaque', mhodType, data };
}
