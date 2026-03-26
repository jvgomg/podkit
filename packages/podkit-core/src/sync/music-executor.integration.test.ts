/**
 * Integration tests for the sync executor
 *
 * These tests require:
 * - gpod-tool (for creating test iPod environments)
 * - FFmpeg (for transcoding operations)
 * - libgpod-node native bindings (for iPod database operations)
 *
 * ## Test Coverage
 *
 * 1. Full sync flow with real iPod database
 * 2. Copy operation with real files
 * 3. Transcode operation with real FFmpeg
 * 4. Remove operation with real database
 * 5. Progress reporting during real operations
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import {
  MusicExecutor,
  executePlan,
  type ExecutorProgress,
  type ExecutorDependencies,
} from './music-executor.js';
import { FFmpegTranscoder } from '../transcode/ffmpeg.js';
import { IpodDatabase } from '../ipod/database.js';
import { IpodDeviceAdapter } from '../device/ipod-adapter.js';
import { getDeviceCapabilities } from '../ipod/capabilities.js';
import type { CollectionTrack } from '../adapters/interface.js';
import type { SyncPlan } from './types.js';
import { requireAllDeps } from '../__tests__/helpers/test-setup.js';

// Fail early if dependencies are not available
requireAllDeps();

// =============================================================================
// Test Helpers
// =============================================================================

let testDir: string;
let transcoder: FFmpegTranscoder;

/**
 * Generate a simple test audio file (WAV format)
 */
async function generateTestAudio(path: string, durationSec: number = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${durationSec}`,
      '-c:a',
      'pcm_s16le',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-metadata',
      'title=Test Track',
      '-metadata',
      'artist=Test Artist',
      '-metadata',
      'album=Test Album',
      '-y',
      path,
    ]);

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg failed: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Generate a simple MP3 test file
 */
async function generateTestMP3(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-metadata',
      'title=MP3 Test Track',
      '-metadata',
      'artist=Test Artist',
      '-metadata',
      'album=Test Album',
      '-y',
      path,
    ]);

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg failed: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

function createCollectionTrack(
  artist: string,
  title: string,
  album: string,
  filePath: string,
  fileType: 'flac' | 'mp3' | 'wav' = 'wav'
): CollectionTrack {
  return {
    id: `${artist}-${title}-${album}`,
    artist,
    title,
    album,
    filePath,
    fileType,
    duration: 1000, // 1 second
  };
}

// =============================================================================
// Integration Tests (require all dependencies)
// =============================================================================

describe('SyncExecutor integration', () => {
  let createTestIpod: typeof import('@podkit/gpod-testing').createTestIpod;

  beforeAll(async () => {
    // Dynamic imports for dependencies
    const gpodTesting = await import('@podkit/gpod-testing');

    createTestIpod = gpodTesting.createTestIpod;

    // Create test directory and transcoder
    testDir = await mkdtemp(join(tmpdir(), 'podkit-executor-test-'));
    transcoder = new FFmpegTranscoder();
  });

  afterAll(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('copy operation', () => {
    it('copies an MP3 file to iPod', async () => {
      // Create test iPod
      const testIpod = await createTestIpod();

      try {
        // Generate test MP3
        const mp3Path = join(testDir, 'test-copy.mp3');
        await generateTestMP3(mp3Path);

        // Open database using IpodDatabase
        const db = await IpodDatabase.open(testIpod.path);

        try {
          const deps: ExecutorDependencies = {
            device: new IpodDeviceAdapter(db, getDeviceCapabilities('classic_3')),
            transcoder,
          };

          const plan: SyncPlan = {
            operations: [
              {
                type: 'add-direct-copy',
                source: createCollectionTrack(
                  'Test Artist',
                  'Test Song',
                  'Test Album',
                  mp3Path,
                  'mp3'
                ),
              },
            ],
            estimatedTime: 1,
            estimatedSize: 50000,
            warnings: [],
          };

          const result = await executePlan(plan, deps);

          expect(result.completed).toBe(1);
          expect(result.failed).toBe(0);
          expect(result.errors).toHaveLength(0);

          // Verify track is in database
          expect(db.trackCount).toBe(1);

          // Verify track metadata
          const tracks = db.getTracks();
          expect(tracks).toHaveLength(1);
          expect(tracks[0]!.title).toBe('Test Song');
          expect(tracks[0]!.artist).toBe('Test Artist');
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });
  });

  describe('transcode operation', () => {
    it('transcodes a WAV file and adds to iPod', async () => {
      const testIpod = await createTestIpod();

      try {
        // Generate test WAV
        const wavPath = join(testDir, 'test-transcode.wav');
        await generateTestAudio(wavPath);

        const db = await IpodDatabase.open(testIpod.path);

        try {
          const deps: ExecutorDependencies = {
            device: new IpodDeviceAdapter(db, getDeviceCapabilities('classic_3')),
            transcoder,
          };

          const plan: SyncPlan = {
            operations: [
              {
                type: 'add-transcode',
                source: createCollectionTrack(
                  'Transcode Artist',
                  'Transcode Song',
                  'Transcode Album',
                  wavPath,
                  'wav'
                ),
                preset: { name: 'high' },
              },
            ],
            estimatedTime: 5,
            estimatedSize: 100000,
            warnings: [],
          };

          const result = await executePlan(plan, deps);

          expect(result.completed).toBe(1);
          expect(result.failed).toBe(0);

          // Verify track is in database
          const tracks = db.getTracks();
          expect(tracks).toHaveLength(1);
          expect(tracks[0]!.title).toBe('Transcode Song');
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });
  });

  describe('remove operation', () => {
    it('removes a track from iPod database', async () => {
      const testIpod = await createTestIpod();

      try {
        // Generate and add a test MP3 first
        const mp3Path = join(testDir, 'test-remove.mp3');
        await generateTestMP3(mp3Path);

        const db = await IpodDatabase.open(testIpod.path);

        try {
          // First, add a track manually using IpodDatabase API
          const track = db.addTrack({
            title: 'Track To Remove',
            artist: 'Remove Artist',
            album: 'Remove Album',
          });
          track.copyFile(mp3Path);
          await db.save();

          // Verify it was added
          expect(db.trackCount).toBe(1);
          const tracks = db.getTracks();
          const savedTrack = tracks[0]!;

          // Now remove it via executor
          const deps: ExecutorDependencies = {
            device: new IpodDeviceAdapter(db, getDeviceCapabilities('classic_3')),
            transcoder,
          };

          const plan: SyncPlan = {
            operations: [
              {
                type: 'remove',
                // Use the actual IpodTrack from IpodDatabase - it has the remove() method
                track: savedTrack,
              },
            ],
            estimatedTime: 0.1,
            estimatedSize: 0,
            warnings: [],
          };

          const result = await executePlan(plan, deps);

          expect(result.completed).toBe(1);
          expect(result.failed).toBe(0);

          // Verify track was removed
          expect(db.trackCount).toBe(0);
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });
  });

  describe('mixed operations', () => {
    it('executes multiple operations in sequence', async () => {
      const testIpod = await createTestIpod();

      try {
        // Generate test files
        const mp3Path1 = join(testDir, 'test-multi-1.mp3');
        const mp3Path2 = join(testDir, 'test-multi-2.mp3');
        const wavPath = join(testDir, 'test-multi.wav');

        await Promise.all([
          generateTestMP3(mp3Path1),
          generateTestMP3(mp3Path2),
          generateTestAudio(wavPath),
        ]);

        const db = await IpodDatabase.open(testIpod.path);

        try {
          const deps: ExecutorDependencies = {
            device: new IpodDeviceAdapter(db, getDeviceCapabilities('classic_3')),
            transcoder,
          };

          const plan: SyncPlan = {
            operations: [
              {
                type: 'add-direct-copy',
                source: createCollectionTrack('Artist 1', 'Song 1', 'Album', mp3Path1, 'mp3'),
              },
              {
                type: 'add-direct-copy',
                source: createCollectionTrack('Artist 2', 'Song 2', 'Album', mp3Path2, 'mp3'),
              },
              {
                type: 'add-transcode',
                source: createCollectionTrack('Artist 3', 'Song 3', 'Album', wavPath, 'wav'),
                preset: { name: 'medium' },
              },
            ],
            estimatedTime: 10,
            estimatedSize: 500000,
            warnings: [],
          };

          const result = await executePlan(plan, deps);

          expect(result.completed).toBe(3);
          expect(result.failed).toBe(0);
          expect(db.trackCount).toBe(3);
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });
  });

  describe('progress reporting', () => {
    it('emits progress for each operation', async () => {
      const testIpod = await createTestIpod();

      try {
        const mp3Path = join(testDir, 'test-progress.mp3');
        await generateTestMP3(mp3Path);

        const db = await IpodDatabase.open(testIpod.path);

        try {
          const deps: ExecutorDependencies = {
            device: new IpodDeviceAdapter(db, getDeviceCapabilities('classic_3')),
            transcoder,
          };

          const plan: SyncPlan = {
            operations: [
              {
                type: 'add-direct-copy',
                source: createCollectionTrack(
                  'Progress Artist',
                  'Progress Song',
                  'Album',
                  mp3Path,
                  'mp3'
                ),
              },
            ],
            estimatedTime: 1,
            estimatedSize: 50000,
            warnings: [],
          };

          const executor = new MusicExecutor(deps);
          const progress: ExecutorProgress[] = [];

          for await (const p of executor.execute(plan)) {
            progress.push(p);
          }

          // Should have copying, updating-db, and complete phases
          // (preparing phase was removed in the pipelined architecture)
          const phases = progress.map((p) => p.phase);
          expect(phases).toContain('copying');
          expect(phases).toContain('updating-db');
          expect(phases).toContain('complete');
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });
  });

  describe('dry-run mode', () => {
    it('does not modify database in dry-run mode', async () => {
      const testIpod = await createTestIpod();

      try {
        const mp3Path = join(testDir, 'test-dryrun.mp3');
        await generateTestMP3(mp3Path);

        const db = await IpodDatabase.open(testIpod.path);

        try {
          const initialCount = db.trackCount;

          const deps: ExecutorDependencies = {
            device: new IpodDeviceAdapter(db, getDeviceCapabilities('classic_3')),
            transcoder,
          };

          const plan: SyncPlan = {
            operations: [
              {
                type: 'add-direct-copy',
                source: createCollectionTrack(
                  'DryRun Artist',
                  'DryRun Song',
                  'Album',
                  mp3Path,
                  'mp3'
                ),
              },
            ],
            estimatedTime: 1,
            estimatedSize: 50000,
            warnings: [],
          };

          const result = await executePlan(plan, deps, { dryRun: true });

          expect(result.skipped).toBe(1);
          expect(result.completed).toBe(0);

          // Track count should be unchanged
          expect(db.trackCount).toBe(initialCount);
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });
  });
});
