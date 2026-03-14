/**
 * E2E tests for the `podkit sync` command.
 *
 * Tests sync operations including dry-run, actual sync, and error handling.
 */

import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, runCliJson, createTempConfig } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, Albums, getAlbumDir } from '../helpers/fixtures';
import type { SyncOutput } from 'podkit/types';

// Track temp config paths for cleanup
let tempConfigPaths: string[] = [];

describe('podkit sync', () => {
  let fixturesAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
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

  describe('validation', () => {
    it('fails when no collections configured', async () => {
      await withTarget(async (target) => {
        // Use non-existent config to ensure we don't pick up user's config
        const result = await runCli([
          '--config',
          '/nonexistent/config.toml',
          'sync',
          '--device',
          target.path,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('No collections configured');
      });
    });

    it('fails when no device specified', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
      const configPath = await createTempConfig(sourcePath);
      tempConfigPaths.push(configPath);

      const result = await runCli(['--config', configPath, 'sync']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No devices configured');
    });

    it('fails when collection path does not exist', async () => {
      await withTarget(async (target) => {
        const configPath = await createTempConfig('/nonexistent/path');
        tempConfigPaths.push(configPath);

        const result = await runCli(['--config', configPath, 'sync', '--device', target.path]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('not found');
      });
    });

    it('outputs validation errors in JSON', async () => {
      const { result, json } = await runCliJson<SyncOutput>([
        '--config',
        '/nonexistent/config.toml',
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
        const configPath = await createTempConfig(sourcePath);
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
        const configPath = await createTempConfig(sourcePath);
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
        expect(json?.plan?.tracksToAdd).toBe(3); // 3 tracks in goldberg-selections
        expect(json?.operations).toHaveLength(3);
      });
    });

    it('shows already synced message when no changes needed', async () => {
      await withTarget(async (target) => {
        // Create an empty temp directory as source
        const emptySource = await mkdtemp(join(tmpdir(), 'empty-source-'));
        const configPath = await createTempConfig(emptySource);
        tempConfigPaths.push(configPath);

        try {
          const result = await runCli([
            '--config',
            configPath,
            'sync',
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
        const configPath = await createTempConfig(sourcePath);
        tempConfigPaths.push(configPath);

        const result = await runCli(['--config', configPath, 'sync', '--device', target.path]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('sync complete');

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
        const configPath = await createTempConfig(sourcePath);
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
        const configPath = await createTempConfig(sourcePath);
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
        const configPath = await createTempConfig(sourcePath);
        tempConfigPaths.push(configPath);

        // First sync
        const result1 = await runCli(['--config', configPath, 'sync', '--device', target.path]);
        expect(result1.exitCode).toBe(0);

        // Second sync should skip all tracks (already synced)
        const { result: result2, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result2.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        // No new tracks completed since all are already synced
        expect(json?.result?.completed).toBe(0);
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
        const configPath = await createTempConfig(sourcePath);
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--config',
          configPath,
          'sync',
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

  describe('eject behavior', () => {
    it('shows eject tip after successful sync', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const configPath = await createTempConfig(sourcePath);
        tempConfigPaths.push(configPath);

        const result = await runCli(['--config', configPath, 'sync', '--device', target.path]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('podkit eject');
        expect(result.stdout).toContain('--eject');
      });
    }, 60000);

    it('does NOT show eject tip on dry-run', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const configPath = await createTempConfig(sourcePath);
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
        // Should NOT show the eject tip on dry-run
        expect(result.stdout).not.toContain('podkit eject');
      });
    });

    it('attempts to eject with --eject flag', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const configPath = await createTempConfig(sourcePath);
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--eject',
        ]);

        expect(result.exitCode).toBe(0);
        // Should show ejecting message (even if it fails on dummy iPod)
        expect(result.stdout).toContain('Ejecting');
        // Should NOT show the tip since --eject was used
        expect(result.stdout).not.toContain("Run 'podkit eject'");
      });
    }, 60000);

    it('includes eject status in JSON output with --eject', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
        const configPath = await createTempConfig(sourcePath);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--eject',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.eject).toBeDefined();
        expect(json?.eject?.requested).toBe(true);
        // Eject may fail on dummy iPod, but the field should exist
      });
    }, 60000);
  });
});
