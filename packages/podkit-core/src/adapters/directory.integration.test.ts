/**
 * Integration tests for DirectoryAdapter
 *
 * These tests use real audio files and the music-metadata library.
 * They require FFmpeg to generate test fixtures.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureFixturesExist,
  getMultiFormatFixturesDir,
  getMultiFormatEmbeddedFixturesDir,
  requireFFmpeg,
  SCENARIO_ARTISTS,
} from '@podkit/test-fixtures';
import { DirectoryAdapter } from './directory.js';

requireFFmpeg();

describe('DirectoryAdapter integration', () => {
  let testDir: string;

  beforeAll(async () => {
    // Create a temporary directory for test fixtures
    testDir = join(tmpdir(), `podkit-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Generate test audio files with metadata using FFmpeg
    const tracks: Array<{
      filename: string;
      format: string;
      metadata: Record<string, string>;
    }> = [
      {
        filename: 'test-mp3.mp3',
        format: 'mp3',
        metadata: {
          title: 'Test MP3 Track',
          artist: 'Test Artist',
          album: 'Test Album',
          track: '1/10',
          date: '2023',
          genre: 'Rock',
        },
      },
      {
        filename: 'unicode-\u97F3\u697D.mp3',
        format: 'mp3',
        metadata: {
          title: '\u97F3\u697D\u306E\u66F2',
          artist: '\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8',
          album: '\u30A2\u30EB\u30D0\u30E0',
          track: '2/10',
          date: '2024',
          genre: 'J-Pop',
        },
      },
      {
        filename: 'no-metadata.mp3',
        format: 'mp3',
        metadata: {}, // No metadata
      },
      {
        filename: 'subdir/nested-track.mp3',
        format: 'mp3',
        metadata: {
          title: 'Nested Track',
          artist: 'Nested Artist',
          album: 'Nested Album',
        },
      },
    ];

    // Create subdirectory
    await mkdir(join(testDir, 'subdir'), { recursive: true });

    // Generate each test file
    for (const track of tracks) {
      const filePath = join(testDir, track.filename);
      await generateTestAudio(filePath, track.format, track.metadata);
    }
  });

  afterAll(async () => {
    // Cleanup test directory
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('scans directory and finds all audio files', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    await adapter.connect();

    const tracks = await adapter.getItems();
    expect(tracks).toHaveLength(4);
  });

  it('parses metadata from MP3 files', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    const tracks = await adapter.getItems();

    const mp3Track = tracks.find((t) => t.filePath.endsWith('test-mp3.mp3'));
    expect(mp3Track).toBeDefined();
    expect(mp3Track!.title).toBe('Test MP3 Track');
    expect(mp3Track!.artist).toBe('Test Artist');
    expect(mp3Track!.album).toBe('Test Album');
    expect(mp3Track!.trackNumber).toBe(1);
    expect(mp3Track!.year).toBe(2023);
    expect(mp3Track!.genre).toBe('Rock');
    expect(mp3Track!.fileType).toBe('mp3');
  });

  it('handles unicode metadata correctly', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    const tracks = await adapter.getItems();

    const unicodeTrack = tracks.find((t) => t.filePath.includes('unicode'));
    expect(unicodeTrack).toBeDefined();
    expect(unicodeTrack!.title).toBe('\u97F3\u697D\u306E\u66F2');
    expect(unicodeTrack!.artist).toBe('\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8');
    expect(unicodeTrack!.album).toBe('\u30A2\u30EB\u30D0\u30E0');
  });

  it('handles files with no metadata', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    const tracks = await adapter.getItems();

    const noMetadataTrack = tracks.find((t) => t.filePath.includes('no-metadata'));
    expect(noMetadataTrack).toBeDefined();
    // Should use filename as title
    expect(noMetadataTrack!.title).toBe('no-metadata');
    expect(noMetadataTrack!.artist).toBe('Unknown Artist');
    expect(noMetadataTrack!.album).toBe('Unknown Album');
  });

  it('scans subdirectories recursively', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    const tracks = await adapter.getItems();

    const nestedTrack = tracks.find((t) => t.filePath.includes('nested-track'));
    expect(nestedTrack).toBeDefined();
    expect(nestedTrack!.title).toBe('Nested Track');
  });

  it('extracts duration from audio files', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    const tracks = await adapter.getItems();

    // All generated files should have duration
    for (const track of tracks) {
      expect(track.duration).toBeDefined();
      expect(track.duration).toBeGreaterThan(0);
    }
  });

  it('filters tracks by artist', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    const filtered = await adapter.getFilteredItems({ artist: 'Test Artist' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.artist).toBe('Test Artist');
  });

  it('filters tracks by album', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    const filtered = await adapter.getFilteredItems({ album: 'Nested' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.album).toBe('Nested Album');
  });

  it('filters tracks by path pattern', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    const filtered = await adapter.getFilteredItems({ pathPattern: '**/subdir/**' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.title).toBe('Nested Track');
  });

  it('reports progress during scan', async () => {
    const progressUpdates: Array<{ phase: string; processed: number; total: number }> = [];

    const adapter = new DirectoryAdapter({
      path: testDir,
      onProgress: (progress) => progressUpdates.push({ ...progress }),
    });

    await adapter.connect();

    // Should have progress updates
    expect(progressUpdates.length).toBeGreaterThan(0);

    // Should have discovery phase
    const discoveryUpdates = progressUpdates.filter((p) => p.phase === 'discovering');
    expect(discoveryUpdates.length).toBeGreaterThan(0);

    // Should have parsing phase with correct totals
    const parsingUpdates = progressUpdates.filter((p) => p.phase === 'parsing');
    expect(parsingUpdates.length).toBeGreaterThan(0);

    // Final update should have processed === total
    const lastUpdate = progressUpdates[progressUpdates.length - 1]!;
    expect(lastUpdate.processed).toBe(lastUpdate.total);
  });

  it('getFileAccess returns path-based access with correct path', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    const tracks = await adapter.getItems();

    for (const track of tracks) {
      const access = adapter.getFileAccess(track);
      expect(access.type).toBe('path');
      if (access.type === 'path') {
        expect(access.path).toBe(track.filePath);
        // Path should be absolute
        expect(access.path).toMatch(/^\//);
      }
    }
  });

  it('disconnect clears the cache', async () => {
    const adapter = new DirectoryAdapter({ path: testDir });
    await adapter.connect();
    expect(adapter.getTrackCount()).toBe(4);

    await adapter.disconnect();
    expect(adapter.getTrackCount()).toBe(0);
  });
});

// Pinning test for the AIFF fixture metadata round-trip. ffmpeg's AIFF muxer
// writes only `title`/`author`/`annotation`/`copyright` chunks by default,
// silently dropping `artist`/`album`/`track`/`genre`. The multi-format
// generator opts AIFF into `-write_id3v2 1` so the full tag set survives;
// this test fails loudly if that flag ever gets removed.
describe('DirectoryAdapter — AIFF multi-format fixture', () => {
  ensureFixturesExist('multi-format');
  ensureFixturesExist('multi-format-embedded');

  it('reads artist/album/track from a plain AIFF fixture', async () => {
    const adapter = new DirectoryAdapter({ path: getMultiFormatFixturesDir() });
    const tracks = await adapter.getItems();
    const aiff = tracks.find((t) => t.filePath.endsWith('02-aiff-track.aiff'));
    expect(aiff).toBeDefined();
    expect(aiff!.title).toBe('AIFF Test Track');
    expect(aiff!.artist).toBe(SCENARIO_ARTISTS.none);
    expect(aiff!.album).toBe('Lossless Collection');
    expect(aiff!.trackNumber).toBe(2);
    expect(aiff!.hasArtwork).toBe(false);
  });

  it('reads embedded artwork from an AIFF fixture with attached_pic', async () => {
    const adapter = new DirectoryAdapter({ path: getMultiFormatEmbeddedFixturesDir() });
    const tracks = await adapter.getItems();
    const aiff = tracks.find((t) => t.filePath.endsWith('02-aiff-track.aiff'));
    expect(aiff).toBeDefined();
    expect(aiff!.artist).toBe(SCENARIO_ARTISTS.embedded);
    expect(aiff!.album).toBe('Lossless Collection (Embedded)');
    expect(aiff!.hasArtwork).toBe(true);
  });
});

// The large-collection performance test moved to
// `./directory.perf.test.ts` and runs via `bun run test:perf`. Default
// `bun run test` / `test:integration` flows exclude `*.perf.test.ts` via
// bunfig's `pathIgnorePatterns`.

/**
 * Generate a minimal test audio file with metadata.
 */
async function generateTestAudio(
  filePath: string,
  format: string,
  metadata: Record<string, string>
): Promise<void> {
  // Build ffmpeg metadata arguments
  const metadataArgs = Object.entries(metadata)
    .map(([key, value]) => ['-metadata', `${key}=${value}`])
    .flat();

  // Generate a 0.1 second silent audio file
  const args = [
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=stereo',
    '-t',
    '0.1',
    ...metadataArgs,
    '-y',
    '-loglevel',
    'error',
    filePath,
  ];

  const result = spawnSync('ffmpeg', args, { stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed with status ${result.status} for ${format} file ${filePath}`);
  }
}
