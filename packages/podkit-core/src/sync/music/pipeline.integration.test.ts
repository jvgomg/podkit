/**
 * Integration tests for the music sync pipeline
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
import { requireFFmpeg, requireGpodTool } from '@podkit/test-fixtures';
import { requireLibgpodNode } from '@podkit/libgpod-node';
import {
  MusicPipeline,
  executeMusicPlan,
  type ExecutorProgress,
  type ExecutorDependencies,
} from './pipeline.js';
import { createMusicHandler } from './handler.js';
import { createSyncExecutor } from '../engine/executor.js';
import { FFmpegTranscoder } from '../../transcode/ffmpeg.js';
import { IpodDatabase } from '../../ipod/database.js';
import { IpodDeviceAdapter } from '../../device/ipod-adapter.js';
import { GENERATIONS, type IpodGenerationId } from '@podkit/devices-ipod';
import { identifyCapabilities } from '../../device/resolve-capabilities.js';
import type { DeviceCapabilities } from '@podkit/device-types';
import type { CollectionTrack } from '../../adapters/interface.js';
import type { SyncPlan } from '../engine/types.js';
import type { MusicOperation } from './types.js';

requireFFmpeg();
requireGpodTool();
requireLibgpodNode();

/** Test-local helper: build DeviceCapabilities from an IpodGenerationId. */
function capsForGeneration(id: IpodGenerationId): DeviceCapabilities {
  const gen = GENERATIONS[id];
  return identifyCapabilities({
    displayName: gen.displayName,
    generationId: id,
    checksumType: gen.checksumType,
    source: 'usb',
  });
}

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
            device: new IpodDeviceAdapter(db, capsForGeneration('classic_7g')),
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

          const result = await executeMusicPlan(plan, deps);

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
            device: new IpodDeviceAdapter(db, capsForGeneration('classic_7g')),
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

          const result = await executeMusicPlan(plan, deps);

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
            device: new IpodDeviceAdapter(db, capsForGeneration('classic_7g')),
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

          const result = await executeMusicPlan(plan, deps);

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
            device: new IpodDeviceAdapter(db, capsForGeneration('classic_7g')),
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

          const result = await executeMusicPlan(plan, deps);

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
            device: new IpodDeviceAdapter(db, capsForGeneration('classic_7g')),
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

          const executor = new MusicPipeline(deps);
          const progress: ExecutorProgress[] = [];

          for await (const p of executor.execute(plan)) {
            progress.push(p);
          }

          // Should have copying and complete phases. 'updating-db' was
          // removed in ADR-019 — save coordination moved to the
          // engine, no separate progress event marks it on the pipeline
          // side anymore.
          const phases = progress.map((p) => p.phase);
          expect(phases).toContain('copying');
          expect(phases).toContain('complete');
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });
  });

  describe('engine save coordination', () => {
    it('routes save through engine: exactly one save per music sync end-to-end', async () => {
      // Pin the ADR-019 contract: music save coordination lives in the
      // engine SyncExecutor wrapping MusicPipeline. With saveInterval=0
      // (no checkpoint saves) and pipeline-internal saves removed, the
      // only save that fires per run is the engine's final save.
      const testIpod = await createTestIpod();

      try {
        const mp3Path = join(testDir, 'test-engine-save.mp3');
        await generateTestMP3(mp3Path);

        const db = await IpodDatabase.open(testIpod.path);

        try {
          const adapter = new IpodDeviceAdapter(db, capsForGeneration('classic_7g'));
          const realSave = adapter.save.bind(adapter);
          let saveCount = 0;
          adapter.save = async () => {
            saveCount++;
            await realSave();
          };

          const handler = createMusicHandler({ quality: 'high', transcoder });
          const executor = createSyncExecutor(handler);

          const plan: SyncPlan<MusicOperation> = {
            operations: [
              {
                type: 'add-direct-copy',
                source: createCollectionTrack(
                  'Save Test Artist',
                  'Save Test Song',
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

          // saveInterval=0 disables checkpoint saves; final save is the
          // only emitter.
          for await (const _ of executor.execute(plan, {
            device: adapter,
            saveInterval: 0,
          })) {
            // drain
          }

          expect(saveCount).toBe(1);
          // Track was committed.
          expect(db.trackCount).toBe(1);
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });

    it('engine fires checkpoint save every saveInterval completed operations', async () => {
      // Pin the ADR-019 contract: with the pipeline's per-track checkpoint
      // removed, all checkpoint cadence comes from the engine. 5 tracks at
      // saveInterval=2 → checkpoint at completed=2 and completed=4 (2 saves)
      // + 1 final save = 3 total.
      const testIpod = await createTestIpod();

      try {
        const mp3Paths = await Promise.all(
          [0, 1, 2, 3, 4].map(async (i) => {
            const p = join(testDir, `test-checkpoint-${i}.mp3`);
            await generateTestMP3(p);
            return p;
          })
        );

        const db = await IpodDatabase.open(testIpod.path);

        try {
          const adapter = new IpodDeviceAdapter(db, capsForGeneration('classic_7g'));
          const realSave = adapter.save.bind(adapter);
          let saveCount = 0;
          adapter.save = async () => {
            saveCount++;
            await realSave();
          };

          const handler = createMusicHandler({ quality: 'high', transcoder });
          const executor = createSyncExecutor(handler);

          const plan: SyncPlan<MusicOperation> = {
            operations: mp3Paths.map((path, i) => ({
              type: 'add-direct-copy',
              source: createCollectionTrack(
                'Checkpoint Artist',
                `Checkpoint Song ${i}`,
                'Album',
                path,
                'mp3'
              ),
            })),
            estimatedTime: 5,
            estimatedSize: 250000,
            warnings: [],
          };

          for await (const _ of executor.execute(plan, {
            device: adapter,
            saveInterval: 2,
          })) {
            // drain
          }

          // 2 checkpoints (at completed=2, completed=4) + 1 final save
          expect(saveCount).toBe(3);
          expect(db.trackCount).toBe(5);
        } finally {
          db.close();
        }
      } finally {
        await testIpod.cleanup();
      }
    });

    it('routes abort through engine: result.aborted=true on signal abort', async () => {
      // Pins the ADR-019 Phase 4b contract: when music sync is aborted, the
      // pipeline throws AbortError after draining queues and the engine sets
      // result.aborted=true. Pre-Phase-4b, the engine caught the throw as a
      // synthetic per-op failure (result.aborted=false, result.failed=1) — a
      // silent lie covered up by music-presenter.ts reading signal directly.
      const testIpod = await createTestIpod();

      try {
        const mp3Paths = await Promise.all(
          [0, 1, 2, 3, 4].map(async (i) => {
            const p = join(testDir, `test-abort-${i}.mp3`);
            await generateTestMP3(p);
            return p;
          })
        );

        const db = await IpodDatabase.open(testIpod.path);

        try {
          const adapter = new IpodDeviceAdapter(db, capsForGeneration('classic_7g'));
          const realSave = adapter.save.bind(adapter);
          let saveCount = 0;
          adapter.save = async () => {
            saveCount++;
            await realSave();
          };

          const handler = createMusicHandler({ quality: 'high', transcoder });
          const executor = createSyncExecutor(handler);
          const controller = new AbortController();

          const plan: SyncPlan<MusicOperation> = {
            operations: mp3Paths.map((path, i) => ({
              type: 'add-direct-copy',
              source: createCollectionTrack(
                'Abort Artist',
                `Abort Song ${i}`,
                'Album',
                path,
                'mp3'
              ),
            })),
            estimatedTime: 5,
            estimatedSize: 250000,
            warnings: [],
          };

          // Pre-abort guarantees the pipeline observes signal.aborted on first
          // stage entry, throws AbortError after draining (empty) queues, and
          // never completes any track. No race with sync duration.
          controller.abort();

          const generator = executor.execute(plan, {
            device: adapter,
            signal: controller.signal,
          });
          let result;
          for (;;) {
            const next = await generator.next();
            if (next.done) {
              result = next.value;
              break;
            }
          }

          expect(result.aborted).toBe(true);
          expect(result.failed).toBe(0);
          expect(result.errors).toHaveLength(0);
          // Final save skipped on abort; no tracks completed → no checkpoint
          // saves. saveCount = 0.
          expect(saveCount).toBe(0);
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
            device: new IpodDeviceAdapter(db, capsForGeneration('classic_7g')),
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

          const result = await executeMusicPlan(plan, deps, { dryRun: true });

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
