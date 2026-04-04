export { BufferReader } from './binary/reader.js';
export { ParseError } from './binary/errors.js';

// iTunesDB parser
export { parseDatabase } from './itunesdb/parser.js';
export { MhodType } from './itunesdb/types.js';
export type {
  ITunesDatabase,
  MhbdRecord,
  MhsdRecord,
  MhsdTrackSection,
  MhsdPlaylistSection,
  MhsdAlbumSection,
  MhsdOpaqueSection,
  MhltRecord,
  MhitRecord,
  MhodRecord,
  MhodStringRecord,
  MhodOpaqueRecord,
  MhodPositionRecord,
  MhlpRecord,
  MhypRecord,
  MhipRecord,
  MhlaRecord,
  MhbaRecord,
  MhiaRecord,
} from './itunesdb/types.js';

// ArtworkDB parser
export { parseArtworkDatabase } from './artworkdb/parser.js';
export type {
  ArtworkDatabase,
  ArtworkImage,
  ArtworkThumbnail,
  ArtworkAlbum,
  ArtworkFile,
  DecodedImage,
} from './artworkdb/types.js';
export { extractThumbnail } from './artworkdb/ithmb.js';
export {
  decodeRGB565,
  decodeRGB555,
  decodeRGB888,
  getDecoder,
  getBytesPerPixel,
} from './artworkdb/pixel-formats.js';
export type { PixelDecoder } from './artworkdb/pixel-formats.js';

// Device identification
export type { SysInfoData } from './device/sysinfo.js';
export { parseSysInfo } from './device/sysinfo.js';
export type { IpodGeneration, IpodModel, IpodModelInfo } from './device/types.js';
export { getModelInfo, getDisplayName, supportsArtwork, supportsVideo } from './device/models.js';

// High-level reader facade
export { IpodReader } from './reader.js';
export type { Track, Playlist, Album, DeviceInfo } from './reader.js';
