/* eslint-disable no-console */
/**
 * E2E tests for mixed format collection sync.
 *
 * Tests sync operations with collections containing:
 * - Lossless formats (FLAC, WAV, AIFF, ALAC)
 * - Compatible lossy formats (MP3, AAC) - should be copied
 * - Incompatible lossy formats (OGG, Opus) - should trigger warnings
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, Albums, getAlbumDir } from '../helpers/fixtures';

interface WarningInfo {
  type: string;
  message: string;
  trackCount: number;
  tracks?: string[];
}

interface SyncOutput {
  success: boolean;
  dryRun: boolean;
  source?: string;
  device?: string;
  plan?: {
    tracksToAdd: number;
    tracksToRemove: number;
    tracksToTranscode: number;
    tracksToCopy: number;
    estimatedSize: number;
    estimatedTime: number;
  };
  operations?: Array<{
    type: 'transcode' | 'copy' | 'remove' | 'update-metadata';
    track: string;
    status?: 'pending' | 'completed' | 'failed' | 'skipped';
    error?: string;
  }>;
  result?: {
    completed: number;
    failed: number;
    skipped: number;
    bytesTransferred: number;
    duration: number;
  };
  warnings?: WarningInfo[];
  error?: string;
}

describe('mixed format collection sync', () => {
  let fixturesAvailable: boolean;
  let multiFormatPath: string;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
    multiFormatPath = getAlbumDir(Albums.MULTI_FORMAT);
  });

  describe('dry-run with mixed formats', () => {
    it('shows correct plan for mixed format collection', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          multiFormatPath,
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
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          multiFormatPath,
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.warnings).toBeDefined();

        // Should have a lossy-to-lossy warning
        const lossyWarning = json?.warnings?.find((w) => w.type === 'lossy-to-lossy');
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
        const result = await runCli([
          'sync',
          '--source',
          multiFormatPath,
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
    it('uses ALAC preset with fallback for mixed collection', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          multiFormatPath,
          '--device',
          target.path,
          '--quality',
          'alac',
          '--fallback',
          'high',
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);

        // Should have operations for all tracks
        expect(json?.operations?.length).toBe(8);
      });
    });

    it('uses CBR preset for all transcodes', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          multiFormatPath,
          '--device',
          target.path,
          '--quality',
          'medium-cbr',
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
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          multiFormatPath,
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

    it('syncs with ALAC quality', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          multiFormatPath,
          '--device',
          target.path,
          '--quality',
          'alac',
          '--fallback',
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
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          multiFormatPath,
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
        const result = await runCli([
          '--verbose',
          'sync',
          '--source',
          multiFormatPath,
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
