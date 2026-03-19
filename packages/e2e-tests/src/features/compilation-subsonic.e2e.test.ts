/**
 * E2E tests for compilation album support via Subsonic/Navidrome.
 *
 * Tests that compilation metadata flows correctly from Navidrome through
 * the Subsonic API to the iPod database during sync.
 *
 * These tests require Docker to run Navidrome with compilation-tagged fixtures.
 *
 * To run:
 *   SUBSONIC_E2E=1 bun test src/features/compilation-subsonic.e2e.test.ts
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { withTarget } from '../targets/index.js';
import { runCliJson, cleanupTempConfig } from '../helpers/cli-runner.js';
import { isDockerAvailable } from '../sources/index.js';
import { startContainer, stopContainer, getContainerPort } from '../docker/index.js';
import { areFixturesAvailable, getTrackPath, Tracks } from '../helpers/fixtures.js';

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

const subsonicE2eEnabled = process.env.SUBSONIC_E2E === '1';
let dockerAvailable = false;
let containerId: string | null = null;
let tempDir: string;
let serverPort: number;
const password = 'testpass';

/**
 * Check if metaflac is available.
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

/**
 * Wait for Navidrome to finish scanning and have albums indexed.
 */
async function waitForLibraryScan(port: number, timeoutMs = 60000): Promise<void> {
  const startTime = Date.now();
  const albumsUrl = `http://localhost:${port}/rest/getAlbumList2?u=admin&p=${password}&c=podkit-test&v=1.16.1&f=json&type=alphabeticalByName&size=10`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(albumsUrl);
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const subsonicResponse = data['subsonic-response'] as Record<string, unknown> | undefined;
        const albumList = subsonicResponse?.albumList2 as Record<string, unknown> | undefined;
        const albums = albumList?.album as unknown[] | undefined;

        // Wait until we have at least 2 albums (compilation + solo)
        if (albums && albums.length >= 2) {
          return;
        }
      }
    } catch {
      // Keep trying
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Navidrome library scan did not complete within ${timeoutMs}ms`);
}

/**
 * Wait for Navidrome HTTP + auth to be ready.
 */
async function waitForServer(port: number, timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  const pingUrl = `http://localhost:${port}/rest/ping?u=admin&p=${password}&c=podkit-test&v=1.16.1&f=json`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(pingUrl);
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const subsonicResponse = data['subsonic-response'] as Record<string, unknown> | undefined;
        if (subsonicResponse?.status === 'ok') {
          return;
        }
      }
    } catch {
      // Keep trying
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Navidrome server did not start within ${timeoutMs}ms`);
}

beforeAll(async () => {
  if (!subsonicE2eEnabled) {
    console.log('Skipping Subsonic compilation tests (set SUBSONIC_E2E=1 to enable)');
    return;
  }

  dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    console.log('Skipping: Docker is not available');
    return;
  }

  const fixturesAvailable = await areFixturesAvailable();
  if (!fixturesAvailable) {
    console.log('Skipping: audio fixtures not available');
    return;
  }

  if (!isMetaflacAvailable()) {
    console.log('Skipping: metaflac not available');
    return;
  }

  // Create temp directories and fixtures
  tempDir = join(tmpdir(), `podkit-comp-subsonic-${randomUUID()}`);
  const musicDir = join(tempDir, 'music');
  const dataDir = join(tempDir, 'data');
  await mkdir(musicDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  await createCompilationFixtures(musicDir);

  // Start Navidrome container
  // Use port 0 to let Docker/OS assign a free host port (avoids conflicts
  // when multiple Docker-based test files run concurrently)
  const result = await startContainer({
    image: 'deluan/navidrome:latest',
    source: 'subsonic-compilation',
    ports: ['0:4533'],
    volumes: [`${musicDir}:/music:ro`, `${dataDir}:/data`],
    env: [
      `ND_DEVAUTOCREATEADMINPASSWORD=${password}`,
      'ND_MUSICFOLDER=/music',
      'ND_DATAFOLDER=/data',
      'ND_SCANSCHEDULE=@startup',
      'ND_LOGLEVEL=warn',
    ],
  });

  containerId = result.containerId;
  serverPort = await getContainerPort(result.containerId, 4533);
  console.log(`Navidrome container started on port ${serverPort}`);

  await waitForServer(serverPort);
  await waitForLibraryScan(serverPort);
  console.log('Navidrome ready with compilation fixtures');
}, 120000);

afterAll(async () => {
  if (containerId) {
    console.log('Stopping Navidrome container...');
    await stopContainer(containerId);
    containerId = null;
  }

  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

function shouldRun(): boolean {
  return subsonicE2eEnabled && dockerAvailable && containerId !== null;
}

// =============================================================================
// Tests
// =============================================================================

describe('compilation albums via Subsonic', () => {
  it.skipIf(!subsonicE2eEnabled)(
    'syncs compilation flag from Navidrome to iPod',
    async () => {
      if (!shouldRun()) {
        console.log('Skipping: Docker not available or setup failed');
        return;
      }

      await withTarget(async (target) => {
        // Create Subsonic config
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-comp-config-'));
        const configPath = join(configDir, 'config.toml');

        await writeFile(
          configPath,
          `version = 1

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
    },
    300000
  );
});
