/**
 * E2E tests for artwork change detection via Subsonic/Navidrome.
 *
 * Tests that artwork changes are detected end-to-end when using
 * --check-artwork with a Subsonic source. The flow:
 *
 * 1. Sync collection to iPod with --check-artwork (establishes artwork hash baselines)
 * 2. Replace artwork in the source FLAC files
 * 3. Trigger Navidrome rescan so getCoverArt returns new bytes
 * 4. Dry-run sync with --check-artwork to verify artwork-updated is detected
 *
 * Also tests artwork-removed and artwork-added detection:
 * - artwork-removed: Strip all embedded artwork, rescan, detect removal
 * - artwork-added: Start with a track without artwork, add artwork, detect addition
 *
 * These tests require Docker to run Navidrome.
 *
 * To run:
 *   SUBSONIC_E2E=1 bun test src/features/artwork-change.e2e.test.ts
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { withTarget } from '../targets/index.js';
import { runCliJson, cleanupTempConfig } from '../helpers/cli-runner.js';
import { isDockerAvailable } from '../sources/index.js';
import { startContainer, stopContainer } from '../docker/index.js';
import { areFixturesAvailable, getTrackPath, Tracks } from '../helpers/fixtures.js';

import type { SyncOutput } from 'podkit/types';

// =============================================================================
// Test Setup
// =============================================================================

const subsonicE2eEnabled = process.env.SUBSONIC_E2E === '1';
let dockerAvailable = false;
let containerId: string | null = null;
let tempDir: string;
let musicDir: string;
let dataDir: string;
let serverPort: number;
const password = 'testpass';

/**
 * Check if metaflac is available (needed to re-embed artwork).
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
 * Check if ffmpeg is available (needed to generate replacement artwork).
 */
function isFfmpegAvailable(): boolean {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create test fixtures for artwork change detection.
 *
 * Copies goldberg-selections FLAC files (all with embedded artwork) into a
 * Navidrome-scannable directory. The dual-tone track (no artwork) is NOT
 * included here — the artwork-added test copies it in dynamically to avoid
 * interference with artwork-updated/removed tests.
 */
async function createArtworkFixtures(targetMusicDir: string): Promise<void> {
  const goldbergDir = join(targetMusicDir, 'Synthetic Classics', 'Goldberg Selections');
  await mkdir(goldbergDir, { recursive: true });

  const goldbergTracks = [Tracks.HARMONY, Tracks.VIBRATO, Tracks.TREMOLO];
  for (const track of goldbergTracks) {
    const srcPath = getTrackPath(track.album, track.filename);
    const dstPath = join(goldbergDir, track.filename);
    await copyFile(srcPath, dstPath);
  }
}

/**
 * Replace embedded artwork in all FLAC files with a new generated image.
 *
 * Generates a solid red 500x500 JPEG image and re-embeds it in each FLAC file.
 * This changes the artwork hash that the Subsonic adapter computes.
 */
async function replaceArtworkInFixtures(targetMusicDir: string): Promise<void> {
  const albumDir = join(targetMusicDir, 'Synthetic Classics', 'Goldberg Selections');
  const newCoverPath = join(albumDir, 'cover-new.jpg');

  // Generate a visually distinct replacement image (solid red)
  execSync(`ffmpeg -y -f lavfi -i color=c=red:s=500x500:d=1 -frames:v 1 "${newCoverPath}"`, {
    stdio: 'ignore',
  });

  // Re-embed the new artwork in each FLAC file
  const trackFiles = ['01-harmony.flac', '02-vibrato.flac', '03-tremolo.flac'];
  for (const filename of trackFiles) {
    const trackPath = join(albumDir, filename);
    // Remove existing pictures and embed the new one
    execSync(
      `metaflac --remove --block-type=PICTURE "${trackPath}" && metaflac --import-picture-from="${newCoverPath}" "${trackPath}"`,
      { stdio: 'ignore' }
    );
  }
}

/**
 * Strip all embedded artwork from FLAC files in the goldberg album directory.
 *
 * After stripping, Navidrome's getCoverArt for these tracks will return no artwork,
 * allowing the adapter to detect artwork-removed.
 */
function stripArtworkFromFixtures(targetMusicDir: string): void {
  const albumDir = join(targetMusicDir, 'Synthetic Classics', 'Goldberg Selections');
  const trackFiles = ['01-harmony.flac', '02-vibrato.flac', '03-tremolo.flac'];
  for (const filename of trackFiles) {
    const trackPath = join(albumDir, filename);
    execSync(`metaflac --remove --block-type=PICTURE "${trackPath}"`, { stdio: 'ignore' });
  }
}

/**
 * Add embedded artwork to a FLAC file that previously had none.
 *
 * Generates a 500x500 blue JPEG and embeds it. After Navidrome rescans,
 * the adapter will detect artwork-added for this track.
 */
function addArtworkToTrack(trackPath: string, tempDir: string): void {
  const coverPath = join(tempDir, 'cover-added.jpg');
  execSync(`ffmpeg -y -f lavfi -i color=c=blue:s=500x500:d=1 -frames:v 1 "${coverPath}"`, {
    stdio: 'ignore',
  });
  execSync(`metaflac --import-picture-from="${coverPath}" "${trackPath}"`, { stdio: 'ignore' });
}

/**
 * Re-embed artwork into goldberg FLAC files (restores artwork after stripping).
 *
 * Used to restore fixture state between tests that share the same musicDir.
 */
function restoreArtworkInFixtures(targetMusicDir: string): void {
  const albumDir = join(targetMusicDir, 'Synthetic Classics', 'Goldberg Selections');
  const coverPath = join(albumDir, 'cover-restore.jpg');

  // Generate a green image to distinguish from original blue and replacement red
  execSync(`ffmpeg -y -f lavfi -i color=c=green:s=500x500:d=1 -frames:v 1 "${coverPath}"`, {
    stdio: 'ignore',
  });

  const trackFiles = ['01-harmony.flac', '02-vibrato.flac', '03-tremolo.flac'];
  for (const filename of trackFiles) {
    const trackPath = join(albumDir, filename);
    execSync(`metaflac --import-picture-from="${coverPath}" "${trackPath}"`, { stdio: 'ignore' });
  }
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

/**
 * Wait for Navidrome to finish scanning and have at least the expected album count.
 */
async function waitForLibraryScan(port: number, minAlbums = 1, timeoutMs = 60000): Promise<void> {
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

        if (albums && albums.length >= minAlbums) {
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
 * Restart the Navidrome container with a fresh database.
 *
 * Clears the data directory (database + artwork cache) and restarts the container.
 * On restart, Navidrome creates a fresh database and rescans all files, including
 * re-extracting artwork. This is the most reliable way to force Navidrome to serve
 * updated artwork after modifying source files.
 */
async function restartNavidrome(): Promise<void> {
  // Clear data directory so Navidrome starts from scratch
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  // Restart the container
  execSync(`docker restart ${containerId}`, { stdio: 'ignore', timeout: 30000 });

  // Wait for fresh server + library scan
  await waitForServer(serverPort);
  await waitForLibraryScan(serverPort);
}

/**
 * Create a config file for a Subsonic source with checkArtwork enabled.
 */
async function createArtworkCheckConfig(port: number): Promise<string> {
  const configDir = join(tmpdir(), `podkit-artwork-config-${randomUUID()}`);
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, 'config.toml');

  await writeFile(
    configPath,
    `[music.main]
type = "subsonic"
url = "http://localhost:${port}"
username = "admin"

[defaults]
music = "main"

# Enable artwork change detection
checkArtwork = true
`
  );

  return configPath;
}

beforeAll(async () => {
  if (!subsonicE2eEnabled) {
    console.log('Skipping artwork change detection tests (set SUBSONIC_E2E=1 to enable)');
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
    console.log('Skipping: metaflac not available (needed for artwork re-embedding)');
    return;
  }

  if (!isFfmpegAvailable()) {
    console.log('Skipping: ffmpeg not available (needed for generating replacement artwork)');
    return;
  }

  // Create temp directories and fixtures
  tempDir = join(tmpdir(), `podkit-artwork-change-${randomUUID()}`);
  musicDir = join(tempDir, 'music');
  dataDir = join(tempDir, 'data');
  await mkdir(musicDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  await createArtworkFixtures(musicDir);

  // Start Navidrome container
  // Mount music as read-write so we can modify artwork between syncs
  serverPort = 4533 + Math.floor(Math.random() * 100);
  console.log(`Starting Navidrome container on port ${serverPort}...`);

  const result = await startContainer({
    image: 'deluan/navidrome:latest',
    source: 'subsonic-artwork',
    ports: [`${serverPort}:4533`],
    volumes: [`${musicDir}:/music`, `${dataDir}:/data`],
    env: [
      `ND_DEVAUTOCREATEADMINPASSWORD=${password}`,
      'ND_MUSICFOLDER=/music',
      'ND_DATAFOLDER=/data',
      'ND_SCANSCHEDULE=@startup',
      'ND_LOGLEVEL=warn',
    ],
  });

  containerId = result.containerId;
  await waitForServer(serverPort);
  await waitForLibraryScan(serverPort);
  console.log('Navidrome ready with artwork fixtures');
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

describe('artwork change detection (Subsonic)', () => {
  it.skipIf(!subsonicE2eEnabled)(
    'detects changed artwork via Subsonic after re-embedding',
    async () => {
      if (!shouldRun()) {
        console.log('Skipping: Docker not available or setup failed');
        return;
      }

      await withTarget(async (target) => {
        const configPath = await createArtworkCheckConfig(serverPort);

        try {
          // ------------------------------------------------------------------
          // Step 1: Initial sync with --check-artwork
          // This syncs tracks and establishes artwork hash baselines in sync tags
          // ------------------------------------------------------------------
          console.log('Step 1: Initial sync with --check-artwork...');
          const { result: syncResult, json: syncJson } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
            {
              env: { SUBSONIC_PASSWORD: password },
              timeout: 180000,
            }
          );

          expect(syncResult.exitCode).toBe(0);
          expect(syncJson?.success).toBe(true);
          // Should sync the 3 goldberg-selections tracks
          expect(syncJson?.result?.completed).toBeGreaterThanOrEqual(3);

          const trackCount = await target.getTrackCount();
          expect(trackCount).toBeGreaterThanOrEqual(3);
          console.log(`Initial sync completed: ${syncJson?.result?.completed} tracks`);

          // ------------------------------------------------------------------
          // Step 2: Verify sync tags have artwork hashes (art= field)
          // Run a second sync to force sync tag writes if the first sync
          // didn't establish baselines (first sync may add tracks without
          // baselines, then a --force-sync-tags pass writes them)
          // ------------------------------------------------------------------
          console.log('Step 2: Establishing artwork hash baselines...');
          const { result: baselineResult } = await runCliJson<SyncOutput>(
            [
              '--config',
              configPath,
              'sync',
              '--device',
              target.path,
              '--check-artwork',
              '--force-sync-tags',
              '--json',
            ],
            {
              env: { SUBSONIC_PASSWORD: password },
              timeout: 120000,
            }
          );

          expect(baselineResult.exitCode).toBe(0);

          // Verify we're now in sync (no more changes needed)
          const { result: verifyResult, json: verifyJson } = await runCliJson<SyncOutput>(
            [
              '--config',
              configPath,
              'sync',
              '--device',
              target.path,
              '--check-artwork',
              '--dry-run',
              '--json',
            ],
            {
              env: { SUBSONIC_PASSWORD: password },
              timeout: 60000,
            }
          );

          expect(verifyResult.exitCode).toBe(0);
          expect(verifyJson?.dryRun).toBe(true);
          // Should have no updates pending (artwork hashes match)
          const preChangeUpdates = verifyJson?.plan?.tracksToUpdate ?? 0;
          console.log(`Pre-change verification: ${preChangeUpdates} updates pending`);

          // ------------------------------------------------------------------
          // Step 3: Replace artwork in source FLAC files
          // ------------------------------------------------------------------
          console.log('Step 3: Replacing artwork in source files...');
          await replaceArtworkInFixtures(musicDir);

          // ------------------------------------------------------------------
          // Step 4: Trigger Navidrome library rescan
          // The new embedded artwork will be picked up by Navidrome,
          // making getCoverArt return different bytes.
          // ------------------------------------------------------------------
          // Restart Navidrome with a fresh database to force artwork re-extraction.
          // A simple rescan is not sufficient — Navidrome caches artwork aggressively
          // and getCoverArt may serve stale data even after a fullScan. Restarting
          // with a clean data directory guarantees fresh artwork.
          console.log('Step 4: Restarting Navidrome with fresh database...');
          await restartNavidrome();

          // ------------------------------------------------------------------
          // Step 5: Dry-run sync with --check-artwork to detect changes
          // ------------------------------------------------------------------
          console.log('Step 5: Dry-run sync to detect artwork changes...');
          const { result: dryRunResult, json: dryRunJson } = await runCliJson<SyncOutput>(
            [
              '--config',
              configPath,
              'sync',
              '--device',
              target.path,
              '--check-artwork',
              '--dry-run',
              '--json',
            ],
            {
              env: { SUBSONIC_PASSWORD: password },
              timeout: 120000,
            }
          );

          expect(dryRunResult.exitCode).toBe(0);
          expect(dryRunJson?.success).toBe(true);
          expect(dryRunJson?.dryRun).toBe(true);

          // ------------------------------------------------------------------
          // Step 6: Verify artwork-updated appears in the update breakdown
          // ------------------------------------------------------------------
          const updateCount = dryRunJson?.plan?.tracksToUpdate ?? 0;
          // Cast to Record to access artwork-updated which may not be in all type versions
          const breakdown = dryRunJson?.plan?.updateBreakdown as
            | Record<string, number | undefined>
            | undefined;

          console.log(`Artwork change detection result:`);
          console.log(`  Tracks to update: ${updateCount}`);
          console.log(`  Update breakdown: ${JSON.stringify(breakdown)}`);
          expect(updateCount).toBeGreaterThan(0);
          expect(breakdown).toBeDefined();
          expect(breakdown?.['artwork-updated']).toBeGreaterThan(0);

          // All 3 tracks share the same album artwork, so all should be detected
          expect(breakdown?.['artwork-updated']).toBeGreaterThanOrEqual(3);

          console.log('Artwork change detection verified');

          // ------------------------------------------------------------------
          // Step 6: Actually sync the artwork updates (not just dry-run)
          // ------------------------------------------------------------------
          console.log('Step 6: Syncing artwork updates...');
          const { result: updateResult, json: updateJson } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
            {
              env: { SUBSONIC_PASSWORD: password },
              timeout: 180000,
            }
          );

          expect(updateResult.exitCode).toBe(0);
          expect(updateJson?.success).toBe(true);
          expect(updateJson?.result?.completed).toBeGreaterThanOrEqual(3);
          console.log(`Artwork sync completed: ${updateJson?.result?.completed} tracks updated`);

          // ------------------------------------------------------------------
          // Step 7: Verify idempotency — next sync should show 0 updates
          // ------------------------------------------------------------------
          console.log('Step 7: Verifying idempotency after artwork sync...');
          const { result: idempotentResult, json: idempotentJson } = await runCliJson<SyncOutput>(
            [
              '--config',
              configPath,
              'sync',
              '--device',
              target.path,
              '--check-artwork',
              '--dry-run',
              '--json',
            ],
            {
              env: { SUBSONIC_PASSWORD: password },
              timeout: 60000,
            }
          );

          expect(idempotentResult.exitCode).toBe(0);
          expect(idempotentJson?.plan?.tracksToUpdate).toBe(0);
          expect(idempotentJson?.plan?.tracksToAdd).toBe(0);
          console.log('Idempotency verified — no further updates needed');
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    },
    600000 // 10 min timeout for full workflow (sync + rescan + verify)
  );

  it.skipIf(!subsonicE2eEnabled)(
    'detects artwork-removed via Subsonic after stripping embedded artwork',
    async () => {
      if (!shouldRun()) {
        console.log('Skipping: Docker not available or setup failed');
        return;
      }

      // The adapter probes for Navidrome's placeholder image at connect time.
      // After stripping artwork, getCoverArt returns the placeholder, which is
      // filtered out → hasArtwork=false → artwork-removed correctly detected.

      await withTarget(async (target) => {
        const configPath = await createArtworkCheckConfig(serverPort);

        try {
          // Step 1: Ensure goldberg tracks have artwork
          console.log('artwork-removed Step 1: Restoring artwork in goldberg fixtures...');
          restoreArtworkInFixtures(musicDir);
          await restartNavidrome();

          // Step 2: Initial sync (artwork present)
          console.log('artwork-removed Step 2: Initial sync with artwork present...');
          const { result: syncResult, json: syncJson } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
            { env: { SUBSONIC_PASSWORD: password }, timeout: 180000 }
          );
          expect(syncResult.exitCode).toBe(0);
          expect(syncJson?.result?.completed).toBeGreaterThanOrEqual(3);

          // Step 3: Strip all artwork from goldberg FLACs
          console.log('artwork-removed Step 3: Stripping artwork from source files...');
          stripArtworkFromFixtures(musicDir);

          // Step 4: Restart Navidrome (fresh DB, rescans artworkless files)
          console.log('artwork-removed Step 4: Restarting Navidrome...');
          await restartNavidrome();

          // Step 5: Dry-run to detect artwork-removed
          console.log('artwork-removed Step 5: Dry-run to detect artwork-removed...');
          const { result: dryRunResult, json: dryRunJson } = await runCliJson<SyncOutput>(
            [
              '--config',
              configPath,
              'sync',
              '--device',
              target.path,
              '--check-artwork',
              '--dry-run',
              '--json',
            ],
            { env: { SUBSONIC_PASSWORD: password }, timeout: 120000 }
          );
          expect(dryRunResult.exitCode).toBe(0);

          const breakdown = dryRunJson?.plan?.updateBreakdown as
            | Record<string, number | undefined>
            | undefined;
          console.log(`artwork-removed result: ${JSON.stringify(breakdown)}`);
          expect(breakdown?.['artwork-removed']).toBeGreaterThanOrEqual(3);

          // Step 6: Apply
          console.log('artwork-removed Step 6: Applying...');
          const { result: applyResult } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
            { env: { SUBSONIC_PASSWORD: password }, timeout: 180000 }
          );
          expect(applyResult.exitCode).toBe(0);

          // Step 7: Verify idempotency
          console.log('artwork-removed Step 7: Verifying idempotency...');
          const { json: idempotentJson } = await runCliJson<SyncOutput>(
            [
              '--config',
              configPath,
              'sync',
              '--device',
              target.path,
              '--check-artwork',
              '--dry-run',
              '--json',
            ],
            { env: { SUBSONIC_PASSWORD: password }, timeout: 60000 }
          );
          expect(idempotentJson?.plan?.tracksToUpdate).toBe(0);
          console.log('artwork-removed: idempotency verified');
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    },
    600000
  );

  it.skipIf(!subsonicE2eEnabled)(
    'detects artwork-added via Subsonic after embedding artwork in a bare track',
    async () => {
      if (!shouldRun()) {
        console.log('Skipping: Docker not available or setup failed');
        return;
      }

      // The dual-tone fixture has no embedded artwork. After initial sync, the
      // adapter detects Navidrome's placeholder and sets hasArtwork=false. Then
      // we embed artwork, restart Navidrome, and the adapter sees real artwork
      // (different hash from placeholder) → artwork-added.

      await withTarget(async (target) => {
        const configPath = await createArtworkCheckConfig(serverPort);

        try {
          // Step 1: Copy dual-tone track (no artwork) into music dir
          console.log('artwork-added Step 1: Adding dual-tone track to Navidrome library...');
          const syntheticDir = join(musicDir, 'Test Tones', 'Synthetic Tests');
          await mkdir(syntheticDir, { recursive: true });
          const dualToneSrc = getTrackPath(Tracks.DUAL_TONE.album, Tracks.DUAL_TONE.filename);
          const dualTonePath = join(syntheticDir, Tracks.DUAL_TONE.filename);
          await copyFile(dualToneSrc, dualTonePath);
          await restartNavidrome();

          // Step 2: Initial sync (dual-tone has no artwork, placeholder is filtered)
          console.log('artwork-added Step 2: Initial sync (no artwork)...');
          const { result: syncResult, json: syncJson } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
            { env: { SUBSONIC_PASSWORD: password }, timeout: 180000 }
          );
          expect(syncResult.exitCode).toBe(0);
          expect(syncJson?.result?.completed).toBeGreaterThanOrEqual(1);

          // Step 3: Add artwork to the dual-tone track
          console.log('artwork-added Step 3: Adding artwork to dual-tone track...');
          addArtworkToTrack(dualTonePath, tempDir);

          // Step 4: Restart Navidrome (fresh DB, rescans file with new artwork)
          console.log('artwork-added Step 4: Restarting Navidrome...');
          await restartNavidrome();

          // Step 5: Dry-run to detect artwork-added
          console.log('artwork-added Step 5: Dry-run to detect artwork-added...');
          const { result: dryRunResult, json: dryRunJson } = await runCliJson<SyncOutput>(
            [
              '--config',
              configPath,
              'sync',
              '--device',
              target.path,
              '--check-artwork',
              '--dry-run',
              '--json',
            ],
            { env: { SUBSONIC_PASSWORD: password }, timeout: 120000 }
          );
          expect(dryRunResult.exitCode).toBe(0);

          const breakdown = dryRunJson?.plan?.updateBreakdown as
            | Record<string, number | undefined>
            | undefined;
          console.log(`artwork-added result: ${JSON.stringify(breakdown)}`);
          expect(breakdown?.['artwork-added']).toBeGreaterThanOrEqual(1);

          // Step 6: Apply
          console.log('artwork-added Step 6: Applying...');
          const { result: applyResult } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
            { env: { SUBSONIC_PASSWORD: password }, timeout: 180000 }
          );
          expect(applyResult.exitCode).toBe(0);

          // Step 7: Verify idempotency
          console.log('artwork-added Step 7: Verifying idempotency...');
          const { json: idempotentJson } = await runCliJson<SyncOutput>(
            [
              '--config',
              configPath,
              'sync',
              '--device',
              target.path,
              '--check-artwork',
              '--dry-run',
              '--json',
            ],
            { env: { SUBSONIC_PASSWORD: password }, timeout: 60000 }
          );
          expect(idempotentJson?.plan?.tracksToUpdate).toBe(0);
          console.log('artwork-added: idempotency verified');
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    },
    600000
  );
});
