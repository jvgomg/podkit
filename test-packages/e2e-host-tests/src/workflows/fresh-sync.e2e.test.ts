/**
 * E2E workflow test: Fresh sync from empty iPod.
 *
 * Tests the complete user journey:
 * 1. Initialize config
 * 2. Sync music to empty iPod
 * 3. Verify synced tracks via iPod database
 *
 * This validates the entire sync pipeline works end-to-end.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { runCli, runCliJson, createTempConfig } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, Albums, getAlbumDir } from '../helpers/fixtures';
import type { SyncOutput } from 'podkit/types';

describe('workflow: fresh sync', () => {
  let fixturesAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
  });

  it('completes full sync workflow: init -> sync -> verify', async () => {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return;
    }

    await withTarget(async (target) => {
      const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);

      // Create a temporary config file with music collection
      const configPath = await createTempConfig(sourcePath);

      try {
        // Step 1: Verify initial empty iPod
        console.log('Step 1: Verify initial empty iPod');
        const initialCount = await target.getTrackCount();
        expect(initialCount).toBe(0);

        // Step 2: Dry-run sync to preview changes
        console.log('Step 2: Dry-run sync');
        const dryRunResult = await runCli([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
        ]);
        expect(dryRunResult.exitCode).toBe(0);
        expect(dryRunResult.stdout).toContain('Dry Run');
        expect(dryRunResult.stdout).toContain('3'); // 3 tracks

        // Step 3: Execute actual sync
        console.log('Step 3: Execute sync');
        const { result: syncResult, json: syncJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(syncResult.exitCode).toBe(0);
        expect(syncJson?.success).toBe(true);
        expect(syncJson?.result?.completed).toBe(3);

        // Step 4: Verify iPod database has the tracks
        console.log('Step 4: Verify tracks were synced');
        const trackCount = await target.getTrackCount();
        expect(trackCount).toBe(3);

        // Step 5: Verify iPod database integrity
        console.log('Step 5: Verify database integrity');
        const verifyResult = await target.verify();
        expect(verifyResult.valid).toBe(true);
        expect(verifyResult.trackCount).toBe(3);

        console.log('Workflow complete!');
      } finally {
        const configDir = join(configPath, '..');
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000); // 2 min timeout for full workflow with transcoding
});
