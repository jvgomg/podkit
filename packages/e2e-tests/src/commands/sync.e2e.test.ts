/* eslint-disable no-console */
/**
 * E2E tests for the `podkit sync` command.
 *
 * Tests sync operations including dry-run, actual sync, and error handling.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, Albums, getAlbumDir } from '../helpers/fixtures';

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
  error?: string;
}

describe('podkit sync', () => {
  let fixturesAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
  });

  describe('validation', () => {
    it('fails when no source specified', async () => {
      await withTarget(async (target) => {
        // Use non-existent config to ensure we don't pick up user's source config
        const result = await runCli([
          '--config',
          '/nonexistent/config.toml',
          'sync',
          '--device',
          target.path,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('No source');
      });
    });

    it('fails when no device specified', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      // Use non-existent config to ensure we don't pick up user's device config
      const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
      const result = await runCli([
        '--config',
        '/nonexistent/config.toml',
        'sync',
        '--source',
        sourcePath,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No iPod device specified');
    });

    it('fails when source does not exist', async () => {
      await withTarget(async (target) => {
        const result = await runCli([
          'sync',
          '--source',
          '/nonexistent/path',
          '--device',
          target.path,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('not found');
      });
    });

    it('outputs validation errors in JSON', async () => {
      const { result, json } = await runCliJson<SyncOutput>([
        'sync',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      expect(json?.success).toBe(false);
      expect(json?.error).toBeDefined();
    });
  });

  describe('dry-run', () => {
    it('shows sync plan without making changes', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const result = await runCli([
          'sync',
          '--source',
          sourcePath,
          '--device',
          target.path,
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Dry Run');
        expect(result.stdout).toContain('Tracks to add');

        // Verify no changes were made
        const trackCount = await target.getTrackCount();
        expect(trackCount).toBe(0);
      });
    });

    it('outputs dry-run plan in JSON', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          sourcePath,
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.dryRun).toBe(true);
        expect(json?.plan).toBeDefined();
        expect(json?.plan?.tracksToAdd).toBe(3); // 3 tracks in goldberg-selections
        expect(json?.operations).toHaveLength(3);
      });
    });

    it('shows already synced message when no changes needed', async () => {
      await withTarget(async (target) => {
        // Create an empty temp directory as source
        const { mkdtemp, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const emptySource = await mkdtemp(join(tmpdir(), 'empty-source-'));

        try {
          const result = await runCli([
            'sync',
            '--source',
            emptySource,
            '--device',
            target.path,
            '--dry-run',
          ]);

          expect(result.exitCode).toBe(0);
          // Both source and iPod are empty - should show no tracks to add
          expect(result.stdout).toContain('Tracks to add: 0');
        } finally {
          await rm(emptySource, { recursive: true, force: true });
        }
      });
    });
  });

  describe('actual sync', () => {
    it('syncs tracks to empty iPod', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const result = await runCli([
          'sync',
          '--source',
          sourcePath,
          '--device',
          target.path,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Sync complete');

        // Verify tracks were added
        const trackCount = await target.getTrackCount();
        expect(trackCount).toBe(3);

        // Verify database integrity
        const verifyResult = await target.verify();
        expect(verifyResult.valid).toBe(true);
      });
    }, 60000); // 60s timeout for transcoding

    it('outputs sync result in JSON', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          sourcePath,
          '--device',
          target.path,
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.dryRun).toBe(false);
        expect(json?.result).toBeDefined();
        expect(json?.result?.completed).toBe(3);
        expect(json?.result?.failed).toBe(0);
      });
    }, 60000);

    it('uses specified quality preset', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const { result, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          sourcePath,
          '--device',
          target.path,
          '--quality',
          'low',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
      });
    }, 60000);
  });

  describe('incremental sync', () => {
    it('skips already synced tracks', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);

        // First sync
        const result1 = await runCli([
          'sync',
          '--source',
          sourcePath,
          '--device',
          target.path,
        ]);
        expect(result1.exitCode).toBe(0);

        // Second sync should skip all tracks
        const { result: result2, json } = await runCliJson<SyncOutput>([
          'sync',
          '--source',
          sourcePath,
          '--device',
          target.path,
          '--json',
        ]);

        expect(result2.exitCode).toBe(0);
        expect(json?.plan?.tracksToAdd).toBe(0);
      });
    }, 120000); // 2 min for two syncs
  });

  describe('quiet mode', () => {
    it('suppresses progress output with --quiet', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const result = await runCli([
          'sync',
          '--source',
          sourcePath,
          '--device',
          target.path,
          '--quiet',
        ]);

        expect(result.exitCode).toBe(0);
        // Should have minimal or no output
        expect(result.stdout.length).toBeLessThan(100);
      });
    }, 60000);
  });
});
