import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDatabase } from './parser.js';
import { MhodType } from './types.js';
import type { MhitRecord, MhypRecord } from './types.js';

const FIXTURES_DIR = join(import.meta.dir, '../../fixtures/databases');

function loadFixture(name: string) {
  const dbPath = join(FIXTURES_DIR, name, 'iPod_Control/iTunes/iTunesDB');
  const expectedPath = join(FIXTURES_DIR, name, 'expected.json');
  const data = readFileSync(dbPath);
  const expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));
  return { data: new Uint8Array(data), expected };
}

/** Get the first MHOD string value with the given type from a record's MHODs. */
function getMhodString(mhods: MhitRecord['mhods'], mhodType: number): string | null {
  for (const mhod of mhods) {
    if (mhod.type === 'string' && mhod.mhodType === mhodType) {
      return mhod.value;
    }
  }
  return null;
}

/** Get playlist name from MHODs. */
function getPlaylistName(playlist: MhypRecord): string | null {
  return getMhodString(playlist.mhods, MhodType.Title);
}

/** Check whether a playlist has smart-playlist data. */
function isSmart(playlist: MhypRecord): boolean {
  return playlist.mhods.some(
    (m) => m.mhodType === MhodType.SmartPlaylistPref || m.mhodType === MhodType.SmartPlaylistRules
  );
}

// ── Fixture-based integration tests ─────────────────────────────────

describe('parseDatabase', () => {
  describe('empty fixture', () => {
    it('parses with correct track and playlist counts', () => {
      const { data, expected } = loadFixture('empty');
      const db = parseDatabase(data);

      expect(db.tracks).toHaveLength(expected.info.trackCount);
      expect(db.playlists).toHaveLength(expected.info.playlistCount);
    });

    it('has the master playlist with correct name', () => {
      const { data, expected } = loadFixture('empty');
      const db = parseDatabase(data);

      const masterPl = expected.playlists[0]!;
      expect(db.playlists).toHaveLength(1);
      expect(getPlaylistName(db.playlists[0]!)).toBe(masterPl.name);
      expect(db.playlists[0]!.playlistId.toString()).toBe(masterPl.id);
    });
  });

  describe('single-track fixture', () => {
    it('parses with correct track and playlist counts', () => {
      const { data, expected } = loadFixture('single-track');
      const db = parseDatabase(data);

      expect(db.tracks).toHaveLength(expected.info.trackCount);
      expect(db.playlists).toHaveLength(expected.info.playlistCount);
    });

    it('has correct track metadata', () => {
      const { data, expected } = loadFixture('single-track');
      const db = parseDatabase(data);

      const track = db.tracks[0]!;
      const exp = expected.tracks[0]!;

      expect(track.trackId).toBe(exp.id);
      expect(track.dbid.toString()).toBe(exp.dbid);
      expect(getMhodString(track.mhods, MhodType.Title)).toBe(exp.title);
      expect(getMhodString(track.mhods, MhodType.Artist)).toBe(exp.artist);
      expect(getMhodString(track.mhods, MhodType.Album)).toBe(exp.album);
      expect(getMhodString(track.mhods, MhodType.Genre)).toBe(exp.genre);
      expect(getMhodString(track.mhods, MhodType.AlbumArtist)).toBe(exp.albumArtist);
      expect(getMhodString(track.mhods, MhodType.Composer)).toBe(exp.composer);
      expect(getMhodString(track.mhods, MhodType.Comment)).toBe(exp.comment);
      expect(track.trackNumber).toBe(exp.trackNumber);
      expect(track.trackTotal).toBe(exp.totalTracks);
      expect(track.discNumber).toBe(exp.discNumber);
      expect(track.discTotal).toBe(exp.totalDiscs);
      expect(track.year).toBe(exp.year);
      expect(track.trackLength).toBe(exp.duration);
      expect(track.bitrate).toBe(exp.bitrate);
      expect(track.sampleRate).toBe(exp.sampleRate);
      expect(track.size).toBe(exp.size);
      expect(track.bpm).toBe(exp.bpm);
      expect(track.compilation).toBe(exp.compilation ? 1 : 0);
      expect(track.rating).toBe(exp.rating);
      expect(track.playCount).toBe(exp.playCount);
    });

    it('has correct mediaType for extended headers', () => {
      const { data, expected } = loadFixture('single-track');
      const db = parseDatabase(data);

      const track = db.tracks[0]!;
      const exp = expected.tracks[0]!;
      if (track.mediaType !== undefined) {
        expect(track.mediaType).toBe(exp.mediaType);
      }
    });

    it('has the master playlist', () => {
      const { data, expected } = loadFixture('single-track');
      const db = parseDatabase(data);

      const pl = db.playlists[0]!;
      const expPl = expected.playlists[0]!;
      expect(getPlaylistName(pl)).toBe(expPl.name);
      expect(pl.playlistId.toString()).toBe(expPl.id);
      expect(pl.items).toHaveLength(expPl.trackCount);
      expect(isSmart(pl)).toBe(expPl.isSmart);
    });
  });

  describe('playlists fixture', () => {
    it('parses with correct track and playlist counts', () => {
      const { data, expected } = loadFixture('playlists');
      const db = parseDatabase(data);

      expect(db.tracks).toHaveLength(expected.info.trackCount);
      expect(db.playlists).toHaveLength(expected.info.playlistCount);
    });

    it('has correct track metadata for all tracks', () => {
      const { data, expected } = loadFixture('playlists');
      const db = parseDatabase(data);

      for (let i = 0; i < expected.tracks.length; i++) {
        const track = db.tracks[i]!;
        const exp = expected.tracks[i]!;

        expect(track.trackId).toBe(exp.id);
        expect(track.dbid.toString()).toBe(exp.dbid);
        expect(getMhodString(track.mhods, MhodType.Title)).toBe(exp.title);
        expect(getMhodString(track.mhods, MhodType.Artist)).toBe(exp.artist);
        expect(getMhodString(track.mhods, MhodType.Album)).toBe(exp.album);
        expect(getMhodString(track.mhods, MhodType.Genre)).toBe(exp.genre);
        expect(track.trackNumber).toBe(exp.trackNumber);
        expect(track.trackTotal).toBe(exp.totalTracks);
        expect(track.trackLength).toBe(exp.duration);
        expect(track.bitrate).toBe(exp.bitrate);
      }
    });

    it('has correct playlist names and track counts', () => {
      const { data, expected } = loadFixture('playlists');
      const db = parseDatabase(data);

      // Match by playlist ID since binary order may differ from expected.json order
      for (const expPl of expected.playlists) {
        const pl = db.playlists.find((p) => p.playlistId.toString() === expPl.id);
        expect(pl).toBeDefined();
        expect(getPlaylistName(pl!)).toBe(expPl.name);
        expect(pl!.items).toHaveLength(expPl.trackCount);
        expect(isSmart(pl!)).toBe(expPl.isSmart);
      }
    });

    it('identifies master vs non-master playlists', () => {
      const { data, expected } = loadFixture('playlists');
      const db = parseDatabase(data);

      for (const expPl of expected.playlists) {
        const pl = db.playlists.find((p) => p.playlistId.toString() === expPl.id);
        expect(pl).toBeDefined();
        // Master playlist has type=1 in the hidden field (low byte)
        const isMaster = (pl!.hidden & 0xff) === 1;
        expect(isMaster).toBe(expPl.isMaster);
      }
    });
  });

  describe('unicode-strings fixture', () => {
    it('parses with correct track count', () => {
      const { data, expected } = loadFixture('unicode-strings');
      const db = parseDatabase(data);
      expect(db.tracks).toHaveLength(expected.info.trackCount);
    });

    it('correctly decodes CJK strings', () => {
      const { data, expected } = loadFixture('unicode-strings');
      const db = parseDatabase(data);

      // First track has Japanese, Chinese, Korean strings
      const track = db.tracks[0]!;
      const exp = expected.tracks[0]!;
      expect(getMhodString(track.mhods, MhodType.Title)).toBe(exp.title);
      expect(getMhodString(track.mhods, MhodType.Artist)).toBe(exp.artist);
      expect(getMhodString(track.mhods, MhodType.Album)).toBe(exp.album);
      expect(getMhodString(track.mhods, MhodType.Genre)).toBe(exp.genre);
    });

    it('correctly decodes Cyrillic strings', () => {
      const { data, expected } = loadFixture('unicode-strings');
      const db = parseDatabase(data);

      const track = db.tracks[1]!;
      const exp = expected.tracks[1]!;
      expect(getMhodString(track.mhods, MhodType.Title)).toBe(exp.title);
      expect(getMhodString(track.mhods, MhodType.Artist)).toBe(exp.artist);
    });

    it('correctly decodes diacritics and special characters', () => {
      const { data, expected } = loadFixture('unicode-strings');
      const db = parseDatabase(data);

      const track = db.tracks[2]!;
      const exp = expected.tracks[2]!;
      expect(getMhodString(track.mhods, MhodType.Title)).toBe(exp.title);
      expect(getMhodString(track.mhods, MhodType.Artist)).toBe(exp.artist);
    });

    it('correctly decodes typographic characters', () => {
      const { data, expected } = loadFixture('unicode-strings');
      const db = parseDatabase(data);

      const track = db.tracks[3]!;
      const exp = expected.tracks[3]!;
      expect(getMhodString(track.mhods, MhodType.Title)).toBe(exp.title);
      expect(getMhodString(track.mhods, MhodType.Artist)).toBe(exp.artist);
      expect(getMhodString(track.mhods, MhodType.Album)).toBe(exp.album);
      // This track has a composer
      expect(getMhodString(track.mhods, MhodType.Composer)).toBe(exp.composer);
    });

    it('correctly decodes mixed-script strings', () => {
      const { data, expected } = loadFixture('unicode-strings');
      const db = parseDatabase(data);

      const track = db.tracks[4]!;
      const exp = expected.tracks[4]!;
      expect(getMhodString(track.mhods, MhodType.Title)).toBe(exp.title);
      expect(getMhodString(track.mhods, MhodType.Artist)).toBe(exp.artist);
    });
  });

  describe('ipod-classic fixture', () => {
    it('parses with correct counts', () => {
      const { data, expected } = loadFixture('ipod-classic');
      const db = parseDatabase(data);

      expect(db.tracks).toHaveLength(expected.info.trackCount);
      expect(db.playlists).toHaveLength(expected.info.playlistCount);
    });

    it('has correct track metadata', () => {
      const { data, expected } = loadFixture('ipod-classic');
      const db = parseDatabase(data);

      const track = db.tracks[0]!;
      const exp = expected.tracks[0]!;
      expect(getMhodString(track.mhods, MhodType.Title)).toBe(exp.title);
      expect(getMhodString(track.mhods, MhodType.Artist)).toBe(exp.artist);
      expect(getMhodString(track.mhods, MhodType.Album)).toBe(exp.album);
      expect(track.year).toBe(exp.year);
    });
  });

  describe('ipod-nano-4 fixture', () => {
    it('parses with correct counts', () => {
      const { data, expected } = loadFixture('ipod-nano-4');
      const db = parseDatabase(data);

      expect(db.tracks).toHaveLength(expected.info.trackCount);
      expect(db.playlists).toHaveLength(expected.info.playlistCount);
    });

    it('has correct track metadata', () => {
      const { data, expected } = loadFixture('ipod-nano-4');
      const db = parseDatabase(data);

      const track = db.tracks[0]!;
      const exp = expected.tracks[0]!;
      expect(getMhodString(track.mhods, MhodType.Title)).toBe(exp.title);
      expect(getMhodString(track.mhods, MhodType.Artist)).toBe(exp.artist);
      expect(track.trackLength).toBe(exp.duration);
    });
  });

  describe('many-tracks fixture', () => {
    it('parses all 100 tracks', () => {
      const { data, expected } = loadFixture('many-tracks');
      const db = parseDatabase(data);

      expect(db.tracks).toHaveLength(expected.info.trackCount);
      expect(db.playlists).toHaveLength(expected.info.playlistCount);
    });

    it('has correct metadata for first and last tracks', () => {
      const { data, expected } = loadFixture('many-tracks');
      const db = parseDatabase(data);

      // First track
      const first = db.tracks[0]!;
      const expFirst = expected.tracks[0]!;
      expect(first.trackId).toBe(expFirst.id);
      expect(getMhodString(first.mhods, MhodType.Title)).toBe(expFirst.title);
      expect(getMhodString(first.mhods, MhodType.Artist)).toBe(expFirst.artist);
      expect(getMhodString(first.mhods, MhodType.Album)).toBe(expFirst.album);

      // Last track
      const last = db.tracks[db.tracks.length - 1]!;
      const expLast = expected.tracks[expected.tracks.length - 1]!;
      expect(last.trackId).toBe(expLast.id);
      expect(getMhodString(last.mhods, MhodType.Title)).toBe(expLast.title);

      // Verify albumArtist on first track
      expect(getMhodString(first.mhods, MhodType.AlbumArtist)).toBe(expFirst.albumArtist);
    });
  });
});

// ── All fixtures parse without throwing ─────────────────────────────

describe('all fixtures parse without error', () => {
  const fixtures = [
    'empty',
    'single-track',
    'playlists',
    'unicode-strings',
    'ipod-classic',
    'ipod-nano-4',
    'many-tracks',
  ];

  for (const name of fixtures) {
    it(`parses ${name}`, () => {
      const { data } = loadFixture(name);
      expect(() => parseDatabase(data)).not.toThrow();
    });
  }
});

// ── Unit tests for specific record behaviors ────────────────────────

describe('MHOD parsing', () => {
  it('preserves unknown MHOD types as opaque', () => {
    const { data } = loadFixture('single-track');
    const db = parseDatabase(data);

    // Check if any opaque MHODs exist (library index, jump table, etc.)
    const allMhods = [
      ...db.tracks.flatMap((t) => t.mhods),
      ...db.playlists.flatMap((p) => p.mhods),
      ...db.playlists.flatMap((p) => p.items.flatMap((i) => i.mhods)),
    ];

    // Every MHOD should have a valid type discriminator
    for (const mhod of allMhods) {
      expect(['string', 'opaque', 'position']).toContain(mhod.type);
    }
  });
});

describe('error handling', () => {
  it('throws ParseError for non-iTunesDB data', () => {
    const garbage = new Uint8Array(256);
    expect(() => parseDatabase(garbage)).toThrow();
  });

  it('throws ParseError for truncated data', () => {
    const { data } = loadFixture('single-track');
    // Truncate to just the header tag
    const truncated = data.slice(0, 16);
    expect(() => parseDatabase(truncated)).toThrow();
  });
});
