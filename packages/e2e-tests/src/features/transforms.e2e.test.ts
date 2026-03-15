/**
 * E2E tests for metadata transforms (cleanArtists).
 *
 * Tests the full transform pipeline from config through to iPod metadata:
 * - Basic cleanArtists sync with transform enabled
 * - Transform toggle workflow (enable -> sync -> disable -> sync)
 * - Dry-run output shows transform info
 * - Custom format and drop mode options
 *
 * These tests create temporary FLAC files with "feat." artist names
 * to verify the transform is applied during sync.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, getTrackPath, Tracks, type AlbumDir } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

interface ListTrack {
  title: string;
  artist: string | null;
  album: string | null;
}

// =============================================================================
// Test Fixture Helpers
// =============================================================================

/**
 * Check if metaflac is available for modifying FLAC metadata.
 */
function isMetaflacAvailable(): boolean {
  try {
    execSync('which metaflac', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Test track definition with featured artist.
 */
interface FeaturedTrack {
  /** Source fixture to copy from */
  source: { album: AlbumDir; filename: string };
  /** New filename in test collection */
  filename: string;
  /** Artist name with featuring info (e.g., "Artist feat. Guest") */
  artist: string;
  /** Expected artist after cleanArtists transform */
  expectedArtist: string;
  /** Track title */
  title: string;
  /** Expected title after cleanArtists transform (with default format) */
  expectedTitle: string;
}

/**
 * Test tracks with various featuring patterns.
 */
const FEATURED_TRACKS: FeaturedTrack[] = [
  {
    source: Tracks.HARMONY,
    filename: '01-featuring.flac',
    artist: 'Main Artist feat. Guest Singer',
    expectedArtist: 'Main Artist',
    title: 'Harmony',
    expectedTitle: 'Harmony (feat. Guest Singer)',
  },
  {
    source: Tracks.VIBRATO,
    filename: '02-ft-dot.flac',
    artist: 'Band Name ft. Rapper',
    expectedArtist: 'Band Name',
    title: 'Vibrato',
    expectedTitle: 'Vibrato (feat. Rapper)',
  },
  {
    source: Tracks.TREMOLO,
    filename: '03-no-feat.flac',
    artist: 'Solo Artist',
    expectedArtist: 'Solo Artist', // No change expected
    title: 'Tremolo',
    expectedTitle: 'Tremolo', // No change expected
  },
];

/**
 * Create a test collection with featured artists.
 *
 * Copies fixture files to a temp directory and modifies their metadata
 * to include "feat." in artist names.
 *
 * @returns Path to the test collection directory
 */
async function createFeaturedArtistCollection(): Promise<string> {
  const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-feat-collection-'));

  for (const track of FEATURED_TRACKS) {
    const sourcePath = getTrackPath(track.source.album, track.source.filename);
    const destPath = join(collectionDir, track.filename);

    // Copy the source file
    await copyFile(sourcePath, destPath);

    // Update metadata using metaflac
    execSync(
      `metaflac --remove-tag=ARTIST --set-tag="ARTIST=${track.artist}" --remove-tag=TITLE --set-tag="TITLE=${track.title}" "${destPath}"`,
      { stdio: 'ignore' }
    );
  }

  return collectionDir;
}

/**
 * Create a config file with transforms settings.
 */
async function createConfigFile(
  configDir: string,
  options: {
    source: string;
    device: string;
    cleanArtists?: {
      enabled?: boolean;
      drop?: boolean;
      format?: string;
    };
  }
): Promise<string> {
  const configPath = join(configDir, 'config.toml');

  // Use ADR-008 format with music collection and global cleanArtists
  // Note: Device is passed via --device flag, not config
  // IMPORTANT: Top-level keys must come before any [section] headers in TOML
  let content = `# Global settings
quality = "low"
`;

  if (options.cleanArtists) {
    // If only enabled is set and it's a simple boolean, use shorthand
    const hasOptions =
      options.cleanArtists.drop !== undefined || options.cleanArtists.format !== undefined;
    const isDisabled = options.cleanArtists.enabled === false;

    if (!hasOptions && !isDisabled) {
      // Simple boolean shorthand
      content += 'cleanArtists = true\n';
    } else if (isDisabled && !hasOptions) {
      content += 'cleanArtists = false\n';
    } else {
      // Table form with options
      content += '\n[cleanArtists]\n';
      if (options.cleanArtists.enabled === false) {
        content += `enabled = false\n`;
      }
      if (options.cleanArtists.drop !== undefined) {
        content += `drop = ${options.cleanArtists.drop}\n`;
      }
      if (options.cleanArtists.format !== undefined) {
        content += `format = "${options.cleanArtists.format}"\n`;
      }
    }
  }

  content += `
[music.default]
path = "${options.source}"

[defaults]
music = "default"
`;

  await writeFile(configPath, content);
  return configPath;
}

// =============================================================================
// Tests
// =============================================================================

describe('transforms: cleanArtists', () => {
  let fixturesAvailable: boolean;
  let metaflacAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
    metaflacAvailable = isMetaflacAvailable();
  });

  /**
   * Skip helper for tests that need metaflac.
   */
  function skipIfUnavailable(): boolean {
    if (!fixturesAvailable) {
      console.log('Skipping: fixtures not available');
      return true;
    }
    if (!metaflacAvailable) {
      console.log('Skipping: metaflac not available (install flac package)');
      return true;
    }
    return false;
  }

  describe('basic sync with cleanArtists enabled', () => {
    it('cleans featured artists during sync', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        // Create test collection with featured artists
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          // Create config with cleanArtists enabled
          const configPath = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: true },
          });

          // Sync with transforms enabled
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
          expect(json?.result?.completed).toBe(3);

          // Verify tracks on iPod have transformed metadata
          const tracks: ListTrack[] = await target.getTracks();

          expect(tracks.length).toBe(3);

          // Check that "feat." was moved to title for tracks with featured artists
          const harmony = tracks.find((t) => t.title.includes('Harmony'));
          expect(harmony).toBeDefined();
          expect(harmony?.artist).toBe('Main Artist');
          expect(harmony?.title).toBe('Harmony (feat. Guest Singer)');

          const vibrato = tracks.find((t) => t.title.includes('Vibrato'));
          expect(vibrato).toBeDefined();
          expect(vibrato?.artist).toBe('Band Name');
          expect(vibrato?.title).toBe('Vibrato (feat. Rapper)');

          // Track without "feat." should be unchanged
          const tremolo = tracks.find((t) => t.title === 'Tremolo');
          expect(tremolo).toBeDefined();
          expect(tremolo?.artist).toBe('Solo Artist');
          expect(tremolo?.title).toBe('Tremolo');
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 120000);

    it('does not transform when cleanArtists is disabled', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          // Create config with cleanArtists disabled (default)
          const configPath = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: false },
          });

          // Sync without transforms
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

          // Verify tracks keep original metadata
          const tracks: ListTrack[] = await target.getTracks();

          // Artist should still include "feat."
          const harmony = tracks.find((t) => t.title === 'Harmony');
          expect(harmony).toBeDefined();
          expect(harmony?.artist).toBe('Main Artist feat. Guest Singer');
          expect(harmony?.title).toBe('Harmony');
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 120000);
  });

  describe('dry-run output', () => {
    it('shows transform info in dry-run JSON output', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          const configPath = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: true },
          });

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

          // Verify transforms array in output
          expect(json?.transforms).toBeDefined();
          expect(json?.transforms?.length).toBe(1);
          expect(json!.transforms![0]!.name).toBe('cleanArtists');
          expect(json!.transforms![0]!.enabled).toBe(true);
          expect(json!.transforms![0]!.mode).toBe('move');
          expect(json!.transforms![0]!.format).toBe('feat. {}');
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 60000);

    it('shows transform info in dry-run text output', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          const configPath = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: true },
          });

          const result = await runCli([
            '--config',
            configPath,
            'sync',
            '--device',
            target.path,
            '--dry-run',
          ]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('Transforms: Clean artists: enabled');
          expect(result.stdout).toContain('format: "feat. {}"');
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 60000);
  });

  describe('transform toggle workflow', () => {
    it('updates metadata when transform is enabled after initial sync', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          // Step 1: Initial sync with cleanArtists disabled
          const configPath = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: false },
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

          // Verify original metadata
          const tracksBeforeToggle: ListTrack[] = await target.getTracks();
          const harmonyBefore = tracksBeforeToggle.find((t) => t.title === 'Harmony');
          expect(harmonyBefore?.artist).toBe('Main Artist feat. Guest Singer');

          // Step 2: Enable cleanArtists and sync again
          const configPathEnabled = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: true },
          });

          // Dry-run first to check what will happen
          const { json: dryRunJson } = await runCliJson<SyncOutput>([
            '--config',
            configPathEnabled,
            'sync',
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          // Should show tracks to update (not add)
          expect(dryRunJson?.plan?.tracksToAdd).toBe(0);
          expect(dryRunJson?.plan?.tracksToUpdate).toBeGreaterThan(0);
          expect(dryRunJson?.plan?.updateBreakdown?.['transform-apply']).toBeGreaterThan(0);

          // Actually sync
          const { result: result2, json: syncJson } = await runCliJson<SyncOutput>([
            '--config',
            configPathEnabled,
            'sync',
            '--device',
            target.path,
            '--json',
          ]);
          expect(result2.exitCode).toBe(0);

          // Sync completed successfully (no new tracks added, only updates)
          expect(syncJson?.success).toBe(true);

          // Verify transformed metadata
          const tracksAfterToggle: ListTrack[] = await target.getTracks();

          const harmonyAfter = tracksAfterToggle.find((t) => t.title.includes('Harmony'));
          expect(harmonyAfter?.artist).toBe('Main Artist');
          expect(harmonyAfter?.title).toBe('Harmony (feat. Guest Singer)');

          // Track count should remain the same
          expect(tracksAfterToggle.length).toBe(3);
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 180000); // 3 min for two syncs

    it('reverts metadata when transform is disabled after initial sync', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          // Step 1: Initial sync with cleanArtists enabled
          const configPath = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: true },
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

          // Verify transformed metadata
          const tracksTransformed: ListTrack[] = await target.getTracks();
          const harmonyTransformed = tracksTransformed.find((t) => t.title.includes('Harmony'));
          expect(harmonyTransformed?.artist).toBe('Main Artist');
          expect(harmonyTransformed?.title).toBe('Harmony (feat. Guest Singer)');

          // Step 2: Disable cleanArtists and sync again
          const configPathDisabled = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: false },
          });

          // Dry-run to see revert operations
          const { json: dryRunJson } = await runCliJson<SyncOutput>([
            '--config',
            configPathDisabled,
            'sync',
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          // Should show transform-remove updates
          expect(dryRunJson?.plan?.tracksToUpdate).toBeGreaterThan(0);
          expect(dryRunJson?.plan?.updateBreakdown?.['transform-remove']).toBeGreaterThan(0);

          // Actually sync
          await runCliJson<SyncOutput>([
            '--config',
            configPathDisabled,
            'sync',
            '--device',
            target.path,
            '--json',
          ]);

          // Verify reverted metadata
          const tracksReverted: ListTrack[] = await target.getTracks();

          const harmonyReverted = tracksReverted.find((t) => t.title === 'Harmony');
          expect(harmonyReverted?.artist).toBe('Main Artist feat. Guest Singer');
          expect(harmonyReverted?.title).toBe('Harmony');
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 180000);
  });

  describe('custom format and drop mode', () => {
    it('uses custom format string for featuring info', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          const configPath = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: {
              enabled: true,
              format: 'ft. {}',
            },
          });

          await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            target.path,
            '--json',
          ]);

          // Verify custom format was used
          const tracks: ListTrack[] = await target.getTracks();

          const harmony = tracks.find((t) => t.title.includes('Harmony'));
          expect(harmony?.title).toBe('Harmony (ft. Guest Singer)');
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 120000);

    it('drops featuring info in drop mode', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          const configPath = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: {
              enabled: true,
              drop: true,
            },
          });

          // Verify dry-run shows drop mode
          const { json: dryRunJson } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          expect(dryRunJson!.transforms![0]!.mode).toBe('drop');
          expect(dryRunJson!.transforms![0]!.format).toBeUndefined();

          // Sync
          await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            target.path,
            '--json',
          ]);

          // Verify featuring info was dropped
          const tracks: ListTrack[] = await target.getTracks();

          const harmony = tracks.find((t) => t.title === 'Harmony');
          expect(harmony).toBeDefined();
          expect(harmony?.artist).toBe('Main Artist');
          expect(harmony?.title).toBe('Harmony'); // No feat. added
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 120000);

    it('shows drop mode in text output', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          const configPath = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: {
              enabled: true,
              drop: true,
            },
          });

          const result = await runCli([
            '--config',
            configPath,
            'sync',
            '--device',
            target.path,
            '--dry-run',
          ]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('Clean artists: enabled (drop mode)');
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 60000);
  });

  describe('verbose mode', () => {
    it('shows before/after in verbose dry-run for update operations', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          // First sync without transforms
          const configPathDisabled = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: false },
          });

          await runCliJson<SyncOutput>([
            '--config',
            configPathDisabled,
            'sync',
            '--device',
            target.path,
            '--json',
          ]);

          // Now enable transforms and do verbose dry-run
          const configPathEnabled = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: true },
          });

          const result = await runCli([
            '--config',
            configPathEnabled,
            'sync',
            '--device',
            target.path,
            '--dry-run',
            '--verbose',
          ]);

          expect(result.exitCode).toBe(0);

          // Should show update operations with before/after
          expect(result.stdout).toContain('update-metadata');
          expect(result.stdout).toContain('Artist transforms:');
          // The before/after arrows
          expect(result.stdout).toMatch(/→/);
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 120000);

    it('includes changes array in JSON update operations', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const collectionDir = await createFeaturedArtistCollection();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          // First sync without transforms
          const configPathDisabled = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: false },
          });

          await runCliJson<SyncOutput>([
            '--config',
            configPathDisabled,
            'sync',
            '--device',
            target.path,
            '--json',
          ]);

          // Enable transforms and do dry-run
          const configPathEnabled = await createConfigFile(configDir, {
            source: collectionDir,
            device: target.path,
            cleanArtists: { enabled: true },
          });

          const { json } = await runCliJson<SyncOutput>([
            '--config',
            configPathEnabled,
            'sync',
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          // Find update-metadata operations
          const updateOps = json?.operations?.filter((op) => op.type === 'update-metadata');
          expect(updateOps?.length).toBeGreaterThan(0);

          // Should have changes array with before/after
          const opWithChanges = updateOps?.find((op) => op.changes && op.changes.length > 0);
          expect(opWithChanges).toBeDefined();
          expect(opWithChanges?.changes?.some((c) => c.field === 'artist')).toBe(true);
          expect(opWithChanges?.changes?.some((c) => c.field === 'title')).toBe(true);
        } finally {
          await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 120000);
  });
});
