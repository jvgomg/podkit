/**
 * Integration test for the full both-stage happy path (`runArchive`).
 *
 * A fixture iPod is synthesised with `@podkit/gpod-testing` + libgpod-node:
 * several tracks of varied media types (music album, compilation, podcast), a
 * manual playlist, and a user-added "foreign" file dropped at the volume root.
 * That directory is treated as the live `volumeRoot`. `runArchive` is then run
 * against it and the produced single, self-contained output directory is
 * asserted end to end:
 *
 *   <dest>/<name>-<id>-<timestamp>/
 *     raw/iPod_Control/...  + raw/manifest.sha256
 *     archive/Music/.../NN Title.ext   (real, byte-lossless copies)
 *     archive/library.sqlite           (openable; device row + tracks)
 *     archive/Playlists/<name>.m3u8
 *     archive/README.md
 *     archive/report.md + report.json  (covers BOTH stages)
 *
 * The stage-1 buckets are proven real (not "not available"): the foreign file
 * planted on the volume must appear in the report's foreign-skipped bucket.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database as SqliteDatabase } from 'bun:sqlite';
import { File as TagFile } from 'node-taglib-sharp';
import { createTestIpod } from '@podkit/gpod-testing';
import { Database, MediaType } from '@podkit/libgpod-node';
import { runArchive } from './run-archive.js';
import { RAW_DUMP_SUBDIR } from './run-dump.js';
import { MANIFEST_FILENAME } from './raw-dumper.js';
import { ARCHIVE_SUBDIR } from './run-transform.js';
import { LIBRARY_DB_FILENAME } from './library-db-writer.js';
import { PLAYLISTS_SUBDIR } from './playlist-writer.js';

// Shared audio fixtures, resolved relative to this file so the suite runs on
// any machine / CI. src/ → packages/ipod-archive/ → packages/ → repo root.
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

// Fixed instant → deterministic output-directory name + catalogue dump_date.
const FIXED = new Date(Date.UTC(2026, 5, 22, 9, 7, 3));
const FIXED_UNIX = Math.floor(FIXED.getTime() / 1000);

/** Foreign file planted at the volume root to prove the stage-1 bucket is real. */
const FOREIGN_FILE = 'my-mixtape.flac';

/** Read the audio-stream properties used to prove a copy was not re-encoded. */
function readAudioProps(filePath: string): {
  description: string;
  durationMs: number;
  bitrate: number;
  sampleRate: number;
  channels: number;
} {
  const file = TagFile.createFromPath(filePath);
  try {
    const p = file.properties;
    return {
      description: p.description,
      durationMs: Math.round(p.durationMilliseconds),
      bitrate: p.audioBitrate,
      sampleRate: p.audioSampleRate,
      channels: p.audioChannels,
    };
  } finally {
    file.dispose();
  }
}

/**
 * Build a live-iPod-shaped fixture volume: a two-track music album, a podcast,
 * a manual playlist, and a user-added foreign file at the root. Returns the
 * directory (containing `iPod_Control`) — `runArchive` treats it as the volume.
 */
async function seedVolume(): Promise<string> {
  const ipod = await createTestIpod();
  const db = await Database.open(ipod.path);

  const first = db.addTrack({
    title: 'First Song',
    artist: 'The Artist',
    album: 'Greatest Hits',
    albumArtist: 'The Band',
    trackNumber: 1,
    genre: 'Rock',
  });
  db.copyTrackToDevice(first, MP3);

  const second = db.addTrack({
    title: 'Second Song',
    artist: 'The Artist',
    album: 'Greatest Hits',
    albumArtist: 'The Band',
    trackNumber: 2,
    genre: 'Rock',
  });
  db.copyTrackToDevice(second, M4A);

  // A podcast → routed into its own top-level Podcasts/ tree.
  const pod = db.addTrack({
    title: 'Episode 1',
    artist: 'Some Show',
    album: 'Some Show',
    mediaType: MediaType.Podcast,
  });
  db.copyTrackToDevice(pod, MP3);

  // An ordered manual playlist (excludes the master/library playlist).
  const mix = db.createPlaylist('My Mix');
  db.addTrackToPlaylist(mix.id, second);
  db.addTrackToPlaylist(mix.id, first);

  db.saveSync();
  db.close();

  // A user-added foreign file at the volume root — must be reported, not copied.
  await writeFile(join(ipod.path, FOREIGN_FILE), 'not an iPod file');

  return ipod.path;
}

/** Whether a path exists as a file. */
async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

describe('runArchive — full both-stage happy path', () => {
  let volume: string;
  let dest: string;

  beforeEach(async () => {
    volume = await seedVolume();
    dest = await mkdtemp(join(tmpdir(), 'ipod-archive-both-out-'));
  });

  afterEach(async () => {
    await rm(volume, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  });

  test('produces one self-contained dir with raw dump + archive + unified report', async () => {
    const result = await runArchive(volume, dest, {
      deviceName: 'TERAPOD',
      volumeLabel: 'IPOD',
      now: FIXED,
      podkitVersion: '9.9.9-test',
    });

    // One named output dir under dest; both stages report it as their root.
    expect(result.outputDir).toBe(join(dest, 'TERAPOD-IPOD-20260622-090703'));
    expect(result.dump.outputDir).toBe(result.outputDir);
    expect(result.transform.archiveDir).toBe(join(result.outputDir, ARCHIVE_SUBDIR));

    // ── Stage 1: raw dump tree + manifest ────────────────────────────────────
    const rawDumpDir = join(result.outputDir, RAW_DUMP_SUBDIR);
    expect(await isFile(join(rawDumpDir, MANIFEST_FILENAME))).toBe(true);
    const manifestText = await readFile(join(rawDumpDir, MANIFEST_FILENAME), 'utf8');
    expect(manifestText).toContain('iPod_Control/');
    // The whitelisted iPod tree was copied; the foreign file was NOT.
    expect(await isFile(join(rawDumpDir, FOREIGN_FILE))).toBe(false);

    // ── Stage 2: archive Music tree (real, byte-lossless copies) ──────────────
    const archiveDir = result.transform.archiveDir;
    const firstDest = join(archiveDir, 'Music', 'The Band', 'Greatest Hits', '01 First Song.mp3');
    const secondDest = join(archiveDir, 'Music', 'The Band', 'Greatest Hits', '02 Second Song.m4a');
    const podDest = join(archiveDir, 'Podcasts', 'Some Show', 'Episode 1.mp3');
    expect(await isFile(firstDest)).toBe(true);
    expect(await isFile(secondDest)).toBe(true);
    expect(await isFile(podDest)).toBe(true);
    expect(result.transform.written).toBe(3);

    // Lossless audio: the archived copy's audio-stream properties (codec,
    // duration, bitrate, sample rate, channels) match the source exactly — tag
    // writing rewrites only the metadata region, never the audio frames.
    expect(readAudioProps(firstDest)).toEqual(readAudioProps(MP3));

    // Tags read back from the archived music file.
    const tagFile = TagFile.createFromPath(secondDest);
    try {
      expect(tagFile.tag.title).toBe('Second Song');
      expect(tagFile.tag.album).toBe('Greatest Hits');
    } finally {
      tagFile.dispose();
    }

    // ── library.sqlite: openable, device row + tracks ─────────────────────────
    const dbPath = join(archiveDir, LIBRARY_DB_FILENAME);
    expect(await isFile(dbPath)).toBe(true);
    const sqlite = new SqliteDatabase(dbPath, { readonly: true });
    try {
      const device = sqlite.query('SELECT podkit_version, dump_date FROM device').get() as {
        podkit_version: string;
        dump_date: number;
      } | null;
      expect(device).not.toBeNull();
      expect(device!.podkit_version).toBe('9.9.9-test');
      // Clock is shared between the dir-name timestamp and the catalogue.
      expect(device!.dump_date).toBe(FIXED_UNIX);

      const trackCount = sqlite.query('SELECT COUNT(*) AS n FROM tracks').get() as { n: number };
      expect(trackCount.n).toBe(3);
    } finally {
      sqlite.close();
    }

    // ── Playlists ─────────────────────────────────────────────────────────────
    const mixM3u8 = join(archiveDir, PLAYLISTS_SUBDIR, 'My Mix.m3u8');
    expect(await isFile(mixM3u8)).toBe(true);
    const m3u8 = await readFile(mixM3u8, 'utf8');
    expect(m3u8).toContain('#EXTM3U');
    expect(m3u8).toContain('../Music/The Band/Greatest Hits/02 Second Song.m4a');

    // ── README ────────────────────────────────────────────────────────────────
    expect(result.transform.readmePath).toBe(join(archiveDir, 'README.md'));
    expect(await isFile(result.transform.readmePath)).toBe(true);
    const readme = await readFile(result.transform.readmePath, 'utf8');
    expect(readme).toContain('# iPod Archive');
    expect(readme).toContain('| Tracks | 3 |');

    // ── Unified report covers BOTH stages ─────────────────────────────────────
    const reportMd = await readFile(result.transform.reportMarkdownPath, 'utf8');
    // Stage-1 section is REAL, not the transform-only placeholder.
    expect(reportMd).not.toContain('Not available (transform-only run)');
    // The planted foreign file is in the stage-1 foreign-skipped bucket.
    expect(reportMd).toContain('### Foreign files skipped (not copied)');
    expect(reportMd).toContain(FOREIGN_FILE);

    const reportJson = JSON.parse(await readFile(result.transform.reportJsonPath, 'utf8')) as {
      stage1: { foreignSkipped: string[] } | null;
      stage2: { noAudio: unknown[] } | null;
    };
    // Stage-1 populated (not null) AND carries the foreign file.
    expect(reportJson.stage1).not.toBeNull();
    expect(reportJson.stage1!.foreignSkipped).toContain(FOREIGN_FILE);
    // Stage-2 present too.
    expect(reportJson.stage2).not.toBeNull();

    // A full runArchive run suppresses the stage-1-only report at the root —
    // only the unified two-stage report at archive/ should exist.
    expect(await isFile(join(result.outputDir, 'report.md'))).toBe(false);
    expect(await isFile(join(result.outputDir, 'report.json'))).toBe(false);
  });
});
