/**
 * E2E tests for quality preset change detection.
 *
 * Preset change detection compares iPod track bitrate against the target preset
 * bitrate. The detection logic is thoroughly tested by unit tests in
 * `upgrades.test.ts` and `differ.test.ts` (22 test cases).
 *
 * E2E testing of the actual detection is limited because:
 * - The iPod database (via libgpod) stores low bitrates (~14-17 kbps) for
 *   transcoded test audio regardless of the encoding quality preset
 * - These unreliable bitrate values prevent testing the detection threshold
 *
 * What IS tested here:
 * - `--skip-upgrades` suppresses all file-replacement upgrades (including preset
 *   changes) — this validates that the CLI wiring and options flow work correctly
 * - Second sync produces no unexpected crashes from the new code paths
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
});
