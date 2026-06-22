/**
 * Integration tests for the `onProgress` event channel on the three archive
 * orchestrators.
 *
 * A fixture iPod is synthesised with `@podkit/gpod-testing` + libgpod-node with
 * a deliberately varied media mix (music, a movie, a podcast) plus a manual
 * playlist, so the `transform:start` stats breakdown can be asserted against
 * known counts. Each orchestrator is run with a capturing callback and the
 * emitted event sequence is asserted (start → file(s)/track(s) → done), proving:
 *
 *  - events fire at the right points, in order;
 *  - the transform's media-kind breakdown buckets correctly;
 *  - the (single-materialisation) track loop still produces the same tree —
 *    i.e. adding progress did not double-iterate or change extraction output.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestIpod } from '@podkit/gpod-testing';
import { Database, MediaType } from '@podkit/libgpod-node';
import { runDump } from './run-dump.js';
import { runTransform } from './run-transform.js';
import { runArchive } from './run-archive.js';
import type { ArchiveProgressEvent } from './progress-events.js';

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

const FIXED = new Date(Date.UTC(2026, 5, 22, 9, 7, 3));

/**
 * Build a live-iPod-shaped fixture volume: two music tracks, one movie, one
 * podcast, and a manual playlist. Returns the directory (containing
 * `iPod_Control`) — the orchestrators treat it as the volume / dump.
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
  });
  db.copyTrackToDevice(first, MP3);

  const second = db.addTrack({
    title: 'Second Song',
    artist: 'The Artist',
    album: 'Greatest Hits',
    albumArtist: 'The Band',
    trackNumber: 2,
  });
  db.copyTrackToDevice(second, M4A);

  // A movie → routed into Video/Movies/.
  const movie = db.addTrack({
    title: 'A Movie',
    mediaType: MediaType.Movie,
    movieFlag: true,
  });
  db.copyTrackToDevice(movie, M4A);

  // A podcast → routed into Podcasts/.
  const pod = db.addTrack({
    title: 'Episode 1',
    artist: 'Some Show',
    album: 'Some Show',
    mediaType: MediaType.Podcast,
  });
  db.copyTrackToDevice(pod, MP3);

  // A metadata-only track with no audio body → walked by progress (so it counts
  // toward `transform:track.done`) but not extracted (so `written` stays lower).
  db.addTrack({ title: 'Lonely Track', artist: 'Nobody' });

  // A manual playlist (the master/library playlist is also reported by libgpod,
  // so the playlist count is at least 2).
  const mix = db.createPlaylist('My Mix');
  db.addTrackToPlaylist(mix.id, first);

  db.saveSync();
  db.close();

  // A user-added foreign file at the root — proves the dump still classifies it
  // out while progress runs.
  await writeFile(join(ipod.path, 'mixtape.flac'), 'foreign');

  return ipod.path;
}

describe('archive progress events', () => {
  let volume: string;
  let dest: string;

  beforeEach(async () => {
    volume = await seedVolume();
    dest = await mkdtemp(join(tmpdir(), 'ipod-archive-progress-'));
  });

  afterEach(async () => {
    await rm(volume, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  });

  test('runDump emits start → file(s) → done with a monotonically rising count', async () => {
    const events: ArchiveProgressEvent[] = [];
    const result = await runDump(volume, dest, {
      deviceName: 'TERAPOD',
      volumeLabel: 'IPOD',
      now: FIXED,
      onProgress: (e) => events.push(e),
    });

    const start = events[0];
    expect(start?.kind).toBe('dump:start');
    if (start?.kind === 'dump:start') {
      expect(start.deviceName).toBe('TERAPOD');
      expect(start.outputDir).toBe(result.outputDir);
    }

    const fileEvents = events.filter((e) => e.kind === 'dump:file');
    expect(fileEvents.length).toBe(result.manifest.length);
    expect(fileEvents.length).toBeGreaterThan(0);
    // The running count is 1..N, strictly increasing.
    fileEvents.forEach((e, i) => {
      expect(e.kind === 'dump:file' && e.copied).toBe(i + 1);
    });

    const last = events[events.length - 1];
    expect(last?.kind).toBe('dump:done');
    if (last?.kind === 'dump:done') {
      expect(last.fileCount).toBe(result.manifest.length);
    }
  });

  test('runTransform emits start (with media-kind stats) → track(s) → done', async () => {
    const events: ArchiveProgressEvent[] = [];
    const result = await runTransform(volume, { onProgress: (e) => events.push(e) });

    const start = events[0];
    expect(start?.kind).toBe('transform:start');
    if (start?.kind !== 'transform:start') throw new Error('expected transform:start first');

    // 5 tracks total: 3 songs (incl. the no-audio "Lonely Track", which is plain
    // music) + 1 movie + 1 podcast.
    expect(start.stats.total).toBe(5);
    expect(start.stats.songs).toBe(3);
    expect(start.stats.movies).toBe(1);
    expect(start.stats.podcasts).toBe(1);
    expect(start.stats.audiobooks).toBe(0);
    expect(start.stats.musicVideos).toBe(0);
    expect(start.stats.tvShows).toBe(0);
    // Only the manual "My Mix" is counted — the master/library playlist is
    // excluded from stats (it is also skipped by the .m3u8 writer, so the
    // count matches exactly what is written to Playlists/).
    expect(start.stats.playlists).toBe(1);

    const trackEvents = events.filter((e) => e.kind === 'transform:track');
    expect(trackEvents.length).toBe(5);
    // done counter rises 1..total, with the same total on each tick.
    trackEvents.forEach((e, i) => {
      if (e.kind !== 'transform:track') throw new Error('unreachable');
      expect(e.done).toBe(i + 1);
      expect(e.total).toBe(5);
    });

    const last = events[events.length - 1];
    expect(last?.kind).toBe('transform:done');
    if (last?.kind === 'transform:done') {
      expect(last.written).toBe(result.written);
    }

    // `done` counts every walked track (5); `written` counts only extractions
    // (4 — the no-audio "Lonely Track" is walked but never written). This proves
    // the per-track event is independent of the extraction outcome.
    expect(result.written).toBe(4);
    expect(result.noAudio).toHaveLength(1);
    expect(result.noAudio[0]?.title).toBe('Lonely Track');
  });

  test('runArchive threads one ordered event stream across both stages', async () => {
    const events: ArchiveProgressEvent[] = [];
    await runArchive(volume, dest, {
      deviceName: 'TERAPOD',
      volumeLabel: 'IPOD',
      now: FIXED,
      onProgress: (e) => events.push(e),
    });

    const kinds = events.map((e) => e.kind);
    // Stage 1 events all precede stage 2 events, in the documented order.
    expect(kinds[0]).toBe('dump:start');
    const dumpDoneIdx = kinds.indexOf('dump:done');
    const transformStartIdx = kinds.indexOf('transform:start');
    expect(dumpDoneIdx).toBeGreaterThan(0);
    expect(transformStartIdx).toBe(dumpDoneIdx + 1);
    expect(kinds[kinds.length - 1]).toBe('transform:done');

    // Every dump:file precedes the dump:done that precedes transform:start.
    const lastDumpFileIdx = kinds.lastIndexOf('dump:file');
    expect(lastDumpFileIdx).toBeLessThan(dumpDoneIdx);

    // The transform breakdown is present in the combined stream.
    const start = events[transformStartIdx];
    if (start?.kind === 'transform:start') {
      expect(start.stats.total).toBe(5);
      expect(start.stats.movies).toBe(1);
      expect(start.stats.podcasts).toBe(1);
    }
  });

  test('omitting onProgress is a no-op — result is unchanged', async () => {
    // Sanity: the orchestrators run identically without a callback.
    const result = await runTransform(volume);
    expect(result.written).toBe(4);
  });
});
