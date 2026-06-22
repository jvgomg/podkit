/**
 * Integration tests for the m3u8 playlist writer.
 *
 * A fixture dump is synthesised with `@podkit/gpod-testing` + libgpod-node: a
 * master playlist (always present), an ordered manual playlist whose members
 * include one no-audio (metadata-only) track, and a smart playlist with a genre
 * rule. The transform is run, then the emitted `Playlists/` tree is asserted:
 * the master playlist gets no file; each non-master playlist gets a `.m3u8`
 * with `#EXTM3U`, correct order, `#EXTINF` lines, and relative `../Music/…`
 * paths that resolve to files that actually exist in the archive. The no-audio
 * member is skipped (no dangling path). The smart playlist's resolved tracks
 * are listed.
 *
 * The libgpod test harness supports ordered manual playlists and smart
 * playlists with readable rules (also exercised by the catalogue integration
 * suite), so those paths are asserted directly here rather than mocked.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createTestIpod } from '@podkit/gpod-testing';
import { Database, MediaType, SPLField, SPLAction, SPLMatch } from '@podkit/libgpod-node';
import { runTransform, type TransformResult } from './run-transform.js';
import { PLAYLISTS_SUBDIR } from './playlist-writer.js';

const FIXTURE_DIR = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'test-packages',
  'test-fixtures',
  'fixtures',
  'audio',
  'multi-format'
);
const MP3 = join(FIXTURE_DIR, '05-mp3-track.mp3');
const M4A = join(FIXTURE_DIR, '06-aac-track.m4a');

interface SeedResult {
  root: string;
}

/**
 * Build a dump with two audio album tracks (inserted in reverse track-number
 * order so playlist ordering is provably membership order), a metadata-only
 * no-audio track, an ordered manual playlist (B, A, then the no-audio track),
 * a podcast track, and a smart playlist matching genre Rock.
 */
async function seedDump(): Promise<SeedResult> {
  const ipod = await createTestIpod();
  const db = await Database.open(ipod.path);

  const songB = db.addTrack({
    title: 'Song B',
    artist: 'The Artist',
    album: 'Greatest Hits',
    albumArtist: 'The Band',
    genre: 'Rock',
    trackNumber: 2,
    year: 1999,
  });
  db.copyTrackToDevice(songB, M4A);

  const songA = db.addTrack({
    title: 'Song A',
    artist: 'The Artist',
    album: 'Greatest Hits',
    albumArtist: 'The Band',
    genre: 'Rock',
    trackNumber: 1,
    year: 1999,
  });
  db.copyTrackToDevice(songA, MP3);

  // A podcast in a different genre so the smart 'Rock' playlist excludes it.
  const pod = db.addTrack({
    title: 'Episode 1',
    artist: 'Some Show',
    album: 'Some Show',
    genre: 'Talk',
    mediaType: MediaType.Podcast,
  });
  db.copyTrackToDevice(pod, MP3);

  // A metadata-only track → no audio body → must be skipped in the m3u8.
  const lonely = db.addTrack({ title: 'Lonely Track', artist: 'Nobody' });

  // Ordered manual playlist: B, then the no-audio track (which must be skipped
  // without leaving a dangling path), then A. The skip sits between the two
  // exported entries so its in-position comment placement is observable.
  const manual = db.createPlaylist('My Mix');
  db.addTrackToPlaylist(manual.id, songB);
  db.addTrackToPlaylist(manual.id, lonely);
  db.addTrackToPlaylist(manual.id, songA);

  // Smart playlist matching genre Rock → resolves to Song B + Song A.
  db.createSmartPlaylist({
    name: 'Rock Only',
    match: SPLMatch.And,
    rules: [{ field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' }],
  });

  // Smart playlist whose rule matches nothing → exercises the evaluate path
  // returning an empty resolved list → a valid header-only m3u8.
  db.createSmartPlaylist({
    name: 'Nothing Matches',
    match: SPLMatch.And,
    rules: [{ field: SPLField.Genre, action: SPLAction.Contains, string: 'ZZNoSuchGenre' }],
  });

  db.saveSync();
  db.close();
  return { root: ipod.path };
}

/** Split an m3u8 string into trimmed, non-empty lines. */
function lines(content: string): string[] {
  return content.split('\n').filter((l) => l.length > 0);
}

/** Whether a path exists. */
async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('writePlaylists — m3u8 from a fixture dump', () => {
  let dump: string;
  let archiveDir: string;
  let result: TransformResult;

  beforeEach(async () => {
    dump = (await seedDump()).root;
    result = await runTransform(dump);
    archiveDir = result.archiveDir;
  });

  afterEach(async () => {
    if (dump) await rm(dump, { recursive: true, force: true });
  });

  test('skips the master/library playlist (no m3u8 for it)', async () => {
    // The test harness names the master playlist after the device; whatever its
    // name, no file should carry the full track list. We assert by counting:
    // only the two non-master playlists produce files.
    const re = await Database.open(dump);
    const master = re.getMasterPlaylist();
    re.close();
    expect(master).not.toBeNull();
    const masterFile = join(archiveDir, PLAYLISTS_SUBDIR, `${master!.name}.m3u8`);
    expect(await exists(masterFile)).toBe(false);
  });

  test('emits one m3u8 per non-master playlist with #EXTM3U', async () => {
    const mix = join(archiveDir, PLAYLISTS_SUBDIR, 'My Mix.m3u8');
    const rock = join(archiveDir, PLAYLISTS_SUBDIR, 'Rock Only.m3u8');
    expect(await exists(mix)).toBe(true);
    expect(await exists(rock)).toBe(true);
    expect(lines(await readFile(mix, 'utf8'))[0]).toBe('#EXTM3U');
    expect(lines(await readFile(rock, 'utf8'))[0]).toBe('#EXTM3U');
  });

  test('manual playlist preserves order and uses relative ../Music paths', async () => {
    const content = await readFile(join(archiveDir, PLAYLISTS_SUBDIR, 'My Mix.m3u8'), 'utf8');
    const paths = lines(content).filter((l) => !l.startsWith('#'));
    expect(paths).toEqual([
      '../Music/The Band/Greatest Hits/02 Song B.m4a',
      '../Music/The Band/Greatest Hits/01 Song A.mp3',
    ]);
  });

  test('relative paths resolve to files that exist in the archive', async () => {
    const playlistDir = join(archiveDir, PLAYLISTS_SUBDIR);
    const content = await readFile(join(playlistDir, 'My Mix.m3u8'), 'utf8');
    const paths = lines(content).filter((l) => !l.startsWith('#'));
    expect(paths.length).toBeGreaterThan(0);
    for (const rel of paths) {
      const abs = resolve(playlistDir, rel);
      expect(await exists(abs)).toBe(true);
      // The path resolves back into the archive's Music tree.
      expect(abs.startsWith(join(archiveDir, 'Music'))).toBe(true);
    }
  });

  test('emits #EXTINF lines paired with each track path', async () => {
    const content = await readFile(join(archiveDir, PLAYLISTS_SUBDIR, 'My Mix.m3u8'), 'utf8');
    const body = lines(content)
      .slice(1)
      .filter((l) => !l.startsWith('# skipped'));
    // Body is [EXTINF, path, EXTINF, path, …].
    expect(body.length % 2).toBe(0);
    for (let i = 0; i < body.length; i += 2) {
      expect(body[i]!.startsWith('#EXTINF:')).toBe(true);
      expect(body[i]!).toContain('The Artist');
      expect(body[i + 1]!.startsWith('../Music/')).toBe(true);
    }
  });

  test('skips a no-audio playlist member in position (no dangling path)', async () => {
    const content = await readFile(join(archiveDir, PLAYLISTS_SUBDIR, 'My Mix.m3u8'), 'utf8');
    // The no-audio track must not appear as a path entry…
    expect(content).not.toContain('Lonely Track.');
    const paths = lines(content).filter((l) => !l.startsWith('#'));
    expect(paths).toHaveLength(2);
    // …and is recorded as a skip comment, in the slot it held (between B and A).
    const all = lines(content);
    const skipIdx = all.indexOf('# skipped (no exported audio): Lonely Track');
    const bIdx = all.indexOf('../Music/The Band/Greatest Hits/02 Song B.m4a');
    const aIdx = all.indexOf('../Music/The Band/Greatest Hits/01 Song A.mp3');
    expect(skipIdx).toBeGreaterThan(bIdx);
    expect(skipIdx).toBeLessThan(aIdx);
  });

  test('smart playlist lists its resolved tracks (Rock Only → Song B + Song A)', async () => {
    const content = await readFile(join(archiveDir, PLAYLISTS_SUBDIR, 'Rock Only.m3u8'), 'utf8');
    const paths = lines(content)
      .filter((l) => !l.startsWith('#'))
      .sort();
    expect(paths).toEqual([
      '../Music/The Band/Greatest Hits/01 Song A.mp3',
      '../Music/The Band/Greatest Hits/02 Song B.m4a',
    ]);
    // The podcast (genre Talk) is excluded.
    expect(content).not.toContain('Episode 1');
  });

  test('runTransform reports the written playlists and no failures', async () => {
    expect(result.playlistFailures).toEqual([]);
    const names = result.playlistsWritten.map((p) => p.name).sort();
    expect(names).toEqual(['My Mix', 'Nothing Matches', 'Rock Only']);
    const mix = result.playlistsWritten.find((p) => p.name === 'My Mix')!;
    expect(mix.entries).toHaveLength(2);
    expect(mix.skipped.map((s) => s.title)).toEqual(['Lonely Track']);
    const rock = result.playlistsWritten.find((p) => p.name === 'Rock Only')!;
    expect(rock.isSmart).toBe(true);
  });

  test('an empty-resolving smart playlist yields a valid header-only m3u8', async () => {
    const content = await readFile(
      join(archiveDir, PLAYLISTS_SUBDIR, 'Nothing Matches.m3u8'),
      'utf8'
    );
    expect(content).toBe('#EXTM3U\n');
    const empty = result.playlistsWritten.find((p) => p.name === 'Nothing Matches')!;
    expect(empty.entries).toHaveLength(0);
    expect(empty.skipped).toHaveLength(0);
  });

  test('the Playlists directory is a sibling of Music under the archive root', async () => {
    const mix = join(archiveDir, PLAYLISTS_SUBDIR, 'My Mix.m3u8');
    expect(dirname(dirname(mix))).toBe(archiveDir);
  });
});
