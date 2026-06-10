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
 *   bun run test:e2e:docker
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import { mkdir, readdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  ensureFixturesExist,
  requireFFmpeg,
  requireMetaflac,
  runCliJson,
  cleanupTempConfig,
} from '@podkit/e2e-shared';
import { withTarget } from '../targets/index.js';
import { getTrackPath, Tracks } from '../helpers/fixtures.js';
import { isDockerAvailable } from '../sources/subsonic.js';
import { startNavidromeContainer, type NavidromeContainer } from '../docker/index.js';

import type { SyncOutput } from 'podkit/types';

requireFFmpeg();
requireMetaflac();
ensureFixturesExist('goldberg-selections');
ensureFixturesExist('synthetic-tests');

// =============================================================================
// Test Setup
// =============================================================================

let dockerAvailable = false;
let navidromeContainer: NavidromeContainer | null = null;
let tempDir: string;
let musicDir: string;
let dataDir: string;
let serverPort: number;
let password: string;

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
 * Wipe the Navidrome musicDir clean. Each test then populates only the
 * fixtures it needs — full isolation so a test's `completed` count is bounded
 * to its own files, not what an earlier test happened to leave behind.
 */
async function resetMusicDir(): Promise<void> {
  const entries = await readdir(musicDir);
  for (const entry of entries) {
    await rm(join(musicDir, entry), { recursive: true, force: true });
  }
}

/**
 * Update the Subsonic URL port in a config file.
 *
 * After a docker restart with dynamic port allocation, the host port changes.
 * Config files that were created with the old port need to be updated.
 */
async function updateConfigPort(configPath: string, newPort: number): Promise<void> {
  const content = await readFile(configPath, 'utf-8');
  const updated = content.replace(
    /url = "http:\/\/localhost:\d+"/,
    `url = "http://localhost:${newPort}"`
  );
  await writeFile(configPath, updated);
}

/**
 * Restart the Navidrome container with a fresh database.
 *
 * Forces Navidrome to rebuild from scratch and re-extract artwork — the most
 * reliable way to serve updated artwork after modifying source files, since
 * Navidrome caches artwork aggressively. The restart reassigns the host port,
 * so config files created with the old port are updated when `configPath` is
 * passed.
 */
async function restartNavidrome(configPath?: string): Promise<void> {
  // After per-test fixture setup, musicDir contains at least one album.
  // Wait for the post-restart scan to index it before returning so the next
  // sync doesn't see a stale/empty library.
  await navidromeContainer!.restart({ minAlbums: 1 });
  serverPort = navidromeContainer!.port;

  if (configPath) {
    await updateConfigPort(configPath, serverPort);
  }
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
    `version = 2

[music.main]
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
  dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker is not available — required for @podkit/e2e-tests docker suite.');
  }

  // Create temp directories + a starter fixture so Navidrome's initial scan
  // sees at least one album. beforeEach wipes this before every test.
  tempDir = join(tmpdir(), `podkit-artwork-change-${randomUUID()}`);
  musicDir = join(tempDir, 'music');
  dataDir = join(tempDir, 'data');
  await mkdir(musicDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await createArtworkFixtures(musicDir);

  // Mount music read-write so tests can modify artwork between syncs.
  navidromeContainer = await startNavidromeContainer({
    musicDir,
    dataDir,
    writable: true,
    label: 'subsonic-artwork',
  });
  serverPort = navidromeContainer.port;
  password = navidromeContainer.password;
  console.log(`Navidrome ready on port ${serverPort}`);
}, 120000);

// Each test populates its own fixtures from a clean slate. Without this the
// three tests share one library: a goldberg fixture from an earlier test
// would still be served when the artwork-added test syncs its dual-tone,
// making the `completed === 1` assertion fuzzy.
beforeEach(async () => {
  await resetMusicDir();
});

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

describe('artwork change detection (Subsonic)', () => {
  it('detects changed artwork via Subsonic after re-embedding', async () => {
    await createArtworkFixtures(musicDir);
    await restartNavidrome();

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
        expect(syncJson?.result?.completed).toBe(3);

        const trackCount = await target.getTrackCount();
        expect(trackCount).toBe(3);
        console.log(`Initial sync completed: ${syncJson?.result?.completed} tracks`);

        // ------------------------------------------------------------------
        // Step 2: Confirm the initial sync is already idempotent — no
        // second --force-sync-tags pass needed to establish baselines.
        //
        // Initial-add now writes the artwork-hash baseline directly during
        // the transfer step when --check-artwork supplies a source hash and
        // the bytes successfully land on the device. The earlier two-pass
        // workaround (sync, then --force-sync-tags) is no longer required;
        // first-run users get artwork-change detection on their next sync.
        // --force-sync-tags is still honoured for users backfilling
        // baselines on tracks added before this feature shipped.
        // ------------------------------------------------------------------
        console.log('Step 2: Verifying initial-add baseline is idempotent...');
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
        // Baselines were established during initial add; no further updates.
        expect(verifyJson?.plan?.tracksToUpdate).toBe(0);

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
        await restartNavidrome(configPath);

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
        // All 3 tracks share the same album artwork, so all should be detected
        expect(updateCount).toBe(3);
        expect(breakdown).toBeDefined();
        expect(breakdown?.['artwork-updated']).toBe(3);

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
        expect(updateJson?.result?.completed).toBe(3);
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
  }, 600000); // 10 min timeout for full workflow (sync + rescan + verify)

  it('detects artwork-removed via Subsonic after stripping embedded artwork', async () => {
    // The adapter probes for Navidrome's placeholder image at connect time.
    // After stripping artwork, getCoverArt returns the placeholder, which is
    // filtered out → hasArtwork=false → artwork-removed correctly detected.

    await createArtworkFixtures(musicDir);
    await restartNavidrome();

    await withTarget(async (target) => {
      const configPath = await createArtworkCheckConfig(serverPort);

      try {
        // Step 1: Initial sync — fixtures already have artwork.
        console.log('artwork-removed Step 1: Initial sync with artwork present...');
        const { result: syncResult, json: syncJson } = await runCliJson<SyncOutput>(
          ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
          { env: { SUBSONIC_PASSWORD: password }, timeout: 180000 }
        );
        expect(syncResult.exitCode).toBe(0);
        expect(syncJson?.result?.completed).toBe(3);

        // Step 2: Strip all artwork from goldberg FLACs.
        console.log('artwork-removed Step 2: Stripping artwork from source files...');
        stripArtworkFromFixtures(musicDir);

        // Step 3: Restart Navidrome (fresh DB, rescans artworkless files).
        console.log('artwork-removed Step 3: Restarting Navidrome...');
        await restartNavidrome(configPath);

        // Step 4: Dry-run to detect artwork-removed.
        console.log('artwork-removed Step 4: Dry-run to detect artwork-removed...');
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
        expect(breakdown?.['artwork-removed']).toBe(3);

        // Step 5: Apply.
        console.log('artwork-removed Step 5: Applying...');
        const { result: applyResult } = await runCliJson<SyncOutput>(
          ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
          { env: { SUBSONIC_PASSWORD: password }, timeout: 180000 }
        );
        expect(applyResult.exitCode).toBe(0);

        // Step 6: Verify idempotency.
        console.log('artwork-removed Step 6: Verifying idempotency...');
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
  }, 600000);

  it('detects artwork-added via Subsonic after embedding artwork in a bare track', async () => {
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
        await restartNavidrome(configPath);

        // Step 2: Initial sync (dual-tone has no artwork, placeholder is filtered)
        console.log('artwork-added Step 2: Initial sync (no artwork)...');
        const { result: syncResult, json: syncJson } = await runCliJson<SyncOutput>(
          ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
          { env: { SUBSONIC_PASSWORD: password }, timeout: 180000 }
        );
        expect(syncResult.exitCode).toBe(0);
        // Only dual-tone is in the library — beforeEach wipes everything else.
        expect(syncJson?.result?.completed).toBe(1);

        // Step 3: Add artwork to the dual-tone track
        console.log('artwork-added Step 3: Adding artwork to dual-tone track...');
        addArtworkToTrack(dualTonePath, tempDir);

        // Step 4: Restart Navidrome (fresh DB, rescans file with new artwork)
        console.log('artwork-added Step 4: Restarting Navidrome...');
        await restartNavidrome(configPath);

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
        expect(breakdown?.['artwork-added']).toBe(1);

        // Step 6: Apply.
        console.log('artwork-added Step 6: Applying...');
        const { result: applyResult, json: applyJson } = await runCliJson<SyncOutput>(
          ['--config', configPath, 'sync', '--device', target.path, '--check-artwork', '--json'],
          { env: { SUBSONIC_PASSWORD: password }, timeout: 180000 }
        );
        expect(applyResult.exitCode).toBe(0);
        // Exactly one track in the library; the artwork-added op completes it.
        expect(applyJson?.result?.completed).toBe(1);

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
  }, 600000);
});
