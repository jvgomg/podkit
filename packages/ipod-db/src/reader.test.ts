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
// artwork
// ---------------------------------------------------------------------------

describe('IpodReader — artwork', () => {
  test('getTrackArtwork returns null when no artworkDb provided', () => {
    const reader = loadFixture('single-track');
    expect(reader.getTrackArtwork(52)).toBeNull();
  });

  test('getTrackArtwork returns null when artworkDb provided but no ithmbs', () => {
    const base = join(FIXTURES_DIR, 'single-track');
    const itunesDb = patchArtworkCount(
      readFileSync(join(base, 'iPod_Control', 'iTunes', 'iTunesDB'))
    );
    const artworkDb = buildArtworkDbWithThumbnail(52, 1057, 2, 2, 0, 8);
    const reader = IpodReader.fromFiles({ itunesDb, artworkDb });
    expect(reader.getTrackArtwork(52)).toBeNull();
  });

  test('getTrackArtwork returns null when track has artworkCount=0', () => {
    const base = join(FIXTURES_DIR, 'single-track');
    // Unpatched iTunesDB — artworkCount is 0 as generated by libgpod
    const itunesDb = readFileSync(join(base, 'iPod_Control', 'iTunes', 'iTunesDB'));
    const artworkDb = buildArtworkDbWithThumbnail(52, 1057, 2, 2, 0, 8);
    const ithmbs = new Map([['F1057_1.ithmb', new Uint8Array(8)]]);
    const reader = IpodReader.fromFiles({ itunesDb, artworkDb, ithmbs });
    // Track's artworkCount is 0, so artworkId will be 0, no match
    expect(reader.getTrackArtwork(52)).toBeNull();
  });

  test('getTrackArtwork decodes artwork when all data is present', () => {
    const base = join(FIXTURES_DIR, 'single-track');
    const itunesDb = patchArtworkCount(
      readFileSync(join(base, 'iPod_Control', 'iTunes', 'iTunesDB'))
    );

    // Build a 2x2 RGB565 thumbnail: red, green, blue, white
    const pixelData = new Uint8Array([
      0x00,
      0xf8, // red
      0xe0,
      0x07, // green
      0x1f,
      0x00, // blue
      0xff,
      0xff, // white
    ]);

    const trackId = 52; // matches the single-track fixture's track ID
    const artworkDb = buildArtworkDbWithThumbnail(trackId, 1057, 2, 2, 0, pixelData.byteLength);
    const ithmbs = new Map([['F1057_1.ithmb', pixelData]]);

    const reader = IpodReader.fromFiles({ itunesDb, artworkDb, ithmbs });
    const result = reader.getTrackArtwork(trackId);

    expect(result).not.toBeNull();
    expect(result!.width).toBe(2);
    expect(result!.height).toBe(2);
    expect(result!.data.length).toBe(16); // 2*2*4 RGBA

    // First pixel is red (RGB565 0xF800 → R=255, G=0, B=0)
    expect(result!.data[0]).toBe(255);
    expect(result!.data[1]).toBe(0);
    expect(result!.data[2]).toBe(0);
    expect(result!.data[3]).toBe(255);

    // Last pixel is white
    expect(result!.data[12]).toBe(255);
    expect(result!.data[13]).toBe(255);
    expect(result!.data[14]).toBe(255);
    expect(result!.data[15]).toBe(255);
  });

  test('getTrackArtwork matches by sourceId (dbid) when imageId differs from trackId', () => {
    const base = join(FIXTURES_DIR, 'single-track');
    const itunesDb = patchArtworkCount(
      readFileSync(join(base, 'iPod_Control', 'iTunes', 'iTunesDB'))
    );

    // Read the fixture to get the track's dbid
    const tempReader = IpodReader.fromFiles({ itunesDb: new Uint8Array(itunesDb) });
    const track = tempReader.getTrack(52)!;
    expect(track).toBeDefined();

    const pixelData = new Uint8Array([0xff, 0xff]); // 1x1 white pixel (RGB565)
    // imageId=999 (doesn't match trackId=52), but sourceId matches track.dbid
    const artworkDb = buildArtworkDbWithThumbnail(999, 1057, 1, 1, 0, 2, undefined, track.dbid);
    const ithmbs = new Map([['F1057_1.ithmb', pixelData]]);

    const reader = IpodReader.fromFiles({ itunesDb, artworkDb, ithmbs });
    const result = reader.getTrackArtwork(52);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(1);
    expect(result!.height).toBe(1);
  });

  test('getTrackArtwork finds ithmb by filename from thumbnail', () => {
    const base = join(FIXTURES_DIR, 'single-track');
    const itunesDb = patchArtworkCount(
      readFileSync(join(base, 'iPod_Control', 'iTunes', 'iTunesDB'))
    );

    const pixelData = new Uint8Array([0xff, 0xff, 0xff, 0xff]); // 1x2 white pixels
    const trackId = 52;
    const artworkDb = buildArtworkDbWithThumbnail(
      trackId,
      1057,
      1,
      2,
      0,
      pixelData.byteLength,
      ':iPod_Control:Artwork:F1057_1.ithmb'
    );
    const ithmbs = new Map([['F1057_1.ithmb', pixelData]]);

    const reader = IpodReader.fromFiles({ itunesDb, artworkDb, ithmbs });
    const result = reader.getTrackArtwork(trackId);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(1);
    expect(result!.height).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// artwork test helpers
// ---------------------------------------------------------------------------

/**
 * Patch the artworkCount field on the first mhit record in an iTunesDB binary.
 * Sets artworkCount to 1 so the track gets a non-zero artworkId.
 */
function patchArtworkCount(itunesDb: Buffer): Uint8Array {
  const data = new Uint8Array(itunesDb);
  // Find the first 'mhit' tag in the binary
  for (let i = 0; i < data.byteLength - 4; i++) {
    if (data[i] === 0x6d && data[i + 1] === 0x68 && data[i + 2] === 0x69 && data[i + 3] === 0x74) {
      // artworkCount is at mhit + 124 (uint16 LE)
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      view.setUint16(i + 124, 1, true);
      return data;
    }
  }
  throw new Error('No mhit found in iTunesDB');
}

/**
 * Build a synthetic ArtworkDB binary with one image that has one thumbnail.
 * The image's imageId matches the given trackId.
 */
function buildArtworkDbWithThumbnail(
  imageId: number,
  formatId: number,
  width: number,
  height: number,
  offset: number,
  size: number,
  filename?: string,
  sourceId?: bigint
): Uint8Array {
  const parts: Uint8Array[] = [];

  // Build mhni record
  const mhniHeaderLen = 0x4c; // 76 bytes
  let mhniChildren: Uint8Array | undefined;
  let mhniNumChildren = 0;

  if (filename) {
    mhniChildren = buildStringMhod(3, filename);
    mhniNumChildren = 1;
  }

  const mhniTotalLen = mhniHeaderLen + (mhniChildren?.byteLength ?? 0);
  const mhni = new Uint8Array(mhniTotalLen);
  const mhniView = new DataView(mhni.buffer);
  writeTag(mhni, 0, 'mhni');
  mhniView.setUint32(4, mhniHeaderLen, true);
  mhniView.setUint32(8, mhniTotalLen, true);
  mhniView.setUint32(12, mhniNumChildren, true);
  mhniView.setUint32(0x10, formatId, true);
  mhniView.setUint32(0x14, offset, true); // ithmb offset
  mhniView.setUint32(0x18, size, true); // image size
  mhniView.setInt16(0x1c, 0, true); // verticalPadding
  mhniView.setInt16(0x1e, 0, true); // horizontalPadding
  mhniView.setInt16(0x20, height, true); // imageHeight
  mhniView.setInt16(0x22, width, true); // imageWidth
  if (mhniChildren) mhni.set(mhniChildren, mhniHeaderLen);

  // Build mhod type 2 (thumbnail container) wrapping the mhni
  const mhodHeaderLen = 0x18; // 24 bytes
  const mhodTotalLen = mhodHeaderLen + mhni.byteLength;
  const mhod = new Uint8Array(mhodTotalLen);
  const mhodView = new DataView(mhod.buffer);
  writeTag(mhod, 0, 'mhod');
  mhodView.setUint32(4, mhodHeaderLen, true);
  mhodView.setUint32(8, mhodTotalLen, true);
  mhodView.setUint16(12, 2, true); // type 2 = thumbnail container
  mhod.set(mhni, mhodHeaderLen);

  // Build mhii with the mhod child
  const mhiiHeaderLen = 0x34; // 52 bytes
  const mhiiTotalLen = mhiiHeaderLen + mhod.byteLength;
  const mhii = new Uint8Array(mhiiTotalLen);
  const mhiiView = new DataView(mhii.buffer);
  writeTag(mhii, 0, 'mhii');
  mhiiView.setUint32(4, mhiiHeaderLen, true);
  mhiiView.setUint32(8, mhiiTotalLen, true);
  mhiiView.setUint32(12, 1, true); // numChildren = 1 (the mhod)
  mhiiView.setUint32(16, imageId, true);
  if (sourceId !== undefined) {
    mhiiView.setBigUint64(20, sourceId, true);
  }
  mhii.set(mhod, mhiiHeaderLen);

  // Build sections: image list, empty album list, file list
  const mhliHeaderLen = 0x5c;
  const mhli = new Uint8Array(mhliHeaderLen + mhii.byteLength);
  const mhliView = new DataView(mhli.buffer);
  writeTag(mhli, 0, 'mhli');
  mhliView.setUint32(4, mhliHeaderLen, true);
  mhliView.setUint32(8, 1, true); // numChildren = 1
  mhli.set(mhii, mhliHeaderLen);

  const mhsd1HeaderLen = 0x60;
  const mhsd1 = new Uint8Array(mhsd1HeaderLen + mhli.byteLength);
  const mhsd1View = new DataView(mhsd1.buffer);
  writeTag(mhsd1, 0, 'mhsd');
  mhsd1View.setUint32(4, mhsd1HeaderLen, true);
  mhsd1View.setUint32(8, mhsd1.byteLength, true);
  mhsd1View.setUint16(12, 1, true); // type 1 = image list
  mhsd1.set(mhli, mhsd1HeaderLen);

  // Empty album list
  const mhlaHeaderLen = 0x5c;
  const mhla = new Uint8Array(mhlaHeaderLen);
  const mhlaView = new DataView(mhla.buffer);
  writeTag(mhla, 0, 'mhla');
  mhlaView.setUint32(4, mhlaHeaderLen, true);
  mhlaView.setUint32(8, 0, true);

  const mhsd2HeaderLen = 0x60;
  const mhsd2 = new Uint8Array(mhsd2HeaderLen + mhla.byteLength);
  const mhsd2View = new DataView(mhsd2.buffer);
  writeTag(mhsd2, 0, 'mhsd');
  mhsd2View.setUint32(4, mhsd2HeaderLen, true);
  mhsd2View.setUint32(8, mhsd2.byteLength, true);
  mhsd2View.setUint16(12, 2, true);
  mhsd2.set(mhla, mhsd2HeaderLen);

  // File list with one mhif
  const mhifHeaderLen = 0x7c;
  const mhif = new Uint8Array(mhifHeaderLen);
  const mhifView = new DataView(mhif.buffer);
  writeTag(mhif, 0, 'mhif');
  mhifView.setUint32(4, mhifHeaderLen, true);
  mhifView.setUint32(8, mhifHeaderLen, true);
  mhifView.setUint32(16, formatId, true);
  mhifView.setUint32(20, size, true);

  const mhlfHeaderLen = 0x5c;
  const mhlf = new Uint8Array(mhlfHeaderLen + mhif.byteLength);
  const mhlfView = new DataView(mhlf.buffer);
  writeTag(mhlf, 0, 'mhlf');
  mhlfView.setUint32(4, mhlfHeaderLen, true);
  mhlfView.setUint32(8, 1, true);
  mhlf.set(mhif, mhlfHeaderLen);

  const mhsd3HeaderLen = 0x60;
  const mhsd3 = new Uint8Array(mhsd3HeaderLen + mhlf.byteLength);
  const mhsd3View = new DataView(mhsd3.buffer);
  writeTag(mhsd3, 0, 'mhsd');
  mhsd3View.setUint32(4, mhsd3HeaderLen, true);
  mhsd3View.setUint32(8, mhsd3.byteLength, true);
  mhsd3View.setUint16(12, 3, true);
  mhsd3.set(mhlf, mhsd3HeaderLen);

  // mhfd header
  const mhfdHeaderLen = 0x84;
  const mhfdTotalLen = mhfdHeaderLen + mhsd1.byteLength + mhsd2.byteLength + mhsd3.byteLength;
  const mhfd = new Uint8Array(mhfdHeaderLen);
  const mhfdView = new DataView(mhfd.buffer);
  writeTag(mhfd, 0, 'mhfd');
  mhfdView.setUint32(4, mhfdHeaderLen, true);
  mhfdView.setUint32(8, mhfdTotalLen, true);
  mhfdView.setUint32(0x10, 2, true);
  mhfdView.setUint32(0x14, 3, true);

  parts.push(mhfd, mhsd1, mhsd2, mhsd3);

  const totalLen = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const part of parts) {
    result.set(part, off);
    off += part.byteLength;
  }
  return result;
}

/** Build a string mhod (type 3) for ArtworkDB filenames. */
function buildStringMhod(type: number, value: string): Uint8Array {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);
  const headerLen = 0x24;
  const totalLen = headerLen + encoded.byteLength;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhod');
  view.setUint32(4, headerLen, true);
  view.setUint32(8, totalLen, true);
  view.setUint16(12, type, true);
  view.setUint32(0x18, encoded.byteLength, true); // stringLen
  view.setInt8(0x1c, 1); // encoding = UTF-8
  buf.set(encoded, headerLen);
  return buf;
}

function writeTag(buf: Uint8Array, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = tag.charCodeAt(i);
  }
}

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
