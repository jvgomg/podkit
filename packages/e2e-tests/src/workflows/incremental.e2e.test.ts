/**
 * E2E workflow test: Incremental sync.
 *
 * Tests adding tracks incrementally:
 * 1. Sync first album
 * 2. Sync second album (incremental)
 * 3. Verify only new tracks are processed
 * 4. Verify both albums present on iPod
 *
 * This validates the diff algorithm correctly identifies existing tracks.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, rm, symlink, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import {
  areFixturesAvailable,
  Albums,
  getAlbumTracks,
} from '../helpers/fixtures';

interface SyncOutput {
  success: boolean;
  plan?: {
    tracksToAdd: number;
  };
  result?: {
    completed: number;
  };
}


/**
 * Create a temp config file with the given music collection path
 */
async function createTempConfig(musicPath: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'podkit-incremental-config-'));
  const configPath = join(tempDir, 'config.toml');

  const content = `[music.main]
path = "${musicPath}"

[defaults]
music = "main"
`;

  await writeFile(configPath, content);
  return configPath;
}

describe('workflow: incremental sync', () => {
  let fixturesAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
  });

  it('adds only new tracks on incremental sync', async () => {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return;
    }

    await withTarget(async (target) => {
      // Create a temp directory to simulate growing collection
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-incremental-'));
      let configPath: string | undefined;

      try {
        // Get track files from both albums
        const album1Tracks = await getAlbumTracks(Albums.GOLDBERG_SELECTIONS);
        const album2Tracks = await getAlbumTracks(Albums.SYNTHETIC_TESTS);

        // Step 1: Add first album to collection (symlinks to fixtures)
        console.log('Step 1: Setting up first album');
        const album1Dir = join(collectionDir, 'album1');
        await mkdir(album1Dir);
        for (const track of album1Tracks) {
          const linkPath = join(album1Dir, track.filename);
          await symlink(track.path, linkPath);
        }

        // Create config file pointing to the collection
        configPath = await createTempConfig(collectionDir);

        // Step 2: First sync - should add 3 tracks
        console.log('Step 2: First sync (3 tracks)');
        const { result: sync1Result, json: sync1Json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(sync1Result.exitCode).toBe(0);
        expect(sync1Json?.success).toBe(true);
        expect(sync1Json?.result?.completed).toBe(3);

        // Verify 3 tracks on iPod
        let trackCount = await target.getTrackCount();
        expect(trackCount).toBe(3);

        // Step 3: Add second album to collection
        console.log('Step 3: Adding second album');
        const album2Dir = join(collectionDir, 'album2');
        await mkdir(album2Dir);
        for (const track of album2Tracks) {
          const linkPath = join(album2Dir, track.filename);
          await symlink(track.path, linkPath);
        }

        // Step 4: Second sync - should only add 3 new tracks
        console.log('Step 4: Incremental sync (3 new tracks)');
        const { result: sync2Result, json: sync2Json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(sync2Result.exitCode).toBe(0);
        expect(sync2Json?.success).toBe(true);
        expect(sync2Json?.result?.completed).toBe(3); // Only new tracks added

        // Verify 6 tracks total on iPod
        trackCount = await target.getTrackCount();
        expect(trackCount).toBe(6);

        // Step 5: Third sync - should add nothing
        console.log('Step 5: Verify no-op sync');
        const { result: sync3Result, json: sync3Json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(sync3Result.exitCode).toBe(0);
        expect(sync3Json?.success).toBe(true);
        expect(sync3Json?.result?.completed).toBe(0); // Nothing new to sync

        // Step 6: Verify database integrity and final track count
        console.log('Step 6: Verify database integrity');
        const verifyResult = await target.verify();
        expect(verifyResult.valid).toBe(true);
        expect(verifyResult.trackCount).toBe(6);

        console.log('Incremental sync workflow complete!');
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        if (configPath) {
          const configDir = join(configPath, '..');
          await rm(configDir, { recursive: true, force: true });
        }
      }
    });
  }, 180000); // 3 min timeout for multiple syncs with transcoding
});
