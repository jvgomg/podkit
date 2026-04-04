/**
 * Generate golden test fixtures for ipod-db using libgpod-node.
 *
 * Creates iTunesDB binary fixtures that serve as ground truth for validating
 * the pure TypeScript parser. Run once with:
 *
 *   bun run packages/ipod-db/fixtures/generate.ts
 *
 * Output goes to packages/ipod-db/fixtures/databases/
 */

import { rm, cp, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from '@podkit/libgpod-node';
import type { Track, Playlist, TrackHandle } from '@podkit/libgpod-node';
import { createTestIpod } from '@podkit/gpod-testing';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'databases');

// ============================================================================
// Types
// ============================================================================

interface FixtureMetadata {
  category: string;
  model: string;
  trackCount: number;
  playlistCount: number;
  createdAt: string;
}

interface ExpectedTrack {
  id: number | undefined;
  dbid: string; // bigint serialized as string
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  genre: string | null;
  composer: string | null;
  comment: string | null;
  trackNumber: number;
  totalTracks: number;
  discNumber: number;
  totalDiscs: number;
  year: number;
  duration: number;
  bitrate: number;
  sampleRate: number;
  size: number;
  bpm: number;
  mediaType: number;
  compilation: boolean;
  rating: number;
  playCount: number;
}

interface ExpectedPlaylist {
  id: string; // bigint serialized as string
  name: string | null;
  trackCount: number;
  isMaster: boolean;
  isSmart: boolean;
}

interface ExpectedJson {
  tracks: ExpectedTrack[];
  playlists: ExpectedPlaylist[];
  info: {
    trackCount: number;
    playlistCount: number;
  };
}

// ============================================================================
// Helpers
// ============================================================================

function trackToExpected(track: Track): ExpectedTrack {
  return {
    id: track.id,
    dbid: track.dbid.toString(),
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    genre: track.genre,
    composer: track.composer,
    comment: track.comment,
    trackNumber: track.trackNumber,
    totalTracks: track.totalTracks,
    discNumber: track.discNumber,
    totalDiscs: track.totalDiscs,
    year: track.year,
    duration: track.duration,
    bitrate: track.bitrate,
    sampleRate: track.sampleRate,
    size: track.size,
    bpm: track.bpm,
    mediaType: track.mediaType,
    compilation: track.compilation,
    rating: track.rating,
    playCount: track.playCount,
  };
}

function playlistToExpected(playlist: Playlist): ExpectedPlaylist {
  return {
    id: playlist.id.toString(),
    name: playlist.name,
    trackCount: playlist.trackCount,
    isMaster: playlist.isMaster,
    isSmart: playlist.isSmart,
  };
}

/**
 * Read back a database and produce the expected.json content.
 */
function readExpected(db: Database): ExpectedJson {
  const handles = db.getTracks();
  const tracks = handles
    .map((h) => trackToExpected(db.getTrack(h)))
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  const playlists = db
    .getPlaylists()
    .map(playlistToExpected)
    .sort((a, b) => {
      // Master playlist first, then by name
      if (a.isMaster !== b.isMaster) return a.isMaster ? -1 : 1;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });

  const info = db.getInfo();

  return {
    tracks,
    playlists,
    info: {
      trackCount: info.trackCount,
      playlistCount: info.playlistCount,
    },
  };
}

/**
 * Copy iPod_Control directory from a temp iPod to the fixture output.
 */
async function copyFixture(
  sourcePath: string,
  category: string,
  model: string,
  expected: ExpectedJson
): Promise<void> {
  const destDir = join(OUTPUT_DIR, category);
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  // Copy iPod_Control
  await cp(join(sourcePath, 'iPod_Control'), join(destDir, 'iPod_Control'), {
    recursive: true,
  });

  // Write expected.json
  await Bun.write(join(destDir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');

  // Write metadata.json
  const metadata: FixtureMetadata = {
    category,
    model,
    trackCount: expected.info.trackCount,
    playlistCount: expected.info.playlistCount,
    createdAt: new Date().toISOString(),
  };
  await Bun.write(join(destDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');

  // Verify iTunesDB starts with "mhbd" magic bytes
  const itunesDbPath = join(destDir, 'iPod_Control', 'iTunes', 'iTunesDB');
  const header = await readFile(itunesDbPath);
  const magic = header.subarray(0, 4).toString('ascii');
  if (magic !== 'mhbd') {
    throw new Error(`Invalid iTunesDB magic bytes: expected "mhbd", got "${magic}"`);
  }

  console.log(
    `  -> ${category}: ${expected.info.trackCount} tracks, ${expected.info.playlistCount} playlists, iTunesDB ${header.length} bytes`
  );
}

// ============================================================================
// Fixture generators
// ============================================================================

async function generateEmpty(): Promise<void> {
  const model = 'MA147';
  const ipod = await createTestIpod({ model, name: 'Empty iPod' });
  try {
    // Open the freshly initialized database -- it should have only a master playlist
    const db = Database.openSync(ipod.path);
    // Save to ensure the binary is written
    db.saveSync();

    // Read back for expected.json
    const db2 = Database.openSync(ipod.path);
    const expected = readExpected(db2);
    db2.close();
    db.close();

    await copyFixture(ipod.path, 'empty', model, expected);
  } finally {
    await ipod.cleanup();
  }
}

async function generateSingleTrack(): Promise<void> {
  const model = 'MA147';
  const ipod = await createTestIpod({ model, name: 'Single Track iPod' });
  try {
    const db = Database.openSync(ipod.path);

    db.addTrack({
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
      genre: 'Rock',
      duration: 180000,
      bitrate: 256,
      sampleRate: 44100,
      trackNumber: 1,
      totalTracks: 1,
      discNumber: 1,
      totalDiscs: 1,
      year: 2024,
      filetype: 'MPEG audio file',
      mediaType: 0x0001, // Audio
      size: 5760000, // ~256kbps * 180s
    });

    db.saveSync();
    db.close();

    // Read back
    const db2 = Database.openSync(ipod.path);
    const expected = readExpected(db2);
    db2.close();

    await copyFixture(ipod.path, 'single-track', model, expected);
  } finally {
    await ipod.cleanup();
  }
}

async function generatePlaylists(): Promise<void> {
  const model = 'MA147';
  const ipod = await createTestIpod({ model, name: 'Playlist iPod' });
  try {
    const db = Database.openSync(ipod.path);

    // Add 10 tracks
    const handles: TrackHandle[] = [];
    for (let i = 1; i <= 10; i++) {
      const handle = db.addTrack({
        title: `Track ${String(i).padStart(2, '0')}`,
        artist: `Artist ${((i - 1) % 3) + 1}`,
        album: `Album ${((i - 1) % 2) + 1}`,
        genre: i <= 5 ? 'Rock' : 'Jazz',
        duration: 180000 + i * 10000,
        bitrate: 256,
        sampleRate: 44100,
        trackNumber: i,
        totalTracks: 10,
        filetype: 'MPEG audio file',
        mediaType: 0x0001,
      });
      handles.push(handle);
    }

    // Create 3 playlists with overlapping track assignments
    const pl1 = db.createPlaylist('Rock Favorites');
    const pl2 = db.createPlaylist('Road Trip');
    const pl3 = db.createPlaylist('Study Music');

    // Rock Favorites: tracks 1-5 (the Rock tracks)
    for (let i = 0; i < 5; i++) {
      db.addTrackToPlaylist(pl1.id, handles[i]);
    }

    // Road Trip: tracks 2, 4, 6, 8, 10 (even-numbered)
    for (let i = 1; i < 10; i += 2) {
      db.addTrackToPlaylist(pl2.id, handles[i]);
    }

    // Study Music: tracks 6-10 (the Jazz tracks)
    for (let i = 5; i < 10; i++) {
      db.addTrackToPlaylist(pl3.id, handles[i]);
    }

    db.saveSync();
    db.close();

    // Read back
    const db2 = Database.openSync(ipod.path);
    const expected = readExpected(db2);
    db2.close();

    await copyFixture(ipod.path, 'playlists', model, expected);
  } finally {
    await ipod.cleanup();
  }
}

async function generateUnicodeStrings(): Promise<void> {
  const model = 'MA147';
  const ipod = await createTestIpod({ model, name: 'Unicode iPod' });
  try {
    const db = Database.openSync(ipod.path);

    // CJK characters
    db.addTrack({
      title: '日本語テスト',
      artist: '中文艺术家',
      album: '한국어앨범',
      genre: 'ジャンル',
      duration: 200000,
      bitrate: 320,
      filetype: 'MPEG audio file',
      mediaType: 0x0001,
    });

    // Cyrillic
    db.addTrack({
      title: 'Тест Кириллицы',
      artist: 'Артист',
      album: 'Альбом',
      genre: 'Рок',
      duration: 210000,
      bitrate: 256,
      filetype: 'MPEG audio file',
      mediaType: 0x0001,
    });

    // Accented Latin characters
    db.addTrack({
      title: 'Café Naïve',
      artist: 'Ångström',
      album: 'Résumé',
      genre: 'Élégant',
      duration: 190000,
      bitrate: 192,
      filetype: 'MPEG audio file',
      mediaType: 0x0001,
    });

    // Special characters: quotes, em-dash, ellipsis, etc.
    db.addTrack({
      title: 'Don\u2019t Stop \u2014 Believin\u2026',
      artist: 'The \u201CQuoted\u201D Band',
      album: 'Greatest Hits \u2022 Vol. 1',
      genre: 'Pop/Rock',
      composer: 'Smith & Jones \u00A9 2024',
      duration: 220000,
      bitrate: 256,
      filetype: 'MPEG audio file',
      mediaType: 0x0001,
    });

    // Mixed script
    db.addTrack({
      title: 'Tokyo \u6771\u4EAC Mix',
      artist: 'DJ \u03B1\u03B2\u03B3',
      album: '\u00C9toile \u2605 Star',
      genre: 'Electronic',
      duration: 300000,
      bitrate: 320,
      filetype: 'MPEG audio file',
      mediaType: 0x0001,
    });

    db.saveSync();
    db.close();

    // Read back
    const db2 = Database.openSync(ipod.path);
    const expected = readExpected(db2);
    db2.close();

    await copyFixture(ipod.path, 'unicode-strings', model, expected);
  } finally {
    await ipod.cleanup();
  }
}

async function generateIpodClassic(): Promise<void> {
  const model = 'MA147'; // iPod Video 60GB
  const ipod = await createTestIpod({ model, name: 'iPod Classic' });
  try {
    const db = Database.openSync(ipod.path);

    // Add a few representative tracks
    db.addTrack({
      title: 'Classic Track',
      artist: 'Classic Artist',
      album: 'Classic Album',
      genre: 'Classic Rock',
      duration: 240000,
      bitrate: 256,
      sampleRate: 44100,
      year: 2007,
      filetype: 'MPEG audio file',
      mediaType: 0x0001,
    });

    db.saveSync();
    db.close();

    // Read back
    const db2 = Database.openSync(ipod.path);
    const expected = readExpected(db2);
    db2.close();

    await copyFixture(ipod.path, 'ipod-classic', model, expected);
  } finally {
    await ipod.cleanup();
  }
}

async function generateManyTracks(): Promise<void> {
  const model = 'MA147';
  const ipod = await createTestIpod({ model, name: 'Many Tracks iPod' });
  try {
    const db = Database.openSync(ipod.path);

    const genres = [
      'Rock',
      'Jazz',
      'Classical',
      'Electronic',
      'Hip Hop',
      'Country',
      'Blues',
      'Folk',
      'Metal',
      'Pop',
    ];
    const artists = [
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
    ];

    for (let i = 1; i <= 100; i++) {
      const artistIdx = (i - 1) % artists.length;
      const genreIdx = (i - 1) % genres.length;
      const albumNum = Math.floor((i - 1) / 10) + 1;

      db.addTrack({
        title: `Song ${String(i).padStart(3, '0')}`,
        artist: artists[artistIdx],
        album: `Album ${String(albumNum).padStart(2, '0')}`,
        albumArtist: artists[artistIdx],
        genre: genres[genreIdx],
        duration: 120000 + i * 5000,
        bitrate: [128, 192, 256, 320][i % 4],
        sampleRate: 44100,
        trackNumber: ((i - 1) % 10) + 1,
        totalTracks: 10,
        discNumber: 1,
        totalDiscs: 1,
        year: 2020 + (i % 5),
        filetype: 'MPEG audio file',
        mediaType: 0x0001,
      });
    }

    db.saveSync();
    db.close();

    // Read back
    const db2 = Database.openSync(ipod.path);
    const expected = readExpected(db2);
    db2.close();

    await copyFixture(ipod.path, 'many-tracks', model, expected);
  } finally {
    await ipod.cleanup();
  }
}

async function generateIpodNano4(): Promise<void> {
  const model = 'MB598'; // iPod Nano 4th gen 8GB
  // Note: Nano 4th gen uses hash58 checksums but gpod-testing handles that
  // with the TEST_FIREWIRE_GUID
  const ipod = await createTestIpod({ model, name: 'iPod Nano' });
  try {
    const db = Database.openSync(ipod.path);

    db.addTrack({
      title: 'Nano Track',
      artist: 'Nano Artist',
      album: 'Nano Album',
      genre: 'Pop',
      duration: 195000,
      bitrate: 256,
      sampleRate: 44100,
      year: 2008,
      filetype: 'MPEG audio file',
      mediaType: 0x0001,
    });

    db.saveSync();
    db.close();

    // Read back
    const db2 = Database.openSync(ipod.path);
    const expected = readExpected(db2);
    db2.close();

    await copyFixture(ipod.path, 'ipod-nano-4', model, expected);
  } finally {
    await ipod.cleanup();
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('Generating iPod database fixtures...');
  console.log(`Output: ${OUTPUT_DIR}\n`);

  // Ensure output directory exists
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Priority 1 fixtures
  console.log('Priority 1 (must have):');
  await generateEmpty();
  await generateSingleTrack();
  await generatePlaylists();
  await generateUnicodeStrings();
  await generateIpodClassic();

  // Priority 2 fixtures
  console.log('\nPriority 2 (nice to have):');
  await generateManyTracks();
  await generateIpodNano4();

  console.log('\nDone! All fixtures generated successfully.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
