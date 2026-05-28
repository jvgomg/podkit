/**
 * E2E tests for compilation album support via Subsonic/Navidrome.
 *
 * Tests that compilation metadata flows correctly from Navidrome through
 * the Subsonic API to the iPod database during sync.
 *
 * These tests require Docker to run Navidrome with compilation-tagged fixtures.
 *
 * To run:
 *   bun run test:e2e:docker
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  ensureFixturesExist,
  requireMetaflac,
  runCliJson,
  cleanupTempConfig,
} from '@podkit/e2e-shared';
import { withTarget } from '../targets/index.js';
import { getTrackPath, Tracks } from '../helpers/fixtures.js';
import { isDockerAvailable } from '../sources/subsonic.js';
import { startNavidromeContainer, type NavidromeContainer } from '../docker/index.js';

requireMetaflac();
ensureFixturesExist('goldberg-selections');
ensureFixturesExist('multi-format');
ensureFixturesExist('synthetic-tests');

import type { SyncOutput } from 'podkit/types';

interface DeviceTrack {
  title: string;
  artist: string | null;
  album: string | null;
  compilation: boolean;
}

// =============================================================================
// Test Setup
// =============================================================================

let dockerAvailable = false;
let navidromeContainer: NavidromeContainer | null = null;
let tempDir: string;
let serverPort: number;
let password: string;

/**
 * Create compilation test fixtures for Navidrome.
 *
 * Creates an album directory structure with compilation-tagged FLAC files
 * that Navidrome will scan and expose via the Subsonic API.
 */
async function createCompilationFixtures(musicDir: string): Promise<void> {
  // Create a compilation album directory
  const compAlbumDir = join(musicDir, 'Various Artists', 'Compilation Album');
  await mkdir(compAlbumDir, { recursive: true });

  // Track 1: Artist Alpha
  const track1Src = getTrackPath(Tracks.HARMONY.album, Tracks.HARMONY.filename);
  const track1Dst = join(compAlbumDir, '01-harmony.flac');
  await copyFile(track1Src, track1Dst);
  execSync(
    `metaflac --remove-tag=ARTIST --set-tag="ARTIST=Artist Alpha" --remove-tag=ALBUMARTIST --set-tag="ALBUMARTIST=Various Artists" --remove-tag=TITLE --set-tag="TITLE=Harmony" --remove-tag=ALBUM --set-tag="ALBUM=Compilation Album" --remove-tag=COMPILATION --set-tag="COMPILATION=1" "${track1Dst}"`,
    { stdio: 'ignore' }
  );

  // Track 2: Artist Beta
  const track2Src = getTrackPath(Tracks.VIBRATO.album, Tracks.VIBRATO.filename);
  const track2Dst = join(compAlbumDir, '02-vibrato.flac');
  await copyFile(track2Src, track2Dst);
  execSync(
    `metaflac --remove-tag=ARTIST --set-tag="ARTIST=Artist Beta" --remove-tag=ALBUMARTIST --set-tag="ALBUMARTIST=Various Artists" --remove-tag=TITLE --set-tag="TITLE=Vibrato" --remove-tag=ALBUM --set-tag="ALBUM=Compilation Album" --remove-tag=COMPILATION --set-tag="COMPILATION=1" "${track2Dst}"`,
    { stdio: 'ignore' }
  );

  // Create a non-compilation album for comparison
  const regularAlbumDir = join(musicDir, 'Solo Artist', 'Solo Album');
  await mkdir(regularAlbumDir, { recursive: true });

  const track3Src = getTrackPath(Tracks.TREMOLO.album, Tracks.TREMOLO.filename);
  const track3Dst = join(regularAlbumDir, '01-tremolo.flac');
  await copyFile(track3Src, track3Dst);
  execSync(
    `metaflac --remove-tag=ARTIST --set-tag="ARTIST=Solo Artist" --remove-tag=ALBUMARTIST --set-tag="ALBUMARTIST=Solo Artist" --remove-tag=TITLE --set-tag="TITLE=Tremolo" --remove-tag=ALBUM --set-tag="ALBUM=Solo Album" --remove-tag=COMPILATION "${track3Dst}"`,
    { stdio: 'ignore' }
  );
}

beforeAll(async () => {
  dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker is not available — required for @podkit/e2e-tests docker suite.');
  }

  // Create temp directories and fixtures
  tempDir = join(tmpdir(), `podkit-comp-subsonic-${randomUUID()}`);
  const musicDir = join(tempDir, 'music');
  const dataDir = join(tempDir, 'data');
  await mkdir(musicDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  await createCompilationFixtures(musicDir);

  // Wait for both albums (compilation + solo) to be indexed.
  navidromeContainer = await startNavidromeContainer({
    musicDir,
    dataDir,
    label: 'subsonic-compilation',
    minAlbums: 2,
  });
  serverPort = navidromeContainer.port;
  password = navidromeContainer.password;
  console.log(`Navidrome ready with compilation fixtures on port ${serverPort}`);
}, 120000);

afterAll(async () => {
  if (navidromeContainer) {
    console.log('Stopping Navidrome container...');
    await navidromeContainer.stop();
    navidromeContainer = null;
  }

  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// =============================================================================
// Tests
// =============================================================================

describe('compilation albums via Subsonic', () => {
  it('syncs compilation flag from Navidrome to iPod', async () => {
    await withTarget(async (target) => {
      // Create Subsonic config
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-comp-config-'));
      const configPath = join(configDir, 'config.toml');

      await writeFile(
        configPath,
        `version = 2

[music.main]
type = "subsonic"
url = "http://localhost:${serverPort}"
username = "admin"

[defaults]
music = "main"
`
      );

      try {
        // Sync from Navidrome to iPod
        const { result, json } = await runCliJson<SyncOutput>(
          ['--config', configPath, 'sync', '--device', target.path, '--json'],
          {
            env: { SUBSONIC_PASSWORD: password },
            timeout: 180000,
          }
        );

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.result?.completed).toBe(3);

        // Get tracks from iPod via CLI to check compilation flag
        const { json: musicJson } = await runCliJson<DeviceTrack[]>(
          [
            '--config',
            configPath,
            'device',
            'music',
            '--tracks',
            '--device',
            target.path,
            '--json',
          ],
          {
            env: { SUBSONIC_PASSWORD: password },
          }
        );

        const tracks = musicJson ?? [];
        expect(tracks.length).toBe(3);

        // Compilation tracks should have compilation: true
        const compTrack1 = tracks.find((t) => t.title === 'Harmony');
        expect(compTrack1).toBeDefined();
        expect(compTrack1?.compilation).toBe(true);

        const compTrack2 = tracks.find((t) => t.title === 'Vibrato');
        expect(compTrack2).toBeDefined();
        expect(compTrack2?.compilation).toBe(true);

        // Non-compilation track should have compilation: false
        const regularTrack = tracks.find((t) => t.title === 'Tremolo');
        expect(regularTrack).toBeDefined();
        expect(regularTrack?.compilation).toBe(false);

        console.log('Compilation flag verified via Subsonic sync');
      } finally {
        await cleanupTempConfig(configPath);
        await rm(configDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  }, 300000);
});
