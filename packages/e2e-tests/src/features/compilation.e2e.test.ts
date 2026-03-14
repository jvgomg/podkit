/**
 * E2E tests for compilation album support.
 *
 * Tests the full compilation flag pipeline from source metadata through to iPod:
 * - Directory source with COMPILATION tag set in FLAC files
 * - Verification that compilation flag appears in device music output
 * - Non-compilation tracks have compilation: false
 *
 * These tests create temporary FLAC files with compilation metadata
 * to verify the flag is correctly synced.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, getTrackPath, Tracks, type AlbumDir } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

interface DeviceTrack {
  title: string;
  artist: string | null;
  album: string | null;
  compilation: boolean;
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
 * Test track definition for compilation tests.
 */
interface CompilationTrack {
  /** Source fixture to copy from */
  source: { album: AlbumDir; filename: string };
  /** New filename in test collection */
  filename: string;
  /** Artist name */
  artist: string;
  /** Album artist (typically "Various Artists" for compilations) */
  albumArtist: string;
  /** Track title */
  title: string;
  /** Album name */
  album: string;
  /** Whether this track should have the compilation flag */
  isCompilation: boolean;
}

/**
 * Test tracks: a compilation album and a regular album.
 */
const TEST_TRACKS: CompilationTrack[] = [
  // Compilation album tracks (different artists, same album)
  {
    source: Tracks.HARMONY,
    filename: '01-comp-track1.flac',
    artist: 'Artist Alpha',
    albumArtist: 'Various Artists',
    title: 'Harmony',
    album: 'Greatest Hits Collection',
    isCompilation: true,
  },
  {
    source: Tracks.VIBRATO,
    filename: '02-comp-track2.flac',
    artist: 'Artist Beta',
    albumArtist: 'Various Artists',
    title: 'Vibrato',
    album: 'Greatest Hits Collection',
    isCompilation: true,
  },
  // Regular (non-compilation) track
  {
    source: Tracks.TREMOLO,
    filename: '03-regular-track.flac',
    artist: 'Solo Artist',
    albumArtist: 'Solo Artist',
    title: 'Tremolo',
    album: 'Solo Album',
    isCompilation: false,
  },
];

/**
 * Create a test collection with compilation and non-compilation tracks.
 */
async function createCompilationCollection(): Promise<string> {
  const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-comp-collection-'));

  for (const track of TEST_TRACKS) {
    const sourcePath = getTrackPath(track.source.album, track.source.filename);
    const destPath = join(collectionDir, track.filename);

    // Copy the source file
    await copyFile(sourcePath, destPath);

    // Update metadata using metaflac
    const tags = [
      `--remove-tag=ARTIST --set-tag="ARTIST=${track.artist}"`,
      `--remove-tag=ALBUMARTIST --set-tag="ALBUMARTIST=${track.albumArtist}"`,
      `--remove-tag=TITLE --set-tag="TITLE=${track.title}"`,
      `--remove-tag=ALBUM --set-tag="ALBUM=${track.album}"`,
    ];

    if (track.isCompilation) {
      tags.push('--remove-tag=COMPILATION --set-tag="COMPILATION=1"');
    } else {
      tags.push('--remove-tag=COMPILATION');
    }

    execSync(`metaflac ${tags.join(' ')} "${destPath}"`, { stdio: 'ignore' });
  }

  return collectionDir;
}

/**
 * Create a config file for the test collection.
 */
async function createConfigFile(configDir: string, source: string): Promise<string> {
  const configPath = join(configDir, 'config.toml');

  const content = `[music.default]
path = "${source}"

quality = "low"

[defaults]
music = "default"
`;

  await writeFile(configPath, content);
  return configPath;
}

/**
 * Get tracks from iPod via CLI device music command (includes compilation field).
 * The CLI outputs a JSON array of track objects directly.
 */
async function getDeviceTracks(
  configPath: string,
  devicePath: string
): Promise<DeviceTrack[]> {
  const { json } = await runCliJson<DeviceTrack[]>([
    '--config',
    configPath,
    'device',
    'music',
    '--tracks',
    '--device',
    devicePath,
    '--json',
  ]);

  return json ?? [];
}

// =============================================================================
// Tests
// =============================================================================

describe('compilation album support', () => {
  let fixturesAvailable: boolean;
  let metaflacAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
    metaflacAvailable = isMetaflacAvailable();
  });

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

  it('syncs compilation flag from FLAC metadata to iPod', async () => {
    if (skipIfUnavailable()) return;

    await withTarget(async (target) => {
      const collectionDir = await createCompilationCollection();
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

      try {
        const configPath = await createConfigFile(configDir, collectionDir);

        // Sync to iPod
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

        // Get tracks from iPod via CLI to check compilation flag
        const tracks = await getDeviceTracks(configPath, target.path);

        expect(tracks.length).toBe(3);

        // Compilation tracks should have compilation: true
        const compTrack1 = tracks.find((t) => t.title === 'Harmony');
        expect(compTrack1).toBeDefined();
        expect(compTrack1?.compilation).toBe(true);
        expect(compTrack1?.artist).toBe('Artist Alpha');

        const compTrack2 = tracks.find((t) => t.title === 'Vibrato');
        expect(compTrack2).toBeDefined();
        expect(compTrack2?.compilation).toBe(true);
        expect(compTrack2?.artist).toBe('Artist Beta');

        // Non-compilation track should have compilation: false
        const regularTrack = tracks.find((t) => t.title === 'Tremolo');
        expect(regularTrack).toBeDefined();
        expect(regularTrack?.compilation).toBe(false);
        expect(regularTrack?.artist).toBe('Solo Artist');
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('reports compilation metadata conflict on re-sync when tag changes', async () => {
    if (skipIfUnavailable()) return;

    await withTarget(async (target) => {
      const collectionDir = await createCompilationCollection();
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

      try {
        const configPath = await createConfigFile(configDir, collectionDir);

        // First sync
        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);

        // Now mark the regular track as a compilation
        const regularPath = join(collectionDir, '03-regular-track.flac');
        execSync(
          `metaflac --remove-tag=COMPILATION --set-tag="COMPILATION=1" "${regularPath}"`,
          { stdio: 'ignore' }
        );

        // Dry-run re-sync should detect the compilation conflict
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);
        expect(result2.exitCode).toBe(0);
        expect(json2?.success).toBe(true);

        // The track should be reported as having a metadata conflict
        expect(json2?.plan?.tracksWithConflicts).toBeGreaterThanOrEqual(1);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);
});
