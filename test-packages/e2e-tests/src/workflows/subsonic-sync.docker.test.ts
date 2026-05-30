/**
 * E2E tests for Subsonic sync workflow
 *
 * These tests verify the complete workflow: sync from Subsonic server to iPod via CLI.
 * They require Docker to run Navidrome. The suite throws on module-load if
 * Docker is unavailable, so it shows up as a focused failure rather than a
 * silent skip.
 *
 * To run:
 *   bun run test:e2e:docker
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { runCli, runCliJson, cleanupTempConfig, ensureFixturesExist } from '@podkit/e2e-shared';
import { withTarget } from '../targets/index.js';
import { SubsonicTestSource, isDockerAvailable } from '../sources/subsonic.js';
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
    throw new Error('Docker is not available — required for @podkit/e2e-tests docker suite.');
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
          // SubsonicTestSource copies @podkit/test-fixtures' full audio tree
          // into Navidrome; that inventory evolves as the matrix grows and
          // Navidrome filters by codec/metadata, so the absolute count can't
          // be pinned here. The relationship "everything Navidrome served
          // survived sync to the iPod" is the real invariant.
          const completed = json!.result!.completed;
          expect(completed).toBeGreaterThan(0);
          const trackCount = await target.getTrackCount();
          expect(trackCount).toBe(completed);

          // Verify database integrity
          const verify = await target.verify();
          expect(verify.valid).toBe(true);
          expect(verify.trackCount).toBe(completed);

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
          // Inventory evolves and is mixed (FLAC + MP3 + AAC + …) so the
          // exact add/transcode split shifts as fixtures change. Assert the
          // plan is non-trivial and any transcodes are a subset of adds.
          const tracksToAdd = json!.plan!.tracksToAdd ?? 0;
          const tracksToTranscode = json!.plan!.tracksToTranscode ?? 0;
          expect(tracksToAdd).toBeGreaterThan(0);
          expect(tracksToTranscode).toBeGreaterThan(0);
          expect(tracksToTranscode).toBeLessThanOrEqual(tracksToAdd);
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 120000);
  });

  // Incremental-sync regression coverage moved to art-matrix.docker.test.ts (scenario A).

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

          // Verify the relationship: every Subsonic-served track survived
          // the sync onto the iPod. Absolute count varies with fixtures.
          const trackCount = await target.getTrackCount();
          expect(trackCount).toBe(json!.result!.completed);
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
