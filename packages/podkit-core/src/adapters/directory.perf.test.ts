/**
 * Performance test for DirectoryAdapter.
 *
 * Generates 100 synthetic audio files and measures how long the adapter
 * takes to scan them end-to-end. Lives in its own `*.perf.test.ts` file so
 * it does not run under the default `bun run test` / `test:integration`
 * flows — those exclude `*.perf.test.ts` via bunfig's `pathIgnorePatterns`.
 *
 * Run with:
 *
 *   bun run --filter @podkit/core test:perf
 *
 * The threshold is generous (10s wall-clock for 100 files) so it surfaces
 * regressions without flapping on slower machines.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requireBinary } from '@podkit/test-fixtures';
import { DirectoryAdapter } from './directory.js';

requireBinary('ffmpeg', 'brew install ffmpeg (macOS) or apt install ffmpeg (Linux)', ['-version']);

describe('DirectoryAdapter performance', () => {
  let testDir: string;

  describe('large collection', () => {
    beforeAll(async () => {
      testDir = join(tmpdir(), `podkit-perf-${Date.now()}`);
      await mkdir(testDir, { recursive: true });

      // Generate 100 short files with deterministic metadata to simulate a
      // medium collection. Concurrency is left to the OS — Promise.all here
      // is what we'd see if a user pointed the adapter at a real library.
      const fileCount = 100;
      const promises: Array<Promise<void>> = [];
      for (let i = 0; i < fileCount; i++) {
        const filePath = join(testDir, `track-${String(i).padStart(4, '0')}.mp3`);
        promises.push(
          generateTestAudio(filePath, {
            title: `Track ${i}`,
            artist: `Artist ${i % 10}`,
            album: `Album ${i % 20}`,
            track: `${(i % 12) + 1}/12`,
            date: String(2020 + (i % 5)),
          })
        );
      }
      await Promise.all(promises);
    });

    afterAll(async () => {
      if (testDir) {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('scans 100 files in reasonable time', async () => {
      const start = performance.now();

      const adapter = new DirectoryAdapter({ path: testDir });
      const tracks = await adapter.getItems();

      const elapsed = performance.now() - start;

      expect(tracks).toHaveLength(100);
      // Generous threshold so CI noise doesn't flap the test. The point is to
      // catch O(n²) regressions, not micro-benchmark.
      expect(elapsed).toBeLessThan(10000);
    });
  });
});

/**
 * Generate a minimal 0.1s silent MP3 with the given tag set.
 */
async function generateTestAudio(
  filePath: string,
  metadata: Record<string, string>
): Promise<void> {
  const metadataArgs = Object.entries(metadata)
    .map(([key, value]) => ['-metadata', `${key}=${value}`])
    .flat();

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
    throw new Error(`ffmpeg failed with status ${result.status}`);
  }
}
