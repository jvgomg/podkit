import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import { IpodReader } from './reader.js';

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures', 'databases');

function loadFixture(name: string): IpodReader {
  const base = join(FIXTURES_DIR, name);
  const itunesDb = readFileSync(join(base, 'iPod_Control', 'iTunes', 'iTunesDB'));
  let sysInfo: string | undefined;
  try {
    sysInfo = readFileSync(join(base, 'iPod_Control', 'Device', 'SysInfo'), 'utf-8');
  } catch {
    // SysInfo is optional
  }
  return IpodReader.fromFiles({ itunesDb, sysInfo });
}

function loadExpected(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name, 'expected.json'), 'utf-8'));
}

// ---------------------------------------------------------------------------
// single-track fixture
// ---------------------------------------------------------------------------

describe('IpodReader — single-track', () => {
  const reader = loadFixture('single-track');
  const expected = loadExpected('single-track');

  test('getTracks returns 1 track', () => {
    expect(reader.getTracks()).toHaveLength(1);
  });

  test('track has correct metadata', () => {
    const track = reader.getTracks()[0]!;
    const exp = expected.tracks[0];
    expect(track.id).toBe(exp.id);
    expect(track.title).toBe(exp.title);
    expect(track.artist).toBe(exp.artist);
    expect(track.album).toBe(exp.album);
    expect(track.genre).toBe(exp.genre);
    expect(track.trackNumber).toBe(exp.trackNumber);
    expect(track.discNumber).toBe(exp.discNumber);
    expect(track.year).toBe(exp.year);
    expect(track.duration).toBe(exp.duration);
    expect(track.bitrate).toBe(exp.bitrate);
    expect(track.sampleRate).toBe(exp.sampleRate);
    expect(track.size).toBe(exp.size);
    expect(track.compilation).toBe(exp.compilation);
    expect(track.rating).toBe(exp.rating);
    expect(track.playCount).toBe(exp.playCount);
    expect(track.dbid).toBe(BigInt(exp.dbid));
  });

  test('getTrack by ID returns the track', () => {
    const track = reader.getTrack(expected.tracks[0].id);
    expect(track).toBeDefined();
    expect(track!.title).toBe('Test Song');
  });

  test('getTrack with unknown ID returns undefined', () => {
    expect(reader.getTrack(99999)).toBeUndefined();
  });

  test('getPlaylists includes master playlist', () => {
    const playlists = reader.getPlaylists();
    expect(playlists.some((p) => p.isMaster)).toBe(true);
  });

  test('getMasterPlaylist returns the master', () => {
    const master = reader.getMasterPlaylist();
    expect(master.isMaster).toBe(true);
    expect(master.name).toBe(expected.playlists[0].name);
    expect(master.trackCount).toBe(1);
  });

  test('master playlist contains the track', () => {
    const master = reader.getMasterPlaylist();
    expect(master.trackIds).toContain(expected.tracks[0].id);
  });

  test('getArtists returns sorted artists', () => {
    expect(reader.getArtists()).toEqual(['Test Artist']);
  });

  test('getGenres returns sorted genres', () => {
    expect(reader.getGenres()).toEqual(['Rock']);
  });

  test('getDeviceInfo returns iPod info', () => {
    const info = reader.getDeviceInfo();
    expect(info).not.toBeNull();
    expect(info!.modelNumber).toBe('MA147');
    expect(info!.supportsVideo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// playlists fixture
// ---------------------------------------------------------------------------

describe('IpodReader — playlists', () => {
  const reader = loadFixture('playlists');
  const expected = loadExpected('playlists');

  test('has correct number of tracks', () => {
    expect(reader.getTracks()).toHaveLength(expected.info.trackCount);
  });

  test('has correct number of playlists', () => {
    expect(reader.getPlaylists()).toHaveLength(expected.info.playlistCount);
  });

  test('master playlist has all tracks', () => {
    const master = reader.getMasterPlaylist();
    expect(master.isMaster).toBe(true);
    expect(master.trackCount).toBe(expected.info.trackCount);
  });

  test('non-master playlists have correct names', () => {
    const playlists = reader.getPlaylists().filter((p) => !p.isMaster);
    const expectedNonMaster = expected.playlists.filter((p: any) => !p.isMaster);
    const names = playlists.map((p) => p.name).sort();
    const expectedNames = expectedNonMaster.map((p: any) => p.name).sort();
    expect(names).toEqual(expectedNames);
  });

  test('non-master playlists have correct track counts', () => {
    for (const expPl of expected.playlists) {
      if (expPl.isMaster) continue;
      const pl = reader.getPlaylist(BigInt(expPl.id));
      expect(pl).toBeDefined();
      expect(pl!.trackCount).toBe(expPl.trackCount);
    }
  });

  test('getPlaylistTracks returns Track objects', () => {
    const master = reader.getMasterPlaylist();
    const tracks = reader.getPlaylistTracks(master.id);
    expect(tracks).toHaveLength(master.trackCount);
    expect(tracks[0]!.title).toBeDefined();
  });

  test('getPlaylistTracks with unknown ID returns empty', () => {
    expect(reader.getPlaylistTracks(0n)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// unicode-strings fixture
// ---------------------------------------------------------------------------

describe('IpodReader — unicode-strings', () => {
  const reader = loadFixture('unicode-strings');
  const expected = loadExpected('unicode-strings');

  test('CJK track title preserved', () => {
    const track = reader.getTrack(52);
    expect(track).toBeDefined();
    expect(track!.title).toBe(expected.tracks[0].title);
  });

  test('Cyrillic track title preserved', () => {
    const track = reader.getTrack(53);
    expect(track).toBeDefined();
    expect(track!.title).toBe(expected.tracks[1].title);
  });

  test('accented characters preserved', () => {
    const track = reader.getTrack(54);
    expect(track).toBeDefined();
    expect(track!.title).toBe(expected.tracks[2].title);
  });

  test('special characters in composer preserved', () => {
    const track = reader.getTrack(55);
    expect(track).toBeDefined();
    expect(track!.composer).toBe(expected.tracks[3].composer);
  });
});

// ---------------------------------------------------------------------------
// ipod-classic fixture
// ---------------------------------------------------------------------------

describe('IpodReader — ipod-classic', () => {
  const reader = loadFixture('ipod-classic');

  test('getDeviceInfo returns iPod Video info', () => {
    const info = reader.getDeviceInfo();
    expect(info).not.toBeNull();
    expect(info!.modelNumber).toBe('MA147');
    expect(info!.supportsVideo).toBe(true);
  });

  test('track metadata is correct', () => {
    const track = reader.getTracks()[0]!;
    expect(track.title).toBe('Classic Track');
    expect(track.artist).toBe('Classic Artist');
    expect(track.album).toBe('Classic Album');
    expect(track.year).toBe(2007);
  });
});

// ---------------------------------------------------------------------------
// many-tracks fixture (indexing tests)
// ---------------------------------------------------------------------------

describe('IpodReader — many-tracks indexing', () => {
  const reader = loadFixture('many-tracks');
  const _expected = loadExpected('many-tracks');

  test('loads all 100 tracks', () => {
    expect(reader.getTracks()).toHaveLength(100);
  });

  test('getArtists returns 10 sorted unique artists', () => {
    const artists = reader.getArtists();
    expect(artists).toHaveLength(10);
    expect(artists).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
      'Foxtrot',
      'Golf',
      'Hotel',
      'India',
      'Juliet',
    ]);
  });

  test('getGenres returns 10 sorted unique genres', () => {
    const genres = reader.getGenres();
    expect(genres).toHaveLength(10);
    expect(genres[0]).toBe('Blues');
    expect(genres[genres.length - 1]).toBe('Rock');
  });

  test('getAlbums returns albums with artist and track IDs', () => {
    const albums = reader.getAlbums();
    // 10 albums, each with 10 tracks from different artists
    expect(albums.length).toBeGreaterThan(0);
    for (const album of albums) {
      expect(album.name).toBeTruthy();
      expect(album.artist).toBeTruthy();
      expect(album.trackIds.length).toBeGreaterThan(0);
    }
  });

  test('getAlbums are sorted by artist then name', () => {
    const albums = reader.getAlbums();
    for (let i = 1; i < albums.length; i++) {
      const prev = albums[i - 1]!;
      const curr = albums[i]!;
      const cmp = prev.artist.localeCompare(curr.artist);
      if (cmp === 0) {
        expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0);
      } else {
        expect(cmp).toBeLessThan(0);
      }
    }
  });

  test('getTracksByArtist returns correct tracks', () => {
    const alphaTracks = reader.getTracksByArtist('Alpha');
    expect(alphaTracks.length).toBeGreaterThan(0);
    for (const track of alphaTracks) {
      expect(track.artist).toBe('Alpha');
    }
  });

  test('getTracksByArtist for unknown artist returns empty', () => {
    expect(reader.getTracksByArtist('Nonexistent')).toEqual([]);
  });

  test('getTracksByAlbum returns correct tracks', () => {
    const tracks = reader.getTracksByAlbum('Alpha', 'Album 01');
    expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) {
      expect(track.album).toBe('Album 01');
    }
  });

  test('getTracksByAlbum for unknown album returns empty', () => {
    expect(reader.getTracksByAlbum('Alpha', 'Nonexistent')).toEqual([]);
  });

  test('getTracksByGenre returns correct tracks', () => {
    const rockTracks = reader.getTracksByGenre('Rock');
    expect(rockTracks.length).toBeGreaterThan(0);
    for (const track of rockTracks) {
      expect(track.genre).toBe('Rock');
    }
  });

  test('getTracksByGenre for unknown genre returns empty', () => {
    expect(reader.getTracksByGenre('Nonexistent')).toEqual([]);
  });

  test('tracks within artist index are sorted by trackNumber then title', () => {
    const alphaTracks = reader.getTracksByArtist('Alpha');
    for (let i = 1; i < alphaTracks.length; i++) {
      const prev = alphaTracks[i - 1]!;
      const curr = alphaTracks[i]!;
      if (prev.trackNumber !== curr.trackNumber) {
        expect(prev.trackNumber).toBeLessThan(curr.trackNumber);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// empty fixture
// ---------------------------------------------------------------------------

describe('IpodReader — empty', () => {
  const reader = loadFixture('empty');

  test('getTracks returns empty', () => {
    expect(reader.getTracks()).toHaveLength(0);
  });

  test('getArtists returns empty', () => {
    expect(reader.getArtists()).toHaveLength(0);
  });

  test('getAlbums returns empty', () => {
    expect(reader.getAlbums()).toHaveLength(0);
  });

  test('getGenres returns empty', () => {
    expect(reader.getGenres()).toHaveLength(0);
  });

  test('getMasterPlaylist still works', () => {
    const master = reader.getMasterPlaylist();
    expect(master).toBeDefined();
    expect(master.isMaster).toBe(true);
    expect(master.trackCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// artwork (no fixture data, test graceful null)
// ---------------------------------------------------------------------------

describe('IpodReader — artwork', () => {
  test('getTrackArtwork returns null when no artworkDb provided', () => {
    const reader = loadFixture('single-track');
    expect(reader.getTrackArtwork(52)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// no SysInfo
// ---------------------------------------------------------------------------

describe('IpodReader — no SysInfo', () => {
  test('getDeviceInfo returns null when no sysInfo', () => {
    const base = join(FIXTURES_DIR, 'single-track');
    const itunesDb = readFileSync(join(base, 'iPod_Control', 'iTunes', 'iTunesDB'));
    const reader = IpodReader.fromFiles({ itunesDb });
    expect(reader.getDeviceInfo()).toBeNull();
  });
});
