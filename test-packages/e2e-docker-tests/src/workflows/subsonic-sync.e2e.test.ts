/**
 * E2E tests for Subsonic sync workflow
 *
 * These tests verify the complete workflow: sync from Subsonic server to iPod via CLI.
 * They require Docker to run Navidrome and will skip gracefully if Docker is not available.
 *
 * To run these tests with Docker:
 * 1. Ensure Docker is running
 * 2. Run: SUBSONIC_E2E=1 bun test src/workflows/subsonic-sync.e2e.test.ts
 *
 * Without SUBSONIC_E2E=1, tests will skip to avoid slow Docker operations in normal test runs.
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runCli, runCliJson, cleanupTempConfig, ensureFixturesExist } from '@podkit/e2e-shared';
import { withTarget } from '@podkit/e2e-host-tests/targets';
import { SubsonicTestSource, isDockerAvailable } from '../subsonic-source.js';
import { createSubsonicConfig } from '../helpers/subsonic-config.js';

import type { SyncOutput } from 'podkit/types';

ensureFixturesExist('goldberg-selections');

// =============================================================================
// Test Setup
// =============================================================================

let source: SubsonicTestSource | null = null;

beforeAll(async () => {
  // Docker is mandatory for this entire package. Fail loudly if it's missing
  // instead of silently passing every test — the old SUBSONIC_E2E gate would
  // skip the suite quietly, which hid real coverage gaps.
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker is not available — required for @podkit/e2e-docker-tests.');
  }

  source = new SubsonicTestSource();
  console.log('Starting Navidrome container...');
  await source.setup();
  console.log(`Navidrome ready at ${source.serverUrl}`);
}, 120000); // 2 minute timeout for Docker setup

afterAll(async () => {
  if (source) {
    console.log('Stopping Navidrome container...');
    await source.teardown();
    source = null;
  }
});

// =============================================================================
// Fresh Sync Tests
// =============================================================================

describe('Subsonic sync workflow', () => {
  describe('fresh sync', () => {
    it('syncs all tracks from Subsonic to empty iPod', async () => {
      await withTarget(async (target) => {
        // Verify iPod is initially empty
        const initialCount = await target.getTrackCount();
        expect(initialCount).toBe(0);

        // Create Subsonic config
        const configPath = await createSubsonicConfig(source!.serverUrl, source!.username);

        try {
          // Run sync with password in environment
          const { result, json } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--json'],
            {
              env: source!.getEnv(),
              timeout: 180000, // 3 min for download + transcode
            }
          );

          expect(result.exitCode).toBe(0);
          expect(json?.success).toBe(true);
          // Should have synced at least the 6 FLAC files from test fixtures
          expect(json?.result?.completed).toBeGreaterThanOrEqual(6);

          // Verify tracks were added to iPod
          const trackCount = await target.getTrackCount();
          expect(trackCount).toBeGreaterThanOrEqual(6);

          // Verify database integrity
          const verify = await target.verify();
          expect(verify.valid).toBe(true);
          expect(verify.trackCount).toBeGreaterThanOrEqual(6);

          console.log(`Synced ${json?.result?.completed} tracks from Subsonic`);
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 300000); // 5 min timeout for full workflow
  });

  describe('dry-run', () => {
    it('shows planned operations without actual transfer', async () => {
      await withTarget(async (target) => {
        // Verify iPod is empty
        const initialCount = await target.getTrackCount();
        expect(initialCount).toBe(0);

        // Create Subsonic config
        const configPath = await createSubsonicConfig(source!.serverUrl, source!.username);

        try {
          // Run dry-run
          const result = await runCli(
            ['--config', configPath, 'sync', '--device', target.path, '--dry-run'],
            {
              env: source!.getEnv(),
              timeout: 60000,
            }
          );

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('Dry Run');
          // Should show tracks to add (at least 6 from test fixtures)
          expect(result.stdout).toMatch(/Tracks to add:\s*\d+/);

          // iPod should still be empty after dry-run
          const finalCount = await target.getTrackCount();
          expect(finalCount).toBe(0);
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 120000);

    it('dry-run JSON output shows plan details', async () => {
      await withTarget(async (target) => {
        const configPath = await createSubsonicConfig(source!.serverUrl, source!.username);

        try {
          const { result, json } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--dry-run', '--json'],
            {
              env: source!.getEnv(),
              timeout: 60000,
            }
          );

          expect(result.exitCode).toBe(0);
          expect(json?.success).toBe(true);
          expect(json?.dryRun).toBe(true);
          expect(json?.plan).toBeDefined();
          expect(json?.plan?.tracksToAdd).toBeGreaterThanOrEqual(6);
          // FLAC files should be transcoded
          expect(json?.plan?.tracksToTranscode).toBeGreaterThanOrEqual(6);
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 120000);
  });

  describe('incremental sync', () => {
    it('second sync shows no changes needed', async () => {
      await withTarget(async (target) => {
        const configPath = await createSubsonicConfig(source!.serverUrl, source!.username);

        try {
          // First sync
          const firstSync = await runCli(
            ['--config', configPath, 'sync', '--device', target.path],
            {
              env: source!.getEnv(),
              timeout: 180000,
            }
          );
          expect(firstSync.exitCode).toBe(0);

          const trackCountAfterFirst = await target.getTrackCount();
          expect(trackCountAfterFirst).toBeGreaterThan(0);
          console.log(`First sync: ${trackCountAfterFirst} tracks`);

          // Second sync - should find nothing to do
          const secondSync = await runCli(
            ['--config', configPath, 'sync', '--device', target.path],
            {
              env: source!.getEnv(),
              timeout: 60000,
            }
          );

          expect(secondSync.exitCode).toBe(0);
          expect(secondSync.stdout).toContain('already in sync');

          // Track count should be unchanged
          const trackCountAfterSecond = await target.getTrackCount();
          expect(trackCountAfterSecond).toBe(trackCountAfterFirst);
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 300000);
  });

  describe('transcoding', () => {
    it('transcodes FLAC files from Subsonic to iPod-compatible format', async () => {
      await withTarget(async (target) => {
        const configPath = await createSubsonicConfig(source!.serverUrl, source!.username);

        try {
          // Sync with JSON output to see transcoding details
          const { result, json } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--json'],
            {
              env: source!.getEnv(),
              timeout: 180000,
            }
          );

          expect(result.exitCode).toBe(0);
          expect(json?.success).toBe(true);

          // Verify tracks were synced
          const trackCount = await target.getTrackCount();
          expect(trackCount).toBeGreaterThan(0);

          // Verify database is valid (implicitly checks files exist and are readable)
          const verify = await target.verify();
          expect(verify.valid).toBe(true);

          console.log(`Transcoded and synced ${json?.result?.completed} tracks`);
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 300000);
  });
});

// =============================================================================
// Infrastructure Tests (no Docker required)
// =============================================================================

describe('Subsonic test infrastructure', () => {
  it('can check Docker availability', async () => {
    const available = await isDockerAvailable();
    // Just verify the check runs without error
    expect(typeof available).toBe('boolean');
  });

  it('source factory creates SubsonicTestSource', () => {
    const testSource = new SubsonicTestSource();
    expect(testSource.name).toBe('subsonic');
    expect(testSource.requiresDocker).toBe(true);
  });

  it('SubsonicTestSource generates correct URLs', () => {
    const testSource = new SubsonicTestSource(4533);
    expect(testSource.serverUrl).toBe('http://localhost:4533');
    expect(testSource.sourceUrl).toBe('subsonic://admin@localhost:4533');
    expect(testSource.username).toBe('admin');
  });

  it('SubsonicTestSource provides password via getEnv()', () => {
    const testSource = new SubsonicTestSource();
    const env = testSource.getEnv();
    expect(env.SUBSONIC_PASSWORD).toBe('testpass');
  });
});
