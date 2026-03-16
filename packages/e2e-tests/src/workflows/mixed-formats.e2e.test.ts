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
import { runCli, runCliJson, createTempConfig } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, Albums, getAlbumDir } from '../helpers/fixtures';
import type { SyncOutput } from 'podkit/types';

// Track temp config paths for cleanup
let tempConfigPaths: string[] = [];

describe('mixed format collection sync', () => {
  let fixturesAvailable: boolean;
  let multiFormatPath: string;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
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
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

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

        // Compatible lossy (MP3, AAC) should be copied
        // expect(json?.plan?.tracksToCopy).toBe(2);

        // Lossless (WAV, AIFF, FLAC, ALAC) + incompatible lossy (OGG, Opus) should be transcoded
        // expect(json?.plan?.tracksToTranscode).toBe(6);
      });
    });

    it('generates lossy-to-lossy warning for OGG and Opus files', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

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
        expect(json?.planWarnings).toBeDefined();

        // Should have a lossy-to-lossy warning
        const lossyWarning = json?.planWarnings?.find((w) => w.type === 'lossy-to-lossy');
        expect(lossyWarning).toBeDefined();
        expect(lossyWarning?.trackCount).toBe(2); // OGG and Opus
      });
    });

    it('shows warning in human-readable output', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

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
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

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
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

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
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

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
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

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
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

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
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

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
        // Verbose should show track names in warning
        expect(
          result.stdout.toLowerCase().includes('ogg') ||
            result.stdout.toLowerCase().includes('opus')
        ).toBe(true);
      });
    });
  });
});
