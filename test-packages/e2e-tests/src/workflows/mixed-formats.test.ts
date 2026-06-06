/**
 * E2E tests for mixed format collection sync.
 *
 * Tests sync operations with collections containing:
 * - Lossless formats (FLAC, WAV, AIFF, ALAC)
 * - Compatible lossy formats (MP3, AAC) - should be copied
 * - Incompatible lossy formats (OGG, Opus) - should trigger warnings
 */

import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureFixturesExist } from '@podkit/e2e-shared';
import { runCli, runCliJson, createTempConfig } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { Albums, getAlbumDir } from '../helpers/fixtures';
import type { SyncOutput } from 'podkit/types';

ensureFixturesExist('multi-format');

// Track temp config paths for cleanup
let tempConfigPaths: string[] = [];

describe('mixed format collection sync', () => {
  let multiFormatPath: string;

  beforeAll(() => {
    multiFormatPath = getAlbumDir(Albums.MULTI_FORMAT);
  });

  afterEach(async () => {
    // Clean up temp config files
    for (const configPath of tempConfigPaths) {
      try {
        const dir = join(configPath, '..');
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    tempConfigPaths = [];
  });

  describe('dry-run with mixed formats', () => {
    it('shows correct plan for mixed format collection', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig(multiFormatPath);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.dryRun).toBe(true);
        expect(json?.plan).toBeDefined();

        // 8 tracks total in multi-format directory
        expect(json?.plan?.tracksToAdd).toBe(8);

        // Compatible lossy (MP3, AAC) → direct copy
        expect(json?.plan?.tracksToCopy).toBe(2);

        // Lossless (WAV, AIFF, FLAC, ALAC) + incompatible lossy (OGG, Opus) → transcode
        expect(json?.plan?.tracksToTranscode).toBe(6);
      });
    });

    it('generates lossy-to-lossy warning for OGG and Opus files', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig(multiFormatPath);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.warnings).toBeDefined();

        // Should have a lossy-to-lossy warning
        const lossyWarning = json?.warnings?.find(
          (w) => w.phase === 'plan' && w.type === 'lossy-to-lossy'
        );
        expect(lossyWarning).toBeDefined();
        expect(lossyWarning?.trackCount).toBe(2); // OGG and Opus
      });
    });

    it('shows warning in human-readable output', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig(multiFormatPath);
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
        // Warning message should appear in output
        expect(result.stdout).toContain('lossy-to-lossy');
      });
    });
  });

  describe('quality presets', () => {
    it('uses max preset for mixed collection', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig(multiFormatPath);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--audio-quality',
          'max',
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);

        // Should have operations for all tracks
        expect(json?.operations?.length).toBe(8);
      });
    });

    it('uses CBR encoding for all transcodes', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig(multiFormatPath);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'medium',
          '--encoding',
          'cbr',
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
      });
    });
  });

  describe('actual sync with mixed formats', () => {
    it('syncs mixed format collection successfully', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig(multiFormatPath);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.dryRun).toBe(false);
        expect(json?.result).toBeDefined();
        expect(json?.result?.completed).toBe(8);
        expect(json?.result?.failed).toBe(0);

        // Verify all tracks were added
        const trackCount = await target.getTrackCount();
        expect(trackCount).toBe(8);

        // Verify database integrity
        const verifyResult = await target.verify();
        expect(verifyResult.valid).toBe(true);
      });
    }, 120000); // 2 min timeout for transcoding

    it('syncs with max quality', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig(multiFormatPath);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--audio-quality',
          'max',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.result?.completed).toBe(8);
      });
    }, 120000);

    it('syncs with low quality for smaller files', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig(multiFormatPath);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.result?.completed).toBe(8);
      });
    }, 120000);
  });

  describe('verbose output', () => {
    it('shows detailed warning info with --verbose', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig(multiFormatPath);
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--verbose',
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
        // Verbose should show BOTH lossy-to-lossy formats in the warning.
        // The fixture has one OGG and one Opus track; an OR-assertion would
        // silently pass if either format went missing from the verbose output.
        // Both strings appear in at least two places: the lossy-to-lossy
        // warning message lists "OGG, Opus" explicitly, and the operations
        // list (always shown for <20 ops) renders track titles like
        // "OGG Test Track" / "Opus Test Track".
        const lowerStdout = result.stdout.toLowerCase();
        expect(lowerStdout).toContain('ogg');
        expect(lowerStdout).toContain('opus');
      });
    });
  });
});
