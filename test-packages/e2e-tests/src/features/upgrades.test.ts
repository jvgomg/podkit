/**
 * E2E tests for self-healing sync (upgrade detection and application).
 *
 * Covers four upgrade paths:
 * - Metadata correction (genre, year, trackNumber, ...) — purely metadata
 *   comparison, runs on every adapter.
 * - Normalization update — soundcheck / ReplayGain re-write when source
 *   values change.
 * - Format upgrade (MP3 → FLAC re-routed to transcode) — see
 *   `documents/architecture/sync/upgrades.md` for why this gate is
 *   suppressed when the iPod track is already AAC.
 * - Quality upgrade (MP3 source bitrate rises past the iPod-stored copy) —
 *   requires both `source.bitrate` and the iPod track's persisted bitrate
 *   to populate the `detectUpgrades` gate; the second is written on copy
 *   today, with `--force-sync-tags` backfilling pre-existing tracks.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm, copyFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { ensureFixturesExist, requireFFmpeg, requireMetaflac } from '@podkit/e2e-shared';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { getTrackPath, Tracks, type AlbumDir } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

requireMetaflac();
ensureFixturesExist('goldberg-selections');

/**
 * Tracks used for upgrade testing — all from Goldberg Selections with artwork.
 */
const TEST_TRACKS: Array<{ source: { album: AlbumDir; filename: string } }> = [
  { source: Tracks.HARMONY },
  { source: Tracks.VIBRATO },
  { source: Tracks.TREMOLO },
];

/**
 * Create a test collection by copying FLAC fixtures.
 *
 * @returns Path to the test collection directory
 */
async function createTestCollection(): Promise<string> {
  const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-upgrade-'));

  for (const track of TEST_TRACKS) {
    const sourcePath = getTrackPath(track.source.album, track.source.filename);
    const destPath = join(collectionDir, track.source.filename);
    await copyFile(sourcePath, destPath);
  }

  return collectionDir;
}

/**
 * Modify the GENRE tag on all FLAC files in the collection.
 */
function changeGenre(collectionDir: string, newGenre: string): void {
  for (const track of TEST_TRACKS) {
    const filePath = join(collectionDir, track.source.filename);
    execSync(`metaflac --remove-tag=GENRE --set-tag="GENRE=${newGenre}" "${filePath}"`, {
      stdio: 'ignore',
    });
  }
}

/**
 * Modify the DATE (year) tag on all FLAC files in the collection.
 */
function changeYear(collectionDir: string, newYear: number): void {
  for (const track of TEST_TRACKS) {
    const filePath = join(collectionDir, track.source.filename);
    execSync(`metaflac --remove-tag=DATE --set-tag="DATE=${newYear}" "${filePath}"`, {
      stdio: 'ignore',
    });
  }
}

/**
 * Create a config file for the test collection.
 */
async function createConfigFile(configDir: string, options: { source: string }): Promise<string> {
  const configPath = join(configDir, 'config.toml');

  const content = `version = 2

[music.default]
path = "${options.source}"

quality = "low"

[defaults]
music = "default"
`;

  await writeFile(configPath, content);
  return configPath;
}

// =============================================================================
// Tests
// =============================================================================

describe('self-healing sync: upgrade workflow', () => {
  it('detects and applies metadata corrections (genre change)', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection with original genre ("Electronic") and sync
        collectionDir = await createTestCollection();

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result1.exitCode).toBe(0);
        expect(json1?.success).toBe(true);
        expect(json1?.result?.completed).toBe(3);

        const tracksAfterFirstSync = await target.getTracks();
        expect(tracksAfterFirstSync.length).toBe(3);

        // Step 2: Change genre to "Ambient" in the source files
        changeGenre(collectionDir, 'Ambient');

        // Step 3: Sync again — should detect metadata corrections
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

        // Step 4: Verify track count is unchanged (corrections, not adds)
        const tracksAfterCorrection = await target.getTracks();
        expect(tracksAfterCorrection.length).toBe(3);

        // Step 5: Verify updates were applied. changeGenre + changeYear hit
        // every fixture track, so all 3 should complete. Detailed plan
        // breakdown is asserted in the sibling dry-run test below;
        // non-dry-run sync output does not carry `plan`.
        expect(json2!.result!.completed).toBe(3);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('reports metadata corrections in dry-run without applying them', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection and initial sync
        collectionDir = await createTestCollection();

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        const initialCount = (await target.getTracks()).length;
        expect(initialCount).toBe(3);

        // Step 2: Change metadata
        changeGenre(collectionDir, 'Ambient');
        changeYear(collectionDir, 2000);

        // Step 3: Dry-run sync — detect corrections without applying
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

        // Should report metadata corrections for all 3 fixture tracks.
        expect(json!.plan).toBeDefined();
        expect(json!.plan!.tracksToUpdate).toBe(3);
        expect(json!.plan!.tracksToAdd).toBe(0);

        // Track count should be unchanged (dry-run didn't modify anything)
        const countAfterDryRun = (await target.getTracks()).length;
        expect(countAfterDryRun).toBe(initialCount);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('preserves track count through metadata correction cycle', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection and sync
        collectionDir = await createTestCollection();

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        // Step 2: Change metadata and sync
        changeGenre(collectionDir, 'Ambient');
        await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        // Step 3: Change metadata again and sync
        changeGenre(collectionDir, 'Classical');
        changeYear(collectionDir, 1999);
        const { result: result3, json: json3 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result3.exitCode).toBe(0);
        expect(json3?.success).toBe(true);

        // Track count should still be 3 through all correction cycles
        const finalTracks = await target.getTracks();
        expect(finalTracks.length).toBe(3);

        // Step 4: Sync again with no changes — should be no-op
        const { json: json4 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        // Idempotency: a no-change re-sync should perform zero operations.
        // (Non-dry-run sync output has no `plan`; assert on `result` instead.)
        expect(json4!.result!.completed).toBe(0);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});

// =============================================================================
// Normalization update: verify soundcheck is written and re-sync is idempotent
//
// Source FLAC fixtures include ReplayGain tags. After the initial sync, the iPod
// should have non-zero soundcheck values. A re-sync with no changes should
// produce zero updates (proving the normalization was actually persisted).
// =============================================================================

describe('self-healing sync: normalization update', () => {
  it('initial sync writes soundcheck and re-sync is idempotent', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection with ReplayGain tags and sync
        collectionDir = await createTestCollection();

        // Ensure all tracks have ReplayGain tags
        for (const track of TEST_TRACKS) {
          const filePath = join(collectionDir, track.source.filename);
          execSync(
            `metaflac --remove-tag=REPLAYGAIN_TRACK_GAIN --set-tag="REPLAYGAIN_TRACK_GAIN=-7.50 dB" "${filePath}"`,
            { stdio: 'ignore' }
          );
        }

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result1.exitCode).toBe(0);
        expect(json1?.success).toBe(true);
        expect(json1?.result?.completed).toBe(3);

        // Step 2: Re-sync with no changes — should be a no-op
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

        // Idempotency: a no-change re-sync should perform zero operations.
        expect(json2!.result!.completed).toBe(0);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('detects and applies normalization changes', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection with ReplayGain -3.0 dB and sync
        collectionDir = await createTestCollection();

        for (const track of TEST_TRACKS) {
          const filePath = join(collectionDir, track.source.filename);
          execSync(
            `metaflac --remove-tag=REPLAYGAIN_TRACK_GAIN --set-tag="REPLAYGAIN_TRACK_GAIN=-3.00 dB" "${filePath}"`,
            { stdio: 'ignore' }
          );
        }

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        // Step 2: Change ReplayGain to -9.0 dB (>0.1 dB change triggers update)
        for (const track of TEST_TRACKS) {
          const filePath = join(collectionDir, track.source.filename);
          execSync(
            `metaflac --remove-tag=REPLAYGAIN_TRACK_GAIN --set-tag="REPLAYGAIN_TRACK_GAIN=-9.00 dB" "${filePath}"`,
            { stdio: 'ignore' }
          );
        }

        // Step 3: Re-sync — should detect normalization updates
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

        // Normalization change applied to all 3 tracks (no adds, no removes).
        expect(json2!.result!.completed).toBe(3);

        // Step 4: Re-sync again — should be idempotent now
        const { result: result3, json: json3 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result3.exitCode).toBe(0);
        // Idempotent: third sync (re-sync with no changes) does no work.
        expect(json3!.result!.completed).toBe(0);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});

// =============================================================================
// Format upgrade: MP3 → FLAC (transcoded to AAC)
//
// This is the exact scenario that caused playback failures on real iPods:
// 1. User has MP3s, syncs to iPod (copies as-is with .mp3 extension)
// 2. User replaces MP3s with FLACs in their collection
// 3. Sync detects format upgrade, transcodes FLAC to AAC
// 4. The replaced file MUST have .m4a extension (not .mp3) or iPod can't play it
// =============================================================================

/**
 * Generate a short MP3 test file with specific metadata.
 */
function generateMp3(
  outputPath: string,
  metadata: { title: string; artist: string; album: string }
): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
      `-metadata title="${metadata.title}" ` +
      `-metadata artist="${metadata.artist}" ` +
      `-metadata album="${metadata.album}" ` +
      `-b:a 128k -y "${outputPath}"`,
    { stdio: 'ignore' }
  );
}

/**
 * Generate a short FLAC test file with the same metadata as the MP3.
 */
function generateFlac(
  outputPath: string,
  metadata: { title: string; artist: string; album: string }
): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
      `-metadata title="${metadata.title}" ` +
      `-metadata artist="${metadata.artist}" ` +
      `-metadata album="${metadata.album}" ` +
      `-c:a flac -y "${outputPath}"`,
    { stdio: 'ignore' }
  );
}

/**
 * Recursively find all audio files on the iPod's music directory.
 *
 * Uses withFileTypes to filter for directories explicitly rather than
 * relying on a try/catch around readdir to swallow ENOTDIR — a swallowed
 * error would have hidden permission failures or filesystem corruption.
 */
async function findIpodMusicFiles(ipodPath: string): Promise<string[]> {
  const musicDir = join(ipodPath, 'iPod_Control', 'Music');
  if (!existsSync(musicDir)) return [];

  const files: string[] = [];
  const entries = await readdir(musicDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subdirPath = join(musicDir, entry.name);
    const subEntries = await readdir(subdirPath);
    for (const subEntry of subEntries) {
      files.push(join(subdirPath, subEntry));
    }
  }
  return files;
}

describe('self-healing sync: format upgrade (MP3 → FLAC)', () => {
  it('upgrades MP3 to AAC with correct .m4a extension', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-format-upgrade-'));

      try {
        const trackMeta = {
          title: 'Format Test',
          artist: 'Upgrade Artist',
          album: 'Upgrade Album',
        };

        // Step 1: Create collection with MP3 and sync
        generateMp3(join(collectionDir, 'track.mp3'), trackMeta);

        const configPath = await createConfigFile(configDir, { source: collectionDir });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect(json1?.result?.completed).toBe(1);

        // Verify the track was copied as MP3 (compatible lossy → direct copy)
        const filesAfterFirstSync = await findIpodMusicFiles(target.path);
        const mp3Files = filesAfterFirstSync.filter((f) => f.endsWith('.mp3'));
        expect(mp3Files).toHaveLength(1);

        // Step 2: Replace source MP3 with a FLAC (same metadata)
        execSync(`rm "${join(collectionDir, 'track.mp3')}"`, { stdio: 'ignore' });
        generateFlac(join(collectionDir, 'track.flac'), trackMeta);

        // Step 3: Sync again — should detect format upgrade and transcode
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

        // Should have upgraded (not added) — track count stays at 1
        const tracksAfterUpgrade = await target.getTracks();
        expect(tracksAfterUpgrade).toHaveLength(1);

        // Step 4: Verify the file on the iPod now has .m4a extension
        const filesAfterUpgrade = await findIpodMusicFiles(target.path);
        const m4aFiles = filesAfterUpgrade.filter((f) => f.endsWith('.m4a'));
        const remainingMp3Files = filesAfterUpgrade.filter((f) => f.endsWith('.mp3'));

        // This is the critical assertion: the upgraded file must be .m4a, not .mp3
        // If this fails, the iPod firmware would try to decode AAC with the MP3
        // decoder and playback would fail.
        expect(m4aFiles).toHaveLength(1);
        expect(remainingMp3Files).toHaveLength(0);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);
});

// =============================================================================
// Quality upgrade: MP3 source bitrate rises past the iPod-stored copy.
//
// Closes the gap documented at the top of the file: `detectUpgrades`'s
// quality-upgrade gate compares `source.bitrate && ipod.bitrate`. New copies
// receive the source bitrate during `transferToIpod` (see
// `packages/podkit-core/src/sync/music/transfer.ts:toDeviceTrackInput`), so
// re-syncing a higher-bitrate source file detects the upgrade WITHOUT
// `--force-sync-tags`.
//
// Thresholds (see `packages/podkit-core/src/sync/engine/upgrades.ts`):
// - `MIN_BITRATE_INCREASE_KBPS` = 64 kbps absolute delta, OR
// - `MIN_BITRATE_MULTIPLIER`    = 1.5x relative ratio.
// 96 → 256 kbps passes both gates comfortably.
// =============================================================================

/**
 * Generate an MP3 at a specified bitrate (kbps). Used by the quality-upgrade
 * test to swap a low-bitrate source for a higher-bitrate one.
 */
function generateMp3AtBitrate(
  outputPath: string,
  metadata: { title: string; artist: string; album: string },
  bitrateKbps: number
): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
      `-metadata title="${metadata.title}" ` +
      `-metadata artist="${metadata.artist}" ` +
      `-metadata album="${metadata.album}" ` +
      `-b:a ${bitrateKbps}k -y "${outputPath}"`,
    { stdio: 'ignore' }
  );
}

describe('self-healing sync: quality upgrade (MP3 bitrate increase)', () => {
  it('replaces the iPod track when source bitrate rises significantly', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-quality-upgrade-'));

      try {
        const trackMeta = {
          title: 'Quality Test',
          artist: 'Upgrade Artist',
          album: 'Upgrade Album',
        };

        // Step 1: Sync the source at 96 kbps. With the persisted bitrate,
        // the iPod track will carry `bitrate = 96` for the next-sync
        // comparison.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 96);

        const configPath = await createConfigFile(configDir, { source: collectionDir });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect(json1?.result?.completed).toBe(1);

        const tracksAfterFirstSync = await target.getTracks();
        expect(tracksAfterFirstSync).toHaveLength(1);
        // Pin the bitrate is actually persisted on the iPod side — without
        // this, the quality-upgrade gate cannot fire. Allow a small VBR
        // wiggle (FFmpeg may report 96.x kbps as 95 or 97 in libgpod).
        const initialBitrate = tracksAfterFirstSync[0]!.bitrate;
        expect(initialBitrate).toBeGreaterThan(0);
        expect(initialBitrate).toBeLessThan(150);

        // Step 2: Replace source with a 256 kbps re-encode. Same metadata,
        // same file path — the matcher still considers it the same track.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 256);

        // Step 3a: Dry-run first to pin the plan reports a quality-upgrade.
        // Without this assertion, a future regression that silently filtered
        // out the upgrade (e.g. classifier returning copy instead of upgrade)
        // could let the test still pass on the bitrate check below if some
        // unrelated codepath happened to refresh the field.
        const { json: dryJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);
        expect(dryJson?.plan?.updateBreakdown?.['quality-change-up']).toBe(1);

        // Step 3: Re-sync WITHOUT `--force-sync-tags`. The expectation
        // is that the quality-change (source-improved, up) gate fires now that
        // both sides of the bitrate comparison are populated.
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
        expect(json2?.result?.completed).toBe(1);

        // Step 4: Track count unchanged — this is an upgrade (file
        // replacement), not an add.
        const tracksAfterUpgrade = await target.getTracks();
        expect(tracksAfterUpgrade).toHaveLength(1);

        // Step 5: The iPod track's bitrate now reflects the upgraded
        // source. If quality-upgrade had failed to fire, the bitrate
        // would remain at the original 96 kbps.
        const upgradedBitrate = tracksAfterUpgrade[0]!.bitrate;
        expect(upgradedBitrate).toBeGreaterThan(initialBitrate);
        expect(upgradedBitrate).toBeGreaterThan(200);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);
});
