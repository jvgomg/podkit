import { BufferReader } from '../binary/reader.js';
import { ParseError } from '../binary/errors.js';
import type {
  ITunesDatabase,
  MhbdRecord,
  MhitRecord,
  MhypRecord,
  MhbaRecord,
  MhsdTrackSection,
  MhsdPlaylistSection,
  MhsdAlbumSection,
} from './types.js';
import { parseMhbd } from './records/mhbd.js';

/**
 * Parse a complete iTunesDB binary file into a structured object.
 *
 * Auto-detects byte order by attempting to read the "mhbd" tag in
 * little-endian (default) and falling back to big-endian.
 */
export function parseDatabase(data: Uint8Array): ITunesDatabase {
  let reader = new BufferReader(data);

  // Auto-detect endianness
  const tag = reader.readTag();
  reader.seek(0);

  if (tag !== 'mhbd') {
    // Try big-endian
    const beReader = new BufferReader(data, true);
    const beTag = beReader.readTag();
    beReader.seek(0);

    if (beTag !== 'mhbd') {
      throw new ParseError('Not an iTunesDB: missing mhbd header', {
        offset: 0,
        expected: 'mhbd',
        actual: tag,
      });
    }
    reader = beReader;
  }

  const header = parseMhbd(reader);

  // Extract tracks, playlists, and albums from sections
  const tracks = extractTracks(header);
  const playlists = extractPlaylists(header);
  const albums = extractAlbums(header);

  return { header, tracks, playlists, albums };
}

function extractTracks(header: MhbdRecord): MhitRecord[] {
  for (const section of header.sections) {
    if (section.sectionType === 1) {
      return (section as MhsdTrackSection).trackList.tracks;
    }
  }
  return [];
}

function extractPlaylists(header: MhbdRecord): MhypRecord[] {
  // Prefer type 3 (podcast-aware) over type 2 (standard), matching libgpod behavior
  let primarySection: MhypRecord[] | undefined;
  const smartPlaylists: MhypRecord[] = [];

  for (const section of header.sections) {
    if (section.sectionType === 3) {
      primarySection = (section as MhsdPlaylistSection).playlistList.playlists;
    } else if (section.sectionType === 2 && !primarySection) {
      primarySection = (section as MhsdPlaylistSection).playlistList.playlists;
    } else if (section.sectionType === 5) {
      smartPlaylists.push(...(section as MhsdPlaylistSection).playlistList.playlists);
    }
  }

  const result = primarySection ?? [];
  if (smartPlaylists.length > 0) {
    result.push(...smartPlaylists);
  }
  return result;
}

function extractAlbums(header: MhbdRecord): MhbaRecord[] {
  for (const section of header.sections) {
    if (section.sectionType === 4) {
      return (section as MhsdAlbumSection).albumList.albums;
    }
  }
  return [];
}

// Re-export types for convenience
export type { ITunesDatabase } from './types.js';
