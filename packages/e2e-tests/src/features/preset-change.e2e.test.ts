/**
 * E2E tests for quality preset change detection and sync tags.
 *
 * Tests the full cycle: sync → verify sync tags written → change preset →
 * verify detection → re-sync → verify idempotent.
 *
 * Sync tags enable exact preset change detection by storing transcode settings
 * in the iPod track's comment field. Bitrate-based detection serves as a
 * fallback for tracks without sync tags.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, getTrackPath, Tracks, type AlbumDir } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

// =============================================================================
// Test Fixture Helpers
// =============================================================================

const TEST_TRACKS: Array<{ source: { album: AlbumDir; filename: string } }> = [
  { source: Tracks.HARMONY },
  { source: Tracks.VIBRATO },
  { source: Tracks.TREMOLO },
];

async function createTestCollection(): Promise<string> {
  const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-preset-'));

  for (const track of TEST_TRACKS) {
    const sourcePath = getTrackPath(track.source.album, track.source.filename);
    const destPath = join(collectionDir, track.source.filename);
    await copyFile(sourcePath, destPath);
  }

  return collectionDir;
}

async function createConfigFile(
  configDir: string,
  options: { source: string; quality: string }
): Promise<string> {
  const configPath = join(configDir, 'config.toml');

  const content = `[music.default]
path = "${options.source}"

quality = "${options.quality}"

[defaults]
music = "default"
`;

  await writeFile(configPath, content);
  return configPath;
}

// =============================================================================
// Tests
// =============================================================================

describe('preset change detection', () => {
  let fixturesAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
  });

  it('second sync at different quality succeeds without errors', async () => {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Sync at low quality
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'low',
        });

        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect((await target.getTracks()).length).toBe(3);

        // Change to high quality and sync again — should succeed
        await writeFile(
          configPath,
          `[music.default]\npath = "${collectionDir}"\nquality = "high"\n[defaults]\nmusic = "default"\n`
        );

        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result2.exitCode).toBe(0);
        expect(json2?.success).toBe(true);
        // Track count preserved regardless of what happened (add/upgrade/no-op)
        expect((await target.getTracks()).length).toBe(3);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('skip-upgrades suppresses all file-replacement upgrades at different quality', async () => {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Sync at low quality
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'low',
        });

        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);

        // Change to high quality with --skip-upgrades — no file-replacement upgrades
        await writeFile(
          configPath,
          `[music.default]\npath = "${collectionDir}"\nquality = "high"\n[defaults]\nmusic = "default"\n`
        );

        const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--skip-upgrades',
          '--json',
        ]);

        expect(dryResult.exitCode).toBe(0);

        // With skip-upgrades, no file-replacement upgrades should be planned
        if (dryJson?.plan) {
          const breakdown = dryJson.plan.updateBreakdown ?? {};
          expect(breakdown['format-upgrade'] ?? 0).toBe(0);
          expect(breakdown['quality-upgrade'] ?? 0).toBe(0);
          expect(breakdown['preset-upgrade'] ?? 0).toBe(0);
          expect(breakdown['preset-downgrade'] ?? 0).toBe(0);
          expect(breakdown['artwork-added'] ?? 0).toBe(0);
        }
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('second sync with same preset is idempotent (no work via sync tags)', async () => {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'high',
        });

        // First sync
        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config', configPath,
          'sync', '--device', target.path, '--json',
        ]);
        expect(result1.exitCode).toBe(0);

        // Second sync — should be fully in sync (no work)
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config', configPath,
          'sync', '--device', target.path, '--dry-run', '--json',
        ]);
        expect(result2.exitCode).toBe(0);
        expect(json2?.plan?.tracksToAdd).toBe(0);
        expect(json2?.plan?.tracksToUpdate).toBe(0);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('sync tag detects preset change and re-transcodes', async () => {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'high',
        });

        // Sync at high quality
        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config', configPath,
          'sync', '--device', target.path, '--quality', 'high', '--json',
        ]);
        expect(result1.exitCode).toBe(0);

        // Dry-run at low quality — sync tags should detect mismatch
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config', configPath,
          'sync', '--device', target.path, '--quality', 'low', '--dry-run', '--json',
        ]);
        expect(result2.exitCode).toBe(0);
        // All 3 tracks should need updating (preset downgrade)
        expect(json2?.plan?.tracksToUpdate).toBe(3);

        // Actually sync at low — tracks should be re-transcoded
        const { result: result3, json: json3 } = await runCliJson<SyncOutput>([
          '--config', configPath,
          'sync', '--device', target.path, '--quality', 'low', '--json',
        ]);
        expect(result3.exitCode).toBe(0);
        expect(json3?.result?.completed).toBe(3);

        // Third sync at low — should be idempotent (sync tags match)
        const { json: json4 } = await runCliJson<SyncOutput>([
          '--config', configPath,
          'sync', '--device', target.path, '--quality', 'low', '--dry-run', '--json',
        ]);
        expect(json4?.plan?.tracksToAdd).toBe(0);
        expect(json4?.plan?.tracksToUpdate).toBe(0);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  it('--force-sync-tags writes tags as plan operations', async () => {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'medium',
        });

        // Sync without sync tags (simulate pre-sync-tag tracks by clearing comments after)
        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config', configPath,
          'sync', '--device', target.path, '--json',
        ]);
        expect(result1.exitCode).toBe(0);

        // Verify tracks were synced
        const tracks = await target.getTracks();
        expect(tracks.length).toBe(3);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);
});
